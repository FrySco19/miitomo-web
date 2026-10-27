/**
 * PLAY room camera framing on a PC screen — WEB ADAPTATION.
 *
 * The original camera (doorAnim POD node "persp", see Room.ts / ROOM.md) is kept as it is: same direction, same aim,
 * same field of view, still fixed (no user control, CAMERA PLAY decision). The only change is a dolly BACK along its own
 * view axis, so that on a landscape PC window a Mii standing anywhere on the walkable floor — up to the front edge —
 * stays fully visible above the bottom bar. The original phone screen is portrait; a desktop window is landscape and
 * lower, so with the unmodified camera the front of the room and the Mii's feet/legs were cut off.
 * The picture is re-centred with a vertical lens shift (projection offset: no rotation of the camera) and the camera is
 * panned sideways so the room's centre (x = 0) is in the middle of the window.
 * The camera never moves closer than the original (dolly ≥ 0).
 */
import * as THREE from 'three';

export interface FramingInput {
  position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fovRad: number;
}
/** Front edge of the walkable floor (RoomDirector ROOM_HALF 34 − MARGIN 3). */
export const FRONT_Z = 31;
/** Lowest NDC y the feet may reach: leaves room for the bottom bar (≈ 13 % of the window height). */
export const FEET_NDC = -0.74;

function ndc(p: THREE.Vector3, eye: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3, fovRad: number, aspect: number) {
  const f = target.clone().sub(eye).normalize();
  const r = new THREE.Vector3().crossVectors(f, up).normalize();
  const u = new THREE.Vector3().crossVectors(r, f);
  const d = p.clone().sub(eye);
  const z = d.dot(f); if (z <= 1e-6) return { x: Infinity, y: -Infinity };
  const t = Math.tan(fovRad / 2);
  return { x: d.dot(r) / z / t / aspect, y: d.dot(u) / z / t };
}

/** Top edge of the back wall (room box 68 x 34 x 68, ROOM.md): ceiling height 34 at z = −34. */
export const BACK_TOP = 34, BACK_Z = -34;
/** Highest NDC y the back wall top may reach (small margin under the top of the window). */
export const TOP_NDC = 0.94;
/** Side limit of the walkable floor (ROOM_HALF − MARGIN) and the |NDC x| it may reach on narrow windows. */
export const SIDE_X = 31, SIDE_NDC = 0.97;

function edges(c: FramingInput, s: number, aspect: number) {
  const back = c.position.clone().sub(c.target).normalize();
  const eye = c.position.clone().addScaledVector(back, s), tgt = c.target.clone().addScaledVector(back, s);
  const P = (x: number, y: number, z: number) => ndc(new THREE.Vector3(x, y, z), eye, tgt, c.up, c.fovRad, aspect);
  const bottom = P(c.target.x, 0, FRONT_Z).y, top = P(c.target.x, BACK_TOP, BACK_Z).y;
  const side = Math.max(Math.abs(P(-SIDE_X, 0, FRONT_Z).x), Math.abs(P(SIDE_X, 0, FRONT_Z).x));
  return { top, bottom, side };
}

/**
 * Smallest dolly (body units) for which the room — back wall top edge to a Mii's feet at the front of the floor —
 * fits between the bottom bar and the top of the window, and — on narrow windows — the floor fits in width. The picture is then re-centred with a vertical lens shift
 * (shiftNdc), so the camera does not have to move further back than needed and keeps its original direction.
 */
export function roomDolly(c: FramingInput, aspect = 16 / 9): number {
  const span = TOP_NDC - FEET_NDC;
  const ok = (s: number) => { const e = edges(c, s, aspect); return e.top - e.bottom <= span && e.side <= SIDE_NDC; };
  if (ok(0)) return 0;
  let lo = 0, hi = 400;
  if (!ok(hi)) return hi;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
  return hi;
}

/** Camera for the PLAY room: original camera moved back by roomDolly(), plus a vertical lens shift in NDC units. */
export function framedRoomCamera(c0: FramingInput, aspect = 16 / 9): { position: THREE.Vector3; target: THREE.Vector3; dolly: number; shiftNdc: number } {
  // horizontal centring: the original camera aims at x ≈ 2.5 (room centre x = 0), so on a wide PC window the room sat
  // right of centre. Pan sideways (camera and aim moved by the same amount: same direction, no rotation) so that, after
  // the dolly, the aim is on x = 0. Two passes: the view axis leans a hair in x, so the pan depends slightly on the dolly.
  let c: FramingInput = c0, s = 0;
  for (let pass = 0; pass < 3; pass++) {
    s = roomDolly(c, aspect);
    const back = c.position.clone().sub(c.target).normalize();
    const tx = c.target.x + back.x * s;
    if (Math.abs(tx) < 1e-9) break;
    const pan = new THREE.Vector3(tx, 0, 0);
    c = { ...c, position: c.position.clone().sub(pan), target: c.target.clone().sub(pan) };
  }
  const back = c.position.clone().sub(c.target).normalize();
  const e = edges(c, s, aspect);
  // re-centre only when the room is shorter than the window (otherwise keep the original vertical placement)
  const shiftNdc = s === 0 ? 0 : (e.top - e.bottom <= TOP_NDC - FEET_NDC + 1e-6 ? (TOP_NDC + FEET_NDC) / 2 - (e.top + e.bottom) / 2 : 0);
  return { position: c.position.clone().addScaledVector(back, s), target: c.target.clone().addScaledVector(back, s), dolly: s, shiftNdc };
}
