#!/bin/bash
# retrain_pipeline.sh
#
# Batch job -- run manually or via cron/systemd timer (NOT by the always-on
# anomalyWorker.js process; training and live scoring are deliberately
# separate). Exports a historical window and trains the DEPLOYED detector (P1,
# 5-model PyOD ensemble) with the evaluated protocol:
#
#   first RETRAIN_TRAIN_FRAC of the days  -> scaler + 5 detectors are fitted here only
#   remaining days (unlabelled)           -> min-max ranges + P1 threshold (percentile RETRAIN_P1_PCT)
#
# No labels are read, so this works on real audit data. Output:
#   models/p1_ensemble.joblib   fitted artifact loaded by anomalyWorker.js
#   models/thresholds.json      p1_threshold (+ ensemble_threshold alias for the experimental P2 path)
#
# Usage:
#   ./retrain_pipeline.sh                 # real AuditLogMirror export, P1 only (deployed config)
#   ./retrain_pipeline.sh --synthetic     # use anomalyDetection/synthetic_audit_log.csv instead
#   ./retrain_pipeline.sh --with-p2       # ALSO train the EXPERIMENTAL LSTM tier (only needed when the
#                                         # worker runs with ANOMALY_ENABLE_P2=true)
#
# Suggested schedule: weekly, or after a meaningful change in data volume. Re-run sooner if reviewer
# outcomes on recent flags (routes/anomalyResponse.js, PATCH /anomalies/:id/review) start drifting.
set -e

USE_SYNTHETIC=false
WITH_P2=false
for arg in "$@"; do
  case "$arg" in
    --synthetic) USE_SYNTHETIC=true ;;
    --with-p2)   WITH_P2=true ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

BACKEND_DIR="${BACKEND_DIR:-$HOME/hyperledger/ehr-fabric-network/backend}"
ANOMALY_DIR="${ANOMALY_DIR:-$HOME/hyperledger/ehr-fabric-network/anomalyDetection}"
MODEL_DIR="$ANOMALY_DIR/models"
HISTORY_DAYS="${RETRAIN_HISTORY_DAYS:-90}"
TRAIN_FRAC="${RETRAIN_TRAIN_FRAC:-0.6}"   # fit window; the rest calibrates the P1 threshold
P1_PCT="${RETRAIN_P1_PCT:-95}"            # validation-selected on every v2 seed (EXPERIMENTS.md)
SEED="${RETRAIN_SEED:-42}"
PYTHON_BIN="${PYTHON_BIN:-python}"

mkdir -p "$MODEL_DIR"

if [[ "$USE_SYNTHETIC" == "true" ]]; then
  echo ">> [1/3] Using synthetic_audit_log.csv (--synthetic) -- real AuditLogMirror doesn't have"
  echo "   enough history yet. Drop --synthetic once production data accumulates."
  cd "$ANOMALY_DIR"
  cp synthetic_audit_log.csv raw_history.csv
else
  echo ">> [1/3] Exporting last $HISTORY_DAYS days of AuditLogMirror"
  cd "$BACKEND_DIR"
  node exportHistoricalAuditLog.js --days "$HISTORY_DAYS" --out "$ANOMALY_DIR/raw_history.csv"
fi

cd "$ANOMALY_DIR"

echo ">> [2/3] Feature engineering"
"$PYTHON_BIN" feature_engineering.py --in raw_history.csv --out features_history.csv

echo ">> [3/3] Training P1 (5-model PyOD ensemble): fit on first $TRAIN_FRAC of days, p$P1_PCT of the rest"
"$PYTHON_BIN" p1_detector.py train \
  --in features_history.csv \
  --train-frac "$TRAIN_FRAC" \
  --pct "$P1_PCT" \
  --seed "$SEED" \
  --model-out "$MODEL_DIR/p1_ensemble.joblib" \
  --thresholds-out "$MODEL_DIR/thresholds.json"

if [[ "$WITH_P2" == "true" ]]; then
  echo ">> [extra] Training EXPERIMENTAL LSTM tier (P2, advisory only -- see EXPERIMENTS.md)"
  "$PYTHON_BIN" lstm_sequence_model.py \
    --in raw_history.csv \
    --mode train \
    --train-frac "$TRAIN_FRAC" \
    --lstm-percentile 0.99 \
    --model-out "$MODEL_DIR/lstm_model.pt" \
    --out "$MODEL_DIR/last_train_lstm_scored.csv"
  "$PYTHON_BIN" -c "
import json, torch
lstm = torch.load('$MODEL_DIR/lstm_model.pt', weights_only=False)
p = '$MODEL_DIR/thresholds.json'
t = json.load(open(p))
t['lstm_threshold'] = lstm['lstm_threshold']
json.dump(t, open(p, 'w'), indent=2)
print('Added lstm_threshold to', p)
"
fi

echo ""
echo ">> Done. The worker loads these artifacts fresh each cycle -- no restart needed."
if [[ "$WITH_P2" != "true" ]]; then
  echo "   P2 not trained (default). Keep ANOMALY_ENABLE_P2 unset/false on the worker."
fi
