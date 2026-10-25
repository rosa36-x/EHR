#!/usr/bin/env bash
# cleanup_anomaly_dir.sh -- tidy anomalyDetection/ so outputs stop piling up.
#
# DRY-RUN BY DEFAULT: prints what it would do. Nothing changes without --apply.
# Nothing is deleted except caches/logs/checkpoints; regenerable legacy outputs
# are MOVED to archive/legacy_outputs_<date>/ (recoverable).
#
# Run from inside anomalyDetection/:
#   ./cleanup_anomaly_dir.sh --backup ~/anomalyDetection_pre_rerun_20261024.tgz
#   ./cleanup_anomaly_dir.sh --backup ~/anomalyDetection_pre_rerun_20261024.tgz --apply
#
# Options:
#   --apply          actually do it
#   --backup FILE    verify FILE is a readable tarball first (aborts if not)
#   --keep-runs N    keep the N newest runs/<tag>/ folders (default 3); a folder
#                    containing a file named KEEP is never touched
#   --drop-repro     also delete repro/ (scratch folder from the reproduction check)
set -euo pipefail

APPLY=0; KEEP_RUNS=3; BACKUP=""; DROP_REPRO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --backup) BACKUP="${2:?--backup needs a file}"; shift ;;
    --keep-runs) KEEP_RUNS="${2:?--keep-runs needs a number}"; shift ;;
    --drop-repro) DROP_REPRO=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -f pyod_ensemble.py ] && [ -f run_experiments.py ] || { echo "Run this from inside anomalyDetection/." >&2; exit 1; }

if [ -n "$BACKUP" ]; then
  tar tzf "$BACKUP" >/dev/null 2>&1 || { echo "Backup $BACKUP is missing or unreadable -- aborting." >&2; exit 1; }
  echo "Backup OK: $BACKUP"
else
  echo "WARNING: no --backup given (dry-run is still safe)."
fi

run() { if [ "$APPLY" -eq 1 ]; then "$@"; else echo "  [dry-run] $*"; fi; }
[ "$APPLY" -eq 1 ] && echo "MODE: APPLY" || echo "MODE: dry-run (add --apply to execute)"

echo; echo "1) Caches, logs, checkpoints (deleted)"
for p in __pycache__ .ipynb_checkpoints; do
  [ -e "$p" ] && run rm -rf "$p"
done
for f in *.log nohup.out lstm_best*.pt; do
  [ -e "$f" ] && run rm -f "$f"
done

echo; echo "2) Legacy outputs (moved to archive/, regenerable except the LSTM-dependent ones)"
PATTERNS=(features*.csv patient_features*.csv scored_features*.csv lstm_scored_actor_days*.csv
          prioritized_flags*.csv combined_scores*.csv detection_metrics*.json
          synthetic_audit_log*.csv synthetic_audit_log*.json lstm_loss*.csv)
FOUND=()
for pat in "${PATTERNS[@]}"; do
  for f in $pat; do [ -f "$f" ] && FOUND+=("$f"); done
done
# LSTM-dependent outputs cannot be regenerated bit-for-bit (the legacy LSTM is unseeded):
# refuse to move them unless they are frozen with a passing checksum.
IRREPRODUCIBLE=0
for f in "${FOUND[@]:-}"; do
  case "$f" in scored_features*|lstm_scored_actor_days*|prioritized_flags*|combined_scores*|lstm_loss*) IRREPRODUCIBLE=1 ;; esac
done
if [ "$IRREPRODUCIBLE" -eq 1 ]; then
  if [ -f frozen_tableV/SHA256SUMS ] && (cd frozen_tableV && sha256sum -c --quiet SHA256SUMS 2>/dev/null); then
    echo "  frozen_tableV/ checksums OK"
  else
    echo "  ABORT step 2: scored/LSTM outputs exist but frozen_tableV/SHA256SUMS is missing or fails." >&2
    echo "  Freeze them first:  mkdir -p frozen_tableV && cp <those files> frozen_tableV/ && (cd frozen_tableV && sha256sum * > SHA256SUMS)" >&2
    FOUND=()
  fi
fi
if [ "${#FOUND[@]}" -gt 0 ] && [ -n "${FOUND[0]:-}" ]; then
  DEST="archive/legacy_outputs_$(date +%Y%m%d)"
  run mkdir -p "$DEST"
  for f in "${FOUND[@]}"; do run mv "$f" "$DEST/"; done
else
  echo "  nothing to move"
fi

echo; echo "3) Old runs (keep newest $KEEP_RUNS, never touch folders containing KEEP)"
if [ -d runs ]; then
  i=0
  while IFS= read -r d; do
    i=$((i+1))
    [ "$i" -le "$KEEP_RUNS" ] && continue
    [ -e "$d/KEEP" ] && { echo "  keep (KEEP file): $d"; continue; }
    run rm -rf "$d"
  done < <(ls -1dt runs/*/ 2>/dev/null | sed 's:/$::')
else
  echo "  no runs/ folder"
fi

echo; echo "4) repro/ scratch folder"
if [ -d repro ]; then
  if [ "$DROP_REPRO" -eq 1 ]; then run rm -rf repro; else echo "  kept (pass --drop-repro to delete): $(du -sh repro | cut -f1)"; fi
else
  echo "  none"
fi

echo; echo "5) Keep generated output out of git (local .git/info/exclude, nothing committed)"
GITDIR="$(git rev-parse --git-dir 2>/dev/null || true)"
if [ -n "$GITDIR" ]; then
  EXCL="$GITDIR/info/exclude"
  for pat in "anomalyDetection/runs/" "anomalyDetection/repro/" "anomalyDetection/archive/" \
             "anomalyDetection/frozen_tableV/" "anomalyDetection/__pycache__/" "anomalyDetection/*.pt" \
             "anomalyDetection/*.joblib"; do
    if ! grep -qxF "$pat" "$EXCL" 2>/dev/null; then run bash -c "mkdir -p '$(dirname "$EXCL")' && echo '$pat' >> '$EXCL'"; fi
  done
else
  echo "  not a git repo; skipped"
fi

echo; echo "Size (excluding .venv): $(du -sh --exclude=.venv . | cut -f1)"
[ "$APPLY" -eq 1 ] || echo "Dry-run only. Re-run with --apply to execute."
