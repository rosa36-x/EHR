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

def split_train_holdout(df: pd.DataFrame, train_frac: float = 0.8) -> pd.DataFrame:
    """Chronological per-actor split, same rationale as lstm_sequence_model.py:
    fit only on each actor's earliest train_frac of actor-day rows; mark the
    rest as held_out=True. Requires an actorID + date (or sortable date-like
    column) in df."""
    df = df.sort_values(["actorID", "date"]).reset_index(drop=True)
    df["held_out"] = False
    for actor_id, group in df.groupby("actorID"):
        cutoff = max(1, int(len(group) * train_frac))
        holdout_idx = group.index[cutoff:]
        df.loc[holdout_idx, "held_out"] = True
    return df

def fit_and_score(df: pd.DataFrame, contamination, train_frac: float = 0.8):
    df = split_train_holdout(df, train_frac=train_frac)

    train_df = df[~df["held_out"]]
    X_train = train_df[FEATURE_COLUMNS].values
    X_all = df[FEATURE_COLUMNS].values

    model = IsolationForest(
        n_estimators=200,
        contamination=contamination,
        random_state=42,
    )
    model.fit(X_train)

    raw_scores = -model.decision_function(X_all)
    predictions = model.predict(X_all)

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_all)
    top_features = [top_shap_features(shap_values[i], FEATURE_COLUMNS) for i in range(len(X_all))]

    df = df.copy()
    df["anomaly_score"] = raw_scores
    df["predicted_anomaly"] = predictions == -1
    df["top_features"] = top_features
    return df, model


def evaluate(df: pd.DataFrame, label_suffix: str = ""):
    y_true = (df["label"] == "anomalous").astype(int)
    y_score = df["anomaly_score"]
    y_pred = df["predicted_anomaly"].astype(int)

    print(f"\n=== Classification report{label_suffix} (IsolationForest's own -1/1 threshold) ===")
    print(classification_report(y_true, y_pred, target_names=["normal", "anomalous"], zero_division=0))

    ap = average_precision_score(y_true, y_score)
    print(f"Average precision{label_suffix} (score-based, threshold-independent): {ap:.3f}")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="infile", default="features.csv")
    parser.add_argument("--contamination", default="auto",
                         help="'auto' or a float like 0.02 (estimated anomaly rate)")
    parser.add_argument("--out", default="scored_features.csv")
    parser.add_argument("--top-n", type=int, default=10, help="print top-N highest-scored windows")
    parser.add_argument("--train-frac", type=float, default=0.8,
                         help="fraction of each actor's chronological actor-day rows used to fit; "
                              "rest held out and scored but never fit on")
    args = parser.parse_args()

    contamination = args.contamination
    if contamination != "auto":
        contamination = float(contamination)

    df = pd.read_csv(args.infile)
    scored, model = fit_and_score(df, contamination, train_frac=args.train_frac)

    if "label" in scored.columns and (scored["label"] == "anomalous").any():
        print("\n" + "=" * 70)
        print("METRICS INCLUDING TRAINING DATA (may be optimistic)")
        print("=" * 70)
        evaluate(scored, label_suffix=" [ALL]")

        holdout = scored[scored["held_out"]]
        print("\n" + "=" * 70)
        print(f"METRICS ON HELD-OUT DATA ONLY (leakage-free, n={len(holdout)}) -- report this one")
        print("=" * 70)
        if (holdout["label"] == "anomalous").sum() == 0:
            print("No held-out anomalous rows -- try a lower --train-frac.")
        else:
            evaluate(holdout, label_suffix=" [HELD-OUT]")
    else:
        print("\nNo synthetic 'anomalous' labels present -- skipping eval metrics.")

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
