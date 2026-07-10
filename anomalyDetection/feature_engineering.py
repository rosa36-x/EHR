"""
feature_engineering.py

Turns raw AuditLog-shaped rows into per-actor / per-window features for
the anomaly model, using the REAL action/resourceType vocabulary
(see generate_synthetic_audit_data.py's module docstring for the
confirmed-against-repo field/value list).

Window = actor-day (one row per actor per calendar day with activity).

Notable mapping from the roadmap's plain-English feature names to the
real fields that implement them here:
  - "consent-denied ratio"       -> action=='ACCESS_DENIED' & resourceType=='CONSENT'
  - "dispense-without-prior-read"-> action=='UPDATE' & resourceType=='PRESCRIPTION'
                                     with no earlier action=='READ' &
                                     resourceType=='PRESCRIPTION' on the same
                                     resourceID by the same actor (there is no
                                     separate "DISPENSE" action in this repo —
                                     dispensing IS an UPDATE/PRESCRIPTION row)
  - "cross-org access bursts"    -> rapid-fire run of events regardless of
                                     resourceID (actorOrg itself rarely varies
                                     for a given actor, since it's derived
                                     from mspIdForOrg(orgName) at call time,
                                     not a free-form field an attacker controls)

Usage:
    python feature_engineering.py --in synthetic_audit_log.csv --out features.csv
"""

import argparse

import numpy as np
import pandas as pd

BUSINESS_START_HOUR = 8
BUSINESS_END_HOUR = 18  # 6pm, exclusive
BURST_WINDOW_SECONDS = 300  # events within this gap count as "same burst"


def off_hours_ratio(hours: pd.Series) -> float:
    is_off = ~hours.between(BUSINESS_START_HOUR, BUSINESS_END_HOUR - 1)
    return is_off.mean()


def burst_count(timestamps: pd.Series) -> int:
    """Count distinct bursts of rapid-fire activity (gap < BURST_WINDOW_SECONDS
    between consecutive events) touching >=5 events."""
    if len(timestamps) < 2:
        return 0
    ts_sorted = timestamps.sort_values().reset_index(drop=True)
    gaps = ts_sorted.diff().dt.total_seconds().fillna(np.inf)
    in_burst = gaps < BURST_WINDOW_SECONDS
    burst_id = (~in_burst).cumsum()
    run_lengths = in_burst.groupby(burst_id).sum()
    return int((run_lengths >= 4).sum())


def dispense_without_prior_read(group: pd.DataFrame) -> int:
    """Count UPDATE/PRESCRIPTION events (real dispense action) for a
    resourceID with no earlier READ/PRESCRIPTION for that same resourceID
    by the same actor, within this window."""
    g = group.sort_values("timestamp")
    seen_read_prescription_for_resource = set()
    violations = 0
    for _, row in g.iterrows():
        if row["action"] == "READ" and row["resourceType"] == "PRESCRIPTION":
            seen_read_prescription_for_resource.add(row["resourceID"])
        elif row["action"] == "UPDATE" and row["resourceType"] == "PRESCRIPTION":
            if row["resourceID"] not in seen_read_prescription_for_resource:
                violations += 1
    return violations


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["date"] = df["timestamp"].dt.date
    df["hour"] = df["timestamp"].dt.hour

    rows = []
    for (actor_id, date), group in df.groupby(["actorID", "date"]):
        n_events = len(group)
        n_distinct_resources = group["resourceID"].nunique()
        n_access_denied = (group["action"] == "ACCESS_DENIED").sum()
        n_consent_denied = ((group["action"] == "ACCESS_DENIED") & (group["resourceType"] == "CONSENT")).sum()
        n_consent_related = group["resourceType"].eq("CONSENT").sum()

        rows.append({
            "actorID": actor_id,
            "actorRole": group["actorRole"].iloc[0],
            "actorOrg": group["actorOrg"].iloc[0] if pd.notna(group["actorOrg"].iloc[0]) else "",
            "date": date,
            "access_frequency": n_events,
            "distinct_resources_touched": n_distinct_resources,
            "off_hours_ratio": off_hours_ratio(group["hour"]),
            "burst_count": burst_count(group["timestamp"]),
            "access_denied_ratio": (n_access_denied / n_events) if n_events > 0 else 0.0,
            "consent_denied_ratio": (n_consent_denied / n_consent_related) if n_consent_related > 0 else 0.0,
            "dispense_without_read_count": dispense_without_prior_read(group),
            # eval-only, not a model input:
            "label": "anomalous" if (group["label"] == "anomalous").any() else "normal",
        })

    return pd.DataFrame(rows).sort_values(["date", "actorID"]).reset_index(drop=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="infile", default="synthetic_audit_log.csv")
    parser.add_argument("--out", default="features.csv")
    args = parser.parse_args()

    df = pd.read_csv(args.infile)
    features = build_features(df)
    features.to_csv(args.out, index=False)
    print(f"Wrote {len(features)} actor-day feature rows to {args.out}")
    print(features["label"].value_counts())


if __name__ == "__main__":
    main()
