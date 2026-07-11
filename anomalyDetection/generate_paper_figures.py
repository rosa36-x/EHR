"""
generate_paper_figures.py

Standalone reporting script -- NOT part of the live anomalyWorker.js path.
Produces static PNG figures for the IEEE paper from files already written
by the existing pipeline scripts. Doesn't re-fit anything by default; reads
the CSVs isolation_forest_baseline.py / lstm_sequence_model.py already
produce, so figures stay consistent with whatever run you point it at.

Figures:
  1. score_distribution.png     -- histogram of anomaly_score, split
                                    normal vs synthetic-labeled anomalous
  2. feature_importance.png     -- mean |contribution| per feature, derived
                                    from the top_features JSON column
                                    (a proxy bar chart -- see note in
                                    plot_feature_importance()'s docstring
                                    for why this isn't a true SHAP beeswarm)
  3. lstm_loss_curve.png        -- per-epoch training loss (only produced
                                    if a --lstm-loss CSV is provided --
                                    generate it via:
                                      python lstm_sequence_model.py --loss-out lstm_loss.csv ...
  4. pr_roc_curve.png           -- precision-recall + ROC, eval-only,
                                    requires the synthetic `label` column
                                    (skipped automatically on real data)

Usage:
    python generate_paper_figures.py \
        --scored scored_features.csv \
        --lstm-loss lstm_loss.csv \
        --out-dir figures/
"""

import argparse
import json
import os

import matplotlib
matplotlib.use("Agg")  # headless -- no display needed, just PNG output
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import precision_recall_curve, roc_curve, auc, average_precision_score


def plot_score_distribution(df: pd.DataFrame, out_path: str):
    fig, ax = plt.subplots(figsize=(7, 4.5))
    has_labels = "label" in df.columns and df["label"].notna().any()

    if has_labels:
        normal = df.loc[df["label"] != "anomalous", "anomaly_score"]
        anomalous = df.loc[df["label"] == "anomalous", "anomaly_score"]
        bins = np.linspace(df["anomaly_score"].min(), df["anomaly_score"].max(), 40)
        ax.hist(normal, bins=bins, alpha=0.6, label=f"normal (n={len(normal)})", color="#4C72B0")
        ax.hist(anomalous, bins=bins, alpha=0.6, label=f"anomalous (n={len(anomalous)})", color="#C44E52")
        ax.legend()
    else:
        ax.hist(df["anomaly_score"], bins=40, color="#4C72B0")

    ax.set_xlabel("Isolation Forest anomaly score (higher = more anomalous)")
    ax.set_ylabel("actor-day windows")
    ax.set_title("Anomaly score distribution")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Wrote {out_path}")


def plot_feature_importance(df: pd.DataFrame, out_path: str):
    """Bar chart of mean |contribution| per feature, aggregated from the
    top_features JSON column that isolation_forest_baseline.py already
    writes per-row (top-3 SHAP contributions per row, not all 7 features
    per row). This is a proxy for a true SHAP summary/beeswarm plot, which
    would need the full per-row shap_values matrix -- not persisted to CSV
    today, since only the top-3 per row are needed for the flag's
    topFeatures field in production. Good enough for a paper bar chart of
    "what drives anomaly flags overall"; re-run isolation_forest_baseline.py
    with a --shap-matrix-out flag (not implemented) if a true beeswarm plot
    is needed later.
    """
    totals, counts = {}, {}
    for raw in df["top_features"].dropna():
        try:
            items = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        for item in items:
            f = item.get("feature")
            c = item.get("contribution")
            if f is None or c is None:
                continue
            totals[f] = totals.get(f, 0.0) + abs(c)
            counts[f] = counts.get(f, 0) + 1

    if not totals:
        print("No parsable top_features data -- skipping feature_importance.png")
        return

    means = {f: totals[f] / counts[f] for f in totals}
    ordered = sorted(means.items(), key=lambda kv: kv[1])

    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.barh([f for f, _ in ordered], [v for _, v in ordered], color="#55A868")
    ax.set_xlabel("mean |SHAP contribution| (when among that row's top-3)")
    ax.set_title("Feature importance across flagged windows")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Wrote {out_path}")


def plot_lstm_loss(loss_path: str, out_path: str):
    loss_df = pd.read_csv(loss_path)
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.plot(loss_df["epoch"], loss_df["avg_loss"], marker="o", color="#8172B2")
    ax.set_xlabel("epoch")
    ax.set_ylabel("avg cross-entropy loss")
    ax.set_title("LSTM next-event prediction training loss")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Wrote {out_path}")


def plot_pr_roc(df: pd.DataFrame, out_path: str):
    """Eval-only -- requires the synthetic `label` ground-truth column.
    Automatically skipped on real (unlabeled) audit data, same guard
    isolation_forest_baseline.py already uses."""
    if "label" not in df.columns or not (df["label"] == "anomalous").any():
        print("No synthetic 'anomalous' labels present -- skipping pr_roc_curve.png "
              "(this is expected on real audit data).")
        return

    y_true = (df["label"] == "anomalous").astype(int)
    y_score = df["anomaly_score"]

    precision, recall, _ = precision_recall_curve(y_true, y_score)
    fpr, tpr, _ = roc_curve(y_true, y_score)
    ap = average_precision_score(y_true, y_score)
    roc_auc = auc(fpr, tpr)

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.5))

    axes[0].plot(recall, precision, color="#C44E52")
    axes[0].set_xlabel("recall")
    axes[0].set_ylabel("precision")
    axes[0].set_title(f"Precision-Recall (AP={ap:.3f})")

    axes[1].plot(fpr, tpr, color="#4C72B0", label=f"AUC={roc_auc:.3f}")
    axes[1].plot([0, 1], [0, 1], linestyle="--", color="gray", linewidth=1)
    axes[1].set_xlabel("false positive rate")
    axes[1].set_ylabel("true positive rate")
    axes[1].set_title("ROC")
    axes[1].legend()

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Wrote {out_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scored", default="scored_features.csv",
                         help="output of isolation_forest_baseline.py (--out)")
    parser.add_argument("--lstm-loss", default=None,
                         help="output of lstm_sequence_model.py's --loss-out (optional)")
    parser.add_argument("--out-dir", default="figures")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    df = pd.read_csv(args.scored)

    plot_score_distribution(df, os.path.join(args.out_dir, "score_distribution.png"))
    plot_feature_importance(df, os.path.join(args.out_dir, "feature_importance.png"))
    plot_pr_roc(df, os.path.join(args.out_dir, "pr_roc_curve.png"))

    if args.lstm_loss:
        plot_lstm_loss(args.lstm_loss, os.path.join(args.out_dir, "lstm_loss_curve.png"))
    else:
        print("No --lstm-loss provided -- skipping lstm_loss_curve.png. "
              "Generate one via: python lstm_sequence_model.py --loss-out lstm_loss.csv --in <file>")

    print(f"\nDone. Figures in {args.out_dir}/")


if __name__ == "__main__":
    main()
