/**
 * The one IndexedDB database of this client ("miitomo-web"). All modules open it through here so the version and the
 * store list cannot drift. v3 (M9): resources, vfs, save. v4 (M13): blobs = "cold" asset files, one record per path.
 */
export const DB_NAME = 'miitomo-web';
export const DB_VERSION = 4;
const STORES = ['resources', 'vfs', 'save', 'blobs'];
let pending: Promise<IDBDatabase> | null = null;
export function openMtwDb(): Promise<IDBDatabase> {
  if (pending) return pending;
  pending = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { const db = req.result; for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); };
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); pending = null; }; resolve(db); };
    req.onerror = () => { pending = null; reject(req.error); };
    req.onblocked = () => console.warn('IndexedDB: aggiornamento bloccato da un\'altra scheda aperta');
  });
  return pending;
}
export function txDone(tx: IDBTransaction): Promise<void> { return new Promise((r, j) => { tx.oncomplete = () => r(); tx.onerror = () => j(tx.error); tx.onabort = () => j(tx.error); }); }
export function reqP<T>(req: IDBRequest<T>): Promise<T> { return new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); }); }
