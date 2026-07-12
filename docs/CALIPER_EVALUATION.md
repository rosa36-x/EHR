# Performance Evaluation (Hyperledger Caliper)

Documentation of the MedVault-X chaincode performance benchmark, for the
paper's evaluation section and for reproducibility. Full setup/run
instructions are in `caliper-benchmarks/README.md`; this document covers
methodology, results, and interpretation.

## What Was Benchmarked

Four representative chaincode operations, spanning reads and writes,
single-org and cross-org:

| Operation | Type | Endorsement policy |
|---|---|---|
| `CheckActiveTreatmentRelationship` | Read | `OR(HospitalMSP)` |
| `CreateTreatmentRelationship` | Write | `OR(HospitalMSP)` |
| `CreateConsultation` | Write, PDC | `OR(HospitalMSP)` |
| `HasActiveConsent` | Read, cross-org PDC | `OR(HospitalMSP, PharmacyMSP)` |

`HasActiveConsent` is the headline architectural benchmark — it exercises
the project's core novel claim (consent-gated cross-org PDC access), not
just generic throughput.

## Methodology

- **Tool:** Hyperledger Caliper 0.6.x, Fabric Gateway binding
  (`@hyperledger/fabric-gateway` 1.5.0)
- **Load pattern:** fixed-rate TPS sweep — 10 / 50 / 100 / 200 / 500 TPS
  per operation (20 rounds total)
- **Workers:** two full runs performed, at 2 and 4 Caliper workers, to
  separate real network-side saturation from client-side (benchmark tool)
  bottlenecking — see Findings below for why this mattered
- **Network:** 5-organization Hyperledger Fabric network (Hospital,
  Pharmacy, Laboratory, Governance, Research), 1 peer per org, single
  orderer, channel `medchannel`, chaincode `medvault`
- **Ordering parameters** (`configtx.yaml`): `BatchTimeout: 2s`,
  `MaxMessageCount: 10`, `PreferredMaxBytes: 512KB`
- **Deployment topology — disclosed limitation:** all organizations,
  peers, and the orderer run as Docker Compose containers **on a single
  host**, not distributed hardware. Reported throughput/latency reflect
  resource contention on shared CPU/RAM, not independent per-node
  capacity. This is standard for academic evaluation but should be stated
  plainly, not left implicit.

## Results

### Reads scale without a ceiling found in this topology

Both `CheckActiveTreatmentRelationship` and `HasActiveConsent` tracked
their requested send rate almost exactly at every tier tested, including
500 TPS (≈500 achieved throughput, <50ms latency throughout, zero
failures). No saturation point was found for reads up to the tested
ceiling.

### Writes: two very different outcomes

Comparing the 2-worker and 4-worker runs at the 500 TPS tier reveals a
genuine network-side finding, not a benchmark artifact:

| Operation | 2 workers @ 500tps tier | 4 workers @ 500tps tier |
|---|---|---|
| `CreateTreatmentRelationship` | send 185.0 → throughput 182.5, 0 fail | send 328.5 → throughput **179.8**, **129 fail** |
| `CreateConsultation` | send 199.9 → throughput 197.6, 0 fail | send 316.1 → throughput **288.5**, 0 fail |

**`CreateTreatmentRelationship` hit a real, named Fabric limit.** Doubling
client-side load pressure did not increase real committed throughput at
all — it plateaued at ~180 TPS and produced failures instead, with the
exact error:
```
EndorseError: 2 UNKNOWN: too many requests for /gateway.Gateway,
exceeding concurrency limit (500)
```
This is the peer Gateway's own concurrency protection triggering, not a
misconfiguration — a citable, reproducible saturation point.

**`CreateConsultation` has a higher, not-yet-found ceiling.** More client
pressure produced more real throughput (197 → 289 TPS) with zero
failures, meaning its true limit sits somewhere above what was tested
here.

### Explaining the elevated latency at low TPS

With `MaxMessageCount: 10`, blocks cut by transaction **count**, not the
2-second `BatchTimeout`, at every tested rate (10 TPS already fills a
10-transaction block in ~1s, well under 2s — the timeout never actually
triggers in this data).

The mechanism is fully quantifiable: a transaction's average ordering
wait ≈ half the time needed to fill a block by count.
- At 10 TPS: block fills in ~1s → predicted avg wait ≈0.5s (observed: 0.47-0.49s)
- At 50 TPS: block fills in ~0.2s → predicted avg wait ≈0.1s + fixed overhead (observed: 0.14-0.18s)

This matches observed data closely and is presentable as a verified,
quantitative explanation rather than a qualitative guess.

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

`send_rate_vs_throughput.{png,pdf}` and `send_rate_vs_latency.{png,pdf}`
(generated via `caliper-benchmarks/plot_caliper_results.py`) — PNG at
300 DPI for slides, PDF (vector) for camera-ready print submission.
