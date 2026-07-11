/**
 * analyze_storage_overhead.js
 *
 * Standalone eval script -- NOT part of the live system. Compares:
 *   - on-chain PDC metadata footprint (what actually lives in the
 *     Private Data Collection ledger state per docs/schemas.md: pointers,
 *     hashes, key refs -- never document content)
 *   - off-chain IPFS document footprint (the actual encrypted file)
 *
 * PDC sizes are computed deterministically from representative JSON built
 * directly from the documented field list in docs/schemas.md -- no live
 * Fabric network needed, fully reproducible.
 *
 * IPFS sizes come from REAL files you point it at via --docs-dir (e.g. a
 * folder of sample lab report / prescription PDFs you already have for
 * testing). AES-256-GCM adds a fixed ~28 bytes/file overhead (12-byte
 * nonce + 16-byte auth tag) -- negligible at real document sizes, so
 * plaintext file size is reported as an accurate proxy for encrypted size.
 *
 * If --docs-dir is omitted, IPFS-side numbers are skipped (not guessed --
 * see note in output) rather than fabricated.
 *
 * Usage:
 *   node analyze_storage_overhead.js --docs-dir /path/to/sample/pdfs --out storage_overhead.json
 */
import fs from "fs";
import path from "path";

const GCM_OVERHEAD_BYTES = 12 + 16; // nonce + auth tag

// Representative PDC records built directly from docs/schemas.md field
// lists. Values are realistic-length placeholders (UUIDs, ISO timestamps,
// short free text) -- structure/field count is what's documented, not
// guessed.
const PDC_RECORDS = {
    Consultation: {
        consultationID: "CONS-a1b2c3d4-e5f6-4789-9abc-def012345678",
        patientID: "patient-0099",
        doctorID: "doctor-013",
        diagnosis: "Type 2 diabetes mellitus, well controlled, routine follow-up",
        consultationCID: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        consultationHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        encryptionKeyRef: "kms-key-a1b2c3d4e5f6",
        timestamp: "2026-07-11T09:15:22.000Z",
        createdAt: "2026-07-11T09:15:22.000Z",
        updatedAt: "2026-07-11T09:15:22.000Z",
    },
    Prescription: {
        prescriptionID: "PRE-a1b2c3d4-e5f6-4789-9abc-def012345678",
        patientID: "patient-0016",
        doctorID: "doctor-019",
        prescriptionCID: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        prescriptionHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        encryptionKeyRef: "kms-key-a1b2c3d4e5f6",
        status: "DISPENSED",
        issuedAt: "2026-07-11T09:20:00.000Z",
        dispensedAt: "2026-07-11T10:05:14.000Z",
        createdAt: "2026-07-11T09:20:00.000Z",
        updatedAt: "2026-07-11T10:05:14.000Z",
    },
    LabReport: {
        reportID: "LAB-a1b2c3d4-e5f6-4789-9abc-def012345678",
        patientID: "patient-0014",
        labTechID: "labtech-004",
        reportType: "HbA1c",
        reportCID: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        reportHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        encryptionKeyRef: "kms-key-a1b2c3d4e5f6",
        status: "COMPLETED",
        createdAt: "2026-07-11T08:00:00.000Z",
        updatedAt: "2026-07-11T08:45:00.000Z",
    },
};

function byteLength(obj) {
    return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

function scanDocsDir(dir) {
    if (!dir) return null;
    const files = fs.readdirSync(dir).filter((f) => !f.startsWith("."));
    if (files.length === 0) return null;
    const sizes = files.map((f) => fs.statSync(path.join(dir, f)).size);
    const total = sizes.reduce((a, b) => a + b, 0);
    return {
        n_files: files.length,
        mean_bytes: Math.round(total / files.length),
        min_bytes: Math.min(...sizes),
        max_bytes: Math.max(...sizes),
        mean_bytes_encrypted: Math.round(total / files.length) + GCM_OVERHEAD_BYTES,
    };
}

function parseArgs() {
    const args = process.argv.slice(2);
    const out = { docsDir: null, out: "storage_overhead.json" };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--docs-dir") out.docsDir = args[++i];
        if (args[i] === "--out") out.out = args[++i];
    }
    return out;
}

function main() {
    const { docsDir, out } = parseArgs();

    const pdcSizes = Object.fromEntries(
        Object.entries(PDC_RECORDS).map(([name, record]) => [name, byteLength(record)])
    );
    const meanPdcBytes = Math.round(
        Object.values(pdcSizes).reduce((a, b) => a + b, 0) / Object.values(pdcSizes).length
    );

    const ipfs = scanDocsDir(docsDir);

    const result = {
        methodology: "PDC sizes: deterministic JSON.stringify of representative records built from "
            + "docs/schemas.md field lists (structure documented, not guessed). "
            + "IPFS sizes: real files" + (docsDir ? ` from ${docsDir}` : " -- NONE PROVIDED, see note"),
        on_chain_pdc_metadata_bytes: pdcSizes,
        on_chain_pdc_mean_bytes: meanPdcBytes,
        off_chain_ipfs: ipfs ?? {
            note: "No --docs-dir provided. Re-run with --docs-dir pointing at real sample "
                + "documents (e.g. sample lab report / prescription files) to get measured "
                + "IPFS-side figures -- intentionally not fabricated.",
        },
        overhead_ratio: ipfs ? Number((ipfs.mean_bytes_encrypted / meanPdcBytes).toFixed(1)) : null,
    };

    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    console.log(`\nWrote ${out}`);
}

main();
