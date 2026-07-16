"""
pyod_ensemble.py

Fits 5 PyOD anomaly detectors (PCA, KNN, IForest, OCSVM, HBOS) on the
engineered actor-day features, and combines them into ONE `anomaly_score`
per row via an EQUAL-weight average of each model's min-max normalized
score. A `votes` column (0-5) is also written for interpretability
("N of 5 models flagged this window") -- this is NOT what anomaly_score
is derived from; votes is reporting-only, the continuous average is the
actual signal, since it preserves ranking resolution that hard voting
throws away.

Model selection and the equal-weighting choice both came out of a
PyCaret leaderboard + PyOD holdout comparison across 8 candidate algos:
  pca 0.7866 / knn 0.7863 / iforest 0.7423 / ocsvm 0.7899 / hbos 0.6517
  (held-out average precision, after dropping access_denied_ratio --
  see FEATURE_COLUMNS note below). cluster, mcd, and lof scored
  meaningfully worse (0.58, 0.58, 0.17) and were dropped.

IMPORTANT -- known structural blind spot: this entire model family is
fit on daily AGGREGATE features (counts/ratios/frequencies) and has NO
concept of event order. Checked directly: on the full dataset, all 5
models unanimously miss 100% of `bigram_violation` and `order_composition`
labeled anomalies (14 of 14) -- zero votes from any model. This isn't
noise, it's a representation limit. lstm_sequence_model.py exists
specifically to cover this gap (it operates on event sequences, not
daily aggregates) -- combine_scores.py's job is to merge this ensemble's
output with LSTM's, precisely because they catch different anomaly
classes, not because either alone is sufficient.

FEATURE_COLUMNS drops `access_denied_ratio`: confirmed by inspecting
generate_synthetic_audit_data.py that ACCESS_DENIED is currently only
ever emitted for the two reasons consent_denied_ratio already counts
(patient consent-probing, cross-org denial) -- so on this synthetic
dataset the two columns are perfectly correlated (corr=1.00), which
sent PyOD's PCA model's decision_function to ~1e29 (near-singular
covariance from the zero-variance residual direction). This may NOT
hold on real production data, where ACCESS_DENIED could have other
causes (e.g. expired token, RBAC mismatch) -- worth re-checking
correlation before assuming this drop still applies to real audit logs.

predicted_anomaly threshold is votes >= 4 (not 3, not 5): a 3 vs 4 vs 5
sweep on held-out data showed 3/5 recall=0.800 but precision=0.406 (41
false alarms per 28 true catches); 4/5 keeps recall close (0.741-0.743
across held-out/full) while roughly halving false positives vs 3/5
(precision 0.448-0.542); 5/5 drops recall too far for a system where a
missed privacy-violation flag is costlier than an extra reviewer
click. This is a considered choice, not the default "majority" framing
-- override with --vote-threshold if you want to re-examine that
tradeoff.

top_features is NOT SHAP (SHAP's TreeExplainer, used in
isolation_forest_baseline.py, doesn't cleanly generalize across 5
heterogeneous model types -- PCA/KNN/OCSVM/HBOS aren't tree-based).
Instead this reports each row's largest per-feature deviations (in
standard deviations) from the TRAINING mean, in the direction that
increases each feature (the direction virtually all anomaly types in
this dataset move in). Same JSON schema as IF baseline's top_features
column ({"feature":..., "contribution":...}) for drop-in compatibility
with combine_scores.py / anomalyDetectionService.js, but this is a
distinct, simpler methodology -- do not present it as SHAP-equivalent
rigor in the paper.

Usage:
    python pyod_ensemble.py --in features.csv
"""

import argparse
import json

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import average_precision_score, classification_report

from pyod.models.pca import PCA
from pyod.models.knn import KNN
from pyod.models.iforest import IForest
from pyod.models.ocsvm import OCSVM
from pyod.models.hbos import HBOS

FEATURE_COLUMNS = [
    "access_frequency",
    "distinct_resources_touched",
    "off_hours_ratio",
    "burst_count",
    "consent_denied_ratio",
    "dispense_without_read_count",
]

MODEL_BUILDERS = {
    "pca": lambda contamination: PCA(contamination=contamination, random_state=42),
    "knn": lambda contamination: KNN(contamination=contamination),
    "iforest": lambda contamination: IForest(contamination=contamination, random_state=42),
    "ocsvm": lambda contamination: OCSVM(contamination=contamination),
    "hbos": lambda contamination: HBOS(contamination=contamination),
}


def min_max_normalize(arr: np.ndarray) -> np.ndarray:
    lo, hi = arr.min(), arr.max()
    if hi == lo:
        return np.zeros_like(arr, dtype=float)
    return (arr - lo) / (hi - lo)


def top_zscore_features(row_z: np.ndarray, feature_names: list, top_n: int = 3) -> str:
    """contribution = z-score in the training distribution, positive =
    higher than training mean. Not SHAP -- see module docstring."""
    order = np.argsort(row_z)[::-1][:top_n]
    top = [{"feature": feature_names[i], "contribution": round(float(row_z[i]), 4)} for i in order]
    return json.dumps(top)


def split_train_holdout(df: pd.DataFrame, train_frac: float = 0.6) -> pd.DataFrame:
    """Chronological per-actor split, same convention as
    isolation_forest_baseline.py and lstm_sequence_model.py."""
    df = df.sort_values(["actorID", "date"]).reset_index(drop=True)
    df["held_out"] = False
    for actor_id, group in df.groupby("actorID"):
        cutoff = max(1, int(len(group) * train_frac))
        holdout_idx = group.index[cutoff:]
        df.loc[holdout_idx, "held_out"] = True
    return df


def fit_and_score(df: pd.DataFrame, contamination: float, train_frac: float = 0.6,
                   vote_threshold: int = 4):
    df = split_train_holdout(df, train_frac=train_frac)

    train_df = df[~df["held_out"]]
    X_train_raw = train_df[FEATURE_COLUMNS].values
    X_all_raw = df[FEATURE_COLUMNS].values

    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train_raw)
    X_all = scaler.transform(X_all_raw)

    normalized_scores = []
    vote_matrix = []
    fitted_models = {}

    for name, build in MODEL_BUILDERS.items():
        model = build(contamination)
        model.fit(X_train)
        fitted_models[name] = model

        raw_scores = model.decision_function(X_all)
        normalized_scores.append(min_max_normalize(raw_scores))

        preds = model.predict(X_all)  # 1 = anomalous, 0 = normal
        vote_matrix.append(preds)

    normalized_scores = np.vstack(normalized_scores)  # shape (5, n_rows)
    vote_matrix = np.vstack(vote_matrix)  # shape (5, n_rows)

    df = df.copy()
    df["anomaly_score"] = normalized_scores.mean(axis=0)  # equal-weight average
    df["votes"] = vote_matrix.sum(axis=0)
    df["predicted_anomaly"] = df["votes"] >= vote_threshold

    # z-score explanation, computed against TRAIN mean/std only
    train_mean = X_train_raw.mean(axis=0)
    train_std = X_train_raw.std(axis=0)
    train_std[train_std == 0] = 1.0  # avoid div-by-zero for a degenerate feature
    z_all = (X_all_raw - train_mean) / train_std
    df["top_features"] = [top_zscore_features(z_all[i], FEATURE_COLUMNS) for i in range(len(z_all))]

    return df, fitted_models


def evaluate(df: pd.DataFrame, label_suffix: str = ""):
    y_true = (df["label"] == "anomalous").astype(int)
    y_score = df["anomaly_score"]
    y_pred = df["predicted_anomaly"].astype(int)

    print(f"\n=== Classification report{label_suffix} (votes >= threshold) ===")
    print(classification_report(y_true, y_pred, target_names=["normal", "anomalous"], zero_division=0))

    ap = average_precision_score(y_true, y_score)
    print(f"Average precision{label_suffix} (score-based, threshold-independent): {ap:.3f}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="infile", default="features.csv")
    parser.add_argument("--contamination", type=float, default=0.0714,
                         help="estimated anomaly rate; PyOD models here require a float, not 'auto'")
    parser.add_argument("--out", default="scored_features.csv")
    parser.add_argument("--top-n", type=int, default=10, help="print top-N highest-scored windows")
    parser.add_argument("--train-frac", type=float, default=0.6,
                         help="fraction of each actor's chronological actor-day rows used to fit; "
                              "rest held out and scored but never fit on. Default 0.6 (not IF "
                              "baseline's 0.8) -- see module docstring for why: at 0.8 this dataset's "
                              "holdout only has ~15 anomalous rows, too few for a stable AP estimate.")
    parser.add_argument("--vote-threshold", type=int, default=4,
                         help="number of models (out of 5) that must flag a row for "
                              "predicted_anomaly=True; see module docstring for the 3 vs 4 vs 5 tradeoff")
    args = parser.parse_args()

    df = pd.read_csv(args.infile)
    scored, models = fit_and_score(
        df, args.contamination, train_frac=args.train_frac, vote_threshold=args.vote_threshold
    )

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

        print("\n=== Zero-vote misses (blind spots -- check anomaly_type if present) ===")
        misses = scored[(scored["label"] == "anomalous") & (scored["votes"] == 0)]
        print(f"{len(misses)} of {(scored['label'] == 'anomalous').sum()} anomalous rows got 0 votes")
    else:
        print("\nNo synthetic 'anomalous' labels present -- skipping eval metrics.")

    scored_sorted = scored.sort_values("anomaly_score", ascending=False)
    print(f"\n=== Top {args.top_n} highest-scored actor-day windows ===")
    print(scored_sorted[["actorID", "date", "anomaly_score", "votes", "predicted_anomaly", "label"] + FEATURE_COLUMNS]
          .head(args.top_n).to_string(index=False))

    print(f"\n=== Top-feature explanation for those same {args.top_n} windows ===")
    for _, row in scored_sorted.head(args.top_n).iterrows():
        top = json.loads(row["top_features"])
        reason = ", ".join(f"{t['feature']} ({t['contribution']:+.3f} sd)" for t in top)
        print(f"  {row['actorID']} {row['date']}: {reason}")

    scored_sorted.to_csv(args.out, index=False)
    print(f"\nWrote full scored table to {args.out}")


if __name__ == "__main__":
    main()
