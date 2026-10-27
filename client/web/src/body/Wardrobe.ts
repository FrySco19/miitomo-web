/**
 * Miitomo wardrobe: catalogue of the user-imported clothing packages + outfit resolution.
 *
 * Evidence (docs/reverse-engineering/MII.md § M6):
 *  VERIFIED (data / binary)
 *   - file names: "<cat>%04d%s/<cat>%04d%s%s.Mdl.pod" (libcocos2dcpp.so .rodata 0x18a5450..): first %s = gender suffix of
 *     the 9999 base items ("M"/"F"), second %s = state suffix from the table {In, St, Wd, Hi, Lo} (0x1b75500).
 *   - per-item metadata from *.Mdl_model.xml / ArchModelMetadata: Type, Silhouette, State, Gender, PartRange, Exclusion.
 *   - area materials, in this order (0x1aa3fc4): mtArChest, mtArWaist, mtArLoWaist, mtArHip, mtArUpLeg0..2, mtArKnee,
 *     mtArLoLeg0..2, mtArFoot. 0x5cb5cc builds a 12-entry mask from the item's PartRange [begin..end] and calls a
 *     per-material method for every area OUTSIDE the range (=> area meshes outside the item's own range are hidden).
 *   - colour variants: UserData/ColorList has one entry per *_ALnn albedo texture (counts match on all 40 samples).
 *   - default (base) items listed in xml/other_clothes.xml: bodyTops9999 (M/F), bodyBottomsA9999, bodyBottomsB9999...
 *  INFERRED (not yet traced in the binary, marked in the UI diagnostics):
 *   - Exclusion semantics: equipping X removes worn items whose Type is in X's CategoryList unless their Silhouette is
 *     in AcceptableSilhoette; checked in both directions.
 *   - Variant choice: tops In/St/Wd and bottomsA Hi/Lo from a "tuck in" choice and the bottoms' silhouette.
 *   - Base-item occlusion: base 9999 items hide area meshes covered by the PartRange of a worn item.
 *   - PartRange names map to the material table by suffix ("areaFoot" -> mtArFoot); "areaOther" is not in the table.
 */
import { vfs, openModelPackage, text, FileMap } from '../assets/vfs';
import { parseModelXml, AgxModelXml } from '../agx/xml';
import type { AccessoryData } from '../agx/xml';
import type { BodyScale } from './BodyScale';
import * as THREE from 'three';


export const CATEGORIES = ['headwear', 'tops', 'topslong', 'bottomsA', 'bottomsB', 'shoes', 'acce', 'all'] as const;
export type Category = typeof CATEGORIES[number];
export const CAT_DIR: Record<Category, string> = {
  headwear: 'headwear', tops: 'bodyTops', topslong: 'bodyTopslong', bottomsA: 'bodyBottomsA', bottomsB: 'bodyBottomsB',
  shoes: 'bodyShoes', acce: 'bodyAcce', all: 'bodyAll'
};
export const CAT_LABEL: Record<Category, string> = {
  headwear: 'Cappello', tops: 'Maglia', topslong: 'Maglia lunga', bottomsA: 'Pantaloni / gonna', bottomsB: 'Calze / gambe',
  shoes: 'Scarpe', acce: 'Accessorio', all: 'Completo'
};
export const AREA_MATERIALS = ['mtArChest', 'mtArWaist', 'mtArLoWaist', 'mtArHip', 'mtArUpLeg0', 'mtArUpLeg1', 'mtArUpLeg2',
  'mtArKnee', 'mtArLoLeg0', 'mtArLoLeg1', 'mtArLoLeg2', 'mtArFoot'];

export function areaIndex(area: string): number { return AREA_MATERIALS.indexOf('mtAr' + area.replace(/^area/, '')); }
export function rangeMask(range: [string, string] | null): boolean[] {
  const m = new Array<boolean>(12).fill(false);
  if (!range) return m;
  const a = areaIndex(range[0]), b = areaIndex(range[1]);
  if (a < 0 || b < 0) return m;
  for (let i = a; i <= b; i++) m[i] = true;
  return m;
}

export interface CatalogItem { cat: Category; id: string; path: string; }
/** Items present in the local vfs (only what the user imported). */
export function catalog(): Map<Category, CatalogItem[]> {
  const out = new Map<Category, CatalogItem[]>(CATEGORIES.map((c) => [c, []]));
  for (const k of vfs.keys()) {
    const m = /^asset\/model\/character\/(\w+?)\/output\/\1(\d{4}[MF]?)$/.exec(k);
    if (!m) continue;
    const cat = (Object.keys(CAT_DIR) as Category[]).find((c) => CAT_DIR[c] === m[1]);
    if (cat) out.get(cat)!.push({ cat, id: m[2], path: k });
  }
  for (const l of out.values()) l.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

// --- per-package cache (unzipped files + parsed XML per variant stem) ---
const pkgCache = new Map<string, FileMap>();
const xmlCache = new Map<string, AgxModelXml>();
export function itemPackage(cat: Category, id: string): FileMap {
  const path = `asset/model/character/${CAT_DIR[cat]}/output/${CAT_DIR[cat]}${id}`;
  let p = pkgCache.get(path);
  if (!p) { p = openModelPackage(path); pkgCache.set(path, p); }
  return p;
}
export function variantStems(cat: Category, id: string): string[] {
  const pkg = itemPackage(cat, id);
  return [...pkg.keys()].map((k) => /([^/]+)\.Mdl\.pod$/.exec(k)?.[1]).filter((x): x is string => !!x).sort();
}
export function variantXml(cat: Category, id: string, stem: string): AgxModelXml {
  const key = `${cat}/${stem}`;
  let x = xmlCache.get(key);
  if (!x) {
    const pkg = itemPackage(cat, id);
    const p = [...pkg.keys()].find((k) => k.endsWith(`${stem}.Mdl_model.xml`));
    if (!p) throw new Error(`XML mancante: ${stem}`);
    x = parseModelXml(text(pkg.get(p)!)); xmlCache.set(key, x);
  }
  return x;
}
export function clearWardrobeCache() { pkgCache.clear(); xmlCache.clear(); }

// --- outfit ---
export interface OutfitSlot { id: string; color: number; }
export type Outfit = Partial<Record<Category, OutfitSlot>> & { tuck?: boolean };
export interface ResolvedPart {
  cat: Category; id: string; stem: string; color: number; base: boolean; xml: AgxModelXml; mask: boolean[];
}
export interface Resolution { parts: ResolvedPart[]; notes: string[]; removed: string[]; }

const STATE_SUFFIX = { in: 'In', st: 'St', wd: 'Wd', hi: 'Hi', lo: 'Lo' } as const;

function pickStem(cat: Category, id: string, want: string[]): string {
  const stems = variantStems(cat, id);
  const base = `${CAT_DIR[cat]}${id}`;
  for (const w of want) { const s = base + w; if (stems.includes(s)) return s; }
  return stems.includes(base) ? base : stems[0];
}

/** Applies exclusions, picks variants and base items, computes visible-area masks. */
export function resolveOutfit(outfit: Outfit, gender: 'm' | 'f'): Resolution {
  const notes: string[] = [], removed: string[] = [];
  const have = catalog();
  const worn = new Map<Category, OutfitSlot>();
  for (const c of CATEGORIES) {
    const s = outfit[c];
    if (s && have.get(c)!.some((i) => i.id === s.id)) worn.set(c, s);
    else if (s) notes.push(`${CAT_LABEL[c]} ${s.id}: pacchetto non importato`);
  }
  const silhouette = (c: Category) => { const s = worn.get(c)!; return variantXml(c, s.id, pickStem(c, s.id, ['St', 'Lo', ''])).meta?.silhouette ?? ''; };
  // Exclusion (both directions). The game resolves conflicts by equip order (latest wins); without an equip history
  // we use a fixed priority (INFERRED): the higher-priority item stays, the other is taken off.
  const order: Category[] = ['all', 'topslong', 'tops', 'bottomsA', 'bottomsB', 'shoes', 'acce', 'headwear'];
  for (const c of order) {
    if (!worn.has(c)) continue;
    const meta = variantXml(c, worn.get(c)!.id, pickStem(c, worn.get(c)!.id, ['St', 'Lo', ''])).meta;
    for (const ex of meta?.exclusion ?? []) {
      const other = ex.type as Category;
      if (other === c || !worn.has(other) || !worn.has(c)) continue;
      if (ex.acceptable.length && ex.acceptable.includes(silhouette(other))) continue;
      const loser = order.indexOf(c) < order.indexOf(other) ? other : c, winner = loser === c ? other : c;
      removed.push(`${CAT_LABEL[loser]} ${worn.get(loser)!.id} (in conflitto con ${CAT_LABEL[winner]} ${worn.get(winner)!.id})`);
      worn.delete(loser);
    }
  }
  const allWorn = worn.has('all');
  // Base items (other_clothes.xml lists 9999 as default tops/bottomsA/bottomsB)
  const base = new Set<Category>();
  const baseIds: Partial<Record<Category, string>> = { tops: `9999${gender === 'f' ? 'F' : 'M'}`, bottomsA: '9999', bottomsB: '9999' };
  if (!allWorn) for (const c of ['tops', 'bottomsA', 'bottomsB'] as Category[]) {
    if (worn.has(c) || (c === 'tops' && worn.has('topslong'))) continue;
    if (c === 'bottomsA' && worn.has('topslong')) continue;
    const id = baseIds[c]!;
    if (have.get(c)!.some((i) => i.id === id)) { worn.set(c, { id, color: 0 }); base.add(c); }
    else notes.push(`base ${CAT_DIR[c]}${id} non importato`);
  }
  // Variant choice — REVERSED from the outfit composer 0x5cd220 (outfit struct at AFLObject+0xe0):
  //   ids int16 +0x3e all, +0x40 topslong, +0x42 tops, +0x44 bottomsA, +0x46 bottomsB, +0x48 shoes, +0x4a acce;
  //   colours = 4-bit nibbles at +0x38; byte +0x4e = tuck flag.
  //   tops state = tuck ? In : St ; male with no tops (base 9999M) -> In ; bottomsA = (tops In) ? Hi : Lo ;
  //   if the tops file for that state is missing: swap In<->St and Hi<->Lo ;
  //   if the bottoms metadata field +0x8c == 2 (DEDUCED: Silhouette "wide") and tops field +0x98 != 1: tops -> Wd.
  const tuck = !!outfit.tuck;
  let topsIn = tuck || (gender === 'm' && base.has('tops'));
  const tops = worn.get('tops');
  if (tops) {
    const stems = variantStems('tops', tops.id), b = `${CAT_DIR.tops}${tops.id}`;
    if (!stems.includes(b + (topsIn ? 'In' : 'St'))) topsIn = !topsIn;
  }
  const bottomsWide = worn.has('bottomsA') && silhouette('bottomsA') === 'wide';
  const parts: ResolvedPart[] = [];
  for (const c of CATEGORIES) {
    const s = worn.get(c); if (!s) continue;
    let want = [''];
    if (c === 'tops') want = bottomsWide ? [STATE_SUFFIX.wd, topsIn ? STATE_SUFFIX.in : STATE_SUFFIX.st] : [topsIn ? STATE_SUFFIX.in : STATE_SUFFIX.st];
    if (c === 'bottomsA') want = topsIn ? [STATE_SUFFIX.hi, STATE_SUFFIX.lo] : [STATE_SUFFIX.lo, STATE_SUFFIX.hi];
    const stem = pickStem(c, s.id, want);
    const xml = variantXml(c, s.id, stem);
    parts.push({ cat: c, id: s.id, stem, color: s.color, base: base.has(c), xml, mask: rangeMask(xml.partRange) });
  }
  // Base-item occlusion (INFERRED): a base item does not draw areas covered by a non-base worn item.
  const covered = new Array<boolean>(12).fill(false);
  for (const p of parts) if (!p.base && p.cat !== 'headwear' && p.cat !== 'acce') p.mask.forEach((v, i) => { if (v) covered[i] = true; });
  for (const p of parts) if (p.base) p.mask = p.mask.map((v, i) => v && !covered[i]);
  return { parts, notes, removed };
}

/** Material visibility for a resolved part: area materials only inside the mask; non-area materials always drawn. */
export function materialVisible(p: ResolvedPart, material: string): boolean {
  const i = AREA_MATERIALS.indexOf(material);
  return i < 0 ? true : p.mask[i];
}

// --- accessories ---
/**
 * RootType -> joint. REVERSED: the only 8-entry joint-name pointer table in .data (0x1b7512c) holds exactly the
 * accessory roots, in this order. Index = RootType is DEDUCED (the parser stores RootType as int at +0x48, 0x532468).
 */
export const ACCE_ROOTS = ['jointRoot', 'Skl_Root', 'Shadow', 'Item_Wrist_R', 'Head', 'Acce_Spine_2', 'Acce_Spine_2_R', 'Acce_Spine_2_L'];
/**
 * Accessory placement (REVERSED from 0x5d45dc..0x5d46b0; defaults from 0x5d464c when no Accessory block):
 *   tf_i = TranslateScaleWeightOffset + A_i * TranslateScaleWeight      (per axis, A = body scaleA)
 *   s    = (1 - ScaleWeight) + A.x * ScaleWeight
 *   if SmallEnabled and A.y < SmallStartValue: s *= 1 - SmallRatio * (SmallStartValue - A.y)
 * Which object the per-axis factors multiply (mesh translation in the root-joint frame) is DEDUCED.
 */
export function accessoryTransform(acc: AccessoryData | null, bs: BodyScale | null) {
  const a = acc ?? { rootType: 0, translateScaleWeight: 0, translateScaleWeightOffset: 0.1, scaleWeight: 0.8, smallEnabled: false, smallRatio: 1.5, smallStartValue: 0.6 };
  const A = bs?.a ?? new THREE.Vector3(1, 1, 1);
  const tf = new THREE.Vector3(A.x, A.y, A.z).multiplyScalar(a.translateScaleWeight).addScalar(a.translateScaleWeightOffset);
  let s = (1 - a.scaleWeight) + A.x * a.scaleWeight;
  if (a.smallEnabled && A.y < a.smallStartValue) s *= 1 - a.smallRatio * (a.smallStartValue - A.y);
  return { root: ACCE_ROOTS[a.rootType] ?? 'jointRoot', tf, s };
}
