/**
 * Local virtual file system for user-supplied original assets.
 *
 * Accepted inputs (all stay in this browser, nothing is uploaded or bundled):
 *  - the Miitomo APK (only the entries this client needs are kept),
 *  - original CDN asset zips (asset_env*.zip, asset_model_character_animation_output*.zip, ...),
 *  - AFLResHigh*.dat (handled by resource.ts).
 * Paths are normalised to the game's runtime layout ("asset/...", "shader/...", "userData/...").
 */
import { unzipSync } from 'fflate';
import { openMtwDb, txDone, reqP } from './db';

export type FileMap = Map<string, Uint8Array>;

/**
 * Two tiers (M13, performance): the full CDN set keeps ~735 MB of files, too much for one tab's memory.
 *  hot  — small, needed at boot or every frame (shaders, env, animations, texts, sounds, layouts, fonts...): in memory,
 *         cached as one record ('vfs'/'files').
 *  cold — the many item / room-skin model packages and the capture2 thumbnails (~700 MB with the full set): one
 *         IndexedDB record per path ('blobs'); only the key list is in memory, the data is loaded on demand into a
 *         small LRU. A synchronous get() of a cold file that is not loaded returns undefined and records the miss
 *         (vfs.misses); callers that can wait use vfs.ensure(keys) first, rebuild() retries after loading the misses.
 */
const COLD = [
  /^asset\/model\/character\/(bodyAll|bodyTops|bodyTopslong|bodyBottomsA|bodyBottomsB|bodyShoes|bodyAcce|headwear)\/output\/[^/]+$/,
  /^asset\/model\/room\/(roomFloor|roomWall)\/output\/[^/]+$/,
  /^asset\/capture2\//,
  // M17: scene music (sound.zip + sound_BGM_* zips, ~30 tracks): loaded when a scene plays it
  /^sound\/BGM_(?!MiiWatch_Normal_Day)[^/]+\.mp3$/
];
/** Items always needed (base body, default room): stay hot. */
const HOT_ALWAYS = new Set(['asset/model/character/bodyAll/output/bodyAll0400', 'asset/model/room/roomWall/output/rmWl0000', 'asset/model/room/roomFloor/output/rmFl0000']);
export const isCold = (k: string) => !HOT_ALWAYS.has(k) && COLD.some((re) => re.test(k));
const LRU_BYTES = 96 * 1024 * 1024;

class TieredVfs {
  private hot: FileMap = new Map();
  private coldKeys = new Set<string>();
  private lru = new Map<string, Uint8Array>(); private lruBytes = 0;
  private pendingCold = new Map<string, Uint8Array>();   // imported, not yet written to IndexedDB
  readonly misses = new Set<string>();
  get size() { return this.hot.size + this.coldKeys.size; }
  has(k: string) { return this.hot.has(k) || this.coldKeys.has(k); }
  *keys(): IterableIterator<string> { yield* this.hot.keys(); for (const k of this.coldKeys) if (!this.hot.has(k)) yield k; }
  get(k: string): Uint8Array | undefined {
    const h = this.hot.get(k); if (h) return h;
    if (!this.coldKeys.has(k)) return undefined;
    const p = this.pendingCold.get(k); if (p) return p;
    const c = this.lru.get(k);
    if (c) { this.lru.delete(k); this.lru.set(k, c); return c; }
    this.misses.add(k);
    return undefined;
  }
  set(k: string, d: Uint8Array) {
    if (isCold(k)) { this.coldKeys.add(k); this.pendingCold.set(k, d); this.lruDrop(k); }
    else { this.hot.set(k, d); }
    return this;
  }
  delete(k: string) { this.lruDrop(k); this.pendingCold.delete(k); this.coldKeys.delete(k); return this.hot.delete(k); }
  clear() { this.hot.clear(); this.coldKeys.clear(); this.lru.clear(); this.lruBytes = 0; this.pendingCold.clear(); this.misses.clear(); }
  /** True when every key is readable synchronously right now. */
  ready(keys: string[]) { return keys.every((k) => !this.coldKeys.has(k) || this.hot.has(k) || this.pendingCold.has(k) || this.lru.has(k)); }
  /** Loads cold files into the LRU (missing keys are ignored). */
  async ensure(keys: Iterable<string>): Promise<number> {
    const need = [...new Set(keys)].filter((k) => this.coldKeys.has(k) && !this.ready([k]));
    if (!need.length) return 0;
    const db = await openMtwDb(); const st = db.transaction('blobs').objectStore('blobs');
    const got = await Promise.all(need.map((k) => reqP(st.get(k)).catch(() => undefined)));
    need.forEach((k, i) => { const d = got[i] as Uint8Array | undefined; if (d) this.lruPut(k, d); this.misses.delete(k); });
    return need.length;
  }
  /** Writes imported cold files to IndexedDB and drops them from memory (call after each imported source file). */
  async flushCold(): Promise<void> {
    if (!this.pendingCold.size) return;
    const db = await openMtwDb(); const tx = db.transaction('blobs', 'readwrite'); const st = tx.objectStore('blobs');
    for (const [k, d] of this.pendingCold) st.put(d, k);
    await txDone(tx);
    this.pendingCold.clear();
  }
  hotEntries() { return [...this.hot.entries()]; }
  setHotRaw(k: string, d: Uint8Array) { this.hot.set(k, d); }
  addColdKeys(keys: Iterable<string>) { for (const k of keys) this.coldKeys.add(String(k)); }
  stats() { return { hot: this.hot.size, hotBytes: [...this.hot.values()].reduce((a, d) => a + d.byteLength, 0), cold: this.coldKeys.size, lru: this.lru.size, lruBytes: this.lruBytes, pending: this.pendingCold.size }; }
  private lruPut(k: string, d: Uint8Array) {
    this.lruDrop(k); this.lru.set(k, d); this.lruBytes += d.byteLength;
    for (const [ok, od] of this.lru) { if (this.lruBytes <= LRU_BYTES || ok === k) break; this.lru.delete(ok); this.lruBytes -= od.byteLength; }
  }
  private lruDrop(k: string) { const o = this.lru.get(k); if (o) { this.lru.delete(k); this.lruBytes -= o.byteLength; } }
}
export const vfs = new TieredVfs();
/** A cold file that is imported but not loaded yet (not an error: the caller loads it and retries). */
export class ColdMiss extends Error { constructor(readonly path: string) { super(`in caricamento: ${path}`); this.name = 'ColdMiss'; } }

/** Which APK entries we keep (everything else in the 36 MB APK is ignored). */
const APK_KEEP = [
  /^assets\/shader\/LUT\.(vsh|fsh)$/,
  /^assets\/shader\/MiiDefaultShader\.(vsh|fsh)$/,
  /^assets\/asset\/env\/lut\/[^/]+\.(tga|xml)$/,
  /^assets\/asset\/model\/character\/(bodyAll|headwear)\/output\/[^/]+$/,
  /^assets\/asset\/model\/room\/(roomFloor|roomWall)\/output\/[^/]+$/,
  /^assets\/asset\/capture2\/large\/character\/bodyAll\/[^/]+\.webp$/,
  /^assets\/userData\/[^/]+\.xml$/,
  // M8: sound tables (the APK has no room texts: those come from the CDN message zip), sound effects, UI font, room layout sprites
  /^assets\/message\/Release\/Console\/JPja\/Client\/Sound\/(Action|BGM|Wave)\/(anim|common|bgm|emotion|bundle|effect|face)\.msbt$/,
  /^assets\/sound\/[^/]+\.(wav|mp3)$/,
  /^assets\/asset\/layout\/font\/nintendoPSeurat-[BM]003\.ttf$/,
  // M9: boot / tutorial / common layouts and the APK's own EUit texts (boot, tutorial, launch tips, clothes names...)
  /^assets\/asset\/layout\/(boot|tutorial|common|system|menu)\/Published-iOS\/.+$/,
  /^assets\/message\/Release\/Console\/EUit\/Client\/.+\.msbt$/,
  /^assets\/asset\/layout\/room\/Published-iOS\/texture-room\/resources-iphone\/texture0[0-3]\.(pvr\.ccz|plist)$/,
  // M14: particle effects (nw::eft2 binary)
  /^assets\/asset\/effect\/effect\.ptcl$/
];
/** CDN zip entries we keep. */
const CDN_KEEP = [
  /^asset\/env\/(scene|mii|lut)\/[^/]+$/,
  /^asset\/model\/character\/animation\/output\/anim[A-Za-z_]+\.Anim\.pod$/,
  /^asset\/model\/room\/roomBaseComponents$/,
  /^asset\/model\/room\/(roomFloor|roomWall)\/output\/[^/]+$/,
  /^asset\/model\/character\/(bodyAll|bodyTops|bodyTopslong|bodyBottomsA|bodyBottomsB|bodyShoes|bodyAcce|headwear|bodyMannequin)\/output\/[^/]+$/,
  /^asset\/model\/character\/bodyShadow\/output$/,
  /^asset\/model\/colorlist\/[^/]+$/,
  /^xml\/other_clothes\.xml$/,
  // M8 (message_Release_Console_EUit.zip, sound.zip, asset_layout_v2-0_room_Published-iOS.zip)
  /^message\/Release\/Console\/EUit\/Client\/.+\.msbt$/,
  /^sound\/(BGM_[^/]+\.mp3|[^/]+\.wav)$/,   // M17: every scene BGM (Action/bgm.msbt), not only the room
  /^asset\/layout\/room\/Published-iOS\/texture-room\/resources-iphone\/texture0[0-3]\.(pvr\.ccz|plist)$/,
  // M10: item / room thumbnails (dated CDN zips, asset_capture2_item)
  /^asset\/capture2\/(small|large)\/(character|room)\/[^/]+\/[^/]+\.webp$/,
  // M12 Miifoto: backgrounds, stamps, templates, pose cameras, Latin photo fonts, MessageStudio project (attributes)
  /^asset\/archCamera\/.+\.(webp|dat)$/,
  /^asset\/model\/camera\/output\/[^/]+\.xml$/,
  /^asset\/layout\/font\/(NINEN___|MLSBQ|ANNUBI_|INDYR__|JOT1R__|LYNDAR_|PAREB___|REG-JOE|TECHNHB_|CUCKOO)\.ttf$/,
  /^message\/Release\/Arch\.msbp$/,
  // M13: talking gestures / faces (EmotionExpression: rules, expressions, emotions, faces, Italian word lists)
  /^message\/Release\/Console\/JPja\/EmotionExpression\/(Emotion|Expression|Face|ExpressionRule\/Rule|Wordlist_it\/WLit_[A-Za-z_]+)\.msbt$/,
  // M14: effect descriptors (EmitterSet name, bone, offset)
  /^asset\/effect\/output\/character\/[^/]+\.xml$/,
  // M17 Mii Studio editor: part icons, colour chips, category buttons (CDN asset_layout_v2-3_miiStudio)
  /^asset\/layout\/miiStudio\/Published-iOS\/texture-miiStudio\/resources-iphone\/(miiparts|colors|ui)\.(pvr\.ccz|plist)$/,
  // M15 shop: interior model, layout atlases, top banners
  /^asset\/model\/shop\/output$/,
  /^asset\/layout\/shop\/Published-iOS\/texture-shop\/resources-iphone\/texture0[0-9]\.(pvr\.ccz|plist)$/,
  /^asset\/shopBanner2\/[^/]+\.webp$/
];

export interface ImportReport { source: string; kept: number; }

/**
 * Source files worth reading, by file name (the CDN zip names spell their content path). Used by the local launcher
 * import so that the ~2,600 preserved zips are not all read: only those that can hold kept entries.
 */
const WANTED_SOURCE = [
  /\.apk$/i, /AFLResHigh/i, /^asset_env/, /^asset_model_character_animation_output/, /^asset_model_room_/,
  /^asset_model_character_(bodyAll|bodyTops|bodyTopslong|bodyBottomsA|bodyBottomsB|bodyShoes|bodyAcce|headwear|bodyMannequin|bodyShadow)/,
  /^asset_model_colorlist/, /^asset_model_camera/, /^xml_other_clothes/, /^asset_archCamera/, /^asset_layout_font/, /^asset_layout_v[\d-]+_room_/,
  /^message_Release_Arch_msbp/, /^asset_effect_output/, /^asset_model_shop_output/, /^asset_shopBanner2_/, /^asset_layout_v[\d-]+_shop_/, /^asset_layout_v[\d-]+_miiStudio_/, /^message_Release_Console_EUit/, /^message_Release_Console_JPja_EmotionExpression/,
  /^sound(_[A-Za-z0-9-]+)*\.zip$/,   // M17 fix: sound_BGM_MiiWatch_Friend_Cool_mp3.zip etc. have several "_" parts
  // item / room thumbnails (closet, shop, Arreda stanza) and the updated clothes names: the dated weekly zips and
  // asset_capture2_item. FIX 0.1.2: this rule had slipped into the comment above, so the local import (desktop app,
  // serve-local) never read them and every closet / room thumbnail was missing; picking the files by hand was not affected.
  /^\d{8}[a-z0-9]+(webp|-message)?\.zip$/, /^asset_capture2/,
];
/**
 * Version of the keep rules. When a version adds entries to keep from sources the user may already have imported,
 * those sources must be read again: REIMPORT lists them per version (by file name).
 *   2 (M13/M14): EmotionExpression + miiStudio zips are new files; the APK now also keeps effect.ptcl and the
 *   effect XML zip is newly wanted.
 *   3 (M14b): the APK also keeps the effect / face sound tables (Sound/Action/effect.msbt, face.msbt).
 *   4 (M15): dated weekly zips are read again to record item arrival dates (meta/item-dates.json).
 */
export const KEEP_VERSION = 5;
const REIMPORT: Record<number, RegExp[]> = { 2: [/\.apk$/i, /^asset_effect_output/], 3: [/\.apk$/i], 4: [/^\d{8}[a-z0-9]+webp\.zip$/], 5: [/^asset_layout_v[\d-]+_miiStudio_/, /^sound\.zip$/] };
export function needsReimport(name: string, importedAt: number): boolean {
  const b = name.split(/[\\/]/).pop() ?? name;
  for (let v = importedAt + 1; v <= KEEP_VERSION; v++) if (REIMPORT[v]?.some((re) => re.test(b))) return true;
  return false;
}
export async function loadKeepVersion(): Promise<number> {
  try { const db = await openMtwDb(); const v = await reqP(db.transaction('vfs').objectStore('vfs').get('keepVersion')); return typeof v === 'number' ? v : 1; } catch { return 1; }
}
export async function saveKeepVersion(): Promise<void> {
  try { const db = await openMtwDb(); const tx = db.transaction('vfs', 'readwrite'); tx.objectStore('vfs').put(KEEP_VERSION, 'keepVersion'); await txDone(tx); } catch { /* */ }
}
export const wantedSource = (name: string) => WANTED_SOURCE.some((re) => re.test(name.split(/[\\/]/).pop() ?? name));

export function importZipBytes(name: string, bytes: Uint8Array): ImportReport {
  const isApk = /\.apk$/i.test(name) || hasEntry(bytes, 'AndroidManifest.xml');
  const keep = isApk ? APK_KEEP : CDN_KEEP;
  const entries = unzipSync(bytes, { filter: (f) => keep.some((re) => re.test(f.name)) });
  let kept = 0;
  for (const [path, data] of Object.entries(entries)) {
    if (!data.length) continue;
    vfs.set(isApk ? path.replace(/^assets\//, '') : path, data);
    kept++;
  }
  recordItemDates(name, Object.keys(entries));
  return { source: isApk ? 'APK' : name, kept };
}

/**
 * Item arrival dates (M15): the CDN delivered new clothes in weekly zips named by date (20161110…webp.zip …
 * 20180405…webp.zip, Thursdays) holding their capture2 thumbnails. The first date an item's thumbnail appears is its
 * arrival date — data VERIFIED (zip names), use as the shop's "Arrivi dd/mm" groups DEDUCED. Stored as a small hot
 * JSON file so it survives the cache. 20150101 = the launch set (no arrival group).
 */
export const ITEM_DATES = 'meta/item-dates.json';
function recordItemDates(source: string, paths: string[]) {
  const m = /^(\d{8})[a-z0-9]+webp\.zip$/.exec(source.split(/[\\/]/).pop() ?? ''); if (!m) return;
  const date = m[1];
  let map: Record<string, string> = {};
  try { const b = vfs.get(ITEM_DATES); if (b) map = JSON.parse(new TextDecoder().decode(b)); } catch { map = {}; }
  let changed = false;
  for (const p of paths) {
    const x = /^asset\/capture2\/small\/character\/([^/]+)\/\1(\w+?)_\d{2}\.webp$/.exec(p); if (!x) continue;
    const key = `${x[1]}/${x[2]}`;
    if (!map[key] || map[key] > date) { map[key] = date; changed = true; }
  }
  if (changed) vfs.set(ITEM_DATES, new TextEncoder().encode(JSON.stringify(map)));
}
export function itemDates(): Record<string, string> { try { const b = vfs.get(ITEM_DATES); return b ? JSON.parse(new TextDecoder().decode(b)) : {}; } catch { return {}; } }

function hasEntry(zip: Uint8Array, name: string): boolean {
  // Cheap check of the central directory for a file name.
  const needle = new TextEncoder().encode(name);
  outer: for (let i = Math.max(0, zip.length - 4_000_000); i < zip.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (zip[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Original model files are zips without extension (e.g. bodyAll/output/bodyAll0400). */
export function openModelPackage(path: string): FileMap {
  const z = vfs.get(path);
  if (!z && vfs.has(path)) throw new ColdMiss(path);
  if (!z) throw new Error(`File mancante: ${path}`);
  const out: FileMap = new Map();
  for (const [p, d] of Object.entries(unzipSync(z))) if (d.length) out.set(p, d);
  return out;
}

export const text = (b: Uint8Array) => new TextDecoder('utf-8').decode(b).replace(/^﻿/, '');

// ---- per-viewer cache in IndexedDB ----
const STORE = 'vfs';
const openDb = openMtwDb;
/** Hot files as one record; cold files were already written by flushCold(). */
export async function saveVfs(): Promise<void> {
  try {
    await vfs.flushCold();
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(vfs.hotEntries(), 'files');
    await txDone(tx);
  } catch (e) { console.warn('cache file non salvata', e); }
}
/** Names of the source files already imported (so the local launcher can import only new ones). */
export async function loadSources(): Promise<string[]> {
  try { const db = await openDb(); const v = await reqP(db.transaction(STORE).objectStore(STORE).get('sources')); return Array.isArray(v) ? v : []; } catch { return []; }
}
export async function addSources(names: string[]): Promise<void> {
  try {
    const have = new Set(await loadSources()); names.forEach((n) => have.add(n));
    const db = await openDb(); const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put([...have], 'sources');
    await txDone(tx);
  } catch { /* optional */ }
}
/** Loads the hot record and the cold key list. A cache from before M13 (everything hot) is split once. */
export async function loadVfs(): Promise<number> {
  try {
    const db = await openDb();
    const v = (await reqP(db.transaction(STORE).objectStore(STORE).get('files'))) as [string, Uint8Array][] | undefined;
    let migrated = false;
    if (v) for (const [k, d] of v) { if (isCold(k)) { vfs.set(k, d); migrated = true; } else vfs.setHotRaw(k, d); }
    vfs.addColdKeys((await reqP(db.transaction('blobs').objectStore('blobs').getAllKeys())) as string[]);
    if (migrated) await saveVfs();
    return vfs.size;
  } catch { return 0; }
}
export async function clearVfs(): Promise<void> {
  vfs.clear();
  try {
    const db = await openDb(); const tx = db.transaction([STORE, 'blobs'], 'readwrite');
    tx.objectStore(STORE).delete('files'); tx.objectStore(STORE).delete('sources'); tx.objectStore('blobs').clear();
    await txDone(tx);
  } catch { /* */ }
}
