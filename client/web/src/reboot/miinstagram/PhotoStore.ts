/**
 * REBOOT R5 — where MIInstagram keeps the photos (Miifoto shared by the user, photos of the room). Posts only hold a
 * `photoId`; the image lives here so the post list stays small. In the browser: IndexedDB (its own database, never
 * the Classic save); when IndexedDB is unavailable (private mode) or in tests: memory only, said so by `persistent`.
 * Images are JPEG / PNG / WebP data URLs, checked and size-capped before they are kept.
 */
export interface PhotoStore {
  readonly persistent: boolean;
  put(dataUrl: string): Promise<string>;
  get(id: string): Promise<string | null>;
  delete(id: string): Promise<void>;
  ids(): Promise<string[]>;
}
export const MAX_PHOTO_BYTES = 1_500_000;
export function validPhoto(dataUrl: unknown): dataUrl is string {
  return typeof dataUrl === 'string' && dataUrl.length <= MAX_PHOTO_BYTES && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl);
}
const newId = () => `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class MemoryPhotoStore implements PhotoStore {
  readonly persistent: boolean = false;
  readonly map = new Map<string, string>();
  async put(dataUrl: string) { if (!validPhoto(dataUrl)) throw new Error('IMAGE_INVALID'); const id = newId(); this.map.set(id, dataUrl); return id; }
  async get(id: string) { return this.map.get(id) ?? null; }
  async delete(id: string) { this.map.delete(id); }
  async ids() { return [...this.map.keys()]; }
}

const DB = 'mtw-reboot', STORE = 'photos';
export class IdbPhotoStore implements PhotoStore {
  readonly persistent = true;
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  /** Resolves when the database is open; rejects when IndexedDB refuses (private mode, blocked storage). */
  async ready() { await this.db; }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const q = fn(t.objectStore(STORE)); t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  }
  async put(dataUrl: string) { if (!validPhoto(dataUrl)) throw new Error('IMAGE_INVALID'); const id = newId(); await this.tx('readwrite', (s) => s.put(dataUrl, id)); return id; }
  async get(id: string) { try { return ((await this.tx('readonly', (s) => s.get(id))) as string | undefined) ?? null; } catch { return null; } }
  async delete(id: string) { try { await this.tx('readwrite', (s) => s.delete(id)); } catch { /* already gone */ } }
  async ids() { try { return ((await this.tx('readonly', (s) => s.getAllKeys())) as IDBValidKey[]).map(String); } catch { return []; } }
}
/** IndexedDB when it works, memory otherwise (the UI says photos will not survive a reload). */
export async function openPhotoStore(): Promise<PhotoStore> {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryPhotoStore();
    const s = new IdbPhotoStore(); await s.ready(); return s;
  } catch { return new MemoryPhotoStore(); }
}
/** Usable at once; calls wait for the real store (IndexedDB, or memory when it is refused) to be open. */
export class LazyPhotoStore implements PhotoStore {
  private real: PhotoStore | null = null;
  private ready: Promise<PhotoStore>;
  constructor(open: () => Promise<PhotoStore> = openPhotoStore) { this.ready = open().then((s) => (this.real = s)); }
  /** Until IndexedDB answered we assume it works (it does in normal browsers); a refusal flips this to false. */
  get persistent() { return this.real ? this.real.persistent : true; }
  async put(d: string) { return (await this.ready).put(d); }
  async get(id: string) { return (await this.ready).get(id); }
  async delete(id: string) { return (await this.ready).delete(id); }
  async ids() { return (await this.ready).ids(); }
}
