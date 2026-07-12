# MedVault Caliper Benchmark

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
round. 