// PLAY room framing (WEB ADAPTATION): original camera dollied back along its own axis, never closer, front floor visible.
import * as THREE from '../../client/web/node_modules/three/build/three.module.js';
import { roomDolly, framedRoomCamera, FRONT_Z, FEET_NDC, TOP_NDC, BACK_TOP, BACK_Z, SIDE_X, SIDE_NDC } from '../../client/web/src/room/RoomFraming.ts';
let fails = 0; const ok = (n: string, c: boolean, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
// original doorAnim camera (ROOM.md): position (2.706, 30.781, 60.583), aim (2.5, 19.5, 0), fov 0.6606
const cam = { position: new THREE.Vector3(2.706, 30.781, 60.583), target: new THREE.Vector3(2.5, 19.5, 0), up: new THREE.Vector3(0, 1, 0), fovRad: 0.6606 };
const f = framedRoomCamera(cam);
ok('camera moves back (dolly > 0) for the original framing', f.dolly > 0, f.dolly);
ok('dolly is moderate ("un po\' più indietro", < 45 units)', f.dolly < 45, f.dolly);
const dir0 = cam.target.clone().sub(cam.position).normalize(), dir1 = f.target.clone().sub(f.position).normalize();
ok('same view direction as the original camera', dir0.angleTo(dir1) < 1e-6, dir0.angleTo(dir1));
ok('moved along the original axis + a sideways pan (target displaced by the same vector)', f.position.clone().sub(cam.position).distanceTo(f.target.clone().sub(cam.target)) < 1e-6);
ok('horizontally centred: the camera aims at the room centre x = 0', Math.abs(f.target.x) < 1e-6 && Math.abs(f.position.x - (cam.position.x - cam.target.x)) < 0.02, [f.target.x, f.position.x]);
const pc = new THREE.PerspectiveCamera(cam.fovRad * 180 / Math.PI, 16 / 9, 1, 400); pc.position.copy(f.position); pc.up.copy(cam.up); pc.lookAt(f.target); pc.updateMatrixWorld(); pc.updateProjectionMatrix();
const feet = new THREE.Vector3(cam.target.x, 0, FRONT_Z).project(pc).y + f.shiftNdc;
ok('a Mii at the front edge of the floor has its feet above the bottom bar', feet >= FEET_NDC - 1e-3 && feet < FEET_NDC + 0.02, feet);
const back = new THREE.Vector3(cam.target.x, BACK_TOP, BACK_Z).project(pc).y + f.shiftNdc;
ok('the back wall top edge is in frame, just under the top', back <= TOP_NDC + 1e-3 && back > TOP_NDC - 0.02, back);
ok('lens shift moves the picture up (room was low in the frame)', f.shiftNdc > 0, f.shiftNdc);
const close = { ...cam, position: cam.position.clone().addScaledVector(cam.position.clone().sub(cam.target).normalize(), 200) };
ok('never closer than the original (already far camera → dolly 0)', roomDolly(close) === 0);
// narrow (portrait) window: the floor must also fit in width
const tall = framedRoomCamera(cam, 600 / 900);
const pt = new THREE.PerspectiveCamera(cam.fovRad * 180 / Math.PI, 600 / 900, 1, 400); pt.position.copy(tall.position); pt.up.copy(cam.up); pt.lookAt(tall.target); pt.updateMatrixWorld(); pt.updateProjectionMatrix();
const sx = Math.max(...[-SIDE_X, SIDE_X].map((x) => Math.abs(new THREE.Vector3(x, 0, FRONT_Z).project(pt).x)));
ok('portrait window: floor front corners fit in width', sx <= SIDE_NDC + 1e-3, sx);
ok('portrait window moves further back than landscape', tall.dolly > f.dolly, [tall.dolly, f.dolly]);
const ft = new THREE.Vector3(cam.target.x, 0, FRONT_Z).project(pt).y + tall.shiftNdc;
ok('portrait window: feet at the front still above the bottom bar', ft >= FEET_NDC - 1e-3, ft);
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else console.log('ALL PASS');
