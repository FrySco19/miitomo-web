// SHARED ROOM orchestration (mp/SceneSync.ts) on a test room: real RoomDirector for my Mii and for each spawned
// friend, the engine replaced by a small double that emits the same events (mp view, states, actions). Checks what
// the game page does when a session starts / changes / ends. The real main.ts room adapter needs the user's game
// files and is not run here.
// Run from client/web: npx tsx ../../tests/unit/scenesync.test.mts
let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const THREE = await import('../../client/web/node_modules/three/build/three.module.js');
const { RoomDirector } = await import('../../client/web/src/room/RoomDirector');
const { SceneSync } = await import('../../client/web/src/mp/SceneSync');
const clip = (name: string, sec: number) => ({ name, frames: Math.round(sec * 30), fps: 30, byName: new Map() });
const anims = new Map(['animWaitMale', 'animWaitFemale', 'animWalkClone', 'animHandWaveLIn', 'animHandWaveL', 'animHandWaveLOut', 'animActionStroked', 'animNodClone'].map((n) => [n, clip(n, 0.5)]));
const mk = () => new RoomDirector(anims as never, false, clip('door', 0.3) as never, clip('door', 0.3) as never);

const ME = 'p2p-' + 'a'.repeat(16), BOB = 'p2p-' + 'b'.repeat(16), CARLA = 'p2p-' + 'c'.repeat(16);
// ---- engine double (P2PClient surface used by SceneSync)
const subs = { mp: new Set<(v: any) => void>(), av: new Set<(id: string, seq: number, s: any) => void>(), act: new Set<(id: string, seq: number, a: any) => void>() };
const sentAv: any[] = [], sentAct: any[] = [];
const client: any = {
  mp: null,
  onMp: (cb: any) => { subs.mp.add(cb); if (client.mp) cb(client.mp); return () => subs.mp.delete(cb); },
  onAv: (cb: any) => { subs.av.add(cb); return () => subs.av.delete(cb); },
  onAct: (cb: any) => { subs.act.add(cb); return () => subs.act.delete(cb); },
  castAv: (s: any) => sentAv.push(s), castAct: (a: any) => sentAct.push(a),
};
const view = (session: any) => { client.mp = { me: ME, session, invites: [], knocks: [], pending: [], last: null }; for (const cb of subs.mp) cb(client.mp); };
const member = (id: string, name: string, av: any = null) => ({ id, name, profile: { profile: { name } }, conn: 'ok', joinedAt: 0, av, rtt: null });
// ---- room double over real directors
let local = mk(); local.enter();
const remotes = new Map<string, any>();
const shown: any[] = [], said: any[] = [], log: string[] = [];
let pokes = 0, active = false, seats = 0;
const ticks = new Set<(dt: number) => void>(), localActs = new Set<(a: any) => void>();
const host: any = {
  roomReady: () => true, local: () => local, objects: () => [],
  remote: (id: string) => remotes.get(id) ?? null,
  spawn: async (id: string, _p: unknown, inside: any) => { const d = mk(); if (inside) d.restore(new THREE.Vector3(inside.x, 0, inside.z), inside.h); remotes.set(id, d); log.push(`spawn ${id.slice(4, 5)}${inside ? ' inside' : ''}`); return true; },
  despawn: (id: string, viaDoor: boolean) => { remotes.delete(id); log.push(`despawn ${id.slice(4, 5)}${viaDoor ? ' door' : ''}`); },
  say: (id: string, text: string, lang: string) => said.push({ id, text, lang }),
  showShared: (room: any, info: any) => { shown.push({ room, info }); if (room) { local = mk(); local.enter(); } },
  pokeLocal: () => { pokes++; },
  setActive: (on: boolean, n: number) => { active = on; seats = n; },
  onTick: (cb: any) => { ticks.add(cb); return () => ticks.delete(cb); },
  onLocalAct: (cb: any) => { localActs.add(cb); return () => localActs.delete(cb); },
};
const sync = new SceneSync(client, host);
const run = async (sec: number) => { for (let t = 0; t < sec; t += 1 / 30) { local.update(1 / 30); for (const d of remotes.values()) d.update(1 / 30); for (const c of ticks) c(1 / 30); await Promise.resolve(); } };

// ---- 1. I join Bob's room (guest): his room look is shown with MY Mii coming in, his Mii already inside
view({ sid: 'sAAAAAAAA', role: 'guest', host: BOB, room: { wall: '0007', floor: '0003', variant: 2 }, ver: 2, state: 'active', startedAt: 0, members: [member(BOB, 'Bob', { x: 6, z: 4, h: 0, st: 'idle', tx: null, tz: null, t: 1 }), member(ME, 'Alice')] });
await run(0.5);
ok('guest: the host\'s room look is shown (wall 0007), with role and host name', shown.at(-1)?.room?.wall === '0007' && shown.at(-1)?.info?.role === 'guest' && shown.at(-1)?.info?.hostName === 'Bob', shown.at(-1));
ok('session on: simulated visitors off, a seat for Bob', active && seats === 1);
ok('Bob\'s Mii appears INSIDE at his spot (he was already in), my Mii is not touched', log.includes('spawn b inside') && remotes.get(BOB)?.pos.x === 6 && !remotes.has(ME), log);
await run(6);
ok('my Mii\'s state is sent while it comes in (states with my position)', sentAv.length > 5 && sentAv.some((s) => s.st === 'entering') && sentAv.at(-1).st === 'idle', sentAv.at(-1));

// ---- 2. Bob walks; his copy follows
for (const cb of subs.av) cb(BOB, 5, { x: 6, z: 4, h: 0, st: 'walking', tx: -10, tz: 12, t: 2 });
await run(4);
for (const cb of subs.av) cb(BOB, 6, { x: -10, z: 12, h: 0, st: 'idle', tx: null, tz: null, t: 3 });
await run(2);
const bd = remotes.get(BOB);
ok('Bob\'s copy walked to where Bob went (−10, 12)', Math.hypot(bd.pos.x + 10, bd.pos.z - 12) < 1.6 && bd.state === 'idle', { x: bd.pos.x, z: bd.pos.z, st: bd.state });

// ---- 3. Bob taps my Mii (poke) → my Mii reacts here (and that goes out as mine); Bob says a line
for (const cb of subs.act) cb(BOB, 1, { k: 'poke', o: ME });
for (const cb of subs.act) cb(BOB, 2, { k: 'poke', o: CARLA });
for (const cb of subs.act) cb(BOB, 3, { k: 'say', text: 'Ciao Alice!', lang: 'it' });
ok('a poke for ME makes my Mii react once; a poke for someone else does nothing here', pokes === 1, pokes);
ok('Bob\'s line is said by Bob\'s Mii, in its language', said.length === 1 && said[0].id === BOB && said[0].lang === 'it');
for (const cb of localActs) cb({ k: 'wave' });
ok('my wave goes out as my action', sentAct.some((a) => a.k === 'wave'));

// ---- 4. Carla joins (through the door), then leaves (through the door)
view({ ...client.mp.session, ver: 3, members: [member(BOB, 'Bob'), member(ME, 'Alice'), member(CARLA, 'Carla', { x: 0, z: -40, h: 0, st: 'entering', tx: 2, tz: 0, t: 1 })] });
await run(0.3);
ok('Carla joins: her Mii comes through the door (not placed inside), seats = 2', log.includes('spawn c') && seats === 2, log);
view({ ...client.mp.session, ver: 4, members: [member(BOB, 'Bob'), member(ME, 'Alice')] });
ok('Carla leaves: her Mii goes out through the door', log.includes('despawn c door'), log);

// ---- 5. the host changes the room look → the room is shown again and the friends put back
const before = shown.length;
view({ ...client.mp.session, ver: 5, room: { wall: '0001', floor: '0001', variant: 0 } });
await run(0.3);
ok('new room look: shown again, Bob\'s Mii put back after the rebuild', shown.length === before + 1 && shown.at(-1).room.wall === '0001' && remotes.has(BOB), { n: shown.length - before, log: log.slice(-3) });

// ---- 6. session over → back to my own room, friends gone, visitors back on
view(null);
ok('session over: back home (no room look), friends removed, simulated visitors allowed again', shown.at(-1).room === null && !remotes.size && !active, { last: shown.at(-1), remotes: remotes.size });
const sent = sentAv.length; await run(1);
ok('no more states sent once the session is over', sentAv.length === sent);
sync.dispose();
ok('dispose: no listener left', !subs.mp.size && !subs.av.size && !subs.act.size && !ticks.size && !localActs.size);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
