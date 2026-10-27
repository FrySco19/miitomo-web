/**
 * The FFL head on the body — ONE place, ONE conversion (HOTFIX 2026-10-28).
 *
 * FFL builds the head in its own units (AFLResHigh_2_3: chin y 0 … hair top 68.66). On the body the game scales it by
 * AFL's 0.1 (both callers of AFLSetScale pass 0.1: MII.md "Head on body", VERIFIED) → 6.9 body units.
 *   with a skeleton   the head goes under BodyModel.headAnchor = World(Head)·Rz(−90°)·S(0.1) (+ headwear ×10: authored in
 *                     head units / 10)
 *   without one       (no body part carries the Head joint: body packages not imported / incomplete, or no body) the
 *                     same S(0.1) on a stand; with an incomplete body the stand sits at the bind Head height (10.65,
 *                     scaled by the height axis: APPROXIMATED, only so the head is not on the floor)
 * The second case used to add the head UNSCALED: 10× too big in the room, where the root is in body units.
 * The caller sets the root scale (room: 1 = body units; lab: 10).
 */
import * as THREE from 'three';
import type { BodyScale } from './BodyScale';

export const AFL_HEAD_SCALE = 0.1;
export const BIND_HEAD_Y = 10.65;
/** What attachHead needs of a body part (BodyModel). */
export interface HeadPart { group: THREE.Group; headAnchor: THREE.Group; jointFrame(name: string): THREE.Matrix4 | null; applyPose(clip: null, frame: number): void; pod?: { nodes: { name: string }[] } }
export interface HeadSlot { root: THREE.Group; parts: HeadPart[]; body: HeadPart | null; headGroup?: THREE.Object3D | null }
export type HeadAttach = { mode: 'joint' | 'stand'; skeleton: string | null; parts: string[]; reason: string | null };

/** `full` = a body is expected (play / full view); false = the head-only view of the lab. */
export function attachHead(s: HeadSlot, head: THREE.Object3D, bs: BodyScale | null, full: boolean): HeadAttach {
  const body = s.parts.filter((p) => !p.group.userData.headwear);
  const skel = body.find((p) => p.jointFrame('Head')) ?? null;
  s.body = skel;
  const stems = body.map((p) => String(p.group.userData.part ?? p.pod?.nodes[0]?.name ?? '?'));
  const wear = s.parts.filter((p) => p.group.userData.headwear);
  for (const p of wear) { p.applyPose(null, 0); p.group.scale.setScalar(1 / AFL_HEAD_SCALE); }
  if (skel) {
    skel.headAnchor.add(head);
    for (const p of wear) skel.headAnchor.add(p.group);
    return { mode: 'joint', skeleton: String(skel.group.userData.part ?? 'body'), parts: stems, reason: null };
  }
  const stand = new THREE.Group();
  stand.name = 'headStand';
  stand.scale.setScalar(AFL_HEAD_SCALE);
  if (body.length) stand.position.y = BIND_HEAD_Y * (bs?.a.x ?? 1);
  stand.add(head);
  for (const p of wear) stand.add(p.group);
  s.root.add(stand);
  const reason = body.length ? `nessuna parte del corpo ha il joint Head (${stems.join(', ')}): pacchetti del corpo incompleti` : full ? 'nessun pacchetto del corpo importato: solo la testa' : null;
  if (reason) console.warn(`[Mii] ${reason}`);
  return { mode: 'stand', skeleton: null, parts: stems, reason };
}

/** Measures a built Mii: FFL head height vs the height of the Head joint above the feet (body units). */
export function measureMii(s: HeadSlot | null) {
  if (!s?.headGroup) return null;
  s.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(s.headGroup);
  const rootScale = s.root.scale.x || 1;
  const headH = (box.max.y - box.min.y) / rootScale;
  const neck = s.body?.jointFrame('Head');
  const neckY = neck ? neck.elements[13] : null;
  // MII.md: FFL head ×0.1 = 6.9 units; Head joint 5.23 (h 28) … 9.83 (h 127) → head / joint ≈ 0.7 … 1.3
  const ratio = neckY ? headH / neckY : null;
  return { headHeight: +headH.toFixed(2), headJointY: neckY !== null ? +neckY.toFixed(2) : null, ratio: ratio !== null ? +ratio.toFixed(2) : null,
    verdict: ratio === null ? 'nessuno scheletro' : ratio > 0.4 && ratio < 2 ? 'proporzioni attese' : 'SPROPORZIONATA', expected: 'testa 6.9 · joint Head 5.2–9.8 · rapporto 0.7–1.3' };
}
