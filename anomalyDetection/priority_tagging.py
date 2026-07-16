"""
priority_tagging.py

Replaces combine_scores.py's single linear blend (ensemble_weight *
ensemble_norm + lstm_weight * lstm_norm -> one shared threshold) with a
TWO-TIER priority system.

Why: check_or_rule.py and check_lstm_threshold.py showed the linear blend
suppresses LSTM's signal specifically on the one case it exists for --
sequence-type anomalies (bigram_violation / order_composition), which the
5-model PyOD ensemble is structurally blind to (0/5 votes on 100% of
these -- see pyod_ensemble.py). At the SAME threshold percentile, LSTM
scored alone recovered far more sequence-type anomalies than the blended
score did, because averaging two differently-scaled, differently-noisy
signals into one number lets a confident specialist (LSTM, for sequence
anomalies) get diluted by a model that's simply blind to that case
(the ensemble).

Design:
  PRIORITY 1 (high confidence): ensemble anomaly_score >= its own
    p97 percentile threshold (NOT votes -- checked directly via
    check_p1_definition.py: p97 beat votes>=4 on held-out data,
    recall 0.800 vs 0.743, precision 0.509 vs 0.542 -- a real, favorable
    trade, not noise). votes is still reported as a column for
    interpretability ("N of 5 models agree") but no longer decides P1.
  PRIORITY 2 (sequence-anomaly candidate): LSTM's max_z_surprisal clears
    its own p99 threshold, AND the row is NOT already Priority 1 (dedup --
    a row caught by both stays Priority 1, it doesn't get double-counted
    or downgraded). Checked directly via check_p2_score_col.py: p99 cuts
    P2 volume by ~78% vs p97 (19 vs 88 flags) and roughly triples P2
    precision (0.316 vs 0.102), at a cost of 3 fewer sequence-type catches
    (6/23 vs 9/23) -- a better trade given P2 is a lower-confidence
    "worth a quick check" tier, not a ranked-by-urgency list.
  NONE: neither fires.

Precision is intentionally NOT uniform across tiers. P1 carries the
ensemble's ~0.45-0.54 precision. P2 is LSTM-only and meaningfully
noisier (LSTM solo precision was ~0.14-0.21 in our checks) -- this is
expected and should be surfaced to reviewers explicitly (label P2 as
"lower-confidence, sequence-pattern candidate", not folded into one
undifferentiated flagged list) rather than hidden by blending it into
one score.

Usage:
    python priority_tagging.py \
        --ensemble-in scored_features.csv \
        --lstm-in lstm_scored_actor_days.csv \
        --out prioritized_flags.csv
"""

import argparse

import pandas as pd
from sklearn.metrics import classification_report


def tag_priority(ensemble_df: pd.DataFrame, lstm_df: pd.DataFrame,
                  ensemble_percentile: float, lstm_score_col: str, lstm_percentile: float) -> pd.DataFrame:
    ensemble_df = ensemble_df.copy()
    lstm_df = lstm_df.copy()
    ensemble_df["date"] = ensemble_df["date"].astype(str)
    lstm_df["date"] = lstm_df["date"].astype(str)

    ensemble_cols = ["actorID", "date", "votes", "anomaly_score", "label", "top_features"]
    if "held_out" in ensemble_df.columns:
        ensemble_cols.append("held_out")
    ensemble_slim = ensemble_df[ensemble_cols].rename(
        columns={"anomaly_score": "ensemble_score", "held_out": "ensemble_held_out"})

    lstm_cols = ["actorID", "date", lstm_score_col]
    if "held_out" in lstm_df.columns:
        lstm_cols.append("held_out")
    lstm_slim = lstm_df[lstm_cols].rename(
        columns={lstm_score_col: "lstm_score", "held_out": "lstm_held_out"})

    merged = ensemble_slim.merge(lstm_slim, on=["actorID", "date"], how="left")

    # Left merge can leave NaN in lstm_* columns for actor-days the LSTM
    # output didn't cover -- NaN serializes as a truly EMPTY CSV field,
    # which anomalyDetectionService.js's parseCSV silently drops (its regex
    # requires 1+ chars per field), shifting every later column left by one.
    # Fill immediately after merge so nothing downstream ever sees NaN.
    if "lstm_held_out" in merged.columns:
        merged["lstm_held_out"] = merged["lstm_held_out"].fillna(False)

    # LSTM threshold fit on the FULL lstm_df distribution -- what a
    # production system would actually use, not re-fit per evaluation slice.
    lstm_threshold = lstm_df[lstm_score_col].quantile(lstm_percentile)
    merged["lstm_score"] = merged["lstm_score"].fillna(merged["lstm_score"].min())

    ensemble_threshold = ensemble_df["anomaly_score"].quantile(ensemble_percentile)
    p1 = merged["ensemble_score"] >= ensemble_threshold
    p2 = (merged["lstm_score"] >= lstm_threshold) & ~p1  # dedup: P1 wins ties

    merged["priority"] = "none"
    merged.loc[p2, "priority"] = "P2_sequence_candidate"
    merged.loc[p1, "priority"] = "P1_high_confidence"

    if "ensemble_held_out" in merged.columns and "lstm_held_out" in merged.columns:
        merged["held_out"] = merged["ensemble_held_out"] & merged["lstm_held_out"].fillna(False)
    elif "ensemble_held_out" in merged.columns:
        merged["held_out"] = merged["ensemble_held_out"]

    merged["lstm_threshold_used"] = lstm_threshold
    return merged


def evaluate(df: pd.DataFrame, label_suffix: str = ""):
    y_true = (df["label"] == "anomalous").astype(int)
    y_pred = (df["priority"] != "none").astype(int)

    print(f"\n=== Classification report{label_suffix} (P1 or P2, i.e. any flag) ===")
    print(classification_report(y_true, y_pred, target_names=["normal", "anomalous"], zero_division=0))

    print(f"Priority breakdown{label_suffix}:")
    print(df["priority"].value_counts())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ensemble-in", default="scored_features.csv")
    parser.add_argument("--lstm-in", default="lstm_scored_actor_days.csv")
    parser.add_argument("--out", default="prioritized_flags.csv")
    parser.add_argument("--ensemble-percentile", type=float, default=0.97)
    parser.add_argument("--lstm-score-col", default="max_z_surprisal")
    parser.add_argument("--lstm-percentile", type=float, default=0.99)
    parser.add_argument("--top-n", type=int, default=10)
    args = parser.parse_args()

    ensemble_df = pd.read_csv(args.ensemble_in)
    lstm_df = pd.read_csv(args.lstm_in)

    tagged = tag_priority(
        ensemble_df, lstm_df,
        ensemble_percentile=args.ensemble_percentile,
        lstm_score_col=args.lstm_score_col,
        lstm_percentile=args.lstm_percentile,
    )

    if "label" in tagged.columns and (tagged["label"] == "anomalous").any():
        print("\n" + "=" * 70)
        print("METRICS INCLUDING TRAINING DATA (may be optimistic)")
        print("=" * 70)
        evaluate(tagged, label_suffix=" [ALL]")

        if "held_out" in tagged.columns:
            holdout = tagged[tagged["held_out"]]
            print("\n" + "=" * 70)
            print(f"METRICS ON HELD-OUT DATA ONLY (leakage-free, n={len(holdout)}) -- report this one")
            print("=" * 70)
            if (holdout["label"] == "anomalous").sum() == 0:
                print("No held-out anomalous rows to evaluate.")
            else:
                evaluate(holdout, label_suffix=" [HELD-OUT]")
    else:
        print("\nNo synthetic 'anomalous' labels present -- skipping eval metrics.")

    p1_top = tagged[tagged["priority"] == "P1_high_confidence"].sort_values("ensemble_score", ascending=False)
    p2_top = tagged[tagged["priority"] == "P2_sequence_candidate"].sort_values("lstm_score", ascending=False)

    print(f"\n=== Top {args.top_n} PRIORITY 1 (high confidence) ===")
    print(p1_top[["actorID", "date", "votes", "ensemble_score", "label"]].head(args.top_n).to_string(index=False))

    print(f"\n=== Top {args.top_n} PRIORITY 2 (sequence-anomaly candidates) ===")
    print(p2_top[["actorID", "date", "lstm_score", "label"]].head(args.top_n).to_string(index=False))

    tagged.to_csv(args.out, index=False)
    print(f"\nWrote {len(tagged)} rows to {args.out}")


if __name__ == "__main__":
    main()
