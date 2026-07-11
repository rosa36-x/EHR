"""
isolation_forest_baseline.py

Fits an Isolation Forest on the engineered features, scores every
actor-day window, and checks the result against the synthetic `label`
column for a rough precision/recall sanity check.

`label` is used ONLY here, for eval. The model itself is unsupervised
and never sees it.

Also computes SHAP feature attributions (shap.TreeExplainer works
directly on sklearn's IsolationForest — verified: it explains
decision_function, where LOWER = more anomalous, so a feature with a
strongly NEGATIVE shap value is what's pushing that row toward
"anomalous". `contribution` below is defined as -shap_value specifically
so a HIGHER contribution number = pushes toward anomalous, which reads
naturally in a report ("top contributing features") without the reader
needing to know decision_function's sign convention.

This is the "why" a flag was raised — combine_scores.py and
anomalyDetectionService.js both expect the `top_features` column this
script writes (JSON string per row: [{"feature":..., "contribution":...}, ...]).

Usage:
    python isolation_forest_baseline.py --in features.csv
"""

import argparse
import json

import numpy as np
import pandas as pd
import shap
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


def top_shap_features(shap_row: np.ndarray, feature_names: list, top_n: int = 3) -> str:
    """contribution = -shap_value: positive contribution = pushes toward
    anomalous (see module docstring for why the sign is flipped here)."""
    contributions = -shap_row
    order = np.argsort(contributions)[::-1][:top_n]
    top = [{"feature": feature_names[i], "contribution": round(float(contributions[i]), 4)} for i in order]
    return json.dumps(top)


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

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X)
    top_features = [top_shap_features(shap_values[i], FEATURE_COLUMNS) for i in range(len(X))]

    df = df.copy()
    df["anomaly_score"] = raw_scores
    df["predicted_anomaly"] = predictions == -1
    df["top_features"] = top_features
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

    if "label" in scored.columns and (scored["label"] == "anomalous").any():
        evaluate(scored)
    else:
        print("\nNo synthetic 'anomalous' labels present (real audit data, or a "
              "run with zero injected anomalies) -- skipping eval metrics, which "
              "need ground truth. Scoring/SHAP output below is unaffected.")

    scored_sorted = scored.sort_values("anomaly_score", ascending=False)
    print(f"\n=== Top {args.top_n} highest-scored actor-day windows ===")
    print(scored_sorted[["actorID", "date", "anomaly_score", "predicted_anomaly", "label"] + FEATURE_COLUMNS]
          .head(args.top_n).to_string(index=False))

    print(f"\n=== Top-feature explanation for those same {args.top_n} windows ===")
    for _, row in scored_sorted.head(args.top_n).iterrows():
        top = json.loads(row["top_features"])
        reason = ", ".join(f"{t['feature']} ({t['contribution']:+.3f})" for t in top)
        print(f"  {row['actorID']} {row['date']}: {reason}")

    scored_sorted.to_csv(args.out, index=False)
    print(f"\nWrote full scored table to {args.out}")


if __name__ == "__main__":
    main()
