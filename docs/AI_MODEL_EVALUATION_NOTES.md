# AI Model Evaluation Notes

Supporting material for the paper's threat model, limitations, and
reproducibility sections. See also `AI_MODEL_ROADMAP.md` for the full
capability roadmap.

## Threat Model

| Adversary | Mechanism | Code reference | Coverage |
|---|---|---|---|
| **1. Malicious Insider (valid credentials)** | 5-model PyOD ensemble (PCA/KNN/IForest/OCSVM/HBOS) over per-actor-day features: `off_hours_ratio`, `consent_denied_ratio`, `dispense_without_read_count`, cross-org access-denied bursts, combined with the LSTM sequence model via a two-tier priority system | `feature_engineering.py`, `pyod_ensemble.py`, `lstm_sequence_model.py`, `priority_tagging.py` | Detected — `P1_high_confidence` (point anomalies) + `P2_sequence_candidate` (order/sequence anomalies) |
| **2. Fake Treatment Relationship Attacker** | Access without an active `TreatmentRelationship` record | — | Not implemented. Assessed as feasible (data already exists via `treatment_relationship_contract.go`), scoped as future work |
| **3. Rogue/Compromised AI Model** | `ai_entity` classification: query-rate, purpose-mismatch, unauthorized record-type tracking for AI-model actors | — | Not implemented. No AI-model-as-registered-actor identity exists in the system (ResearchMSP is a skeleton org); this is a prerequisite subsystem, not a detection feature, and is out of scope |
| **4. Emergency Abuse Attacker** | Cross-check flagged actor-day against overlapping `EmergencyAccessLog.reason` | `classifyFlag()` in `anomalyDetectionService.js` | Detected — `emergency_abuse` classification |

## Limitations / Threats to Validity

- **Evaluation is synthetic-only.** All precision/recall/F1 figures are
  against `generate_synthetic_audit_data.py` output with injected, labeled
  anomalies. No real production audit data was used for evaluation.
- **Small evaluation scale.** ~94 actor-day windows in a single 24h scan;
  larger-population/longer-horizon evaluation is needed for stronger
  statistical claims.
- **2 of 4 spec'd adversaries undetected** (see table above).
- **LSTM is now in the live path via a two-tier priority system, not a
  single blended score.** A linear weighted-average blend of the ensemble
  and LSTM scores (the original `combine_scores.py` design) was found to
  suppress LSTM's contribution specifically on sequence-type anomalies —
  its one intended purpose — because averaging two differently-scaled
  signals lets a model that's structurally blind to a case (the ensemble,
  for sequence anomalies) dilute a model that isn't (LSTM). Replaced with
  independent thresholds: P1 fires on the ensemble's own `anomaly_score`
  percentile, P2 fires on LSTM's own `max_z_surprisal` percentile,
  deduplicated so P1 takes precedence. See "5-Model Ensemble + Two-Tier
  Priority System" below.
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

**Combining ensemble + LSTM:** a linear score blend (weighted average,
one shared threshold) was tested first — a weight grid search found
0.9 ensemble / 0.1 LSTM maximized overall AP (0.825 vs the original
0.7/0.3's 0.818), but this difference is within noise at this dataset's
scale (~35-81 labeled anomalies) and isn't a meaningful basis for
changing the documented 0.7/0.3 weighting. More importantly, checking
recall on *just* the sequence-type subset at matched thresholds showed
the blend recovers only ~17-22% of sequence anomalies, while LSTM's own
score alone recovers ~75% (held-out) at the same percentile bar —
direct evidence the blend was diluting LSTM's one distinguishing signal.

**Final design — two independent-threshold tiers, not a blend:**
- **P1 (`P1_high_confidence`):** ensemble `anomaly_score` ≥ its own p97
  threshold. (Not `votes` — checked directly: p97-on-score beat
  `votes≥4` on held-out data, recall 0.800 vs 0.743, precision 0.509 vs
  0.542.)
- **P2 (`P2_sequence_candidate`):** LSTM `max_z_surprisal` ≥ its own p99
  threshold, excluding anything already in P1. (`max_z_surprisal` beat
  `mean_z_surprisal`/`p90_z_surprisal` at matched recall; p99 was chosen
  over p97 to cut P2 volume ~78% and triple P2 precision at a cost of
  3 fewer sequence catches out of 23 — an acceptable trade for a
  lower-confidence, reviewer-facing tier.)
- Combined held-out performance: recall 0.95, precision 0.46 on the
  anomalous class — a meaningful improvement over the original blended
  approach at comparable recall.

P1 and P2 are intentionally NOT uniform-precision and should be surfaced
to reviewers as separate queues, not one undifferentiated flagged list —
P2 is a "worth a quick sequence-pattern check" tier, not ranked by
urgency the way P1 is.

See `pyod_ensemble.py`, `priority_tagging.py`, and their accompanying
`check_*.py` scripts for the full benchmarking trail.

## Reproducibility

```bash
# 1. Generate synthetic data
cd anomalyDetection
python generate_synthetic_audit_data.py --out synthetic_audit_log.csv --days 14 --json

# 2. Seed + score
cd ../backend
node seed_synthetic_audit_data.js ../anomalyDetection/synthetic_audit_log.json
cd ../anomalyDetection
python feature_engineering.py --in synthetic_audit_log.csv --out features.csv --patient-out patient_features.csv
python pyod_ensemble.py --in features.csv --out scored_features.csv
python lstm_sequence_model.py --in synthetic_audit_log.csv --out lstm_scored_actor_days.csv --loss-out lstm_loss.csv
python priority_tagging.py --ensemble-in scored_features.csv --lstm-in lstm_scored_actor_days.csv --out prioritized_flags.csv

# 3. Metrics + figures (used directly in the paper)
python compute_detection_metrics.py --scored scored_features.csv
python generate_paper_figures.py --scored scored_features.csv --lstm-loss lstm_loss.csv --out-dir figures/

# 4. API-level tests
cd ../backend && npm run db:reset && NODE_ENV=test node server.js &
node seed_test_anomaly_flags.js
cd ../medvault-tests/bruno/MedVault && bru run --env <your_env>
```

All thresholds (`FLAG_THRESHOLD=0.15`, ban/clarification thresholds) are
environment variables with defaults matching what's reported in this paper
— see `anomalyDetectionService.js`.
