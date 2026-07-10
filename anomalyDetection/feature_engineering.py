"""
feature_engineering.py

Turns raw AuditLog-shaped rows into features for the anomaly model, using
the REAL action/resourceType vocabulary (see generate_synthetic_audit_data.py's
module docstring for the confirmed-against-repo field/value list).

Produces TWO feature tables, because two different anomaly shapes need two
different windows:

  1. Actor-day features (build_actor_features) — one row per actor per
     calendar day. Catches "this actor is doing something unusual."

  2. Patient-day features (build_patient_features) — one row per patient
     per calendar day. Catches "this patient is being touched in an
     unusual way," which an actor-day view can't see: 5 different org
     actors each reading this one patient's records 2x today looks
     completely normal from every individual actor's own perspective, but
     is exactly the "many orgs touching one patient in a short window"
     pattern from the roadmap.

     IMPORTANT: this requires a patientID per row, which the real
     on-chain AuditLog struct does NOT have (see
     generate_synthetic_audit_data.py's docstring) -- resourceID is the
     record's own ID (PRE0001, etc.) for CONSULTATION/PRESCRIPTION/
     LAB_REPORT/REFERRAL, not the patient it belongs to. This script's
     patient-day features work on synthetic data because the generator
     carries patientID as extra ground-truth metadata. Running this
     against REAL audit data requires resolving resourceID -> owning
     patientID first (a join against the actual ledger/Mongo record,
     e.g. GetPrescription's PatientID field) -- there is no way to do
     this from AuditLog rows alone, and that join is not implemented
     anywhere yet.

Notable mapping from the roadmap's plain-English feature names to the
real fields that implement them here:
  - "consent-denied ratio"        -> TWO real patterns, not one:
        (a) action=='ACCESS_DENIED' & resourceType=='CONSENT'
            (a patient probing someone else's consent record)
        (b) action=='ACCESS_DENIED' & resourceType in
            {'PRESCRIPTION','LAB_REPORT'} & actorOrg != ""
            (an org_actor denied because they have no active consent --
            the actual chaincode CONSENT_REQUIRED gate from
            prescription_contract.go's GetPrescription)
        An earlier version of this feature only counted (a), which
        missed the org_actor-denied case entirely -- the more relevant
        one for this project's actual cross-org consent feature.
  - "dispense-without-prior-read" -> action=='UPDATE' & resourceType==
                                      'PRESCRIPTION' with no earlier
                                      action=='READ' & resourceType==
                                      'PRESCRIPTION' on the same
                                      resourceID by the same actor,
                                      checked against that actor's FULL
                                      history (not just this window) --
                                      a legitimate read-then-dispense
                                      pair spanning midnight must not be
                                      flagged just because the read
                                      happened "yesterday."
  - "cross-org access bursts"     -> see build_patient_features above;
                                      NOT an actor-day feature, since
                                      actorOrg rarely varies within one
                                      actor's own day.

Usage:
    python feature_engineering.py --in synthetic_audit_log.csv --out features.csv --patient-out patient_features.csv
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


def compute_dispense_violations(df: pd.DataFrame) -> pd.Series:
    """Per-row boolean: True if this is an UPDATE/PRESCRIPTION event with
    no earlier READ/PRESCRIPTION for the SAME resourceID by the SAME
    actor ANYWHERE in that actor's history -- not just earlier the same
    day. Returns a Series aligned to df's original index.

    This replaces a per-actor-day-group version that reset "seen reads"
    at midnight: a legitimate read at 11:58pm followed by a dispense at
    12:02am would have been wrongly flagged, since the two events fell
    in different day-groups and the group-local read history didn't
    carry over.
    """
    violation = pd.Series(False, index=df.index)
    seen_read_prescription = set()  # (actorID, resourceID) pairs

    ordered = df.sort_values("timestamp")
    for idx, row in ordered.iterrows():
        if row["resourceType"] != "PRESCRIPTION":
            continue
        key = (row["actorID"], row["resourceID"])
        if row["action"] == "READ":
            seen_read_prescription.add(key)
        elif row["action"] == "UPDATE":
            if key not in seen_read_prescription:
                violation.loc[idx] = True

    return violation


def build_actor_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["date"] = df["timestamp"].dt.date
    df["hour"] = df["timestamp"].dt.hour
    df["dispense_violation"] = compute_dispense_violations(df)

    rows = []
    for (actor_id, date), group in df.groupby(["actorID", "date"]):
        n_events = len(group)
        n_distinct_resources = group["resourceID"].nunique()
        n_access_denied = (group["action"] == "ACCESS_DENIED").sum()

        # (a) patient probing another patient's consent record
        n_consent_probe_denied = ((group["action"] == "ACCESS_DENIED") & (group["resourceType"] == "CONSENT")).sum()
        # (b) org_actor denied under the real CONSENT_REQUIRED chaincode gate
        n_cross_org_denied = ((group["action"] == "ACCESS_DENIED")
                               & group["resourceType"].isin(["PRESCRIPTION", "LAB_REPORT"])
                               & group["actorOrg"].fillna("").ne("")).sum()
        n_consent_denied_total = n_consent_probe_denied + n_cross_org_denied

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
            "consent_denied_ratio": (n_consent_denied_total / n_events) if n_events > 0 else 0.0,
            "dispense_without_read_count": int(group["dispense_violation"].sum()),
            # eval-only, not a model input:
            "label": "anomalous" if (group["label"] == "anomalous").any() else "normal",
        })

    return pd.DataFrame(rows).sort_values(["date", "actorID"]).reset_index(drop=True)


def build_patient_features(df: pd.DataFrame) -> pd.DataFrame:
    """Patient-day features. Requires a patientID column -- see module
    docstring for why this can't be derived from resourceID alone for
    real audit data."""
    if "patientID" not in df.columns:
        raise ValueError(
            "No patientID column found. Patient-centric features require it "
            "(see module docstring) -- resolve resourceID -> owning patientID "
            "first if this is real audit data, not synthetic."
        )

    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["date"] = df["timestamp"].dt.date
    df["hour"] = df["timestamp"].dt.hour

    rows = []
    for (patient_id, date), group in df.groupby(["patientID", "date"]):
        n_events = len(group)
        n_distinct_actors = group["actorID"].nunique()
        distinct_orgs = set(o for o in group["actorOrg"].fillna("") if o != "")
        n_access_denied = (group["action"] == "ACCESS_DENIED").sum()

        rows.append({
            "patientID": patient_id,
            "date": date,
            "access_frequency": n_events,
            "distinct_actors_touched": n_distinct_actors,
            "distinct_orgs_touched": len(distinct_orgs),
            "off_hours_ratio": off_hours_ratio(group["hour"]),
            "burst_count": burst_count(group["timestamp"]),
            "access_denied_ratio": (n_access_denied / n_events) if n_events > 0 else 0.0,
            # eval-only, not a model input:
            "label": "anomalous" if (group["label"] == "anomalous").any() else "normal",
        })

    return pd.DataFrame(rows).sort_values(["date", "patientID"]).reset_index(drop=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="infile", default="synthetic_audit_log.csv")
    parser.add_argument("--out", default="features.csv", help="actor-day features")
    parser.add_argument("--patient-out", default="patient_features.csv", help="patient-day features")
    args = parser.parse_args()

    df = pd.read_csv(args.infile)

    actor_features = build_actor_features(df)
    actor_features.to_csv(args.out, index=False)
    print(f"Wrote {len(actor_features)} actor-day feature rows to {args.out}")
    print(actor_features["label"].value_counts())

    if "patientID" in df.columns:
        patient_features = build_patient_features(df)
        patient_features.to_csv(args.patient_out, index=False)
        print(f"\nWrote {len(patient_features)} patient-day feature rows to {args.patient_out}")
        print(patient_features["label"].value_counts())
    else:
        print("\nNo patientID column in input -- skipping patient-day features "
              "(expected for real audit data until resourceID->patientID "
              "resolution is implemented; see module docstring).")


if __name__ == "__main__":
    main()
