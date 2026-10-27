# Anomaly detection experiments (reviewer rerun)

All files here are additive. The original scripts (`generate_synthetic_audit_data.py`,
`feature_engineering.py`, `pyod_ensemble.py`, `lstm_sequence_model.py`,
`priority_tagging.py`, `compute_detection_metrics.py`) are unchanged, so the
Table V pipeline still runs exactly as before.

## Tier status

**P1 (the five-detector ensemble) is the detector.** P2 and every LSTM-based method (LSTM only, DeepLog-style,
P1 + P2) are an **experimental sequence tier**: under realistic, contaminated training data they add false positives
for little recall (see `results/`). Result tables label the combined row "P1 + P2 (experimental sequence tier)".
Their usefulness depends on vetted training data (see the clean-training and P1-filtered ablations).

## Run

```bash
source .venv/bin/activate
python run_experiments.py --sanity --seeds 1-3                 # dataset diagnostics, no models
python run_experiments.py --profile legacy --seeds 1           # Table V dataset under the new protocol
python run_experiments.py --profile v2 --seeds 1-10 --figures  # main experiment (~5 min)
python run_experiments.py --profile v2 --seeds 1-10 --severity 0.5
python run_experiments.py --profile v2 --seeds 1-10 --exclude-type bigram_violation
python run_experiments.py --profile v2 --seeds 1-10 --clean-train   # oracle ablation: fit on training data with all injected events removed
```

Each run writes one folder, `runs/<profile>_<timestamp>/`: `summary.md`
(mean ± std tables), `summary.csv`, `per_seed.csv`, `sweep_mean.csv`,
`by_type_pooled.csv`, `dataset_per_seed.csv`, `config.json`, optional `sweep.png`.
`./cleanup_anomaly_dir.sh` prunes old `runs/` folders.

## Dataset (for Section III-F)

* Table V dataset = `generate_synthetic_audit_data.py --days 90 --seed 1`
  (15,936 events, 1,138 anomalous; 4,704 actor-day windows, 81 anomalous).
  `--profile legacy --seed 1` regenerates it; only the `auditID` values differ
  from the original file (they are now seeded).
* `v2` keeps the schema, panels and injectors and adds: heavy-tailed per-actor
  activity (lognormal, sigma 0.8); benign confounders in normal traffic
  (legitimate consent-lapse and mis-click `ACCESS_DENIED`, on-call off-hours
  doctors, in-panel rapid "rounds", 20-90 min legitimate dispenses); `anomaly_type`
  on every injection; `--severity` (fraction of volume-based injection events
  kept); 3x as many injections by default.
* Injected anomaly types: off_hours_burst, broad_access, consent_probe,
  cross_org_denied, dispense_without_read, order_composition, bigram_violation.
  Injection days are uniform in time, so most fall in the training period
  (training data is contaminated, as it would be in deployment).
* Limits to state: features were written around the injected behaviours; the
  data validates the pipeline and is not a claim about real-world accuracy.

## Protocol (for Section V-C)

* Chronological split by calendar day, shared by all models: first 60% train,
  next 20% validation, last 20% test. A window lies inside exactly one split.
* Fitted on train only: scaler, the five PyOD detectors, the LSTM. Chosen on
  validation only: P1/P2 percentile thresholds, min-max ranges, LSTM z-score
  statistics and early stopping, DeepLog's `g`. Test is reported only.
* P1 = ensemble score >= 97th percentile of validation scores. P2 = LSTM
  max-z-surprisal >= 99th percentile of validation scores and not P1.
* Seeds 1..N are both the generator seed and the model seed; results are
  mean ± std over seeds.
* PyOD `contamination` is a fixed 0.05 (not derived from labels); it only
  affects the `votes` rule.

## Reporting precision correctly

At a fixed flag budget precision cannot exceed `n_pos / flags`
(`precision_ceiling` in the tables). The old Section V-C attributed the
ceiling to class imbalance; with 33 + 6 = 39 flags and 19 positives the
ceiling was 19/39 = 0.49, set by the percentile thresholds. Report flags, TP,
FP, FN and flags per 1,000 windows next to every precision, and use the sweep
(`sweep_mean.csv`, `sweep.png`) to show how precision and recall move with the
threshold.

## Clean-training ablation

`--clean-train` removes every injected event from the data the ensemble and LSTM are fitted on
(thresholds still come from the unmodified validation split). It uses labels, so report it as an
oracle upper bound, not as a deployable result. Purpose: separate "the model cannot represent this
anomaly" from "the model learned the anomaly as normal because training was contaminated".

## Baselines

* Supervised LR and RBF-SVM on the same six features, `class_weight=balanced`,
  Boxwala-et-al.-style stratified 10-fold CV pooled over all windows (random
  folds, so it is optimistic, and it evaluates a different population than the
  test split), plus a temporal variant trained on train+val labels and scored on
  test. These use labels; the other methods do not.
* DeepLog-style rule: same LSTM, a window is flagged if any event's actual next
  token is outside the model's top-g predictions; g is chosen on validation so
  the validation flag rate is closest to P1's budget. This is the log-key model
  only (no parameter-value model).
* The LSTM is a next-event LSTM in the DeepLog family; cite Du et al., CCS 2017.

Note: with clean training, `dispense_without_read_count` is constant 0 in the fit data, which made PyOD's
PCA return +inf for every row (PCA silently dropped out of the ensemble). `run_ensemble` now floors the PCA
component weights at 1e-3 and refreshes its threshold; normal runs are unaffected (identical TP/FP).

## Label-free filtered training (`--p1-filtered-train`)

Trains the LSTM (and so P2 and the DeepLog-style rule) without the training actor-days that P1 flags
(threshold = p97 of validation scores; no labels used). Labels are used only to report how many positives the
filter removed (`n_train_excluded_pos` in `dataset_per_seed.csv`). Purpose: test whether a deployable filter
recovers the clean-training (oracle) result. The ensemble is not refit.

## Choosing the P1 operating point (`--select-pct`, `--p1-pct`)

`--p1-pct X` fixes the P1 percentile (default 97; Isolation Forest-only and the DeepLog-style flag budget follow it).
`--select-pct` instead picks the percentile from {90, 93, 95, 97, 98, 99, 99.5} that maximises F2 (recall weighted twice
as heavily as precision) on the VALIDATION split, ties to the higher percentile, so the test split is never used to
choose the operating point. The chosen value is recorded per seed (`p1_pct` in `dataset_per_seed.csv`). The full sweep is
still reported. Labels `P1 (ensemble, val-selected)` and `IForest only (val-selected pct)` replace the p97 labels in this mode.
The DeepLog-style `g` is the grid value whose validation flag rate is closest to P1's budget; the grid is coarse, so its
flag count can differ from P1's. LSTM-only stays at p99.
