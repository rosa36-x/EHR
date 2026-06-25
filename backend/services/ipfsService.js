import { createHelia } from "helia";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import { unixfs } from "@helia/unixfs";
import { CID } from "multiformats/cid";

/**
 * Singleton Helia instance (prevents multiple nodes)
 */
let helia = null;
let ipfsFs = null;
let initPromise = null;

/**
 * Initialize IPFS (Helia) — concurrency-safe singleton.
 * Subsequent calls resolve immediately once initialized.
 */
export async function initIPFS() {
    if (!initPromise) {
        initPromise = (async () => {
            helia = await createHelia();
            ipfsFs = unixfs(helia);
        })();
    }
    await initPromise;
    return { helia, ipfsFs };
}

/**
 * Gracefully stop the Helia node and release all resources.
 * Call this on process SIGTERM / SIGINT to avoid hangs.
 */
export async function stopIPFS() {
    if (helia) {
        try {
            await helia.stop();
        } catch (err) {
            console.error("[IPFS] Error during shutdown:", err);
        } finally {
            helia = null;
            ipfsFs = null;
            initPromise = null;
        }
    }
}

/**
 * Register shutdown handlers so the node is always cleaned up.
 * Safe to call multiple times — only registers once.
 */
let shutdownRegistered = false;
export function registerShutdownHandlers() {
    if (shutdownRegistered) return;
    shutdownRegistered = true;

    const shutdown = async (signal) => {
        console.log(`[IPFS] Received ${signal}, stopping Helia...`);
        await stopIPFS();
        process.exit(0);
    };

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT",  () => shutdown("SIGINT"));
}

/**
 * Upload a file buffer to IPFS.
 * Uses deterministic chunking for consistent CIDs across MedVault nodes.
 *
 * @param {Buffer | Uint8Array} fileBuffer
 * @returns {Promise<string>} CID string
 */
export async function uploadFile(fileBuffer) {
    if (!fileBuffer || fileBuffer.byteLength === 0) {
        throw new Error("Cannot upload empty buffer");
    }

    const { ipfsFs } = await initIPFS();

    // v7.2.1: chunker must be a structured object; flat `chunkSize` is not a valid top-level key.
    // `rawLeaves: true` is already the default but kept explicit for clarity.
    const cid = await ipfsFs.addBytes(fileBuffer, {
        rawLeaves: true,
        chunker: fixedSize({ chunkSize: 262144 }), // 256 KiB chunks
    });

    return cid.toString();
}

/**
 * Retrieve a file from IPFS by CID.
 * Streams chunks into memory with a configurable size cap.
 *
 * @param {string} cid - CID string
 * @param {object} [options]
 * @param {number} [options.maxBytes=104857600] - Max file size in bytes (default: 100 MB)
 * @returns {Promise<Buffer>}
 */
export async function getFile(cid, { maxBytes = 100 * 1024 * 1024 } = {}) {
    // Validate CID before hitting the network
    let parsedCid;
    try {
        parsedCid = CID.parse(cid);
    } catch {
        throw new Error(`Invalid CID: "${cid}"`);
    }

    const { ipfsFs } = await initIPFS();

    const chunks = [];
    let total = 0;

    for await (const chunk of ipfsFs.cat(parsedCid)) {
        total += chunk.byteLength;
        if (total > maxBytes) {
            throw new Error(
                `File exceeds size limit of ${maxBytes} bytes (got at least ${total} bytes)`
            );
        }
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}