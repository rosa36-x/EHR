# MedVault-X Caliper Benchmark

New, standalone folder -- doesn't touch chaincode, backend, or
docker-compose.yaml. **Not runtime-tested** (no live Fabric network
available where this was built) -- treat as a scaffold, expect to debug.

## Before running -- fix this first

1. **Place this folder** at `<repo root>/caliper-benchmarks/` (sibling of
   `backend/`, `chaincode/`, `organizations/`). If you put it elsewhere,
   every `../organizations/...` path in `networkconfig.yaml` and
   `connection-profiles/*.yaml` needs updating.

Already confirmed on rosa-Aspire, no action needed:
- Keystore filenames — real hashes are filled into `networkconfig.yaml`.
  If you ever regenerate MSP material, these change and need updating.
- Orderer TLS cert path — confirmed correct as assumed.
- `CREATE_CONSULTATION` policy — checked `chaincode/consultation_contract.go`
  directly: it only enforces `HospitalMSP` org membership, no
  TreatmentRelationship precondition. `createConsultation.js`'s workload
  measures real write throughput with no setup dependency.

## Install

```bash
cd caliper-benchmarks
npm init -y
npm install --save-dev @hyperledger/caliper-cli
npx caliper bind --caliper-bind-sut fabric:2.4
```

## Run

```bash
npx caliper launch manager \
  --caliper-workspace . \
  --caliper-networkconfig networkconfig.yaml \
  --caliper-benchconfig benchmark-config.yaml \
  --caliper-flow-only-test
```

Output: an HTML report (`report.html`) with TPS/latency/success-rate per
round — that's your throughput/latency figure for the paper. If any round
fails outright, the error log tells you which of the fixes above is still
needed.

## What's benchmarked

- `CheckActiveTreatmentRelationship` (read) — 10/50/100 TPS
- `CreateTreatmentRelationship` (write) — 10/50 TPS
- `CreateConsultation` (write, PDC) — 10/50 TPS

Not benchmarked: prescription/labreport/emergency writes, or any GovernanceMSP
operations — add workload modules following the same pattern in
`workloads/` if you want broader coverage, same signature-verification
approach (check the .go file, don't guess args).
