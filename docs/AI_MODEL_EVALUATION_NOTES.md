# AI Model Evaluation Notes

Supporting material for the paper's threat model, limitations, and
reproducibility sections. See also `AI_MODEL_ROADMAP.md` for the full
capability roadmap.

## Threat Model

| Adversary | Mechanism | Code reference | Coverage |
|---|---|---|---|
| **1. Malicious Insider (valid credentials)** | Isolation Forest over per-actor-day features: `off_hours_ratio`, `consent_denied_ratio`, `dispense_without_read_count`, cross-org access-denied bursts | `feature_engineering.py`, `isolation_forest_baseline.py` | Detected — generic `point` classification |
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
- **LSTM session-level scoring is excluded from the live path.**
  Empirically underperformed the Isolation Forest baseline at current data
  volumes in initial testing; kept available for offline evaluation only
  (`lstm_sequence_model.py`).
- **No adversarial red-team evaluation.** Detection quality is measured
  against injected synthetic patterns, not an adaptive adversary attempting
  evasion.
- **Single shared Fabric identity per org**, with authorization enforced at
  the application layer rather than per-identity on-chain ABAC — a
  deliberate architectural tradeoff relevant to the system's overall trust
  model.

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
python isolation_forest_baseline.py --in features.csv --out scored_features.csv

# 3. Metrics + figures (used directly in the paper)
python compute_detection_metrics.py --scored scored_features.csv
python lstm_sequence_model.py --in synthetic_audit_log.csv --loss-out lstm_loss.csv
python generate_paper_figures.py --scored scored_features.csv --lstm-loss lstm_loss.csv --out-dir figures/

# 4. API-level tests
cd ../backend && npm run db:reset && NODE_ENV=test node server.js &
node seed_test_anomaly_flags.js
cd ../medvault-tests/bruno/MedVault && bru run --env <your_env>
```

All thresholds (`FLAG_THRESHOLD=0.15`, ban/clarification thresholds) are
environment variables with defaults matching what's reported in this paper
— see `anomalyDetectionService.js`.
