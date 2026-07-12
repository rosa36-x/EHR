"""
plot_caliper_results.py

Standalone script -- parses Caliper's default report.html "Summary of
performance metrics" table and produces publication-quality charts for
the paper:
  - send_rate_vs_throughput.png / .pdf
  - send_rate_vs_latency.png / .pdf

PNG at 300 DPI for slides/screen; PDF is vector (scales cleanly in LaTeX,
no resolution loss at print size) -- use the PDF for the actual
camera-ready submission if your template accepts vector figures.

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

plt.rcParams.update({
    "font.size": 12,
    "axes.titlesize": 14,
    "axes.labelsize": 13,
    "legend.fontsize": 10.5,
    "xtick.labelsize": 11,
    "ytick.labelsize": 11,
    "axes.grid": True,
    "grid.alpha": 0.3,
    "grid.linestyle": "--",
    "figure.dpi": 100,  # on-screen only; savefig dpi set explicitly below
})

DPI = 300

ROUND_LABEL_RE = re.compile(r"^(.*)_(\d+)tps$")

# Distinct marker + linestyle per operation so overlapping lines (e.g. two
# reads with near-identical values) stay visually distinguishable even in
# black-and-white print, not just on-screen color.
STYLE_CYCLE = [
    {"marker": "o", "linestyle": "-"},
    {"marker": "s", "linestyle": "--"},
    {"marker": "^", "linestyle": "-."},
    {"marker": "D", "linestyle": ":"},
    {"marker": "v", "linestyle": "-"},
    {"marker": "P", "linestyle": "--"},
]


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


def save_fig(fig, out_dir, basename):
    png_path = os.path.join(out_dir, f"{basename}.png")
    pdf_path = os.path.join(out_dir, f"{basename}.pdf")
    fig.savefig(png_path, dpi=DPI, bbox_inches="tight")
    fig.savefig(pdf_path, bbox_inches="tight")
    print(f"Wrote {png_path}")
    print(f"Wrote {pdf_path}")


def plot_send_rate_vs_throughput(df, out_dir):
    fig, ax = plt.subplots(figsize=(7, 5))
    for i, (op, group) in enumerate(df.groupby("operation")):
        group = group.sort_values("Send Rate (TPS)")
        style = STYLE_CYCLE[i % len(STYLE_CYCLE)]
        ax.plot(
            group["Send Rate (TPS)"], group["Throughput (TPS)"],
            label=op.replace("_", " "), markersize=7, linewidth=2, alpha=0.85, **style,
        )

    lims = [0, max(df["Send Rate (TPS)"].max(), df["Throughput (TPS)"].max()) * 1.05]
    ax.plot(lims, lims, linestyle=(0, (1, 1)), color="gray", linewidth=1.2,
             label="ideal (throughput = send rate)")
    ax.set_xlabel("Send rate (TPS)")
    ax.set_ylabel("Achieved throughput (TPS)")
    ax.set_title("Send rate vs. achieved throughput")
    ax.legend(loc="upper left", frameon=True, framealpha=0.9)
    fig.tight_layout()
    save_fig(fig, out_dir, "send_rate_vs_throughput")
    plt.close(fig)


def plot_send_rate_vs_latency(df, out_dir):
    fig, ax = plt.subplots(figsize=(7, 5))
    for i, (op, group) in enumerate(df.groupby("operation")):
        group = group.sort_values("Send Rate (TPS)")
        style = STYLE_CYCLE[i % len(STYLE_CYCLE)]
        line, = ax.plot(
            group["Send Rate (TPS)"], group["Avg Latency (s)"],
            label=op.replace("_", " "), markersize=7, linewidth=2, **style,
        )
        ax.fill_between(
            group["Send Rate (TPS)"],
            group["Min Latency (s)"],
            group["Max Latency (s)"],
            alpha=0.12, color=line.get_color(),
        )

    ax.set_xlabel("Send rate (TPS)")
    ax.set_ylabel("Latency (s)  [line = avg, band = min/max]")
    ax.set_title("Send rate vs. latency")
    ax.legend(loc="upper left", frameon=True, framealpha=0.9)
    fig.tight_layout()
    save_fig(fig, out_dir, "send_rate_vs_latency")
    plt.close(fig)


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

    plot_send_rate_vs_throughput(df, args.out_dir)
    plot_send_rate_vs_latency(df, args.out_dir)

    print(f"\nDone. Figures in {args.out_dir}/ (PNG @ {DPI} DPI + vector PDF)")


if __name__ == "__main__":
    main()