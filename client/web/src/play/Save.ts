/**
 * Local save (M9). One slot, stored in IndexedDB (database "miitomo-web", store "save", key "slot0").
 * Versioned: `version` is bumped whenever the shape changes and `migrate()` upgrades older saves.
 * Export = the same JSON object; import validates and migrates it. No cloud sync. See docs/reverse-engineering/SAVE.md.
 */
import type { Outfit } from '../body/Wardrobe';
import { openMtwDb } from '../assets/db';

export const SAVE_FORMAT = 'miitomo-web-save';
export const SAVE_VERSION = 1;
/** Favourite-outfit slots. The original limit was server data (MISSING); 50 is a WEB ADAPTATION. */
export const MAX_COORDINATES = 50;

export interface Answer { id: string; question: string; answer: string; at: string; source: 'original' | 'placeholder'; }
export interface SaveData {
  format: typeof SAVE_FORMAT;
  version: number;
  created: string;
  updated: string;
  profile: {
    miiData: string | null;      // base64 of the Mii data the user created / imported (FFLiCharInfo or StoreData)
    name: string;                // Miitomo nickname
    birthday: { month: number; day: number } | null;
    height: number | null;       // null = the Mii's own value
    build: number | null;
    personality: number[] | null;  // characterParam: 5 levels 1..8 (Movimenti, Modo di parlare, Atteggiamento, Espressione, Originalità); see Personality.ts
    greetings: { welcome: string; goIn: string; seeingOff: string; goHome: string };
    voice: { pitch: number; speed: number; accent: number; energy: number; depth: number };   // voiceParam, 0..100 (scale APPROXIMATED)   // "Saluti" (custom greetings, Mii tag group 1.2–1.5)
  };
  outfit: Outfit;
  room: { wall: string; floor: string; variant: number };
  settings: { audio: boolean; lang: 'EUit'; voice: 'auto' | 'original-nuance' | 'web-tts' | 'silent'; sound: { music: boolean; effects: boolean; voice: boolean } };
  progress: { firstEntryDone: boolean; launches: number };
  inventory: { coins: number; items: string[] };
  answers: Answer[];
  /** Closet "Preferito" (★): outfits the user saved (shop/text00 noHaveCoordinate). Local; the original synced them with the server. */
  coordinates: Outfit[];
}

export function newSave(outfit: Outfit): SaveData {
  const now = new Date().toISOString();
  return {
    format: SAVE_FORMAT, version: SAVE_VERSION, created: now, updated: now,
    profile: { miiData: null, name: '', birthday: null, height: null, build: null, personality: null, greetings: { welcome: '', goIn: '', seeingOff: '', goHome: '' }, voice: { pitch: 50, speed: 50, accent: 50, energy: 50, depth: 50 } },
    outfit: structuredClone(outfit),
    room: { wall: '0000', floor: '0000', variant: 0 },
    settings: { audio: true, lang: 'EUit', voice: 'auto', sound: { music: true, effects: true, voice: true } },
    progress: { firstEntryDone: false, launches: 0 },
    inventory: { coins: 0, items: [] },
    answers: [],
    coordinates: []
  };
}

/** Accepts any older / partial save object and returns a valid current one (throws if it is not a save at all). */
export function migrate(raw: unknown, defaults: SaveData): SaveData {
  const r = raw as Partial<SaveData> | null;
  if (!r || typeof r !== 'object' || r.format !== SAVE_FORMAT) throw new Error('Non è un salvataggio di Miitomo Web.');
  if (typeof r.version !== 'number' || r.version > SAVE_VERSION) throw new Error(`Versione del salvataggio non supportata (${r.version}).`);
  // v1 is the first version: fill missing fields from the defaults, keep what is there.
  const d = structuredClone(defaults);
  const out: SaveData = {
    ...d, ...r,
    format: SAVE_FORMAT, version: SAVE_VERSION,
    profile: { ...d.profile, ...(r.profile ?? {}), greetings: { ...d.profile.greetings, ...((r.profile as SaveData['profile'] | undefined)?.greetings ?? {}) }, voice: { ...d.profile.voice, ...((r.profile as SaveData['profile'] | undefined)?.voice ?? {}) } },
    outfit: (r.outfit as Outfit) ?? d.outfit,
    room: { ...d.room, ...(r.room ?? {}) },
    settings: { ...d.settings, ...(r.settings ?? {}), sound: { ...d.settings.sound, ...((r.settings as SaveData['settings'] | undefined)?.sound ?? {}) } },
    progress: { ...d.progress, ...(r.progress ?? {}) },
    inventory: { ...d.inventory, ...(r.inventory ?? {}) },
    answers: Array.isArray(r.answers) ? r.answers : [],
    coordinates: Array.isArray(r.coordinates) ? r.coordinates.filter((o) => o && typeof o === 'object').slice(0, MAX_COORDINATES) : []
  };
  if (out.profile.miiData !== null && typeof out.profile.miiData !== 'string') throw new Error('Dati Mii non validi nel salvataggio.');
  if (typeof out.profile.name !== 'string') out.profile.name = '';
  const pl = out.profile.personality as unknown;
  out.profile.personality = Array.isArray(pl) && pl.length === 5 && pl.every((x) => Number.isInteger(x) && x >= 1 && x <= 8) ? (pl as number[]) : null;
  out.profile.name = out.profile.name.slice(0, 10);
  return out;
}

const DB = 'miitomo-web', STORE = 'save', KEY = 'slot0';
function openDb(): Promise<IDBDatabase> { return openMtwDb(); }
export async function loadSave(defaults: SaveData): Promise<SaveData | null> {
  try {
    const db = await openDb();
    const v = await new Promise<unknown>((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(KEY); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    if (v) return migrate(v, defaults);
  } catch (e) { console.warn('salvataggio non leggibile', e); }
  return null;
}
export async function writeSave(s: SaveData): Promise<boolean> {
  try {
    s.updated = new Date().toISOString();
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(structuredClone(s), KEY);
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    return true;
  } catch (e) { console.warn('salvataggio non riuscito', e); return false; }
}
export async function deleteSave(): Promise<void> {
  try { const db = await openDb(); db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY); } catch { /* */ }
}

export const b64 = {
  enc: (u: Uint8Array) => btoa(String.fromCharCode(...u)),
  dec: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
};
