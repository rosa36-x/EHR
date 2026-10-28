# AI Model Evaluation Notes

Supporting material for the paper's threat model, limitations, and
reproducibility sections. See also `AI_MODEL_ROADMAP.md` for the full
capability roadmap.

## Threat Model

| Adversary | Mechanism | Code reference | Coverage |
|---|---|---|---|
| **1. Malicious Insider (valid credentials)** | 5-model PyOD ensemble (PCA/KNN/IForest/OCSVM/HBOS) over per-actor-day features: `off_hours_ratio`, `consent_denied_ratio`, `dispense_without_read_count`, burst count, distinct resources, access frequency | `feature_engineering.py`, `p1_detector.py` | Detected by the deployed tier — `P1_high_confidence`. Order/sequence anomalies (~29% of injected positives) are invisible to the features; the experimental LSTM tier (`P2_sequence_candidate`, off by default) does not recover them reliably |
| **2. Fake Treatment Relationship Attacker** | Access without an active `TreatmentRelationship` record | — | Not implemented. Assessed as feasible (data already exists via `treatment_relationship_contract.go`), scoped as future work |
| **3. Rogue/Compromised AI Model** | `ai_entity` classification: query-rate, purpose-mismatch, unauthorized record-type tracking for AI-model actors | — | Not implemented. No AI-model-as-registered-actor identity exists in the system (ResearchMSP is a skeleton org); this is a prerequisite subsystem, not a detection feature, and is out of scope |
| **4. Emergency Abuse Attacker** | Cross-check flagged actor-day against overlapping `EmergencyAccessLog.reason` | `classifyFlag()` in `anomalyDetectionService.js` | Detected — `emergency_abuse` classification |

## Limitations / Threats to Validity

- **Evaluation is synthetic-only.** All precision/recall/F1 figures are
  against `generate_synthetic_audit_data_v2.py` output with injected, labeled
  anomalies, 10 seeds, leakage-free chronological 60/20/20 split
  (`anomalyDetection/run_experiments.py`, `EXPERIMENTS.md`,
  `anomalyDetection/results/`). No real production audit data was used.
  The earlier figures in this file (recall 0.95 / precision 0.46, p97
  thresholds, ~94 windows) came from the old, leaky protocol and are
  superseded.
- **2 of 4 spec'd adversaries undetected** (see table above).
- **P1 is the deployed detector; the LSTM tier (P2) is experimental and off
  by default.** Under the leakage-free protocol the LSTM alone reaches
  recall 0.14 / precision 0.25 (DeepLog-style baseline: 0.08 / 0.14), and
  P1 + P2 adds only ~0.007 recall to P1 while costing ~18 extra flags per
  1k windows. The cause is training contamination (anomalies sit in the
  unlabelled training window); an oracle clean-train ablation recovers the
  DeepLog-style model, but the label-free variant only re-detects what P1
  already flags. P2 is therefore a ranked-review advisory list, never an
  alert, and is future work (see "Future work" below).
- **No adversarial red-team evaluation.** Detection quality is measured
  against injected synthetic patterns, not an adaptive adversary attempting
  evasion.
- **Single shared Fabric identity per org**, with authorization enforced at
  the application layer rather than per-identity on-chain ABAC — a
  deliberate architectural tradeoff relevant to the system's overall trust
  model.

## 5-Model Ensemble + Two-Tier Priority System

Replaced solo Isolation Forest with a 5-model PyOD ensemble, selected via
a PyCaret/PyOD benchmark across 8 candidates (`pca`/`knn`/`iforest`/
`ocsvm`/`hbos` kept; `cluster`/`mcd`/`lof` dropped for weak or redundant
performance). Equal-weighted average of each model's normalized
`decision_function` score is the actual signal (`anomaly_score`); a
`votes` column (models agreeing, 0-5) is retained for interpretability
only, not used for thresholding (see `pyod_ensemble.py`).

**Feature fix:** `access_denied_ratio` and `consent_denied_ratio` were
found perfectly correlated (r=1.00) on the synthetic dataset — confirmed
via `generate_synthetic_audit_data.py` that `ACCESS_DENIED` is currently
only ever emitted for the two reasons `consent_denied_ratio` already
counts. This caused PCA's `decision_function` to blow up (~1e29) via a
near-singular covariance matrix. `access_denied_ratio` was dropped from
the modeling feature set. This is a synthetic-data artifact, not
necessarily true of production audit logs, where `ACCESS_DENIED` could
have other causes (expired token, RBAC mismatch) — worth re-checking
before assuming the same redundancy holds on real data.

**Structural blind spot (real finding, not noise):** the entire 5-model
ensemble is fit on daily aggregate features (counts/ratios) with no
concept of event order. On the full dataset, all 5 models unanimously
missed 100% (14/14) of `bigram_violation`/`order_composition`-labeled
anomalies — zero votes from any model. This is the empirical justification
for `lstm_sequence_model.py`'s role in the pipeline: it operates on event
sequences, covering exactly the class the aggregate-feature ensemble
cannot see by construction, not a redundant second opinion.

**Deployed design — P1 alerts, P2 is experimental:**
- **P1 (`P1_high_confidence`, deployed):** ensemble score (equal-weight mean
  of per-detector min-max scores) ≥ the p95 of the calibration-window
  scores. The percentile is chosen on validation (F2, recall weighted 2x)
  from {90, 93, 95, 97, 98, 99, 99.5}; it came out as 95 on all ten v2
  seeds. Thresholds are percentiles of an unlabelled window, so the same
  procedure runs on real data (`p1_detector.py train`). Test-split result
  (mean ± std, 10 seeds): precision 0.80 ± 0.07, recall 0.70 ± 0.10,
  F1 0.74 ± 0.07, ~46 flags per 1k windows.
- **P2 (`P2_sequence_candidate`, experimental, advisory):** LSTM
  `max_z_surprisal` ≥ its own p99, excluding P1. Off unless the worker runs
  with `ANOMALY_ENABLE_P2=true`. P2 flags never notify the actor, never ask
  for a clarification and do not count toward the clarification quota; they
  exist only as a Governance-side review list. Results: P1 + P2 recall
  0.70 vs 0.70 for P1 alone, precision 0.55 vs 0.80.
- Not a blend: a linear ensemble/LSTM blend suppressed LSTM's signal on
  sequence anomalies, so the tiers keep independent thresholds.
- `votes` (how many of the 5 detectors agree) is reported for
  interpretability only; the legacy `votes ≥ 4` rule performs similarly
  (precision 0.84, recall 0.67) but P1 offers a tunable operating point.

**Recall ceiling:** ~29% of injected positives (`order_composition`,
`bigram_violation`) are invisible to the six aggregate features, capping
feature-based recall near 0.71; P1 reaches 0.70 of 0.71.

See `anomalyDetection/EXPERIMENTS.md` for the protocol, baselines
(supervised LR/SVM, DeepLog-style) and ablations (clean-train,
P1-filtered training, percentile selection).

## Future work

- Make the sequence tier work: train the LSTM on data it can trust to be
  mostly normal (reviewer-confirmed or P1-excluded windows) and re-validate
  its threshold before enabling P2 as an alert tier.
- Features that expose order (e.g. read-before-dispense gaps, transition
  counts) so the aggregate tier can see `bigram_violation` and
  `order_composition`.
- Feed `DISMISSED`/`CONFIRMED` review outcomes back as labels for
  recalibration.

## Reproducibility

```bash
# 1. Paper numbers (leakage-free harness, 10 seeds)
cd anomalyDetection
python run_experiments.py --profile v2 --seeds 1-10 --select-pct   # see EXPERIMENTS.md for all runs

# 2. Deployed path: synthetic history -> train P1 -> seed live window -> score
python generate_synthetic_audit_data_v2.py --profile v2 --days 90 --seed 1 --out synthetic_audit_log.csv
cd .. && ./retrain_pipeline.sh --synthetic             # writes anomalyDetection/models/{p1_ensemble.joblib,thresholds.json}
cd anomalyDetection && python generate_synthetic_audit_data.py --out live_window.csv --days 2 --json
cd ../backend && node seed_synthetic_audit_data.js ../anomalyDetection/live_window.json
node anomalyWorker.js --once                           # P1 only; add ANOMALY_ENABLE_P2=true (+ retrain --with-p2) for the experimental tier

# 3. Tests
cd ../anomalyDetection && python -m pytest tests -q    # p1_detector parity with the harness, no label/calibration leakage
cd ../medvault-tests/jest && npm run test:unit         # includes anomalyDetectionService tier semantics
cd ../../backend && npm run db:reset && NODE_ENV=test node server.js &
node seed_test_anomaly_flags.js
cd ../medvault-tests/bruno/MedVault && bru run --env <your_env>
```

The P1 percentile (`RETRAIN_P1_PCT`, default 95), the clarification quota
and the ban threshold are environment variables; defaults match the paper.
