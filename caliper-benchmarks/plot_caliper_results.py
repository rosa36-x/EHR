"""
plot_caliper_results.py

Standalone script -- parses Caliper's default report.html "Summary of
performance metrics" table (the one in your screenshot: Name, Succ, Fail,
Send Rate (TPS), Max/Min/Avg Latency (s), Throughput (TPS)) and produces
two PNG charts for the paper:
  - send_rate_vs_throughput.png -- does throughput keep pace with the
    requested send rate, per operation
  - send_rate_vs_latency.png    -- avg latency (with min/max as an error
    band) vs send rate, per operation

Round labels are expected in the "<operation>_<N>tps" pattern this
project's benchmark-config.yaml already uses (e.g.
"check_active_consent_50tps") -- the trailing "_Ntps" is stripped to group
rounds by operation for the per-operation lines. Rounds that don't match
this pattern are grouped under their full name unchanged (still
plotted, just without TPS-based grouping).

Usage:
    python plot_caliper_results.py --report report.html --out-dir figures/
"""

import argparse
import os
import re

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd


ROUND_LABEL_RE = re.compile(r"^(.*)_(\d+)tps$")


def load_summary_table(report_path):
    tables = pd.read_html(report_path)
    expected_cols = {"Name", "Succ", "Fail", "Send Rate (TPS)", "Throughput (TPS)"}
    for t in tables:
        if expected_cols.issubset(set(t.columns)):
            return t
    raise SystemExit(
        f"Could not find the performance-metrics summary table in {report_path}. "
        f"Found {len(tables)} table(s) but none had the expected columns "
        f"({sorted(expected_cols)}). If Caliper's report format has changed, "
        f"open the HTML and check the table header row against this list."
    )


def split_operation_and_tier(name):
    m = ROUND_LABEL_RE.match(name)
    if m:
        return m.group(1), int(m.group(2))
    return name, None


def plot_send_rate_vs_throughput(df, out_path):
    fig, ax = plt.subplots(figsize=(7, 5))
    for op, group in df.groupby("operation"):
        group = group.sort_values("Send Rate (TPS)")
        ax.plot(group["Send Rate (TPS)"], group["Throughput (TPS)"], marker="o", label=op)

    lims = [0, max(df["Send Rate (TPS)"].max(), df["Throughput (TPS)"].max()) * 1.05]
    ax.plot(lims, lims, linestyle="--", color="gray", linewidth=1, label="ideal (throughput = send rate)")
    ax.set_xlabel("Send rate (TPS)")
    ax.set_ylabel("Achieved throughput (TPS)")
    ax.set_title("Send rate vs. achieved throughput")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Wrote {out_path}")


def plot_send_rate_vs_latency(df, out_path):
    fig, ax = plt.subplots(figsize=(7, 5))
    for op, group in df.groupby("operation"):
        group = group.sort_values("Send Rate (TPS)")
        ax.plot(group["Send Rate (TPS)"], group["Avg Latency (s)"], marker="o", label=op)
        ax.fill_between(
            group["Send Rate (TPS)"],
            group["Min Latency (s)"],
            group["Max Latency (s)"],
            alpha=0.15,
        )

    ax.set_xlabel("Send rate (TPS)")
    ax.set_ylabel("Latency (s) -- line = avg, shaded band = min/max")
    ax.set_title("Send rate vs. latency")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Wrote {out_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", default="report.html")
    parser.add_argument("--out-dir", default="figures")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    df = load_summary_table(args.report)
    df[["operation", "tps_tier"]] = df["Name"].apply(
        lambda n: pd.Series(split_operation_and_tier(n))
    )

    plot_send_rate_vs_throughput(df, os.path.join(args.out_dir, "send_rate_vs_throughput.png"))
    plot_send_rate_vs_latency(df, os.path.join(args.out_dir, "send_rate_vs_latency.png"))

    print(f"\nDone. Figures in {args.out_dir}/")


if __name__ == "__main__":
    main()
