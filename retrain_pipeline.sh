#!/bin/bash
# retrain_pipeline.sh
#
# Batch job -- run manually or via cron/systemd timer (NOT by the always-on
# anomalyWorker.js process; training and live scoring are deliberately
# separate now). Exports a large historical window, retrains the 5-model
# PyOD ensemble + LSTM from scratch on it, and writes persisted artifacts +
# a combined thresholds.json that the live worker loads for --mode score.
#
# Suggested schedule: weekly, or after any meaningful data-volume change.
# Re-run sooner if precision/recall on recent confirmed/dismissed flags
# (see routes/anomalyResponse.js) starts drifting.
set -e

USE_SYNTHETIC=false
if [[ "$1" == "--synthetic" ]]; then
  USE_SYNTHETIC=true
fi

BACKEND_DIR="$HOME/hyperledger/ehr-fabric-network/backend"
ANOMALY_DIR="$HOME/hyperledger/ehr-fabric-network/anomalyDetection"
MODEL_DIR="$ANOMALY_DIR/models"
HISTORY_DAYS="${RETRAIN_HISTORY_DAYS:-90}"
TRAIN_FRAC="${RETRAIN_TRAIN_FRAC:-0.9}"  # NOT 1.0 -- a small held-out slice is
                                          # needed even in production, not just for
                                          # evaluation. Confirmed directly: training
                                          # LSTM with train_frac=1.0 (no held-out
                                          # signal at all) ran the full epoch count
                                          # and OVERFIT -- train loss kept dropping
                                          # but anomaly-detection AP got WORSE over
                                          # the same run, because the model got too
                                          # good at predicting near-anomalous
                                          # sequences too, narrowing the surprisal
                                          # gap. Held-out next-token loss doesn't
                                          # need labels, so it's still a valid early-
                                          # stopping signal on real unlabeled data.

mkdir -p "$MODEL_DIR"

if [[ "$USE_SYNTHETIC" == "true" ]]; then
  echo ">> [1/5] Using synthetic_audit_log.csv (--synthetic flag) -- real AuditLogMirror"
  echo "   doesn't have enough history yet for a meaningful retrain. Switch back to the"
  echo "   real export (drop --synthetic) once production data accumulates."
  cd "$ANOMALY_DIR"
  cp synthetic_audit_log.csv raw_history.csv
else
  echo ">> [1/5] Exporting last $HISTORY_DAYS days of AuditLogMirror"
  cd "$BACKEND_DIR"
  node exportHistoricalAuditLog.js --days "$HISTORY_DAYS" --out "$ANOMALY_DIR/raw_history.csv"
fi

cd "$ANOMALY_DIR"

echo ">> [2/5] Feature engineering"
python feature_engineering.py --in raw_history.csv --out features_history.csv

echo ">> [3/5] Training 5-model PyOD ensemble"
python pyod_ensemble.py \
  --in features_history.csv \
  --mode train \
  --train-frac "$TRAIN_FRAC" \
  --ensemble-percentile 0.97 \
  --model-out "$MODEL_DIR/pyod_ensemble_model.joblib" \
  --out "$MODEL_DIR/last_train_scored_features.csv"

echo ">> [4/5] Training LSTM sequence model"
python lstm_sequence_model.py \
  --in raw_history.csv \
  --mode train \
  --train-frac "$TRAIN_FRAC" \
  --lstm-percentile 0.99 \
  --model-out "$MODEL_DIR/lstm_model.pt" \
  --out "$MODEL_DIR/last_train_lstm_scored.csv"

echo ">> [5/5] Writing combined thresholds.json"
python3 -c "
import json, joblib, torch
ensemble = joblib.load('$MODEL_DIR/pyod_ensemble_model.joblib')
lstm = torch.load('$MODEL_DIR/lstm_model.pt', weights_only=False)
with open('$MODEL_DIR/thresholds.json', 'w') as f:
    json.dump({
        'ensemble_threshold': ensemble['ensemble_threshold'],
        'lstm_threshold': lstm['lstm_threshold'],
    }, f, indent=2)
print('Wrote', '$MODEL_DIR/thresholds.json')
"

echo ""
echo ">> Done. Live worker will pick up new artifacts on its next cycle --"
echo "   no restart needed since anomalyDetectionService.js loads them fresh each run."
