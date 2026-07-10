"""
isolation_forest_baseline.py

Fits an Isolation Forest on the engineered features, scores every
actor-day window, and checks the result against the synthetic `label`
column for a rough precision/recall sanity check.

`label` is used ONLY here, for eval. The model itself is unsupervised
and never sees it.

Usage:
    python isolation_forest_baseline.py --in features.csv
"""

import argparse

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (
    precision_recall_curve,
    average_precision_score,
    classification_report,
)

FEATURE_COLUMNS = [
    "access_frequency",
    "distinct_resources_touched",
    "off_hours_ratio",
    "burst_count",
    "access_denied_ratio",
    "consent_denied_ratio",
    "dispense_without_read_count",
]


def fit_and_score(df: pd.DataFrame, contamination):
    X = df[FEATURE_COLUMNS].values

    model = IsolationForest(
        n_estimators=200,
        contamination=contamination,  # "auto" or a float estimate of anomaly rate
        random_state=42,
    )
    model.fit(X)

    # decision_function: higher = more normal. Flip sign so higher = more anomalous,
    # which is the more intuitive direction for an "anomaly score".
    raw_scores = -model.decision_function(X)
    predictions = model.predict(X)  # -1 = anomaly, 1 = normal

    df = df.copy()
    df["anomaly_score"] = raw_scores
    df["predicted_anomaly"] = predictions == -1
    return df, model


def evaluate(df: pd.DataFrame):
    y_true = (df["label"] == "anomalous").astype(int)
    y_score = df["anomaly_score"]
    y_pred = df["predicted_anomaly"].astype(int)

    print("\n=== Classification report (IsolationForest's own -1/1 threshold) ===")
    print(classification_report(y_true, y_pred, target_names=["normal", "anomalous"], zero_division=0))

    ap = average_precision_score(y_true, y_score)
    print(f"Average precision (score-based, threshold-independent): {ap:.3f}")

    precision, recall, thresholds = precision_recall_curve(y_true, y_score)
    print("\nPrecision/recall at a few score thresholds:")
    for target_recall in [0.9, 0.75, 0.5]:
        idx = np.argmin(np.abs(recall - target_recall))
        print(f"  recall~={recall[idx]:.2f} -> precision={precision[idx]:.2f} "
              f"(score threshold~={thresholds[min(idx, len(thresholds)-1)]:.3f})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="infile", default="features.csv")
    parser.add_argument("--contamination", default="auto",
                         help="'auto' or a float like 0.02 (estimated anomaly rate)")
    parser.add_argument("--out", default="scored_features.csv")
    parser.add_argument("--top-n", type=int, default=10, help="print top-N highest-scored windows")
    args = parser.parse_args()

    contamination = args.contamination
    if contamination != "auto":
        contamination = float(contamination)

    df = pd.read_csv(args.infile)
    scored, model = fit_and_score(df, contamination)

    evaluate(scored)

    scored_sorted = scored.sort_values("anomaly_score", ascending=False)
    print(f"\n=== Top {args.top_n} highest-scored actor-day windows ===")
    print(scored_sorted[["actorID", "date", "anomaly_score", "predicted_anomaly", "label"] + FEATURE_COLUMNS]
          .head(args.top_n).to_string(index=False))

    scored_sorted.to_csv(args.out, index=False)
    print(f"\nWrote full scored table to {args.out}")


if __name__ == "__main__":
    main()
