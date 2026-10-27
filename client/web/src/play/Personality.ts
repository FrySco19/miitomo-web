/**
 * Mii personality (M13) — REVERSED from libcocos2dcpp.so (Miitomo 2.4.0, ARMv7):
 *
 *  0x5be454  type index: the four "characterParam" levels at +0x21..+0x24 (Movimenti, Modo di parlare,
 *            Atteggiamento, Espressione del viso; 1..8, 0 = unset) go through a u16 score table (9 entries per axis,
 *            .rodata 0x18c01d0). A = score0 + score1, B = score2 + score3; each sum is bucketed 51-100 → 1,
 *            101-150 → 2, 151-200 → 3 (else 0); index = A | B << 2.
 *  0x5be42c  type = int[16] table at 0x18c0140 [0,0,1,1, 0,0,1,1, 2,2,3,3, 2,2,3,3][index]
 *            → 0 Cool, 1 Dry, 2 Nagomi, 3 Nori (M17b correction, REVERSED: see room/Expression.ts — the earlier
 *            Nagomi / Nori / Dry / Cool order was the attribute order of the rule struct, not the type order).
 *  0x5be5b8  presets: 16 × 5 bytes at 0x18c0180 copied into the five levels.
 *  The fifth level (+0x25, Originalità) is stored but not used by the type.
 *  0x5be538 / 0x5be578 return A and B themselves (used elsewhere, e.g. movement speed — not reversed yet).
 * Axis labels and the 8 level descriptions: Layout/miiStudio radarChart00 / radarchartBalloon00 (EUit). VERIFIED (data)
 */
import type { Personality } from '../room/Expression';

const SCORE = [
  [50, 10, 20, 30, 40, 60, 70, 80, 90],
  [50, 5, 15, 25, 35, 65, 75, 85, 95],
  [50, 10, 20, 30, 40, 60, 70, 80, 90],
  [50, 5, 15, 25, 35, 65, 75, 85, 95]
];
const TYPE_MAP = [0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 3, 3] as const;
export const PRESETS: number[][] = [
  [1, 1, 1, 1, 4], [3, 3, 1, 1, 4], [5, 5, 1, 1, 4], [7, 7, 1, 1, 4], [1, 1, 3, 3, 4], [3, 3, 3, 3, 4], [5, 5, 3, 3, 4], [7, 7, 3, 3, 4],
  [1, 1, 5, 5, 4], [3, 3, 5, 5, 4], [5, 5, 5, 5, 4], [7, 7, 5, 5, 4], [1, 1, 7, 7, 4], [3, 3, 7, 7, 4], [5, 5, 7, 7, 4], [7, 7, 7, 7, 4]
];
/** Default for a new Mii: 4,4,4,4 → index 5 → type 0 (Cool, "Riservato"). DEDUCED: the game's default is not known. */
export const DEFAULT_LEVELS = [4, 4, 4, 4, 4];

const bucket = (s: number) => (s >= 51 && s <= 100 ? 1 : s >= 101 && s <= 150 ? 2 : s >= 151 && s <= 200 ? 3 : 0);
export function personalityIndex(levels: number[]): number {
  const sc = (axis: number) => SCORE[axis][Math.max(0, Math.min(8, levels[axis] | 0))];
  return bucket(sc(0) + sc(1)) | (bucket(sc(2) + sc(3)) << 2);
}
export function personalityType(levels: number[] | null | undefined): Personality {
  return (levels && levels.length >= 4 ? TYPE_MAP[personalityIndex(levels)] : TYPE_MAP[personalityIndex(DEFAULT_LEVELS)]) as Personality;
}

export const AXIS_LABEL = ['chartLabel00@char00', 'chartLabel01@char01', 'chartLabel02@char02', 'chartLabel03@char03', 'chartLabel04@char04'];
export const AXIS_FALLBACK = ['Movimenti', 'Modo di parlare', 'Atteggiamento', 'Espressione del viso', 'Originalità'];
export const RADAR = 'Layout/miiStudio/parts/layer1/radarChart00.msbt';
export const BALLOON = 'Layout/miiStudio/parts/layer2/radarchartBalloon00.msbt';
export const levelLabel = (axis: number, level: number) => `textLabel@charballoon${axis}_${level}`;

/**
 * Personality result texts (M17 correction: they ARE in the user's files — earlier marked MISSING):
 *  Layout/common/parts/characterInfo00.msbt   type02_text_NN (16 type names), description01_NN (first impression +
 *                                             traits, one per group), description02_NN (long description)
 *  Layout/common/parts/characterInfoTitle00   type01_text_1..4 (group names: Riservato, Deciso, Tranquillo, Espansivo)
 * NN = personalityIndex + 1 — DEDUCED, and checked: the four description01 texts fall exactly on the REVERSED type
 * table groups {1,2,5,6} {3,4,7,8} {9,10,13,14} {11,12,15,16}; group number = type + 1.
 */
export const CHAR_INFO = 'Layout/common/parts/characterInfo00.msbt';
export const CHAR_TITLE = 'Layout/common/parts/characterInfoTitle00.msbt';
export function personalityLabels(levels: number[] | null | undefined) {
  const lv = levels && levels.length >= 4 ? levels : DEFAULT_LEVELS;
  const n = String(personalityIndex(lv) + 1).padStart(2, '0');
  const g = TYPE_MAP[personalityIndex(lv)] + 1;
  return {
    index: personalityIndex(lv),
    name: { rel: CHAR_INFO, key: `textForResize00@type02_text_${n}` },
    group: { rel: CHAR_TITLE, key: `textForResize00@type01_text_0${g}` },
    short: { rel: CHAR_INFO, key: `description01@description01_${n}` },
    long: { rel: CHAR_INFO, key: `description02@description02_${n}` }
  };
}
