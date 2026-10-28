"""
generate_synthetic_audit_data_v2.py

Wrapper around generate_synthetic_audit_data.py (left untouched). Two profiles:

  legacy  Exactly the original generator, so `--profile legacy --days 90 --seed 1`
          still reproduces the Table V dataset. The only difference: auditID is
          drawn from a seeded stream (uuid4 is unseeded in the original), so the
          raw CSV is byte-reproducible. The main random stream is untouched,
          so every feature/label is identical to the original.

  v2      Same schema, same panels, same injectors, plus the realism fixes a
          reviewer can reasonably ask for:
            * heavy-tailed per-actor activity rates (lognormal) instead of a
              uniform choice of actor per tick
            * benign confounders in NORMAL traffic: legitimate ACCESS_DENIED
              (consent lapse / patient mis-click), on-call off-hours doctors,
              legitimate "rounds" bursts inside the doctor's own panel, and
              occasional slow-but-legitimate dispenses (20-90 min; kept below the
              3-6h gap of the bigram_violation injection so that anomaly stays
              a transition absent from normal traffic, not erased by construction)
            * every injection carries an `anomaly_type` tag (needed for
              per-type recall and the held-out-type experiment)
            * `--severity` in (0, 1]: fraction of each volume-based injection's
              events that is kept (min 3 events). 1.0 = legacy volume
            * `--n-bursts` exposed (default for v2: 3x legacy's days//7)

Documented limits (state these in the paper): injected anomaly days are drawn
uniformly in time, so most fall in the training period (training data is
contaminated, as it would be in deployment); features were designed around the
injected behaviours; the data validates the pipeline, it is not a claim about
real-world detection accuracy.

Usage:
    python generate_synthetic_audit_data_v2.py --profile legacy --days 90 --seed 1 --out legacy_seed1.csv
    python generate_synthetic_audit_data_v2.py --profile v2 --days 90 --seed 1 --severity 0.6 --out v2_seed1.csv
"""

import argparse
import random
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta

import pandas as pd

import generate_synthetic_audit_data as g

START = datetime(2026, 1, 1)

# (action, resourceType, org) combos of normal_doctor_events -- copied so v2's
# normal traffic stays vocabulary-identical to legacy.
DOCTOR_COMBOS = [
    ("CREATE", "CONSULTATION", ""),
    ("READ", "CONSULTATION", ""),
    ("CREATE", "REFERRAL", ""),
    ("READ", "REFERRAL", ""),
    ("CREATE", "PRESCRIPTION", "HospitalMSP"),
    ("READ", "PRESCRIPTION", "HospitalMSP"),
    ("READ", "LAB_REPORT", "HospitalMSP"),
    ("READ", "PATIENT", ""),
]

INJECTORS = {
    "off_hours_burst": g.inject_off_hours_burst,
    "broad_access": g.inject_broad_access_burst,
    "consent_probe": g.inject_consent_probe_spree,
    "cross_org_denied": g.inject_cross_org_denied_no_consent,
    "dispense_without_read": g.inject_dispense_without_read,
    "order_composition": g.inject_order_composition_anomaly,
    "bigram_violation": g.inject_stale_dispense_bigram_violation,
}
THINNABLE = {"off_hours_burst", "broad_access", "consent_probe",
             "cross_org_denied", "dispense_without_read"}
ANOMALY_TYPES = list(INJECTORS)

V2_DEFAULTS = dict(
    rate_sigma=0.8,          # lognormal sigma for per-actor activity rate
    oncall_frac=0.12,        # fraction of doctors who do legitimate off-hours work
    oncall_tick_prob=0.25,   # per doctor tick, for on-call doctors
    rounds_prob=0.01,        # per doctor tick: legitimate rapid in-panel burst
    org_denied_prob=0.04,    # per org-actor tick: legitimate consent-lapse denial
    patient_denied_prob=0.01,  # per patient event: benign mis-click on a consent record
    slow_dispense_prob=0.06,   # per legit dispense: 20-90 min gap instead of 1-15 min
)


@contextmanager
def seeded_uuids(seed):
    """Replace uuid.uuid4 with a seeded stream for the duration of the block.
    Uses its own Random, so the generator's main stream is unaffected."""
    stream = random.Random(f"auditID-{seed}")
    original = uuid.uuid4
    uuid.uuid4 = lambda: uuid.UUID(int=stream.getrandbits(128), version=4)
    try:
        yield
    finally:
        uuid.uuid4 = original


# ---------------------------------------------------------------- legacy ----

def generate_legacy(days, seed, n_bursts=None):
    with seeded_uuids(seed):
        return g.generate(days, seed=seed, n_bursts=n_bursts)


# -------------------------------------------------------------------- v2 ----

def _weights(ids, prof_rng, sigma):
    return [prof_rng.lognormvariate(0.0, sigma) for _ in ids]


def _doctor_tick(base_day, rng, w, cfg, oncall):
    rows = []
    doctor = rng.choices(g.DOCTOR_IDS, weights=w["doctor"], k=1)[0]
    for _ in range(rng.randint(1, 6)):
        patient = rng.choice(g.DOCTOR_PANELS[doctor])
        action, resource_type, org = rng.choice(DOCTOR_COMBOS)
        ts = g.business_hours_ts(base_day, rng)
        rows.append(g.make_row(doctor, "doctor", org, action, resource_type, patient, ts, "normal", rng))
    # legitimate on-call work: a few events at night
    if doctor in oncall and rng.random() < cfg["oncall_tick_prob"]:
        for _ in range(rng.randint(1, 3)):
            patient = rng.choice(g.DOCTOR_PANELS[doctor])
            action, resource_type, org = rng.choice(DOCTOR_COMBOS)
            ts = g.off_hours_ts(base_day, rng)
            rows.append(g.make_row(doctor, "doctor", org, action, resource_type, patient, ts, "normal", rng))
    # legitimate rounds: rapid reads of the doctor's OWN panel
    if rng.random() < cfg["rounds_prob"]:
        start_ts = g.business_hours_ts(base_day, rng)
        for i in range(rng.randint(10, 20)):
            patient = rng.choice(g.DOCTOR_PANELS[doctor])
            ts = start_ts + timedelta(seconds=rng.randint(20, 120) * i)
            rows.append(g.make_row(doctor, "doctor", "", "READ", "CONSULTATION", patient, ts, "normal", rng))
    return rows


def _patient_tick(base_day, rng, w, cfg):
    rows = []
    patient = rng.choices(g.PATIENT_IDS, weights=w["patient"], k=1)[0]
    for _ in range(rng.randint(1, 3)):
        ts = g.business_hours_ts(base_day, rng)
        if rng.random() < cfg["patient_denied_prob"]:
            other = rng.choice([p for p in g.PATIENT_IDS if p != patient])
            rows.append(g.make_row(patient, "patient", "", "ACCESS_DENIED", "CONSENT", other, ts, "normal", rng))
            continue
        action = rng.choices(["READ", "CREATE", "UPDATE"], weights=[70, 20, 10], k=1)[0]
        resource_type = "PATIENT" if action == "READ" and rng.random() < 0.4 else "CONSENT"
        rows.append(g.make_row(patient, "patient", "", action, resource_type, patient, ts, "normal", rng))
    return rows


def _org_tick(base_day, rng, w, cfg):
    rows = []
    if rng.random() < 0.5:
        actor = rng.choices(g.PHARMACY_ACTOR_IDS, weights=w["pharm"], k=1)[0]
        patient = rng.choice(g.PHARM_PANELS[actor])
        rid = g.fake_resource_id("PRESCRIPTION", patient, rng)
        ts = g.business_hours_ts(base_day, rng)
        rows.append(g.make_row(actor, "org_actor", "PharmacyMSP", "READ", "PRESCRIPTION", patient, ts, "normal", rng, resource_id=rid))
        if rng.random() < 0.6:
            if rng.random() < cfg["slow_dispense_prob"]:
                gap = timedelta(seconds=rng.randint(20 * 60, 90 * 60))
            else:
                gap = timedelta(minutes=rng.randint(1, 15))
            rows.append(g.make_row(actor, "org_actor", "PharmacyMSP", "UPDATE", "PRESCRIPTION", patient, ts + gap, "normal", rng, resource_id=rid))
        org, rtype, pool, panels = "PharmacyMSP", "PRESCRIPTION", g.PHARMACY_ACTOR_IDS, g.PHARM_PANELS
    else:
        actor = rng.choices(g.LAB_ACTOR_IDS, weights=w["lab"], k=1)[0]
        patient = rng.choice(g.LAB_PANELS[actor])
        ts = g.business_hours_ts(base_day, rng)
        rows.append(g.make_row(actor, "org_actor", "LaboratoryMSP", "READ", "LAB_REPORT", patient, ts, "normal", rng))
        org, rtype = "LaboratoryMSP", "LAB_REPORT"
    # legitimate consent-lapse denial (consent expired between booking and read)
    if rng.random() < cfg["org_denied_prob"]:
        other = rng.choice(g.PATIENT_IDS)
        ts = g.business_hours_ts(base_day, rng)
        rows.append(g.make_row(actor, "org_actor", org, "ACCESS_DENIED", rtype, other, ts, "normal", rng))
    return rows


def _system_tick(base_day, rng):
    rows = []
    if rng.random() < 0.15:
        patient = rng.choice(g.PATIENT_IDS)
        ts = g.business_hours_ts(base_day, rng)
        rows.append(g.make_row(patient, "system", "", "CREATE", "PATIENT", patient, ts, "normal", rng))
    return rows


def _normal_traffic_v2(days, rng, prof_rng, cfg):
    w = {
        "doctor": _weights(g.DOCTOR_IDS, prof_rng, cfg["rate_sigma"]),
        "patient": _weights(g.PATIENT_IDS, prof_rng, cfg["rate_sigma"]),
        "pharm": _weights(g.PHARMACY_ACTOR_IDS, prof_rng, cfg["rate_sigma"]),
        "lab": _weights(g.LAB_ACTOR_IDS, prof_rng, cfg["rate_sigma"]),
    }
    n_oncall = max(1, round(cfg["oncall_frac"] * len(g.DOCTOR_IDS)))
    oncall = set(prof_rng.sample(g.DOCTOR_IDS, n_oncall))
    rows = []
    for d in range(days):
        base_day = START + timedelta(days=d)
        n_ticks = 8 if base_day.weekday() >= 5 else 30
        for _ in range(n_ticks):
            rows += _doctor_tick(base_day, rng, w, cfg, oncall)
            rows += _patient_tick(base_day, rng, w, cfg)
            rows += _org_tick(base_day, rng, w, cfg)
            rows += _system_tick(base_day, rng)
    return rows


def _inject(name, days, rng, severity):
    rows = INJECTORS[name](days, rng)
    if name in THINNABLE and severity < 1.0 and len(rows) > 3:
        keep = min(len(rows), max(3, int(round(len(rows) * severity))))
        idx = sorted(rng.sample(range(len(rows)), keep))
        rows = [rows[i] for i in idx]
    for r in rows:
        r["anomaly_type"] = name
    return rows


def generate_v2(days, seed, n_bursts=None, severity=1.0, cfg=None):
    cfg = {**V2_DEFAULTS, **(cfg or {})}
    rng = random.Random(seed)
    prof_rng = random.Random(f"profile-{seed}")  # separate stream: profile never perturbs the main one
    with seeded_uuids(seed):
        rows = _normal_traffic_v2(days, rng, prof_rng, cfg)
        n_bursts = n_bursts or 3 * max(2, days // 7)
        for _ in range(n_bursts):
            for name in ANOMALY_TYPES:
                rows += _inject(name, days, rng, severity)
    df = pd.DataFrame(rows)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df.sort_values("timestamp", kind="stable").reset_index(drop=True)


def generate(profile, days, seed, n_bursts=None, severity=1.0):
    if profile == "legacy":
        return generate_legacy(days, seed, n_bursts)
    if profile == "v2":
        return generate_v2(days, seed, n_bursts, severity)
    raise ValueError(f"unknown profile {profile!r}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", choices=["legacy", "v2"], default="v2")
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--n-bursts", type=int, default=None,
                        help="legacy default days//7 (min 2); v2 default 3x that")
    parser.add_argument("--severity", type=float, default=1.0,
                        help="v2 only: fraction of volume-based injection events kept (1.0 = legacy volume)")
    parser.add_argument("--out", default="synthetic_audit_log_v2.csv")
    args = parser.parse_args()

    df = generate(args.profile, args.days, args.seed, args.n_bursts, args.severity)
    df.to_csv(args.out, index=False)
    print(f"[{args.profile}] wrote {len(df)} rows ({(df['label'] == 'anomalous').sum()} anomalous) to {args.out}")


if __name__ == "__main__":
    main()
