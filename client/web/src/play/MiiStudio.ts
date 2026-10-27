/**
 * Mii Studio editor data (M17). Edits the FFLiCharInfo (288 B) that FFL builds from whatever Mii format was imported.
 *
 *  ORIGINAL   part icons (texture-miiStudio/miiparts: IconHair000…131, IconEye00…59, IconEyebrow00…23, IconNose00…17,
 *             IconMouth00…35, IconGlass00…19, IconFaceline / IconFaceT_line / IconFaceT_make 00…11, IconMustache /
 *             IconBeard 00…05, IconMole00…01), colour chips (colors: colorHair 8, colorEye 6, colorSkin 10, colorLip 5,
 *             colorGlass 6, colorBeard 8, favoriteColor 12), category buttons (ui: faceBtnOn00 …), segment labels
 *             "Elementi / Colore / Posizione", "Azzera" (Layout/miiStudio EUit), CDN asset_layout_v2-3_miiStudio.
 *  REVERSED   grid order of every part and colour: the order of the icon-name strings in libcocos2dcpp .rodata
 *             (0x1890d20 … 0x1891f21, contiguous tables; icon number = FFL part id). Field offsets / ranges = FFLiCharInfo
 *             (ffl.js, verified by FFL itself: every edit is checked with FFLiVerifyCharInfoWithReason before use).
 *  DEDUCED    string order = display order (the pointer tables were not traced); category ↔ fields grouping.
 *  WEB ADAPTATION  the text names of the categories and of the position controls (the original buttons are icon-only),
 *             +/− steppers instead of the original drag manipulator.
 */
import { ORDER } from './miistudioOrder';

export const MS_DIR = 'asset/layout/miiStudio/Published-iOS/texture-miiStudio/resources-iphone/';

export const FIELD = {
  faceType: 4, faceColor: 8, faceTex: 12, faceMake: 16, hairType: 20, hairColor: 24, hairFlip: 28,
  eyeType: 32, eyeColor: 36, eyeScale: 40, eyeAspect: 44, eyeRotate: 48, eyeX: 52, eyeY: 56,
  eyebrowType: 60, eyebrowColor: 64, eyebrowScale: 68, eyebrowAspect: 72, eyebrowRotate: 76, eyebrowX: 80, eyebrowY: 84,
  noseType: 88, noseScale: 92, noseY: 96, mouthType: 100, mouthColor: 104, mouthScale: 108, mouthAspect: 112, mouthY: 116,
  beardMustache: 120, beardType: 124, beardColor: 128, beardScale: 132, beardY: 136,
  glassType: 140, glassColor: 144, glassScale: 148, glassY: 152, moleType: 156, moleScale: 160, moleX: 164, moleY: 168,
  height: 172, build: 176, gender: 224, birthMonth: 228, birthDay: 232, favoriteColor: 236
} as const;
export type Field = keyof typeof FIELD;
/** FFL ranges (FFLiVerifyCharInfo). */
export const RANGE: Partial<Record<Field, [number, number]>> = {
  eyeScale: [0, 7], eyeAspect: [0, 6], eyeRotate: [0, 7], eyeX: [0, 12], eyeY: [0, 18],
  eyebrowScale: [0, 8], eyebrowAspect: [0, 6], eyebrowRotate: [0, 11], eyebrowX: [0, 12], eyebrowY: [3, 18],
  noseScale: [0, 8], noseY: [0, 18], mouthScale: [0, 8], mouthAspect: [0, 6], mouthY: [0, 18],
  beardScale: [0, 8], beardY: [0, 16], glassScale: [0, 7], glassY: [0, 20], moleScale: [0, 8], moleX: [0, 16], moleY: [0, 30],
  height: [0, 127], build: [0, 127]
};

export const get = (ci: Uint8Array, f: Field) => new DataView(ci.buffer, ci.byteOffset, ci.byteLength).getInt32(FIELD[f], true);
export function set(ci: Uint8Array, f: Field, v: number): Uint8Array {
  const out = new Uint8Array(ci); new DataView(out.buffer).setInt32(FIELD[f], v, true); return out;
}
export function nickname(ci: Uint8Array): string { return new TextDecoder('utf-16le').decode(ci.subarray(180, 202)).replace(/\0.*$/s, ''); }
export function setNickname(ci: Uint8Array, name: string): Uint8Array {
  const out = new Uint8Array(ci); const v = new DataView(out.buffer);
  for (let i = 0; i < 11; i++) v.setUint16(180 + i * 2, i < name.length && i < 10 ? name.charCodeAt(i) : 0, true);
  return out;
}

const order = ORDER as Record<string, number[]>;
export interface PartGrid { field: Field; icon: string; ids: number[]; }
export interface ColorRow { field: Field; chip: string; ids: number[]; }
export interface PosCtl { field: Field; label: string; invert?: boolean; }
export interface Category { id: string; button: string; name: string; parts: PartGrid[]; color?: ColorRow; pos: PosCtl[]; flip?: boolean; physique?: boolean; }
const grid = (field: Field, icon: string): PartGrid => ({ field, icon, ids: order[icon] });
const chips = (field: Field, chip: string): ColorRow => ({ field, chip, ids: order[chip] });

/** Categories in the order of the original category buttons (ui atlas *BtnOn00). Names: WEB ADAPTATION. */
export const CATEGORIES: Category[] = [
  { id: 'face', button: 'faceBtnOn00.png', name: 'Viso', parts: [grid('faceType', 'IconFaceline'), grid('faceTex', 'IconFaceT_line'), grid('faceMake', 'IconFaceT_make')], color: chips('faceColor', 'colorSkin'), pos: [] },
  { id: 'hair', button: 'hairBtnOn00.png', name: 'Capigliatura', parts: [grid('hairType', 'IconHair')], color: chips('hairColor', 'colorHair'), pos: [], flip: true },
  { id: 'eyebrow', button: 'eyebrowBtnOn00.png', name: 'Sopracciglia', parts: [grid('eyebrowType', 'IconEyebrow')], color: chips('eyebrowColor', 'colorHair'),
    pos: [{ field: 'eyebrowY', label: 'Su / giù', invert: true }, { field: 'eyebrowX', label: 'Distanza' }, { field: 'eyebrowScale', label: 'Dimensione' }, { field: 'eyebrowAspect', label: 'Proporzioni' }, { field: 'eyebrowRotate', label: 'Rotazione' }] },
  { id: 'eye', button: 'eyeBtnOn00.png', name: 'Occhi', parts: [grid('eyeType', 'IconEye')], color: chips('eyeColor', 'colorEye'),
    pos: [{ field: 'eyeY', label: 'Su / giù', invert: true }, { field: 'eyeX', label: 'Distanza' }, { field: 'eyeScale', label: 'Dimensione' }, { field: 'eyeAspect', label: 'Proporzioni' }, { field: 'eyeRotate', label: 'Rotazione' }] },
  { id: 'nose', button: 'noseBtnOn00.png', name: 'Naso', parts: [grid('noseType', 'IconNose')], pos: [{ field: 'noseY', label: 'Su / giù', invert: true }, { field: 'noseScale', label: 'Dimensione' }] },
  { id: 'mouth', button: 'lipBtnOn00.png', name: 'Bocca', parts: [grid('mouthType', 'IconMouth')], color: chips('mouthColor', 'colorLip'),
    pos: [{ field: 'mouthY', label: 'Su / giù', invert: true }, { field: 'mouthScale', label: 'Dimensione' }, { field: 'mouthAspect', label: 'Proporzioni' }] },
  { id: 'mustache', button: 'mustacheOnBtnOn00.png', name: 'Baffi', parts: [grid('beardMustache', 'IconMustache')], color: chips('beardColor', 'colorBeard'),
    pos: [{ field: 'beardY', label: 'Su / giù', invert: true }, { field: 'beardScale', label: 'Dimensione' }] },
  { id: 'beard', button: 'beardBtnOn00.png', name: 'Barba', parts: [grid('beardType', 'IconBeard')], color: chips('beardColor', 'colorBeard'), pos: [] },
  { id: 'glass', button: 'glassBtnOn00.png', name: 'Occhiali', parts: [grid('glassType', 'IconGlass')], color: chips('glassColor', 'colorGlass'),
    pos: [{ field: 'glassY', label: 'Su / giù', invert: true }, { field: 'glassScale', label: 'Dimensione' }] },
  { id: 'mole', button: 'moleBtnOn00.png', name: 'Neo', parts: [grid('moleType', 'IconMole')], pos: [{ field: 'moleY', label: 'Su / giù', invert: true }, { field: 'moleX', label: 'Sinistra / destra' }, { field: 'moleScale', label: 'Dimensione' }] },
  { id: 'physique', button: 'physiqueBtnOn00.png', name: 'Corporatura', parts: [], pos: [], physique: true }
];
/** Icon frame name: hair uses 3 digits, the others 2 (miiparts.plist). */
export const iconName = (prefix: string, id: number) => `${prefix}${String(id).padStart(prefix === 'IconHair' ? 3 : 2, '0')}.png`;
export const chipName = (prefix: string, id: number) => `${prefix}${String(id).padStart(2, '0')}.png`;
/** favoriteColor chips are in the colors atlas but not in the .rodata tables: id order 0…11. */
export const FAVORITE_IDS = Array.from({ length: 12 }, (_, i) => i);
