/**
 * Wardrobe data for PLAY (M10): original item names, thumbnails and category icons, all from the user's files.
 *
 *  names       message EUit Client/System/Clothes/Wearname.msbt (APK; updated copy in the dated CDN "-message" zip).
 *              Label WNAME<c><id:6><00>. Category digit c: 1 all, 2 tops, 3 bottomsA, 4 bottomsB, 5 shoes, 6 acce,
 *              7 headwear, 8 topslong — DEDUCED from the names (e.g. 7 "Copricapo da orso", 1 "Costume da orso") and
 *              the counts per digit, which match the CDN catalogue per category (484/467, 444/410, 280/273, ...).
 *  thumbnails  asset/capture2/small/character/<dir>/<dir><id>_<colour:2>.webp (dated CDN zips, asset_capture2_item)  VERIFIED (data)
 *  icons       userData/closet_icon_data.xml categoryBtn00..08 → commonResRoot icon00 atlas (APK)              VERIFIED (data)
 *              icon403 tops, 404 bottomsA, 405 headwear, 406 bottomsB, 407 shoes, 408 acce, 409 all — DEDUCED from the art.
 */
import { vfs } from '../assets/vfs';
import { line, label } from '../room/RoomText';
import { CAT_DIR, Category, variantStems, variantXml } from '../body/Wardrobe';
import { sprite } from '../room/LayoutSprites';

const NAME_DIGIT: Record<Category, number> = { all: 1, tops: 2, bottomsA: 3, bottomsB: 4, shoes: 5, acce: 6, headwear: 7, topslong: 8 };
const WEARNAME = 'System/Clothes/Wearname.msbt';
const ICON_DIR = 'asset/layout/common/Published-iOS/commonResRoot/texture/resources-iphone/';
const ICON: Partial<Record<Category, string>> = { tops: 'icon403V50.png', topslong: 'icon403V50.png', bottomsA: 'icon404V50.png', headwear: 'icon405V50.png', bottomsB: 'icon406V50.png', shoes: 'icon407V50.png', acce: 'icon408V50.png', all: 'icon409V50.png' };
/** Closet tab order (icons categoryBtn02..08 order; topslong shares the tops icon). */
export const CLOSET_ORDER: Category[] = ['tops', 'topslong', 'all', 'bottomsA', 'headwear', 'bottomsB', 'shoes', 'acce'];

/**
 * The original closet tabs (userData/closet_icon_data.xml categoryBtn00..08, VERIFIED): icon-only buttons.
 *  00 icon416 (clock)       recent items — sorted by delivery date, newest first (meaning DEDUCED from the icon)
 *  01 icon536 (shirt + ★)   favourite outfits ("Preferito", shop/text00 noHaveCoordinate "Seleziona ★ per creare un completo")
 *  02 icon403 tops — also holds topslong, which has no button of its own (DEDUCED: 9 buttons, 8 categories + 2 views)
 *  03 icon409 all · 04 icon404 bottomsA · 05 icon405 headwear · 06 icon406 bottomsB · 07 icon407 shoes · 08 icon408 acce
 * The tab names below are WEB ADAPTATION (tooltips / screen readers): the original buttons have no text.
 */
export type ClosetTab = 'recent' | 'fav' | 'tops' | 'all' | 'bottomsA' | 'headwear' | 'bottomsB' | 'shoes' | 'acce';
export const CLOSET_TABS: { id: ClosetTab; icon: string; cats: Category[]; name: string }[] = [
  { id: 'recent', icon: 'icon416V50.png', cats: [], name: 'Recenti' },
  { id: 'fav', icon: 'icon536V50.png', cats: [], name: 'Preferito' },
  { id: 'tops', icon: 'icon403V50.png', cats: ['tops', 'topslong'], name: 'Maglie' },
  { id: 'all', icon: 'icon409V50.png', cats: ['all'], name: 'Completi' },
  { id: 'bottomsA', icon: 'icon404V50.png', cats: ['bottomsA'], name: 'Pantaloni / gonne' },
  { id: 'headwear', icon: 'icon405V50.png', cats: ['headwear'], name: 'Cappelli' },
  { id: 'bottomsB', icon: 'icon406V50.png', cats: ['bottomsB'], name: 'Calze / gambe' },
  { id: 'shoes', icon: 'icon407V50.png', cats: ['shoes'], name: 'Scarpe' },
  { id: 'acce', icon: 'icon408V50.png', cats: ['acce'], name: 'Accessori' }
];
export const tabIcon = (file: string) => sprite('icon00', file, ICON_DIR)?.url ?? null;
/** Generic commonResRoot icon (icon00 atlas), e.g. for the bottom bar. */
export const commonIcon = (file: string) => sprite('icon00', file, ICON_DIR)?.url ?? null;
export const commonTexture = (file: string) => sprite('texture00', file, ICON_DIR)?.url ?? null;
/**
 * Room bottom bar (RoomMenuRootNode, libcocos2dcpp .rodata 0x1895b19..0x1895c2c — REVERSED table): icons
 * icon500V50 home, icon513V45 my page / answers, icon202V45 friends, icon400V45 shop, icon515V45 menu, icon514V45 profile.
 * Button = parts/layer1/tabBtn00.ccbi: base bulletTab00 (texture00), runtime icon sprites baseSprite00/01, label title00
 * (font nintendoPSeurat-M003). The order of the user bar follows the icon table (DEDUCED).
 */
export const BAR_ICON = { home: 'icon500V50.png', page: 'icon513V45.png', friends: 'icon202V45.png', shop: 'icon400V45.png', menu: 'icon515V45.png', profile: 'icon514V45.png' } as const;

export function itemName(cat: Category, id: string): { text: string; original: boolean } {
  const n = /^\d{4}$/.test(id) ? Number(id) : NaN;
  if (!isNaN(n)) {
    const key = `WNAME${NAME_DIGIT[cat]}${String(n).padStart(6, '0')}00`;
    if (line(WEARNAME, key)) return { text: label(WEARNAME, key, id), original: true };
  }
  return { text: `${CAT_DIR[cat]}${id}`, original: false };
}

const thumbs = new Map<string, string | null>();
export const thumbKey = (cat: Category, id: string, colour = 0) => `asset/capture2/small/character/${CAT_DIR[cat]}/${CAT_DIR[cat]}${id}_${String(colour).padStart(2, '0')}.webp`;
export const itemKey = (cat: Category, id: string) => `asset/model/character/${CAT_DIR[cat]}/output/${CAT_DIR[cat]}${id}`;
export function thumb(cat: Category, id: string, colour = 0): string | null {
  const key = thumbKey(cat, id, colour);
  if (!thumbs.has(key)) { const b = vfs.get(key); if (!b && vfs.has(key)) return null; thumbs.set(key, b ? URL.createObjectURL(new Blob([b], { type: 'image/webp' })) : null); }
  return thumbs.get(key)!;
}
export function clearClosetCache() { for (const u of thumbs.values()) if (u) URL.revokeObjectURL(u); thumbs.clear(); }

export function icon(cat: Category): string | null { const n = ICON[cat]; return n ? sprite('icon00', n, ICON_DIR)?.url ?? null : null; }

/** Colour variants of an item (from its colour list), as CSS rgb() strings. */
export function colours(cat: Category, id: string): string[] {
  try { const stem = variantStems(cat, id)[0]; return variantXml(cat, id, stem).colorList.map((rgb) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`); } catch { return []; }
}

// ---------------- room skins (Arreda stanza) ----------------
/**
 * Names: System/WallPaper/WallpaperName.msbt, label PNAME<11 wall | 12 floor><id:4><variant:2> (e.g. PNAME11000000 =
 * rmWl0000 AL00 "Parete a tinta unita (azzurro)", the blue default wall) — DEDUCED from the labels, confirmed by the
 * default room. Thumbnails: asset/capture2/large/room/room{Wall,Floor}/rm{Wl,Fl}<id>_AL<vv>.webp (dated CDN zips).
 */
export function skinName(kind: 'wall' | 'floor', id: string, variant: number): { text: string; original: boolean } {
  const key = `PNAME${kind === 'wall' ? 11 : 12}${id}${String(variant).padStart(2, '0')}`;
  const rel = 'System/WallPaper/WallpaperName.msbt';
  return line(rel, key) ? { text: label(rel, key, key), original: true } : { text: `${kind === 'wall' ? 'rmWl' : 'rmFl'}${id} AL${String(variant).padStart(2, '0')}`, original: false };
}
export const skinThumbKey = (kind: 'wall' | 'floor', id: string, variant: number) => `asset/capture2/large/room/${kind === 'wall' ? 'roomWall/rmWl' : 'roomFloor/rmFl'}${id}_AL${String(variant).padStart(2, '0')}.webp`;
/** Number of colour variants of a skin, from the thumbnail names (no package needs to be read). 0 = no thumbnails. */
export function skinVariantCount(kind: 'wall' | 'floor', id: string): number { let n = 0; while (n < 32 && vfs.has(skinThumbKey(kind, id, n))) n++; return n; }
export function skinThumb(kind: 'wall' | 'floor', id: string, variant: number): string | null {
  const k = skinThumbKey(kind, id, variant);
  if (!thumbs.has(k)) { const b = vfs.get(k); if (!b && vfs.has(k)) return null; thumbs.set(k, b ? URL.createObjectURL(new Blob([b], { type: 'image/webp' })) : null); }
  return thumbs.get(k)!;
}
