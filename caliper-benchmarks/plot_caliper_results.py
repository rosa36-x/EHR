#!/usr/bin/env python3
"""
plot_caliper_results.py

Standalone script -- parses one or more of Caliper's default report.html
"Summary of performance metrics" tables (one file per repeated benchmark
run) and produces a full set of publication-quality benchmark charts,
aggregated as mean +/- std dev across runs:

  1. send_rate_vs_throughput.png / .pdf
       Target send rate vs. achieved throughput (mean, with std-dev error
       bars across runs), plus an ideal-scaling reference line -- shows
       whether the system keeps up with offered load or saturates.
  2. send_rate_vs_latency.png / .pdf
       Target send rate vs. average latency (mean +/- std across runs),
       one line per operation -- quick overview / "at a glance"
       comparison across operations.
  3. latency_min_avg_max_per_operation.png / .pdf
       Small-multiples figure: one subplot per operation, each showing
       mean min / avg / max latency vs. target send rate. This is the
       more detailed companion to (2).
  4. send_rate_vs_failure_rate.png / .pdf
       Target send rate vs. error rate (%) (mean +/- std across runs),
       one line per operation -- failures often climb before
       latency/throughput visibly degrade, so this can be the earliest
       saturation signal.
  5. throughput_vs_latency.png / .pdf
       The load-agnostic "efficiency frontier": achieved throughput vs.
       average latency (mean +/- std in both directions), one curve per
       operation. Shows the latency cost of squeezing out more
       throughput, independent of target rate.
  6. resource_utilization_over_time.png / .pdf (optional)
       Per-peer/org CPU (%) over time. Caliper's summary table has no
       time-series resource data, so this only runs if you pass
       --resource-csv pointing at a CSV with a "Time" column plus one
       column per peer/org (e.g. from a separate monitoring log).

If you only pass one --report, everything still works exactly as before
(no error bars are drawn since there's nothing to compute std dev from).
Pass --report multiple times -- once per repeated run -- to get mean
lines with std-dev error bars, which is the more defensible way to report
results near a saturation knee where single-run noise is highest.

PNG at 300 DPI for slides/screen; PDF is vector (scales cleanly in LaTeX,
no resolution loss at print size) -- use the PDF for the actual
camera-ready submission if your template accepts vector figures.

Nothing about the benchmark data is hardcoded: every number is parsed
straight out of your report.html file(s) (and, optionally, your resource
CSV) at run time.

Usage:
    python plot_caliper_results.py --report run1.html --out-dir figures/
    python plot_caliper_results.py \\
        --report run1.html --report run2.html --report run3.html \\
        --out-dir figures/ --resource-csv cpu_usage.csv

Requirements:
    pip install beautifulsoup4 pandas matplotlib --break-system-packages
"""

import argparse
import re
import sys
from pathlib import Path

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

# --------------------------------------------------------------------------
# 1. Parsing
# --------------------------------------------------------------------------

# Matches e.g. "create_treatment_relationship_450tps" -> ("create_treatment_relationship", 450)
NAME_RE = re.compile(r"^(?P<op>.+)_(?P<target>\d+)tps$", re.IGNORECASE)

EXPECTED_COLUMNS = [
    "Name", "Succ", "Fail", "Send Rate (TPS)",
    "Max Latency (s)", "Min Latency (s)", "Avg Latency (s)", "Throughput (TPS)",
]


def load_caliper_table(report_path: Path) -> pd.DataFrame:
    """Parse the 'Summary of performance metrics' table out of a Caliper
    report.html file and return it as a tidy DataFrame."""
    try:
        tables = pd.read_html(report_path)
    except ValueError as e:
        sys.exit(f"Could not find any tables in '{report_path}': {e}")

    summary_df = None
    for t in tables:
        cols = [str(c).strip() for c in t.columns]
        if "Name" in cols and any("Send Rate" in c for c in cols):
            summary_df = t
            break

    if summary_df is None:
        sys.exit(
            "Could not locate the 'Summary of performance metrics' table "
            f"in '{report_path}'. Found tables with columns: "
            + "; ".join(str(list(t.columns)) for t in tables)
        )

    summary_df.columns = [str(c).strip() for c in summary_df.columns]

    # Normalize column names in case Caliper's HTML varies slightly in units
    rename_map = {}
    for c in summary_df.columns:
        cl = c.lower()
        if cl.startswith("name"):
            rename_map[c] = "Name"
        elif cl.startswith("succ"):
            rename_map[c] = "Succ"
        elif cl.startswith("fail"):
            rename_map[c] = "Fail"
        elif "send rate" in cl:
            rename_map[c] = "Send Rate (TPS)"
        elif "max latency" in cl:
            rename_map[c] = "Max Latency (s)"
        elif "min latency" in cl:
            rename_map[c] = "Min Latency (s)"
        elif "avg latency" in cl:
            rename_map[c] = "Avg Latency (s)"
        elif "throughput" in cl:
            rename_map[c] = "Throughput (TPS)"
    summary_df = summary_df.rename(columns=rename_map)

    missing = [c for c in EXPECTED_COLUMNS if c not in summary_df.columns]
    if missing:
        sys.exit(f"Table is missing expected column(s): {missing}")

    summary_df = summary_df[EXPECTED_COLUMNS].copy()

    # Split "Name" into operation + target send rate (from the *_XXXtps suffix)
    def split_name(name: str):
        m = NAME_RE.match(str(name).strip())
        if not m:
            return pd.Series({"Operation": str(name).strip(), "TargetTPS": None})
        op = m.group("op").replace("_", " ").strip()
        return pd.Series({"Operation": op, "TargetTPS": int(m.group("target"))})

    parsed = summary_df["Name"].apply(split_name)
    summary_df = pd.concat([summary_df, parsed], axis=1)

    numeric_cols = [
        "Succ", "Fail", "Send Rate (TPS)", "Max Latency (s)",
        "Min Latency (s)", "Avg Latency (s)", "Throughput (TPS)",
    ]
    for c in numeric_cols:
        summary_df[c] = pd.to_numeric(summary_df[c], errors="coerce")

    summary_df = summary_df.sort_values(["Operation", "Send Rate (TPS)"]).reset_index(drop=True)

    # Error rate (%) -- guard against divide-by-zero when Succ+Fail == 0
    total = summary_df["Succ"] + summary_df["Fail"]
    summary_df["Error Rate (%)"] = (summary_df["Fail"] / total.replace(0, pd.NA)) * 100
    summary_df["Error Rate (%)"] = summary_df["Error Rate (%)"].fillna(0.0)

    return summary_df


def load_multiple_reports(report_paths) -> pd.DataFrame:
    """Load several report.html files -- one per repeated benchmark run --
    and concatenate them into a single DataFrame tagged with a 'Run'
    column (1-indexed, in the order the files were given)."""
    frames = []
    for i, path in enumerate(report_paths, start=1):
        df = load_caliper_table(path)
        df["Run"] = i
        df["ReportFile"] = str(path)
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


# Metrics we aggregate mean/std for, across repeated runs
AGG_METRICS = [
    "Send Rate (TPS)", "Throughput (TPS)",
    "Avg Latency (s)", "Min Latency (s)", "Max Latency (s)",
    "Error Rate (%)",
]


def aggregate_runs(raw_df: pd.DataFrame) -> pd.DataFrame:
    """Collapse one or more runs down to one row per (Operation, TargetTPS)
    with a '<metric> mean' and '<metric> std' column for each metric in
    AGG_METRICS, plus a NumRuns column. With a single run, std is 0 for
    every row (nothing to compute variance from) rather than NaN, so
    downstream plotting code doesn't need special-casing."""
    grouped = raw_df.dropna(subset=["TargetTPS"]).groupby(["Operation", "TargetTPS"], as_index=False)

    agg_spec = {}
    for metric in AGG_METRICS:
        agg_spec[f"{metric} mean"] = (metric, "mean")
        agg_spec[f"{metric} std"] = (metric, "std")
    agg_spec["NumRuns"] = ("Run", "nunique")

    agg_df = grouped.agg(**agg_spec).reset_index(drop=True)

    std_cols = [c for c in agg_df.columns if c.endswith(" std")]
    agg_df[std_cols] = agg_df[std_cols].fillna(0.0)

    return agg_df.sort_values(["Operation", "TargetTPS"]).reset_index(drop=True)


# --------------------------------------------------------------------------
# 2. Styling
# --------------------------------------------------------------------------

def apply_paper_style():
    """A clean, IEEE/ACM-paper-friendly matplotlib style: serif fonts,
    restrained gridlines, no chartjunk."""
    plt.rcParams.update({
        "font.family": "serif",
        "font.size": 11,
        "axes.titlesize": 12,
        "axes.labelsize": 11,
        "legend.fontsize": 9,
        "xtick.labelsize": 10,
        "ytick.labelsize": 10,
        "axes.linewidth": 0.8,
        "axes.grid": True,
        "grid.linestyle": "--",
        "grid.linewidth": 0.5,
        "grid.alpha": 0.6,
        "axes.axisbelow": True,
        "legend.frameon": True,
        "legend.framealpha": 1.0,
        "legend.edgecolor": "0.4",
        "legend.fancybox": False,
        "legend.shadow": False,
        "figure.dpi": 100,
        "savefig.dpi": 300,
        "savefig.bbox": "tight",
        "lines.linewidth": 1.6,
    })


# Distinguish lines by color + linestyle only (no markers -- markers get
# noisy/overlapping once you have several series, matching the clean look
# of the reference CPU-usage plots).
LINESTYLES = ["-", "--", "-.", ":"]


def style_for_index(i):
    return dict(linestyle=LINESTYLES[i % len(LINESTYLES)])


def operation_colors(operations):
    """Consistent color per operation across every figure in this script,
    so e.g. 'create_prescription' is always the same color whichever plot
    you're looking at."""
    cmap = plt.get_cmap("tab10")
    return {op: cmap(i % 10) for i, op in enumerate(operations)}


# --------------------------------------------------------------------------
# 3. Plots
# --------------------------------------------------------------------------

def plot_send_rate_vs_throughput(agg_df: pd.DataFrame, out_dir: Path):
    """X-axis is the *target* TPS each round was configured for (parsed from
    the '_XXXtps' suffix in Name), not the achieved Send Rate. Under
    saturation the achieved rate can plateau well below the target, which
    would otherwise compress/hide the high-load points on the x-axis.
    Error bars show std dev of achieved throughput across repeated runs
    (zero-length / invisible if only one run was given)."""
    fig, ax = plt.subplots(figsize=(7, 4.5))

    operations = sorted(agg_df["Operation"].dropna().unique())
    colors = operation_colors(operations)

    for i, op in enumerate(operations):
        sub = agg_df[agg_df["Operation"] == op].sort_values("TargetTPS")
        ax.errorbar(
            sub["TargetTPS"], sub["Throughput (TPS) mean"], yerr=sub["Throughput (TPS) std"],
            color=colors[op], label=op, capsize=3, elinewidth=0.8, capthick=0.8,
            **style_for_index(i),
        )

    lims = [agg_df["TargetTPS"].min(), agg_df["TargetTPS"].max()]
    ax.plot(lims, lims, color="gray", linestyle=":", linewidth=1, label="Ideal (Throughput = Target Rate)")

    ax.set_xlabel("Target Send Rate (TPS)")
    ax.set_ylabel("Throughput (TPS)")
    ax.set_title("Target Send Rate vs. Achieved Throughput")
    ax.xaxis.set_major_locator(mticker.MaxNLocator(nbins=8))
    ax.legend(loc="best", ncol=1)
    fig.tight_layout()

    for ext in ("png", "pdf"):
        fig.savefig(out_dir / f"send_rate_vs_throughput.{ext}")
    plt.close(fig)


def plot_send_rate_vs_latency(agg_df: pd.DataFrame, out_dir: Path):
    """Same target-TPS x-axis as above. Mean avg-latency line per
    operation, with std-dev error bars across runs -- no shaded band,
    since overlapping translucent bands across several operations blend
    into a muddy 'shadow' rather than adding readable information."""
    operations = sorted(agg_df["Operation"].dropna().unique())
    colors = operation_colors(operations)

    fig, ax = plt.subplots(figsize=(7, 4.5))

    for i, op in enumerate(operations):
        sub = agg_df[agg_df["Operation"] == op].sort_values("TargetTPS")
        ax.errorbar(
            sub["TargetTPS"], sub["Avg Latency (s) mean"], yerr=sub["Avg Latency (s) std"],
            color=colors[op], label=op, capsize=3, elinewidth=0.8, capthick=0.8,
            **style_for_index(i),
        )

    ax.set_xlabel("Target Send Rate (TPS)")
    ax.set_ylabel("Avg Latency (s)")
    ax.set_title("Target Send Rate vs. Average Latency")
    ax.xaxis.set_major_locator(mticker.MaxNLocator(nbins=8))
    ax.legend(loc="best", ncol=1)
    fig.tight_layout()

    for ext in ("png", "pdf"):
        fig.savefig(out_dir / f"send_rate_vs_latency.{ext}")
    plt.close(fig)


def plot_latency_min_avg_max_faceted(agg_df: pd.DataFrame, out_dir: Path):
    """Small multiples: one subplot per operation, each with mean min /
    avg / max latency vs. target send rate (averaged across runs if
    several were given). More detailed than the single avg-only
    comparison above, without the overlapping-band muddiness of a shaded
    min-max ribbon."""
    import math

    operations = sorted(agg_df["Operation"].dropna().unique())
    n = len(operations)
    ncols = min(3, n) if n > 1 else 1
    nrows = math.ceil(n / ncols)

    fig, axes = plt.subplots(nrows, ncols, figsize=(4.2 * ncols, 3.4 * nrows), squeeze=False)
    axes_flat = axes.flatten()

    for i, op in enumerate(operations):
        ax = axes_flat[i]
        sub = agg_df[agg_df["Operation"] == op].sort_values("TargetTPS")

        ax.plot(sub["TargetTPS"], sub["Max Latency (s) mean"], color="firebrick", linestyle="--", label="Max")
        ax.plot(sub["TargetTPS"], sub["Avg Latency (s) mean"], color="black", linestyle="-", label="Avg")
        ax.plot(sub["TargetTPS"], sub["Min Latency (s) mean"], color="steelblue", linestyle=":", label="Min")

        ax.set_title(op, fontsize=10)
        ax.set_xlabel("Target Send Rate (TPS)")
        ax.set_ylabel("Latency (s)")
        ax.xaxis.set_major_locator(mticker.MaxNLocator(nbins=6))

    # Turn off any unused subplot slots (when n isn't a multiple of ncols)
    for j in range(n, len(axes_flat)):
        axes_flat[j].axis("off")

    # Single shared legend for the whole figure
    handles, labels = axes_flat[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", ncol=3, bbox_to_anchor=(0.5, 1.04))
    fig.suptitle("")  # keep space clean; per-subplot titles already label each operation
    fig.tight_layout()

    for ext in ("png", "pdf"):
        fig.savefig(out_dir / f"latency_min_avg_max_per_operation.{ext}")
    plt.close(fig)


def plot_send_rate_vs_failure_rate(agg_df: pd.DataFrame, out_dir: Path):
    """Target send rate vs. mean error rate (%), with std-dev error bars
    across runs. Failures can climb before latency/throughput visibly
    degrade, so this is often the earliest saturation signal in the
    data."""
    operations = sorted(agg_df["Operation"].dropna().unique())
    colors = operation_colors(operations)

    fig, ax = plt.subplots(figsize=(7, 4.5))

    any_failures = False
    for i, op in enumerate(operations):
        sub = agg_df[agg_df["Operation"] == op].sort_values("TargetTPS")
        if (sub["Error Rate (%) mean"] > 0).any():
            any_failures = True
        ax.errorbar(
            sub["TargetTPS"], sub["Error Rate (%) mean"], yerr=sub["Error Rate (%) std"],
            color=colors[op], label=op, capsize=3, elinewidth=0.8, capthick=0.8,
            **style_for_index(i),
        )

    ax.set_xlabel("Target Send Rate (TPS)")
    ax.set_ylabel("Error Rate (%)")
    ax.set_title("Target Send Rate vs. Error Rate")
    ax.xaxis.set_major_locator(mticker.MaxNLocator(nbins=8))
    ax.legend(loc="best", ncol=1)
    fig.tight_layout()

    if not any_failures:
        ax.text(
            0.5, 0.5, "No failures recorded across any operation",
            transform=ax.transAxes, ha="center", va="center",
            fontsize=10, color="gray", style="italic",
        )

    for ext in ("png", "pdf"):
        fig.savefig(out_dir / f"send_rate_vs_failure_rate.{ext}")
    plt.close(fig)


def plot_throughput_vs_latency(agg_df: pd.DataFrame, out_dir: Path):
    """The load-agnostic 'efficiency frontier': achieved throughput vs.
    average latency, one curve per operation, points ordered by target
    send rate. Independent of what TPS was requested -- shows the actual
    latency cost of pushing more throughput through the system. Error
    bars show std dev in both directions across repeated runs."""
    operations = sorted(agg_df["Operation"].dropna().unique())
    colors = operation_colors(operations)

    fig, ax = plt.subplots(figsize=(7, 4.5))

    for i, op in enumerate(operations):
        sub = agg_df[agg_df["Operation"] == op].sort_values("TargetTPS")
        ax.errorbar(
            sub["Throughput (TPS) mean"], sub["Avg Latency (s) mean"],
            xerr=sub["Throughput (TPS) std"], yerr=sub["Avg Latency (s) std"],
            color=colors[op], label=op, capsize=3, elinewidth=0.8, capthick=0.8,
            **style_for_index(i),
        )

    ax.set_xlabel("Throughput (TPS)")
    ax.set_ylabel("Avg Latency (s)")
    ax.set_title("Throughput vs. Latency (Efficiency Frontier)")
    ax.xaxis.set_major_locator(mticker.MaxNLocator(nbins=8))
    ax.legend(loc="best", ncol=1)
    fig.tight_layout()

    for ext in ("png", "pdf"):
        fig.savefig(out_dir / f"throughput_vs_latency.{ext}")
    plt.close(fig)


def load_resource_csv(resource_csv: Path) -> pd.DataFrame:
    """Load an optional resource-utilization CSV: a 'Time' column (seconds)
    plus one numeric column per peer/org (e.g. 'Peer0_Healthcenter',
    'Peer0_Hospital', ...). This isn't part of Caliper's summary table --
    it needs a separate monitoring log as input."""
    df = pd.read_csv(resource_csv)
    df.columns = [str(c).strip() for c in df.columns]
    time_col = next((c for c in df.columns if c.lower() in ("time", "time (seconds)", "seconds")), None)
    if time_col is None:
        sys.exit(f"Could not find a 'Time' column in '{resource_csv}'. Columns found: {list(df.columns)}")
    df = df.rename(columns={time_col: "Time"})
    for c in df.columns:
        if c != "Time":
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def plot_resource_utilization(resource_csv: Path, out_dir: Path):
    """Per-peer/org CPU (%) over time, in the style of the reference
    figure: color + linestyle only, no markers, no legend shadow."""
    df = load_resource_csv(resource_csv)
    series_cols = [c for c in df.columns if c != "Time"]
    if not series_cols:
        print(f"[warn] '{resource_csv}' has a Time column but no data series -- skipping resource utilization plot.")
        return

    cmap = plt.get_cmap("tab10")
    fig, ax = plt.subplots(figsize=(8, 5))

    for i, col in enumerate(series_cols):
        ax.plot(
            df["Time"], df[col],
            color=cmap(i % 10), linestyle=LINESTYLES[i % len(LINESTYLES)],
            label=col, linewidth=1.4,
        )

    ax.set_xlabel("Time (seconds)")
    ax.set_ylabel("CPU (%)")
    ax.set_title("Resource Utilization Over Time")
    ax.legend(loc="best", ncol=1, fontsize=8)
    fig.tight_layout()

    for ext in ("png", "pdf"):
        fig.savefig(out_dir / f"resource_utilization_over_time.{ext}")
    plt.close(fig)


# --------------------------------------------------------------------------
# 4. Main
# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--report", required=True, action="append", type=Path,
        help="Path to a Caliper report.html. Pass this multiple times -- once per repeated "
             "run of the same benchmark -- to get mean +/- std-dev error bars.",
    )
    parser.add_argument("--out-dir", default=Path("figures"), type=Path, help="Directory to write figures into")
    parser.add_argument(
        "--resource-csv", type=Path, default=None,
        help="Optional CSV with a 'Time' column plus one column per peer/org (CPU %%) "
             "for the resource-utilization-over-time plot. Not part of Caliper's report.html.",
    )
    args = parser.parse_args()

    for report_path in args.report:
        if not report_path.exists():
            sys.exit(f"Report file not found: {report_path}")

    args.out_dir.mkdir(parents=True, exist_ok=True)

    raw_df = load_multiple_reports(args.report)
    n_runs = raw_df["Run"].nunique()
    print(f"Loaded {n_runs} run(s): {', '.join(str(p) for p in args.report)}")
    print(f"Parsed {len(raw_df)} total rows across {raw_df['Operation'].nunique()} operation(s)")

    agg_df = aggregate_runs(raw_df)

    # Sanity check: flag any (Operation, TargetTPS) combo that isn't present
    # in every run, since that means the std dev for that point is based on
    # fewer samples than the rest.
    uneven = agg_df[agg_df["NumRuns"] < n_runs]
    if n_runs > 1 and not uneven.empty:
        print(f"[warn] {len(uneven)} (operation, target TPS) point(s) are missing from at least one run "
              f"-- their error bars are based on fewer than {n_runs} samples:")
        for _, row in uneven.iterrows():
            print(f"    {row['Operation']} @ {int(row['TargetTPS'])} TPS -- found in {int(row['NumRuns'])}/{n_runs} runs")

    apply_paper_style()

    plot_send_rate_vs_throughput(agg_df, args.out_dir)
    plot_send_rate_vs_latency(agg_df, args.out_dir)
    plot_latency_min_avg_max_faceted(agg_df, args.out_dir)
    plot_send_rate_vs_failure_rate(agg_df, args.out_dir)
    plot_throughput_vs_latency(agg_df, args.out_dir)

    written = [
        "send_rate_vs_throughput.png / .pdf",
        "send_rate_vs_latency.png / .pdf",
        "latency_min_avg_max_per_operation.png / .pdf",
        "send_rate_vs_failure_rate.png / .pdf",
        "throughput_vs_latency.png / .pdf",
    ]

    if args.resource_csv is not None:
        if not args.resource_csv.exists():
            print(f"[warn] --resource-csv path not found: {args.resource_csv} -- skipping that plot.")
        else:
            plot_resource_utilization(args.resource_csv, args.out_dir)
            written.append("resource_utilization_over_time.png / .pdf")

    print(f"Figures written to: {args.out_dir.resolve()}")
    for name in written:
        print(f"  - {name}")


if __name__ == "__main__":
    main()