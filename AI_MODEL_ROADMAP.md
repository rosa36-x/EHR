# AI Anomaly Detection — Roadmap

Governed AI actor that reads the existing on-chain audit trail, flags
anomalous access patterns, and writes its own flags back through an audited,
on-chain identity. No chaincode changes, no redeploy — reuses functions
already shipped for the EHR/consent work.

## Why this design

`CreateAuditLog` already accepts arbitrary strings for `actorID`, `actorRole`,
`action`, `resourceType`, `resourceID`, and the on-chain policy check only
verifies the caller's MSP (`GovernanceMSP`), never the `actorRole` value. So
the AI engine can log itself as a real actor (`actorRole: "ai_engine"`)
through the exact same `logAudit()` every other route already calls — zero
new chaincode surface.

The SHAP explanation payload (score, top contributing features, human-
readable reason) doesn't fit `AuditLog`'s fixed struct, so that detail lives
in Mongo, cross-referenced by the `auditID` returned from the on-chain call.
This keeps the flag itself tamper-evident while keeping the rich, variable-
shaped explainability data out of the ledger.

## Steps

1. **Feature pipeline** — pull recent `AuditLog` entries via existing
   audit-history queries. Compute per-actor / per-patient features: access
   frequency, off-hours ratio, cross-org access bursts, consent-denied
   ratio, dispense-without-prior-read patterns.

2. **Python model service** — small REST API, separate from `backend/`:
   - Isolation Forest — per-event/window anomaly score (unsupervised, no
     labels needed to start)
   - LSTM (optional) — per-actor access *sequences* over time, catches
     ordering/timing anomalies a single-event score misses
   - SHAP — feature attribution on top of the Isolation Forest score (the
     "why" behind a flag)

3. **`AnomalyFlag` Mongo schema** — `score`, `topFeatures` (SHAP output),
   `status` (`PENDING` / `REVIEWED` / `DISMISSED`), `auditID` (links to the
   on-chain `CreateAuditLog` entry for that flag). Same pattern as the
   existing `OrgActor` schema in `db.js`.

4. **`anomalyWorker.js`** — standalone Node entrypoint (not inside
   `server.js`). Imports `fabricService.js`, `db.js`, `auditMiddleware.js`
   as-is. Runs on a schedule (`node-cron` or a loop):
   pull audit data → call Python service → write `AnomalyFlag` in Mongo →
   call `logAudit()` as `actorRole: "ai_engine"`, `action:
   "ANOMALY_FLAGGED"` (real chaincode call, existing function, existing
   `governance` identity).

5. **Review routes** — `routes/anomaly.js`, governance-only, mirrors the
   shape of `auditHistory.js`. List/review flags, cross-reference the
   linked on-chain `auditID` as proof the flag was actually raised (not
   fabricated after the fact).

6. **Enforcement** — a governance actor reviews a flag and acts on it via
   **existing** chaincode functions (`RevokeConsent`, marking a treatment
   relationship dormant, etc.). No new chaincode function for enforcement
   either — the AI recommends, a human triggers a call that already exists.

7. **Run** — start the worker independently: `node anomalyWorker.js` (or a
   pm2/systemd entry for a real deployment). Separate process from
   `server.js` by design — see tradeoff note below.

## What's genuinely new vs. reused

| New | Reused as-is |
|---|---|
| Python model service (Isolation Forest / LSTM / SHAP) | `logAudit()` / `auditMiddleware.js` |
| `AnomalyFlag` Mongo schema | `fabricService.js` (`getContract("governance")`) |
| `anomalyWorker.js` entrypoint + scheduler | All existing routes/services — untouched |
| `routes/anomaly.js` | Existing chaincode functions used for enforcement |

## Framing note for the paper

"Governed Fabric MSP entity with its own audit trail" is accurate at the
audit-log level — the AI has a real, on-chain, tamper-evident identity for
every flag it raises. Running it as a separate process (`anomalyWorker.js`)
rather than in-process with the Express app makes the "independent entity"
framing closer to literal, not just log-level — worth stating precisely
rather than overclaiming architectural isolation beyond what actually
exists (it's still a Node process using the same Fabric gateway identity
pattern as the rest of the backend, not its own MSP/peer).

## Blocking dependency

Training/eval data. Real usage volume is almost certainly insufficient —
needs a synthetic data generator: simulate normal access patterns, inject
labeled anomalies (rapid cross-org bursts, midnight access spikes, one
actor touching many patients in a short window) to get a usable
training/eval set before the Isolation Forest / LSTM work can be evaluated
meaningfully.

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
