import { createHelia } from "helia";
import { unixfs } from "@helia/unixfs";

/**
 * We initialize Helia once and reuse it
 */
let helia;
let fs;

/**
 * Initialize Helia node
 */
export async function initIPFS() {
    if (!helia) {
        helia = await createHelia();
        fs = unixfs(helia);
    }
    return { helia, fs };
}

/**
 * Upload file (Buffer) → returns CID
 */
export async function uploadFile(fileBuffer) {
    const { fs } = await initIPFS();

    const cid = await fs.addBytes(fileBuffer);

    return cid.toString();
}

/**
 * Get file from CID
 */
export async function getFile(cid) {
    const { fs } = await initIPFS();

    const chunks = [];

    for await (const chunk of fs.cat(cid)) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}
