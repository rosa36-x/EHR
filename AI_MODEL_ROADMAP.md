# AI Anomaly Detection — Roadmap

Governed AI actor that reads the existing on-chain audit trail, flags
anomalous access patterns, and writes its own flags back through an
audited, on-chain identity (`actorRole: "ai_engine"`, via the existing
`logAudit()` — no new chaincode surface). A governance actor reviews
flags and acts via **existing** chaincode functions (`RevokeConsent`,
marking a treatment relationship dormant, etc.) — the AI recommends, a
human triggers the actual enforcement call.

## Current AI Model Architecture (as deployed)

Three stages, in order: **5-model PyOD ensemble** → **LSTM sequence
model** → **two-tier priority tagging**. Trained via a separate weekly
batch job, scored live every worker cycle with no refitting. Full
rationale/benchmarking trail is in `AI_MODEL_EVALUATION_NOTES.md`; this
section is the architecture summary.

### Stage 1 — 5-model PyOD ensemble (`pyod_ensemble.py`)

Runs on per-actor-day AGGREGATE features (`feature_engineering.py`):
`access_frequency`, `distinct_resources_touched`, `off_hours_ratio`,
`burst_count`, `consent_denied_ratio`, `dispense_without_read_count`.
Selected from an 8-algorithm PyCaret/PyOD benchmark; these 5 were kept
for spanning distinct algorithmic families (not 5 variations on one
idea), which is what makes majority/ensemble agreement meaningful rather
than redundant:

| Model | What it actually does |
|---|---|
| **PCA** | Reconstructs each row from its principal components; flags rows with high reconstruction error — i.e. rows that don't fit the dominant patterns of "normal" correlated behavior. |
| **KNN** | Distance to the k-th nearest neighbor in feature space; flags rows sitting far from any cluster of normal actor-days. |
| **IForest** (Isolation Forest) | Randomly partitions the feature space; anomalies isolate in fewer random splits than normal points, since they're rarer/more separable. |
| **OCSVM** (One-Class SVM) | Learns a boundary enclosing "normal" data in feature space; flags anything outside it. |
| **HBOS** | Univariate histograms per feature, combined; fast, catches per-feature extremes even when the multivariate structure looks unremarkable. |

Each model's `decision_function` output is min-max normalized, then
**equal-weighted averaged** into one continuous `anomaly_score` — the
actual signal used downstream. A `votes` column (how many of the 5
independently flag a row) is also computed but is reporting-only, not
decisive (checked directly: percentile-on-score beat vote-count as the
actual threshold rule).

**Known structural limit:** all 5 operate on daily aggregates with no
concept of event order — confirmed empirically to unanimously miss 100%
of sequence/order-type anomalies. This is why Stage 2 exists.

### Stage 2 — LSTM sequence model (`lstm_sequence_model.py`)

Per-actor next-event-prediction model (unsupervised, no labels used in
training). Each event becomes a token of `(actorRole, action,
resourceType, time-since-last-event-bucket)`; an LSTM is trained to
predict the next token given an actor's history so far. Anomaly signal =
**surprisal** (`-log P(actual next token | history)`) — a predictable
actor produces low-surprisal sequences, an actor doing something
never-before-seen (wrong order, unusual gap, unusual action) produces
high surprisal. This is what catches the sequence/order anomalies Stage
1 structurally can't see (e.g. `bigram_violation`, `order_composition`).

Live scoring pulls an extra rolling lookback window (14 days, configurable
via `ANOMALY_LSTM_LOOKBACK_DAYS`) purely as autoregressive context —
scored for correct history, but only the actual new scan window is
reported (`--report-since`). Mitigates, doesn't eliminate, the
cold-start-every-run issue (see "LSTM Persistent State" below).

### Stage 3 — Two-tier priority tagging (`priority_tagging.py`)

Combines Stage 1 + Stage 2 via **independent thresholds, not a weighted
blend** — a linear blend was tested and found to suppress LSTM's signal
specifically on the sequence-type cases it exists for (checked directly:
LSTM alone recovered far more sequence anomalies at the same percentile
bar than any blended weighting did).

- **P1 (`P1_high_confidence`):** ensemble `anomaly_score` ≥ its own p97
  threshold (from training data, not recomputed live).
- **P2 (`P2_sequence_candidate`):** LSTM `max_z_surprisal` ≥ its own p99
  threshold, excluding anything already in P1 (dedup, P1 wins).

P1 and P2 are intentionally NOT uniform-precision — P1 is the
higher-confidence tier (~0.5 precision), P2 is a deliberately
lower-confidence "worth a quick check" tier (~0.3 precision) that exists
specifically to surface the sequence-type cases P1 can never catch.
Surface these as separate queues to reviewers, not one undifferentiated
flagged list.

### Train / score split + scheduling

- `--mode train`: fits fresh on a large historical window, saves
  scaler/models/vocab/thresholds to `anomalyDetection/models/`.
- `--mode score`: loads those saved artifacts, scores new data, **no
  refitting**. This is all the live worker (`anomalyWorker.js`) ever
  calls — it will refuse to run if artifacts are missing.
- **Retraining is a separate weekly batch job**, not something the
  always-on worker does: `retrain_pipeline.sh`, scheduled via crontab
  for **every Sunday at 3:00 AM**:
  ```
  0 3 * * 0 /home/rosa/hyperledger/ehr-fabric-network/retrain_cron_wrapper.sh >> /home/rosa/retrain.log 2>&1
  ```
  The wrapper activates the venv and sets `MONGO_URI` (cron runs without
  an interactive shell, so these aren't inherited automatically), then
  calls `retrain_pipeline.sh`, which exports historical
  `AuditLogMirror` data, retrains both models, and writes
  `models/thresholds.json` for the live worker to pick up on its next
  cycle (no restart needed).

## Current Status


**Implemented:**
- `point` and `emergency_abuse` classification on `AnomalyFlag` (see
  `classifyFlag()` in `anomalyDetectionService.js` -- cross-checks
  `EmergencyAccessLog`, no chaincode changes).
- Clarification-request loop for an actor's 1st/2nd flag ever
  (`clarificationRequested`/`clarificationText` fields, actor-facing
  `POST /anomalies/:id/respond` in `routes/anomalyResponse.js`).
- Standalone paper figures (`generate_paper_figures.py`): score
  distribution, feature importance, PR/ROC, LSTM loss curve.
- **5-model PyOD ensemble** (replacing solo Isolation Forest) + **LSTM,
  combined via a two-tier priority system** (P1 high-confidence /
  P2 sequence-candidate), both live in `anomalyWorker.js` -- see
  `AI_MODEL_EVALUATION_NOTES.md`'s "5-Model Ensemble + Two-Tier Priority
  System" section for the full selection/combining rationale.
  `sequential` classification is now LIVE (P2 tier), not deferred.
- **Train/score split**: `pyod_ensemble.py`/`lstm_sequence_model.py`
  support `--mode train` (batch, `retrain_pipeline.sh`) vs `--mode score`
  (live worker, no refitting). Fixes the original design's "refit from
  scratch every hourly cycle on a tiny window" problem.
- **LSTM rolling context window**: live scoring pulls extra history
  (`ANOMALY_LSTM_LOOKBACK_DAYS`, default 14) purely as autoregressive
  context (`--report-since` in `lstm_sequence_model.py`), so burn-in
  mostly lands in the context portion instead of eating into the actual
  reportable window. Mitigates, doesn't eliminate, the cold-start issue
  below.

**Deferred / not built:**
- **Persistent per-actor hidden state across scoring runs** (see "LSTM
  Persistent State" roadmap section below) -- the rolling context window
  is a mitigation, not a full fix; an actor silent longer than the
  lookback window still hits a cold start every run.
- `ai_entity` classification (rogue/compromised AI model actor) -- no
  AI-model-as-registered-actor identity exists in the system yet
  (ResearchMSP is still a skeleton org). Needs that identity model built
  first before purpose-mismatch/query-rate detection is meaningful.
- Real-time Fabric block-event subscription -- worker stays poll-based
  (`ANOMALY_INTERVAL_MINUTES`); detection is windowed (actor-day) regardless
  of ingestion latency, so this buys latency, not new detection capability.
- Frontend charts consuming `GET /anomalies/summary` -- backend endpoint
  now also returns `byPriority` (P1/P2 split), UI still not built.
- `retrain_pipeline.sh` scheduling -- script exists, nothing runs it
  automatically yet; needs a cron/systemd timer entry (suggested: weekly).
- Priority-aware chart in `generate_paper_figures.py` -- currently shows
  ensemble-only `anomaly_score` distribution; a P1-vs-P2 breakdown chart
  would better represent the deployed two-tier design but wasn't built.

## LSTM Persistent State (Option 2 -- not started)

The rolling context window (implemented) mitigates but doesn't solve the
underlying issue: LSTM surprisal depends on autoregressive history, and
every scoring run currently rebuilds that history from a lookback window
rather than truly persisting state. An actor silent longer than
`ANOMALY_LSTM_LOOKBACK_DAYS` still gets scored from a cold `<START>`.

Full fix requires:

1. **Per-actor hidden-state storage.** Persist each actor's LSTM
   `(h, c)` tensor state between runs (new Mongo collection or a
   serialized blob store), keyed by `actorID`. Replace `score_new()`'s
   whole-sequence forward pass with incremental single-step inference
   (feed only the NEW events since last run, seeded with the actor's
   saved hidden state).
2. **Cold-start policy for new/unseen actors** -- no saved state yet,
   fall back to the current lookback-window approach (or a
   fresh `<START>`) until enough history accumulates.
3. **Staleness policy** -- decide when a saved hidden state is too old
   to trust (e.g. actor inactive 30+ days): reset to cold-start rather
   than resuming from a stale/meaningless state.
4. **Retrain interaction** -- a retrained model's weights are
   incompatible with hidden states saved under the old weights. Either
   invalidate all saved states on every retrain (simplest, forces a
   fresh cold-start pass immediately after each `retrain_pipeline.sh`
   run), or version state blobs against a model version and only reuse
   matching ones.
5. **Re-validate the P2 threshold.** Incremental-state scoring will
   shift the surprisal distribution (likely lower/more stable per-event
   surprisal than whole-sequence batch scoring produces). The current
   p99 threshold (see `thresholds.json`) was calibrated against
   whole-sequence scoring and should NOT be assumed to transfer --
   re-run the same threshold sweep methodology (`check_lstm_threshold.py`
   pattern) against incremental-scoring output before trusting it.

Step 5 is the part most likely to be skipped under time pressure and
shouldn't be -- shipping incremental scoring with an unvalidated
threshold undermines the two-tier design's actual point. Estimated
effort: substantially more than the rolling-context-window mitigation;
treat as a dedicated work session with real before/after validation,
not a bolt-on.