// SHARED ROOM movement: the REAL RoomDirector on both sides (path finding, walking, door, reactions, objects) — the
// owner's Mii driven by "player input", the friend's copy driven only by the network states (LocalSampler →
// network with latency + jitter + reordering → RemoteAvatar). Simulated: the animation clips (synthetic durations,
// no Nintendo files) and the network. Measured: how far the copy is from the owner while walking and once still.
// Run from client/web: npx tsx ../../tests/unit/remoteavatar.test.mts
let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const THREE = await import('../../client/web/node_modules/three/build/three.module.js');
const { RoomDirector } = await import('../../client/web/src/room/RoomDirector');
const { LocalSampler, RemoteAvatar } = await import('../../client/web/src/mp/RemoteAvatar');
type Clip = { name: string; frames: number; fps: number; byName: Map<string, Float32Array[]> };
const clip = (name: string, sec: number): Clip => ({ name, frames: Math.round(sec * 30), fps: 30, byName: new Map() });
const anims = new Map<string, Clip>([
  ['animWaitMale', clip('animWaitMale', 2)], ['animWaitFemale', clip('animWaitFemale', 2)], ['animWalkClone', clip('animWalkClone', 1)],
  ['animHandWaveLIn', clip('animHandWaveLIn', 0.3)], ['animHandWaveL', clip('animHandWaveL', 0.4)], ['animHandWaveLOut', clip('animHandWaveLOut', 0.3)],
  ['animActionStroked', clip('animActionStroked', 1.2)], ['animNodClone', clip('animNodClone', 0.6)], ['animActionCheckTheBox', clip('animActionCheckTheBox', 1.5)],
]);
const door = clip('door', 0.5);
const box = { name: 'chest', min: new THREE.Vector2(14, 10), max: new THREE.Vector2(22, 16) };
const mk = () => { const d = new RoomDirector(anims as never, false, door as never, door as never); d.boxes = [box]; return d; };
const owner = mk(), copy = mk();
const chest = owner.interactable(box)!;
const objects = () => (chest ? [chest] : []);
const sampler = new LocalSampler();
const remote = new RemoteAvatar('p2p-bbbbbbbbbbbbbbbb', copy, objects);
let t = 0; const DT = 1 / 60;
// network: 120 ms ± 60 ms, so updates often arrive out of order; the newest by seq is kept (like session.ts)
const wire: { at: number; seq: number; s: unknown; a?: unknown }[] = []; let seq = 0, lastSeq = 0, sent = 0, stale = 0;
const acts: { at: number; a: unknown }[] = [];
const ownerActs: string[] = [];
owner.onEvent = (e: { type: string; object?: string }) => { if (e.type === 'interact') ownerActs.push('interact'); };
const lat = () => 0.12 + (Math.sin(seq * 12.9898) * 43758.5453 % 1 + 1) % 1 * 0.12 - 0.06;
let maxWalkErr = 0;
function step(n: number, measure = false) {
  for (let i = 0; i < n; i++) {
    t += DT;
    owner.update(DT); copy.update(DT);
    const s = sampler.sample(owner as never, DT, Math.round(t * 1000));
    if (s) { wire.push({ at: t + lat(), seq: ++seq, s }); sent++; }
    for (const m of [...wire]) if (m.at <= t) { wire.splice(wire.indexOf(m), 1); if (m.seq <= lastSeq) { stale++; continue; } lastSeq = m.seq; remote.apply(m.s as never); }
    for (const m of [...acts]) if (m.at <= t) { acts.splice(acts.indexOf(m), 1); remote.act(m.a as never); }
    remote.tick(DT);
    if (measure && owner.state === 'walking') maxWalkErr = Math.max(maxWalkErr, owner.pos.distanceTo(copy.pos));
  }
}
const dist = () => Math.hypot(owner.pos.x - copy.pos.x, owner.pos.z - copy.pos.z);

// ---- both come in through the door
owner.enter();
step(60 * 8);
ok('door: the owner comes in; the copy comes in by itself and stops at the same spot', owner.state === 'idle' && copy.state === 'idle' && dist() < 1.6, { o: owner.state, c: copy.state, d: dist() });

// ---- a long walk around the chest, then a second destination while still walking
owner.goTo(new THREE.Vector3(25, 0, 20)); step(60 * 1.2, true);
owner.goTo(new THREE.Vector3(-20, 0, 18)); step(60 * 8, true);
ok('walking: the copy follows the same path, never more than 6 units behind (latency 60–180 ms)', maxWalkErr < 6, { maxWalkErr });
ok('still again: the copy stands where the owner stands (< 1.5)', owner.state === 'idle' && copy.state === 'idle' && dist() < 1.5, dist());
ok('no hard corrections needed for normal movement', remote.snaps === 0, remote.log);
const rate = sent / t;
console.log(`   messages: ${sent} in ${t.toFixed(1)} s (${rate.toFixed(1)}/s), ${stale} arrived late and were ignored; max distance while walking ${maxWalkErr.toFixed(2)}`);
ok('traffic: under 10 state messages a second on average', rate < 10, rate);

// ---- actions: wave, object
acts.push({ at: t + 0.15, a: { k: 'wave' } }); owner.waveReaction();
step(30);
ok('wave: the copy waves too (original wave sequence)', copy.state === 'reacting', copy.state);
step(60 * 3);
owner.interact(chest); step(20);
acts.push({ at: t + 0.15, a: { k: 'interact', o: 'chest' } });
step(60 * 6);
ok('object: owner uses the chest; the copy walks there and uses it too', ownerActs.includes('interact') && copy.history.some((h) => h.includes('interacting')), copy.history.slice(-6));
step(60 * 4);
ok('after the object both are still, at the same spot', owner.state === 'idle' && copy.state === 'idle' && dist() < 1.5, { d: dist(), o: owner.state, c: copy.state });

// ---- a big jump (e.g. after a reconnection with stale data): corrected at once
const snaps0 = remote.snaps;
const far = { x: copy.pos.x > 0 ? -28 : 28, z: -20 };
remote.apply({ x: far.x, z: far.z, h: 1, st: 'idle', tx: null, tz: null, t: 0 });
remote.tick(DT);
ok('far off (> 40, e.g. stale data after a reconnection): the copy is put there at once and counted', remote.snaps === snaps0 + 1 && Math.hypot(copy.pos.x - far.x, copy.pos.z - far.z) < 0.5, { snaps: remote.snaps, pos: copy.pos });
step(60 * 6);
ok('then the owner\'s next states bring it back next to the owner', dist() < 1.5, { d: dist(), snaps: remote.snaps });

// ---- the owner leaves through the door
owner.goTo(new THREE.Vector3(0, 0, 0)); step(60 * 4);
owner.exit(); step(60 * 8);
ok('door: the owner goes out; the copy goes out too', owner.state === 'outside' && copy.state === 'outside', { o: owner.state, c: copy.state });
ok('the state machine was never broken (no illegal transitions)', !owner.violations.length && !copy.violations.length, { o: owner.violations, c: copy.violations });

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
