// Unit checks for the body-scale formulas reconstructed from libcocos2dcpp.so (see MII.md § M6).
// Run: node --experimental-strip-types tests/unit/bodyscale.test.mts
import { computeBodyScale, jointScale, rootYCorrection } from '../../client/web/src/body/BodyScale.ts';
import * as THREE from '../../client/web/node_modules/three/build/three.module.js';
let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const near = (a: number, b: number, e = 1e-5) => Math.abs(a - b) < e;
// Constants as single-precision literals found in the binary (0x5d07b8 / 0x5d09c0 literal pools)
const F = (x: number) => Math.fround(x);
for (const [h, w] of [[0, 0], [64, 64], [127, 127], [28, 55], [127, 0]]) {
  const s = computeBodyScale(h, w);
  const ax = (h * F(0.00601562) + 0.5) * 0.75;
  const ay = (h * F(0.00179687) + (w * (h * F(0.00367187) + 0.4)) * F(0.0078125) + 0.4) * 0.75;
  const b = 0.6 + w * F(0.0015625) + h * (w * F(0.003125) + 0.4) * F(0.0078125);
  check(near(s.a.x, ax, 2e-5) && near(s.a.y, ay, 2e-5) && near(s.a.z, ay, 2e-5) && near(s.b.x, b, 2e-5), `scale h=${h} w=${w}: A=(${s.a.x.toFixed(4)}, ${s.a.y.toFixed(4)}) B=${s.b.x.toFixed(4)}`);
}
check(near(computeBodyScale(64, 64).b.x, 1.0), 'scaleB(64,64) = 1 (neutral uniform scale)');
// FFL.js getBodyScale (independent source) = scaleA / 0.75
{ const h = 100, w = 30, m = 128; const fx = (w * (h * (0.47 / m) + 0.4)) / m + h * (0.23 / m) + 0.4, fy = h * (0.77 / m) + 0.5; const s = computeBodyScale(h, w);
  check(near(s.a.y / 0.75, fx) && near(s.a.x / 0.75, fy), 'matches FFL.js getBodyScale x0.75 (axes swapped: game bone-length axis = X)'); }
const bs = computeBodyScale(28, 55), v = new THREE.Vector3();
check(jointScale('Head', bs, v).equals(new THREE.Vector3(1, 1, 1)), 'Head -> 1');
check(jointScale('jointRoot', bs, v).x === 1, 'jointRoot -> 1');
check(near(jointScale('Wrist_L', bs, v).x, bs.a.y) && v.x === v.z, 'Wrist -> uniform A.y');
check(near(jointScale('Ankle_R', bs, v).y, bs.a.y), 'Ankle -> uniform A.y');
check(jointScale('Womb', bs, v).equals(bs.b), 'Womb -> scaleB');
check(near(jointScale('Item_Wrist_R', bs, v).x, 1 - 0.5 * (1 - bs.a.y)), 'Item_* -> 1 - 0.5*(1-A.y)');
check(jointScale('Spine_1', bs, v).equals(bs.a), 'other joints -> scaleA');
check(jointScale('Spine_1', null, v).x === 1, 'no body scale -> 1');
check(near(rootYCorrection(6.4, computeBodyScale(127, 127)), 6.4 * computeBodyScale(127, 127).a.x - (0.2 * 0 - 0.05 * 0)), 'root Y correction at h=w=127');
console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
