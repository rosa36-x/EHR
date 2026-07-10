"""
generate_synthetic_audit_data.py

Generates fake AuditLog-shaped rows matching the REAL on-chain struct and
the REAL vocabulary this repo actually emits (confirmed against
chaincode/models/audit.go, chaincode/audit_contract.go, and every
logAudit() call site in backend/services/*.js as of this writing):

  Fields (chaincode/models/audit.go -> models.AuditLog):
    auditID, actorID, actorRole, actorOrg, action, resourceType,
    resourceID, timestamp

  Real actorRole values:      "doctor" | "patient" | "org_actor" | "system"
    (there is no "nurse"/"pharmacist"/"claims_adjuster" role in this repo —
    pharmacy/lab/governance staff are all actorRole "org_actor",
    distinguished by actorOrg, see backend/services/db.js orgActorSchema)

  Real actorOrg values:        "" (default, most actions) |
                                "HospitalMSP" | "PharmacyMSP" | "LaboratoryMSP"
    actorOrg is ONLY populated on PRESCRIPTION/LAB_REPORT READ/UPDATE calls,
    via mspIdForOrg(orgName) — see backend/services/prescriptionFabricService.js
    and labReportFabricService.js. Every other logAudit() call site leaves
    it at auditMiddleware.js's default of "".

  Real action values:          "CREATE" | "READ" | "UPDATE" |
                                "ACCESS_DENIED" | "ACCESS_FAILED"
    There is no "DISPENSE" action — dispensing a prescription is logged as
    action="UPDATE", resourceType="PRESCRIPTION" via updatePrescriptionStatus().
    ("CONSENT_GRANTED"/"CONSENT_REVOKED" are notificationService.js event
    names shown to the patient, NOT audit-log action values — granting is
    action="CREATE", revoking is action="UPDATE", both resourceType="CONSENT".)

  Real resourceType values:    "PATIENT" | "CONSULTATION" | "LAB_REPORT" |
                                "PRESCRIPTION" | "REFERRAL" | "CONSENT" |
                                "EMERGENCY_ACCESS" | "PERMISSION_REQUEST"

`label` (normal/anomalous) is for eval only — never fed to the model.

Usage:
    python generate_synthetic_audit_data.py --out synthetic_audit_log.csv --days 30
"""

import argparse
import random
import uuid
from datetime import datetime, timedelta

import pandas as pd

# ---- Confirmed-real vocabulary ---------------------------------------------

N_DOCTORS = 25
N_PHARMACY_ACTORS = 8
N_LAB_ACTORS = 8
N_PATIENTS = 250

DOCTOR_IDS = [f"doctor-{i:03d}" for i in range(1, N_DOCTORS + 1)]
PHARMACY_ACTOR_IDS = [f"orgactor-pharm-{i:03d}" for i in range(1, N_PHARMACY_ACTORS + 1)]
LAB_ACTOR_IDS = [f"orgactor-lab-{i:03d}" for i in range(1, N_LAB_ACTORS + 1)]
PATIENT_IDS = [f"patient-{i:04d}" for i in range(1, N_PATIENTS + 1)]

# Each doctor/pharmacy-actor/lab-actor has a small fixed panel of patients
# they normally deal with, so normal traffic isn't "any actor, any patient".
random.seed(7)
DOCTOR_PANELS = {d: random.sample(PATIENT_IDS, k=12) for d in DOCTOR_IDS}
PHARM_PANELS = {p: random.sample(PATIENT_IDS, k=20) for p in PHARMACY_ACTOR_IDS}
LAB_PANELS = {l: random.sample(PATIENT_IDS, k=20) for l in LAB_ACTOR_IDS}


def make_row(actor_id, actor_role, actor_org, action, resource_type, resource_id, ts, label):
    return {
        "auditID": str(uuid.uuid4()),
        "actorID": actor_id,
        "actorRole": actor_role,
        "actorOrg": actor_org,
        "action": action,
        "resourceType": resource_type,
        "resourceID": resource_id,
        "timestamp": ts.isoformat(),
        "label": label,  # normal | anomalous (eval-only)
    }


def business_hours_ts(base_day, rng):
    hour = int(min(23, max(0, rng.gauss(13, 3))))
    return base_day.replace(hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59))


def off_hours_ts(base_day, rng):
    hour = rng.choice([0, 1, 2, 3, 4, 23])
    return base_day.replace(hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59))


# ---- Normal background traffic, grounded in real call sites ----------------

def normal_doctor_events(base_day, rng):
    """Doctor CREATE/READ on CONSULTATION, REFERRAL, PRESCRIPTION (CREATE),
    and READ on their own patients' PATIENT/LAB_REPORT/PRESCRIPTION records.
    actorOrg="" except when reading PRESCRIPTION/LAB_REPORT, where
    mspIdForOrg("hospital") -> "HospitalMSP" is always attached."""
    rows = []
    doctor = rng.choice(DOCTOR_IDS)
    for _ in range(rng.randint(1, 6)):
        patient = rng.choice(DOCTOR_PANELS[doctor])
        action, resource_type, org = rng.choice([
            ("CREATE", "CONSULTATION", ""),
            ("READ", "CONSULTATION", ""),
            ("CREATE", "REFERRAL", ""),
            ("READ", "REFERRAL", ""),
            ("CREATE", "PRESCRIPTION", "HospitalMSP"),
            ("READ", "PRESCRIPTION", "HospitalMSP"),
            ("READ", "LAB_REPORT", "HospitalMSP"),
            ("READ", "PATIENT", ""),
        ])
        ts = business_hours_ts(base_day, rng)
        rows.append(make_row(doctor, "doctor", org, action, resource_type, patient, ts, "normal"))
    return rows


def normal_patient_events(base_day, rng):
    """Patients only ever act on their OWN patientID. READ own PATIENT
    record, CREATE consent (grant), UPDATE consent (revoke), READ consent."""
    rows = []
    patient = rng.choice(PATIENT_IDS)
    for _ in range(rng.randint(1, 3)):
        action = rng.choices(["READ", "CREATE", "UPDATE"], weights=[70, 20, 10], k=1)[0]
        resource_type = "PATIENT" if action == "READ" and rng.random() < 0.4 else "CONSENT"
        ts = business_hours_ts(base_day, rng)
        rows.append(make_row(patient, "patient", "", action, resource_type, patient, ts, "normal"))
    return rows


def normal_org_actor_events(base_day, rng):
    """Pharmacy/lab org_actors reading PRESCRIPTION/LAB_REPORT cross-org
    under patient consent, plus the occasional legitimate dispense
    (UPDATE PRESCRIPTION) that IS preceded by a READ, as the real flow
    requires (GetPrescription -> UpdatePrescriptionStatus)."""
    rows = []
    if rng.random() < 0.5:
        actor = rng.choice(PHARMACY_ACTOR_IDS)
        patient = rng.choice(PHARM_PANELS[actor])
        ts = business_hours_ts(base_day, rng)
        rows.append(make_row(actor, "org_actor", "PharmacyMSP", "READ", "PRESCRIPTION", patient, ts, "normal"))
        if rng.random() < 0.6:  # legitimate dispense follows the read
            ts2 = ts + timedelta(minutes=rng.randint(1, 15))
            rows.append(make_row(actor, "org_actor", "PharmacyMSP", "UPDATE", "PRESCRIPTION", patient, ts2, "normal"))
    else:
        actor = rng.choice(LAB_ACTOR_IDS)
        patient = rng.choice(LAB_PANELS[actor])
        ts = business_hours_ts(base_day, rng)
        rows.append(make_row(actor, "org_actor", "LaboratoryMSP", "READ", "LAB_REPORT", patient, ts, "normal"))
    return rows


def normal_system_events(base_day, rng):
    """system actorRole: automated PATIENT record creation at registration."""
    rows = []
    if rng.random() < 0.15:
        patient = rng.choice(PATIENT_IDS)
        ts = business_hours_ts(base_day, rng)
        rows.append(make_row(patient, "system", "", "CREATE", "PATIENT", patient, ts, "normal"))
    return rows


def generate_normal_traffic(days, rng):
    rows = []
    start = datetime(2026, 1, 1)
    for d in range(days):
        base_day = start + timedelta(days=d)
        n_ticks = 8 if base_day.weekday() >= 5 else 30  # lighter weekends
        for _ in range(n_ticks):
            rows += normal_doctor_events(base_day, rng)
            rows += normal_patient_events(base_day, rng)
            rows += normal_org_actor_events(base_day, rng)
            rows += normal_system_events(base_day, rng)
    return rows


# ---- Injected, labeled anomalies, each grounded in a real code path --------

def inject_off_hours_burst(days, rng):
    """A doctor or org_actor reading many distinct patients' records at
    2-4am — off-hours volume anomaly."""
    rows = []
    base_day = datetime(2026, 1, 1) + timedelta(days=rng.randint(3, days - 3))
    actor, role, org, resource_type = rng.choice([
        (rng.choice(DOCTOR_IDS), "doctor", "", "CONSULTATION"),
        (rng.choice(PHARMACY_ACTOR_IDS), "org_actor", "PharmacyMSP", "PRESCRIPTION"),
    ])
    start_ts = off_hours_ts(base_day, rng)
    for i in range(rng.randint(15, 30)):
        patient = rng.choice(PATIENT_IDS)
        ts = start_ts + timedelta(seconds=rng.randint(5, 90) * i)
        rows.append(make_row(actor, role, org, "READ", resource_type, patient, ts, "anomalous"))
    return rows


def inject_broad_access_burst(days, rng):
    """One doctor reading CONSULTATION/PATIENT records for far more distinct
    patients than their normal panel, in a tight window during business
    hours — data-harvesting pattern, not a timing anomaly."""
    rows = []
    base_day = datetime(2026, 1, 1) + timedelta(days=rng.randint(3, days - 3))
    doctor = rng.choice(DOCTOR_IDS)
    start_ts = business_hours_ts(base_day, rng)
    for i in range(rng.randint(20, 40)):
        patient = rng.choice(PATIENT_IDS)  # NOT restricted to this doctor's panel
        ts = start_ts + timedelta(seconds=rng.randint(2, 20) * i)
        rows.append(make_row(doctor, "doctor", "", "READ", "CONSULTATION", patient, ts, "anomalous"))
    return rows


def inject_consent_probe_spree(days, rng):
    """A patient repeatedly attempting to access ANOTHER patient's CONSENT
    record. This mirrors the real assertOwnsConsent() check in
    consentFabricService.js exactly: patientID !== actorID on a CONSENT
    resource logs action='ACCESS_DENIED', resourceType='CONSENT'."""
    rows = []
    base_day = datetime(2026, 1, 1) + timedelta(days=rng.randint(3, days - 3))
    probing_patient = rng.choice(PATIENT_IDS)
    victim_patient = rng.choice([p for p in PATIENT_IDS if p != probing_patient])
    start_ts = business_hours_ts(base_day, rng)
    for i in range(rng.randint(8, 20)):
        ts = start_ts + timedelta(minutes=rng.randint(1, 5) * i)
        rows.append(make_row(probing_patient, "patient", "", "ACCESS_DENIED", "CONSENT", victim_patient, ts, "anomalous"))
    return rows


def inject_dispense_without_read(days, rng):
    """A pharmacy org_actor issuing UPDATE/PRESCRIPTION (dispense) for
    resourceIDs it never READ first — skipping the real
    GetPrescription -> UpdatePrescriptionStatus flow."""
    rows = []
    base_day = datetime(2026, 1, 1) + timedelta(days=rng.randint(3, days - 3))
    actor = rng.choice(PHARMACY_ACTOR_IDS)
    start_ts = business_hours_ts(base_day, rng)
    for i in range(rng.randint(6, 12)):
        patient = rng.choice(PATIENT_IDS)
        ts = start_ts + timedelta(minutes=rng.randint(1, 10) * i)
        rows.append(make_row(actor, "org_actor", "PharmacyMSP", "UPDATE", "PRESCRIPTION", patient, ts, "anomalous"))
    return rows


def generate(days, seed=42, n_bursts=None):
    rng = random.Random(seed)
    rows = generate_normal_traffic(days, rng)

    n_bursts = n_bursts or max(2, days // 7)
    for _ in range(n_bursts):
        rows += inject_off_hours_burst(days, rng)
        rows += inject_broad_access_burst(days, rng)
        rows += inject_consent_probe_spree(days, rng)
        rows += inject_dispense_without_read(days, rng)

    df = pd.DataFrame(rows)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df.sort_values("timestamp").reset_index(drop=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="synthetic_audit_log.csv")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    df = generate(args.days, seed=args.seed)
    df.to_csv(args.out, index=False)
    print(f"Wrote {len(df)} rows ({(df['label']=='anomalous').sum()} anomalous) to {args.out}")

    if args.json:
        json_path = args.out.rsplit(".", 1)[0] + ".json"
        df.to_json(json_path, orient="records", indent=2, date_format="iso")
        print(f"Also wrote {json_path}")


if __name__ == "__main__":
    main()
