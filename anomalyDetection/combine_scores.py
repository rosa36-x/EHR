"""
combine_scores.py

Merges the PyOD ensemble's anomaly_score (see pyod_ensemble.py) with the LSTM's max_z_surprisal
into ONE combined_score per actor-day window -- currently these are two
separate, un-reconciled reports (pyod_ensemble.py's
scored_features.csv and lstm_sequence_model.py's lstm_scored_actor_days.csv),
which isn't something a review dashboard or an enforcement decision should
have to reconcile by hand.

Weighting default (ensemble 0.7 / LSTM 0.3) reflects an actual empirical finding
from this project, not an arbitrary guess: a controlled test (an anomaly
type specifically designed to be invisible to every ensemble feature -- normal
volume/timing/diversity, only wrong in action-sequence composition) showed
LSTM's max_z_surprisal beating the ensemble's rank on only 2 of 4 injected instances,
with the ensemble's own average precision (~0.79-0.91 across runs) consistently far
ahead of LSTM's (~0.01-0.10). Weighting LSTM this low is a considered
choice given that finding, not a placeholder -- override with --lstm-weight
if you re-run that experiment with more data and get a different result.

Both scores are min-max normalized to [0,1] before combining, since they're
on entirely different, non-comparable scales (the ensemble's is a [0,1]-bounded average of 5 models' normalized decision_functions; LSTM's is a per-actor
z-scored surprisal). A row missing from the LSTM output (dropped by its
burn_in -- see lstm_sequence_model.py) gets an LSTM contribution of 0, i.e.
combined_score falls back to ensemble-only for that row rather than dropping it.

Usage:
    python combine_scores.py --ensemble-in scored_features.csv --lstm-in lstm_scored_actor_days.csv --out combined_scores.csv
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


def combine(ensemble_df: pd.DataFrame, lstm_df: pd.DataFrame, ensemble_weight: float, lstm_weight: float,
            lstm_score_col: str = "max_surprisal") -> pd.DataFrame:
    ensemble_df = ensemble_df.copy()
    ensemble_df["date"] = ensemble_df["date"].astype(str)
    if "held_out" in ensemble_df.columns:
        ensemble_df = ensemble_df.rename(columns={"held_out": "ensemble_held_out"})

    keep_cols = ["actorID", "date", lstm_score_col]
    if "held_out" in lstm_df.columns:
        keep_cols.append("held_out")
    lstm_cols = lstm_df[keep_cols].copy()
    lstm_cols["date"] = lstm_cols["date"].astype(str)
    if "held_out" in lstm_cols.columns:
        lstm_cols = lstm_cols.rename(columns={"held_out": "lstm_held_out"})

    merged = ensemble_df.merge(lstm_cols, on=["actorID", "date"], how="left")

    merged["ensemble_norm"] = min_max_normalize(merged["anomaly_score"])
    lstm_norm = min_max_normalize(merged[lstm_score_col].fillna(merged[lstm_score_col].min()))
    merged["lstm_norm"] = lstm_norm.where(merged[lstm_score_col].notna(), 0.0)

    total_weight = ensemble_weight + lstm_weight
    merged["combined_score"] = (ensemble_weight * merged["ensemble_norm"] + lstm_weight * merged["lstm_norm"]) / total_weight

    # Row is leakage-free only if BOTH the ensemble and LSTM never trained on it.
    if "ensemble_held_out" in merged.columns and "lstm_held_out" in merged.columns:
        merged["held_out"] = merged["ensemble_held_out"] & merged["lstm_held_out"].fillna(False)
    elif "ensemble_held_out" in merged.columns:
        merged["held_out"] = merged["ensemble_held_out"]
    elif "lstm_held_out" in merged.columns:
        merged["held_out"] = merged["lstm_held_out"]

    return merged


def evaluate(df: pd.DataFrame):
    y_true = (df["label"] == "anomalous").astype(int)
    ap = average_precision_score(y_true, df["combined_score"])
    print(f"\n=== combined_score — average precision: {ap:.3f} ===")

    threshold = df["combined_score"].quantile(0.95)
    y_pred = (df["combined_score"] >= threshold).astype(int)
    print(classification_report(y_true, y_pred, target_names=["normal", "anomalous"], zero_division=0))

def grid_search(ensemble_df: pd.DataFrame, lstm_df: pd.DataFrame, lstm_score_col: str,
                 held_out_only: bool = True):
    print(f"\n=== Weight grid search (lstm_score_col={lstm_score_col}, "
          f"held_out_only={held_out_only}) ===")
    best_ap, best_w = -1.0, None
    results = []
    for w_ensemble in np.arange(0.0, 1.01, 0.1):
        w_lstm = 1.0 - w_ensemble
        merged = combine(ensemble_df, lstm_df, w_ensemble, w_lstm, lstm_score_col=lstm_score_col)
        if held_out_only:
            if "held_out" not in merged.columns:
                raise ValueError(
                    "held_out_only=True but no held_out column in merged data "
                    "-- check that --ensemble-in was built with a held_out-tracking "
                    "ensemble run (pyod_ensemble.py's split_train_holdout)"
                )
            eval_df = merged[merged["held_out"] == True]
        else:
            eval_df = merged
        if eval_df["label"].eq("anomalous").sum() == 0:
            print(f"  ensemble_weight={w_ensemble:.1f} — skipped, no anomalous rows in eval set")
            continue
        y_true = (eval_df["label"] == "anomalous").astype(int)
        ap = average_precision_score(y_true, eval_df["combined_score"])
        results.append((w_ensemble, ap))
        print(f"  ensemble_weight={w_ensemble:.1f}  lstm_weight={w_lstm:.1f}  AP={ap:.4f}")
        if ap > best_ap:
            best_ap, best_w = ap, w_ensemble

    print(f"\nBest: ensemble_weight={best_w:.1f}, lstm_weight={1-best_w:.1f}, AP={best_ap:.4f}")
    return results, best_w, best_ap

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ensemble-in", dest="ensemble_in", default="scored_features.csv")
    parser.add_argument("--lstm-in", dest="lstm_in", default="lstm_scored_actor_days.csv")
    parser.add_argument("--out", default="combined_scores.csv")
    parser.add_argument("--ensemble-weight", type=float, default=0.7)
    parser.add_argument("--lstm-weight", type=float, default=0.3)
    parser.add_argument("--top-n", type=int, default=10)
    parser.add_argument("--lstm-score-col", default="max_surprisal",
                         help="which LSTM column to blend in (max_surprisal is currently "
                              "the best-performing held-out signal; max_z_surprisal available too)")
    parser.add_argument("--grid-search", action="store_true",
                         help="sweep ensemble_weight 0.0-1.0 in steps of 0.1 and report AP for each, "
                              "using held-out rows only if available")
    args = parser.parse_args()

    ensemble_df = pd.read_csv(args.ensemble_in)
    lstm_df = pd.read_csv(args.lstm_in)

    if args.grid_search:
        grid_search(ensemble_df, lstm_df, lstm_score_col=args.lstm_score_col)
        return

    combined = combine(ensemble_df, lstm_df, args.ensemble_weight, args.lstm_weight, lstm_score_col=args.lstm_score_col)

    evaluate(combined)

    combined_sorted = combined.sort_values("combined_score", ascending=False)
    print(f"\n=== Top {args.top_n} highest combined_score actor-day windows ===")
    print(combined_sorted[["actorID", "date", "combined_score", "ensemble_norm", "lstm_norm", "label"]]
          .head(args.top_n).to_string(index=False))

    combined_sorted.to_csv(args.out, index=False)
    print(f"\nWrote {len(combined_sorted)} rows to {args.out}")


if __name__ == "__main__":
    main()
