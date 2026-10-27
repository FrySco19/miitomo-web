// HOTFIX 2026-10-28 — Mii head proportions. The FFL head gets AFL's 0.1 exactly ONCE, with or without a skeleton:
//   FFL head 68.66 FFL units tall (AFLResHigh_2_3, MII.md) → 6.87 body units on the body; Head joint 5.2 … 9.8.
// Real three.js transforms; the body part is a stand-in with the same head anchor as BodyModel
// (World(Head)·Rz(−90°)·S(0.1)). Run from client/web: npx tsx ../../tests/unit/headattach.test.mts
import * as THREE from '../../client/web/node_modules/three/build/three.module.js';
import { attachHead, measureMii, AFL_HEAD_SCALE, BIND_HEAD_Y } from '../../client/web/src/body/HeadAttach';
import { computeBodyScale } from '../../client/web/src/body/BodyScale';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const FFL_HEAD_H = 68.66;
const near = (a: number, b: number, e = 0.02) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b));
/** An FFL head: a box 68.66 tall with the origin at the chin (as FFL). */
const ffHead = () => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(50, FFL_HEAD_H, 50)); m.position.y = FFL_HEAD_H / 2; g.add(m); return g; };
/** A body part like BodyModel: Head joint (bone along +Y in bind, X axis along the bone) at y = headY. */
function part(headY: number | null, name = 'bodyTops0001St') {
  const group = new THREE.Group(), headAnchor = new THREE.Group();
  group.userData.part = name;
  const joint = headY === null ? null : new THREE.Matrix4().makeTranslation(0, headY, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  if (joint) { headAnchor.matrixAutoUpdate = false; headAnchor.matrix.multiplyMatrices(joint, new THREE.Matrix4().makeRotationZ(-Math.PI / 2).multiply(new THREE.Matrix4().makeScale(0.1, 0.1, 0.1))); }
  group.add(headAnchor);
  return { group, headAnchor, jointFrame: (n: string) => (n === 'Head' ? joint : null), applyPose: () => {} };
}
const hat = () => { const p = part(null, 'headwear0502'); p.group.userData.headwear = true; const m = new THREE.Mesh(new THREE.BoxGeometry(6.6, 4, 6.6)); m.position.y = 5.2; p.group.add(m); return p; };
const slot = (parts: ReturnType<typeof part>[], rootScale: number) => { const root = new THREE.Group(); root.scale.setScalar(rootScale); for (const p of parts) if (!p.group.userData.headwear) root.add(p.group); return { root, parts, body: null as any, headGroup: null as THREE.Object3D | null }; };
const worldH = (o: THREE.Object3D, root: THREE.Object3D) => { root.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o); return (b.max.y - b.min.y); };

const bs = computeBodyScale(64, 64);
// 1. room (body units, root 1) with a skeleton
{
  const s = slot([part(7.0), hat()], 1); const h = ffHead(); s.headGroup = h;
  const a = attachHead(s, h, bs, true);
  ok('skeleton: head on the Head joint, 6.87 body units tall (= 68.66 × 0.1, once)', a.mode === 'joint' && near(worldH(h, s.root), FFL_HEAD_H * AFL_HEAD_SCALE), worldH(h, s.root));
  const m = measureMii(s)!;
  ok('measure: head / Head-joint ratio in the expected range (0.7–1.3 per MII.md)', m.verdict === 'proporzioni attese' && near(m.ratio!, 0.98, 0.05), m);
  const hatBox = new THREE.Box3().setFromObject(s.parts[1].group);
  ok('headwear follows the head at the same conversion (×10 under the 0.1 anchor → 6.6 wide)', near(hatBox.max.x - hatBox.min.x, 6.6, 0.05), hatBox.max.x - hatBox.min.x);
}
// 2. room, body parts WITHOUT the Head joint (incomplete packages) — the old code put the head UNSCALED here
{
  const s = slot([part(null, 'bodyShoes0003'), hat()], 1); const h = ffHead(); s.headGroup = h;
  const a = attachHead(s, h, bs, true);
  ok('no skeleton (incomplete body): head still 6.87 units — not 68.66 (the bug: 10× too big)', a.mode === 'stand' && near(worldH(h, s.root), FFL_HEAD_H * AFL_HEAD_SCALE), worldH(h, s.root));
  ok('no skeleton: the reason is recorded (which parts, why)', /joint Head/.test(a.reason ?? '') && /bodyShoes0003/.test(a.reason ?? ''), a);
  s.root.updateMatrixWorld(true);
  ok('no skeleton: the head stands at the bind Head height × height axis (approximated), not on the floor', near(new THREE.Box3().setFromObject(h).min.y, BIND_HEAD_Y * bs.a.x, 0.02));
  const hatBox = new THREE.Box3().setFromObject(s.parts[1].group);
  ok('no skeleton: headwear at the same conversion as the head', near(hatBox.max.x - hatBox.min.x, 6.6, 0.05));
}
// 3. head only (no body): lab (root 10) keeps its look; room (root 1) is now body-sized
{
  const lab = slot([], 10); const h1 = ffHead(); attachHead(lab, h1, null, false);
  ok('lab head view (root 10): same size as before the fix (68.66)', near(worldH(h1, lab.root), FFL_HEAD_H));
  const room = slot([], 1); const h2 = ffHead(); const a = attachHead(room, h2, null, true);
  ok('room, no body imported: head 6.87 (was 68.66), reason "no body package"', near(worldH(h2, room.root), FFL_HEAD_H * AFL_HEAD_SCALE) && /nessun pacchetto/.test(a.reason ?? ''), { h: worldH(h2, room.root), a });
}
// 4. the old code path, for the record: unscaled head next to a body whose Head joint is at 7 → measured as wrong
{
  const s = slot([part(7.0)], 1); const h = ffHead(); s.headGroup = h; s.body = s.parts[0]; s.root.add(h);   // what the old no-skeleton branch did
  ok('measure flags the old (unscaled) head as out of proportion', measureMii(s)!.verdict === 'SPROPORZIONATA', measureMii(s));
}
// 5. height / build are not cancelled: the body scale comes from the Mii and only the body joints use it
{
  const short = computeBodyScale(0, 0), tall = computeBodyScale(127, 127);
  ok('body scale follows height / build (h0 0.375 … h127 0.953 on the bone axis)', near(short.a.x, 0.375, 0.01) && near(tall.a.x, 0.9525, 0.01));
}
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
