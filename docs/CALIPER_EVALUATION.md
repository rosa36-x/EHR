# Performance Evaluation (Hyperledger Caliper)

Documentation of the MedVault chaincode performance benchmark, for the
paper's evaluation section and for reproducibility. Full setup/run
instructions are in `caliper-benchmarks/README.md`; this document covers
methodology, results, and interpretation.

## What Was Benchmarked

Four chaincode operations actually configured in
`caliper-benchmarks/benchmark-config.yaml` and implemented in
`caliper-benchmarks/workloads/`, spanning one read and three writes:

| Operation | Type | Endorsement policy |
|---|---|---|
| `CheckActiveTreatmentRelationship` | Read | `OR(HospitalMSP)` |
| `CreateTreatmentRelationship` | Write | `OR(HospitalMSP)` |
| `CreateConsultation` | Write, PDC | `OR(HospitalMSP)` |
| `CreatePrescription` | Write, PDC | `OR(HospitalMSP)` |

Note: `HasActiveConsent` (`CHECK_ACTIVE_CONSENT` in
`chaincode/policy/policy_registry.go`) is a real, implemented chaincode
function with a cross-org policy (`HospitalMSP`, `PharmacyMSP`,
`LaboratoryMSP`, `GovernanceMSP`, `ResearchMSP`), but it was **not**
included in this benchmark run — there is no corresponding round in
`benchmark-config.yaml` and no `workloads/hasActiveConsent.js`. It is a
good candidate for a follow-up benchmark round but is not part of the
results below.

## Methodology

- **Tool:** Hyperledger Caliper, Fabric Gateway binding
  (`@hyperledger/fabric-gateway`)
- **Load pattern:** fixed-rate TPS sweep per operation. The read runs at
  100 / 200 / 500 TPS. Each write runs a dense ramp from 100 to 500 TPS
  (100 / 200 / 250 / 300 / 350 / 400 / 450 / 500), chosen specifically to
  resolve the saturation bend observed around the 200–500 TPS region.
- **Workers:** 4 Caliper workers per round (`benchmark-config.yaml`);
  findings on `CreateTreatmentRelationship`'s hard ceiling were confirmed
  by comparing against a separate run at 2 workers, isolating a real
  network-side limit from a client-side (benchmark tool) artifact.
- **Network:** 5-organization Hyperledger Fabric network (Hospital,
  Pharmacy, Laboratory, Governance, Research), 1 peer per org, single
  orderer, channel `medchannel`, chaincode `medvault`.
- **Deployment topology — disclosed limitation:** all organizations,
  peers, and the orderer run as Docker Compose containers **on a single
  host**, not distributed hardware. Reported throughput/latency reflect
  resource contention on shared CPU/RAM, not independent per-node
  capacity. This is standard for academic evaluation but is stated
  plainly here rather than left implicit.

## Results

### The read operation scales without a ceiling found in this topology

`CheckActiveTreatmentRelationship` tracks its requested send rate almost
exactly at every tier tested, including 500 TPS (≈500 achieved
throughput, ≈10ms latency throughout, zero failures). No saturation
point was found for this read up to the tested ceiling.

### Writes: one hard ceiling, two soft ones

The three write operations diverge sharply from the read, and from each
other:

| Operation | Observed plateau | Failures in tested range |
|---|---|---|
| `CreateTreatmentRelationship` | ~180–225 TPS, throughput *declines* past this point | Yes — 10–15% at the highest tested rates |
| `CreateConsultation` | ~330–340 TPS | None observed |
| `CreatePrescription` | ~330–340 TPS | None observed |

**`CreateTreatmentRelationship` hit a real, named Fabric limit.**
Comparing the 2-worker and 4-worker runs shows that additional
client-side pressure did not raise real committed throughput past
~180–225 TPS — it produced more failures instead, with the exact error:
```
EndorseError: 2 UNKNOWN: too many requests for /gateway.Gateway,
exceeding concurrency limit (500)
```
This is the peer Gateway's own concurrency protection triggering, not a
misconfiguration — a citable, reproducible saturation point.

**`CreateConsultation` and `CreatePrescription` have higher, not-yet-found
ceilings.** Both plateau around 330–340 TPS with zero failures in the
tested range, meaning their true breaking point (as opposed to their
practical plateau here) sits above what was tested in this evaluation.

### Efficiency frontier (throughput vs. latency)

`CheckActiveTreatmentRelationship` stays flat at ~10ms latency across its
entire throughput range — reads pay no latency penalty for higher load in
this topology. Each write shows a near-flat "efficient" region followed
by a sharp latency spike once throughput stops increasing:
`CreateConsultation` and `CreatePrescription` both hold latency under
~100–150ms up to their ~330–340 TPS plateau before rising toward ~0.2–0.5s;
`CreateTreatmentRelationship` is the most severe, with latency climbing
past 1.4s once throughput plateaus near 180–225 TPS. The latency spike on
each write curve is the network absorbing excess load as queueing delay
rather than converting it into additional committed throughput — the
defining signature of a real saturation point.

## Baseline Comparison

Rather than building a redundant single-org Fabric network purely for
baseline numbers, this evaluation compares against **published throughput
figures from prior blockchain-EHR systems** (full citations in
`docs/RELATED_WORK_COMPARISON.md`):
- **ACHealthChain** (Scientific Reports, 2025) — reports throughput,
  latency, and resource-utilization experiments on a comparable
  multi-chaincode Fabric architecture
- **PREHEALTH** — reports efficiency/feasibility results at
  real-world deployment scale

Direct numeric comparison should account for each system's disclosed
hardware/topology, same as this evaluation discloses its own single-host
setup above — throughput numbers alone aren't comparable without that
context.

## Figures

Generated via `caliper-benchmarks/plot_caliper_results.py` into
`caliper-benchmarks/figures/` (PNG at 300 DPI for slides, PDF vector for
camera-ready print submission):

- `send_rate_vs_throughput.{png,pdf}` — target send rate vs. achieved
  throughput, all four operations
- `throughput_vs_latency.{png,pdf}` — efficiency frontier
- `send_rate_vs_failure_rate.{png,pdf}` — failure rate onset
- `latency_min_avg_max_per_operation.{png,pdf}` — per-operation min/avg/max
  latency small multiples

See `caliper-benchmarks/figures/PERFORMANCE_FIGURES.md` for the
figure-by-figure writeup these results are drawn from.
