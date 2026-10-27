/**
 * Miitomo body proportions from the Mii "height" and "build" values (0..127).
 * Reconstructed from libcocos2dcpp.so (Miitomo 2.4.0, ARM); see docs/reverse-engineering/MII.md § M6.
 *
 *  scaleA  (0x5d07b8, called from 0x5c1d68 / 0x5c4adc with both multipliers = 1.0):
 *     x = (h * 0.77/128 + 0.5) * 0.75                                   (bone length axis)
 *     y = z = (h * 0.23/128 + w * (h * 0.47/128 + 0.4) / 128 + 0.4) * 0.75   (thickness)
 *  scaleB  (0x5d09c0): uniform  s = 0.6 + w * 0.2/128 + h * (w * 0.4/128 + 0.4) / 128
 *  h = Mii height, w = Mii build (struct bytes +0xa8 / +0xac of the Mii info at AFLObject+0x284).
 *  The scale is skipped when AFLObject flag +0x560 is set (0x5c1d48) and forced to 1 when +0x448/+0x44a are set.
 *
 * Per-joint rule (SkeletalAnim world-matrix builder 0x5257f0, name compares at 0x525aac..0x525cd0):
 *     jointRoot, Head, Acce_Spine_2(_R/_L)          -> S = 1
 *     Ankle_R/L, Wrist_R/L                          -> S = uniform(scaleA.y)
 *     Shadow                                        -> S = uniform(scaleA.y)  (+ special rebuild, not reproduced)
 *     Item_Wrist_R/L, Item_Spine_2                  -> S = uniform(clamp(1 - 0.5 * max(0, 1 - scaleA.y)))  (0.5 = .data 0x1b75004)
 *     Womb                                          -> S = scaleB
 *     any other joint (incl. Skl_Root, Spine, Arm, Leg, Skirt...) -> S = scaleA
 * Hierarchy (0x526634..0x526bd4):
 *     t'   = t_local * parentScale   (y component NOT scaled for Skl_Root)
 *     W_j  = U_parent * T(t') * R_local * S_j          (scaled world, used for skinning)
 *     U_j  = W_j with unit-length axes                  (passed to children: scale is NOT inherited)
 *     parentScale_j = |axes of W_j|  (= S_j * anim scale)
 * Skl_Root ground correction (0x526978..0x526a24): Y += Y*(sx-1)/k - (0.2*(1-w/127) - 0.05*(1-h/127)),
 *     k = 1 - (a - b) with a/b two values of the blend state not yet identified -> k = 1 here (INFERRED).
 */
import * as THREE from 'three';

export interface BodyScale {
  height: number; build: number;
  a: THREE.Vector3; // scaleA
  b: THREE.Vector3; // scaleB (uniform)
}

const M = 128;
export function computeBodyScale(height: number, build: number): BodyScale {
  const h = THREE.MathUtils.clamp(Math.round(height), 0, 127), w = THREE.MathUtils.clamp(Math.round(build), 0, 127);
  const ax = (h * (0.77 / M) + 0.5) * 0.75;
  const ay = (h * (0.23 / M) + (w * (h * (0.47 / M) + 0.4)) / M + 0.4) * 0.75;
  const s = 0.6 + w * (0.2 / M) + (h * (w * (0.4 / M) + 0.4)) / M;
  return { height: h, build: w, a: new THREE.Vector3(ax, ay, ay), b: new THREE.Vector3(s, s, s) };
}

const ONE = new Set(['jointRoot', 'Head', 'Acce_Spine_2', 'Acce_Spine_2_R', 'Acce_Spine_2_L']);
const UNIFORM_Y = new Set(['Ankle_R', 'Ankle_L', 'Wrist_R', 'Wrist_L', 'Shadow']);
const ITEM = new Set(['Item_Wrist_R', 'Item_Wrist_L', 'Item_Spine_2']);
export const ITEM_SHRINK = 0.5; // float at .data 0x1b75004 (GOT+0x8160)

/** Joint scale vector S_j for joint `name` (writes into `out`). */
export function jointScale(name: string, bs: BodyScale | null, out: THREE.Vector3): THREE.Vector3 {
  if (!bs || ONE.has(name)) return out.set(1, 1, 1);
  if (UNIFORM_Y.has(name)) return out.setScalar(bs.a.y);
  if (ITEM.has(name)) {
    const k = ITEM_SHRINK * Math.max(0, 1 - bs.a.y);
    return out.setScalar(k > 1 ? 0 : 1 - k);
  }
  if (name === 'Womb') return out.copy(bs.b);
  return out.copy(bs.a);
}

/** Skl_Root world-Y correction (k assumed 1, see header). */
export function rootYCorrection(y: number, bs: BodyScale): number {
  const sx = bs.a.x;
  return y + y * (sx - 1) - (0.2 * (1 - bs.build / 127) - 0.05 * (1 - bs.height / 127));
}
