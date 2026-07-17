/**
 * seed_test_anomaly_flags.js
 *
 * TEST-ONLY fixture seed for the 17_AnomalyResponse Bruno suite. Bypasses
 * /auth/org-actor/register entirely (same reasoning as
 * seed_synthetic_audit_data.js: fixed, known actorIDs are required BEFORE
 * the Bruno run so flagIDs can be hardcoded in .bru files -- registering
 * fresh via HTTP would generate a random actorID we can't predict ahead of
 * time). Idempotent: upserts, safe to re-run.
 *
 * Run: node seed_test_anomaly_flags.js
 */
import bcrypt from "bcrypt";
import { connectDB, OrgActor, AnomalyFlag } from "./services/db.js";

const PASSWORD = "TestPass123!";

const ACTOR_1 = { actorID: "ACTORTEST0001", phone: "9000000001", email: "anomaly-test-1@medvault.test" };
const ACTOR_2 = { actorID: "ACTORTEST0002", phone: "9000000002", email: "anomaly-test-2@medvault.test" };

async function upsertActor({ actorID, phone, email }, fullName) {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await OrgActor.findOneAndUpdate(
        { actorID },
        {
            actorID, fullName, org: "PharmacyMSP", phone, email, passwordHash,
            isVerified: true, violationCount: 0, isBanned: false, bannedUntil: null,
            createdAt: new Date().toISOString(),
        },
        { upsert: true, new: true }
    );
}

async function upsertFlag(flagID, overrides = {}) {
    await AnomalyFlag.findOneAndUpdate(
        { flagID },
        {
            flagID,
            actorID: ACTOR_1.actorID,
            actorRole: "org_actor",
            actorOrg: "PharmacyMSP",
            date: new Date().toISOString().slice(0, 10),
            ifScore: 0.5,
            lstmScore: null,
            combinedScore: 0.5,
            priority: "P1_high_confidence",
            topFeatures: [{ feature: "off_hours_ratio", contribution: 0.2 }],
            classification: "point",
            status: "PENDING",
            auditID: "TEST-AUDIT-" + flagID,
            clarificationRequested: true,
            clarificationText: "",
            clarificationSubmittedAt: null,
            createdAt: new Date().toISOString(),
            ...overrides,
        },
        { upsert: true, new: true }
    );
}

async function main() {
    await connectDB();

    await upsertActor(ACTOR_1, "Anomaly Test Actor One");
    await upsertActor(ACTOR_2, "Anomaly Test Actor Two");

    // Owned by ACTOR_1, clarification requested, still PENDING -> the
    // "happy path" respond target.
    await upsertFlag("TESTFLAGCLARIFY", { clarificationRequested: true, status: "PENDING" });

    // Owned by ACTOR_1, but clarification was NOT requested (e.g. their
    // 3rd+ flag) -> /respond should 400.
    await upsertFlag("TESTFLAGNOCLARIFY", { clarificationRequested: false, status: "PENDING" });

    // Owned by ACTOR_1, already reviewed by Governance -> /respond should
    // 400 (can't respond after review).
    await upsertFlag("TESTFLAGREVIEWED", {
        clarificationRequested: true,
        status: "CONFIRMED",
        reviewedBy: "GOV-TEST",
        reviewedAt: new Date().toISOString(),
    });

    console.log("Seeded: ACTOR_1 (%s), ACTOR_2 (%s), password '%s'", ACTOR_1.phone, ACTOR_2.phone, PASSWORD);
    console.log("Seeded flags: TESTFLAGCLARIFY (PENDING, clarification open), "
        + "TESTFLAGNOCLARIFY (PENDING, no clarification), TESTFLAGREVIEWED (CONFIRMED).");
    process.exit(0);
}

main().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
});
