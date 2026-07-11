"""
compute_detection_metrics.py

Standalone eval script -- NOT part of the live anomalyWorker.js path.
Computes precision/recall/F1 at the production threshold
(FLAG_THRESHOLD=0.15, must match anomalyDetectionService.js) against the
synthetic `label` ground-truth column, for the paper's evaluation section.
Also reports the best-F1 threshold for comparison, so you can state
"production threshold trades X recall for Y fewer false positives" if the
two differ.

Requires the synthetic `label` column -- refuses to run on unlabeled real
data (same guard isolation_forest_baseline.py's SHAP eval and
generate_paper_figures.py's PR/ROC already use).

Usage:
    python compute_detection_metrics.py --scored scored_features.csv --threshold 0.15
"""

import argparse
import json

import pandas as pd
from sklearn.metrics import precision_recall_fscore_support, confusion_matrix, precision_recall_curve, f1_score


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scored", default="scored_features.csv",
                         help="output of isolation_forest_baseline.py (--out)")
    parser.add_argument("--threshold", type=float, default=0.15,
                         help="must match FLAG_THRESHOLD / ANOMALY_FLAG_THRESHOLD in "
                              "anomalyDetectionService.js -- this reports the metrics "
                              "for what the system actually flags in production, not "
                              "an arbitrary/best-case threshold")
    parser.add_argument("--out", default="detection_metrics.json")
    args = parser.parse_args()

    df = pd.read_csv(args.scored)
    if "label" not in df.columns or not (df["label"] == "anomalous").any():
        raise SystemExit(
            "No synthetic 'anomalous' labels present in --scored file. This script only "
            "makes sense against labeled synthetic data (real production data has no "
            "ground truth). Re-run isolation_forest_baseline.py against a "
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
        "production_threshold": args.threshold,
        "at_production_threshold": {
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
