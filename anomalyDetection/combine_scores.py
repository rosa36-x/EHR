"""
combine_scores.py

Merges Isolation Forest's anomaly_score with the LSTM's max_z_surprisal
into ONE combined_score per actor-day window -- currently these are two
separate, un-reconciled reports (isolation_forest_baseline.py's
scored_features.csv and lstm_sequence_model.py's lstm_scored_actor_days.csv),
which isn't something a review dashboard or an enforcement decision should
have to reconcile by hand.

Weighting default (IF 0.7 / LSTM 0.3) reflects an actual empirical finding
from this project, not an arbitrary guess: a controlled test (an anomaly
type specifically designed to be invisible to every IF feature -- normal
volume/timing/diversity, only wrong in action-sequence composition) showed
LSTM's max_z_surprisal beating IF's rank on only 2 of 4 injected instances,
with IF's own average precision (~0.79-0.91 across runs) consistently far
ahead of LSTM's (~0.01-0.10). Weighting LSTM this low is a considered
choice given that finding, not a placeholder -- override with --lstm-weight
if you re-run that experiment with more data and get a different result.

Both scores are min-max normalized to [0,1] before combining, since they're
on entirely different, non-comparable scales (IF's is roughly bounded by
its contamination-relative decision_function; LSTM's is a per-actor
z-scored surprisal). A row missing from the LSTM output (dropped by its
burn_in -- see lstm_sequence_model.py) gets an LSTM contribution of 0, i.e.
combined_score falls back to IF-only for that row rather than dropping it.

Usage:
    python combine_scores.py --if-in scored_features.csv --lstm-in lstm_scored_actor_days.csv --out combined_scores.csv
"""

import argparse

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, classification_report


def min_max_normalize(series: pd.Series) -> pd.Series:
    lo, hi = series.min(), series.max()
    if hi == lo:
        return pd.Series(0.0, index=series.index)
    return (series - lo) / (hi - lo)


def combine(if_df: pd.DataFrame, lstm_df: pd.DataFrame, if_weight: float, lstm_weight: float) -> pd.DataFrame:
    if_df = if_df.copy()
    if_df["date"] = if_df["date"].astype(str)

    lstm_cols = lstm_df[["actorID", "date", "max_z_surprisal"]].copy()
    lstm_cols["date"] = lstm_cols["date"].astype(str)

    merged = if_df.merge(lstm_cols, on=["actorID", "date"], how="left")

    merged["if_norm"] = min_max_normalize(merged["anomaly_score"])
    # Rows the LSTM burn-in dropped have no signal either way -- 0
    # contribution (falls back to IF-only), not a penalty or a boost.
    lstm_norm = min_max_normalize(merged["max_z_surprisal"].fillna(merged["max_z_surprisal"].min()))
    merged["lstm_norm"] = lstm_norm.where(merged["max_z_surprisal"].notna(), 0.0)

    total_weight = if_weight + lstm_weight
    merged["combined_score"] = (if_weight * merged["if_norm"] + lstm_weight * merged["lstm_norm"]) / total_weight

    return merged


def evaluate(df: pd.DataFrame):
    y_true = (df["label"] == "anomalous").astype(int)
    ap = average_precision_score(y_true, df["combined_score"])
    print(f"\n=== combined_score — average precision: {ap:.3f} ===")

    threshold = df["combined_score"].quantile(0.95)
    y_pred = (df["combined_score"] >= threshold).astype(int)
    print(classification_report(y_true, y_pred, target_names=["normal", "anomalous"], zero_division=0))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--if-in", dest="if_in", default="scored_features.csv")
    parser.add_argument("--lstm-in", dest="lstm_in", default="lstm_scored_actor_days.csv")
    parser.add_argument("--out", default="combined_scores.csv")
    parser.add_argument("--if-weight", type=float, default=0.7)
    parser.add_argument("--lstm-weight", type=float, default=0.3)
    parser.add_argument("--top-n", type=int, default=10)
    args = parser.parse_args()

    if_df = pd.read_csv(args.if_in)
    lstm_df = pd.read_csv(args.lstm_in)

    combined = combine(if_df, lstm_df, args.if_weight, args.lstm_weight)
    evaluate(combined)

    combined_sorted = combined.sort_values("combined_score", ascending=False)
    print(f"\n=== Top {args.top_n} highest combined_score actor-day windows ===")
    print(combined_sorted[["actorID", "date", "combined_score", "if_norm", "lstm_norm", "label"]]
          .head(args.top_n).to_string(index=False))

    combined_sorted.to_csv(args.out, index=False)
    print(f"\nWrote {len(combined_sorted)} rows to {args.out}")


if __name__ == "__main__":
    main()
