"""
compute_detection_metrics.py

Standalone eval script -- NOT part of the live anomalyWorker.js path.
Computes precision/recall/F1 against the synthetic `label` ground-truth
column, for the paper's evaluation section.

Two modes:
  --priority-in prioritized_flags.csv  (RECOMMENDED, matches production)
      Reports metrics for what the system actually flags: P1 alone, and
      P1+P2 combined. Production has no single "FLAG_THRESHOLD" anymore --
      see priority_tagging.py -- a single-threshold eval below would
      misrepresent the deployed two-tier design.
  --scored scored_features.csv --threshold T  (legacy, ensemble score only)
      Single-threshold eval on the ensemble's anomaly_score alone, ignoring
      LSTM/P2 entirely. Useful for an ensemble-only ablation figure, but
      NOT what's deployed -- don't present this as "the system's" metrics.

Requires the synthetic `label` column -- refuses to run on unlabeled real
data (same guard pyod_ensemble.py's SHAP eval and
generate_paper_figures.py's PR/ROC already use).

Usage:
    python compute_detection_metrics.py --priority-in prioritized_flags.csv
    python compute_detection_metrics.py --scored scored_features.csv --threshold 0.15
"""

import argparse
import json

import pandas as pd
from sklearn.metrics import precision_recall_fscore_support, confusion_matrix, precision_recall_curve, f1_score


def binary_metrics(y_true, y_pred):
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="binary", zero_division=0
    )
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred).ravel()
    return {
        "precision": round(float(precision), 4), "recall": round(float(recall), 4),
        "f1": round(float(f1), 4), "true_positives": int(tp), "false_positives": int(fp),
        "true_negatives": int(tn), "false_negatives": int(fn),
    }


def run_priority_mode(path, out_path):
    df = pd.read_csv(path)
    if "label" not in df.columns or not (df["label"] == "anomalous").any():
        raise SystemExit(
            "No synthetic 'anomalous' labels present in --priority-in file. Re-run "
            "priority_tagging.py against pyod_ensemble.py/lstm_sequence_model.py output "
            "from a generate_synthetic_audit_data.py source."
        )
    y_true = (df["label"] == "anomalous").astype(int)
    p1_pred = (df["priority"] == "P1_high_confidence").astype(int)
    any_pred = (df["priority"] != "none").astype(int)

    result = {
        "n_windows": int(len(df)),
        "n_positive": int(y_true.sum()),
        "priority_breakdown": df["priority"].value_counts().to_dict(),
        "P1_only": binary_metrics(y_true, p1_pred),
        "P1_plus_P2": binary_metrics(y_true, any_pred),
    }
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result, indent=2))
    print(f"\nWrote {out_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--priority-in", default=None,
                         help="output of priority_tagging.py -- RECOMMENDED, matches "
                              "the deployed two-tier system. Overrides --scored/--threshold.")
    parser.add_argument("--scored", default="scored_features.csv",
                         help="[legacy mode] output of pyod_ensemble.py (--out), ensemble-only, "
                              "ignores LSTM/P2 -- NOT the deployed system, use for ablation only")
    parser.add_argument("--threshold", type=float, default=0.15,
                         help="[legacy mode only] fixed threshold on the ensemble's anomaly_score. "
                              "NOTE: production no longer uses a single FLAG_THRESHOLD -- see "
                              "priority_tagging.py -- this is for ensemble-only comparison, not "
                              "the deployed system's actual operating point.")
    parser.add_argument("--out", default="detection_metrics.json")
    args = parser.parse_args()

    if args.priority_in:
        run_priority_mode(args.priority_in, args.out)
        return

    df = pd.read_csv(args.scored)
    if "label" not in df.columns or not (df["label"] == "anomalous").any():
        raise SystemExit(
            "No synthetic 'anomalous' labels present in --scored file. This script only "
            "makes sense against labeled synthetic data (real production data has no "
            "ground truth). Re-run pyod_ensemble.py against a "
            "generate_synthetic_audit_data.py output."
        )

    y_true = (df["label"] == "anomalous").astype(int)
    y_score = df["anomaly_score"]
    y_pred = (y_score >= args.threshold).astype(int)

    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="binary", zero_division=0
    )
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred).ravel()

    # Best-F1 threshold, for comparison against the production operating point.
    p_curve, r_curve, t_curve = precision_recall_curve(y_true, y_score)
    f1_curve = [
        (2 * p * r / (p + r)) if (p + r) > 0 else 0.0
        for p, r in zip(p_curve[:-1], r_curve[:-1])
    ]
    best_idx = max(range(len(f1_curve)), key=lambda i: f1_curve[i]) if f1_curve else None
    best_threshold = float(t_curve[best_idx]) if best_idx is not None else None
    best_f1 = f1_curve[best_idx] if best_idx is not None else None

    result = {
        "n_windows": int(len(df)),
        "n_positive": int(y_true.sum()),
        "fixed_threshold_LEGACY_ensemble_only": args.threshold,
        "at_fixed_threshold": {
            "precision": round(float(precision), 4),
            "recall": round(float(recall), 4),
            "f1": round(float(f1), 4),
            "true_positives": int(tp),
            "false_positives": int(fp),
            "true_negatives": int(tn),
            "false_negatives": int(fn),
        },
        "best_f1_threshold": {
            "threshold": round(best_threshold, 4) if best_threshold is not None else None,
            "f1": round(best_f1, 4) if best_f1 is not None else None,
        },
    }

    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)

    print(json.dumps(result, indent=2))
    print(f"\nWrote {args.out}")


if __name__ == "__main__":
    main()
