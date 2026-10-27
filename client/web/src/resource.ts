/**
 * Local importer for the Mii parts resource (AFLResHigh*.dat).
 *
 * The resource is proprietary Nintendo data. It is never bundled with or uploaded by this
 * client: the user selects a file they obtained themselves, and it stays in this browser
 * (optionally cached in IndexedDB for convenience).
 */
import { unzipSync } from 'fflate';
import { openMtwDb } from './assets/db';

/** Known reference files (from the Miitomo CDN manifest v2.0.1481 + our own hashing). */
export const KNOWN_RESOURCES: Record<string, { name: string; note: string }> = {
  '4a4be71d75162c20b48720ef89cd3d4e6cd4e8e21bcbc2aed63ee08d96de7722': {
    name: 'AFLResHigh_2_3.dat',
    note: 'Miitomo 2.3+ (CDN build 20180125111639), verified'
  }
};

export interface LoadedResource {
  bytes: Uint8Array;
  fileName: string;
  sha256: string;
  known: (typeof KNOWN_RESOURCES)[string] | null;
}

const MAGIC = 'FFRA';

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hasMagic(bytes: Uint8Array): boolean {
  return bytes.length > 0x100 && String.fromCharCode(...bytes.subarray(0, 4)) === MAGIC;
}

/** Accepts the original CDN zip or the bare .dat. */
export async function importResource(file: File): Promise<LoadedResource> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  let fileName = file.name;

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // Zip (the CDN shipped asset_model_character_mii_AFLResHigh_2_3_dat.zip)
    const entries = unzipSync(bytes, { filter: (f) => /AFLRes[^/]*\.dat$/i.test(f.name) });
    const name = Object.keys(entries)[0];
    if (!name) throw new Error('Lo zip non contiene un file AFLRes*.dat.');
    bytes = entries[name];
    fileName = name.split('/').pop() ?? name;
  }

  if (!hasMagic(bytes)) {
    throw new Error('Il file non è una risorsa Mii FFL/AFL (header "FFRA" mancante).');
  }
  const sha256 = await sha256Hex(bytes);
  return { bytes, fileName, sha256, known: KNOWN_RESOURCES[sha256] ?? null };
}

// ---- Optional local cache (per-viewer convenience; may be unavailable) ----

const DB = 'miitomo-web';
const STORE = 'resources';

function openDb(): Promise<IDBDatabase> { return openMtwDb(); }

export async function cacheResource(res: LoadedResource): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ bytes: res.bytes, fileName: res.fileName, sha256: res.sha256 }, 'mii');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* cache is optional */
  }
}

export async function loadCachedResource(): Promise<LoadedResource | null> {
  try {
    const db = await openDb();
    const v = await new Promise<any>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get('mii');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!v || !hasMagic(v.bytes)) return null;
    return { bytes: v.bytes, fileName: v.fileName, sha256: v.sha256, known: KNOWN_RESOURCES[v.sha256] ?? null };
  } catch {
    return null;
  }
}

export async function clearCachedResource(): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete('mii');
  } catch {
    /* ignore */
  }
}
