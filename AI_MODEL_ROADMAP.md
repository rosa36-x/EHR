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
