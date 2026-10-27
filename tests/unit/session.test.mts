// Shared-room multiplayer session (client/web/src/p2p/session.ts): the real SessionManager of three players on an
// in-memory network that can hold, drop, repeat and reorder messages. What is simulated: the transport (the real one
// is the WebRTC data channel, tested in tests/desktop/multiplayer.e2e.mjs). What is real: every rule of the session.
// Run from client/web: npx tsx ../../tests/unit/session.test.mts
let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const { SessionManager, INVITE_MS, GRACE_MS } = await import('../../client/web/src/p2p/session');
type SM = InstanceType<typeof SessionManager>;

let now = 1_000_000;
const ids = { A: 'p2p-' + 'a'.repeat(16), B: 'p2p-' + 'b'.repeat(16), C: 'p2p-' + 'c'.repeat(16) };
const names: Record<string, string> = { [ids.A]: 'Alice', [ids.B]: 'Bob', [ids.C]: 'Carla' };
// friendships: A–B, A–C (B and C are NOT friends)
const friends: Record<string, string[]> = { [ids.A]: [ids.B, ids.C], [ids.B]: [ids.A], [ids.C]: [ids.A] };
const links = new Set([`${ids.A}|${ids.B}`, `${ids.B}|${ids.A}`, `${ids.A}|${ids.C}`, `${ids.C}|${ids.A}`]);
const queue: { from: string; to: string; m: Record<string, unknown> }[] = [];
const events: Record<string, Record<string, unknown>[]> = { [ids.A]: [], [ids.B]: [], [ids.C]: [] };
const statusOf: Record<string, unknown> = {};
const nodes: Record<string, SM> = {};
for (const [k, id] of Object.entries(ids)) {
  nodes[id] = new SessionManager({
    me: () => ({ id, name: names[id] }),
    myProfile: async () => ({ profile: { name: names[id], miiData: 'AAAA' }, outfit: {}, room: { wall: k === 'A' ? '0003' : '0001', floor: '0002', variant: 1 } }),
    isFriend: (x) => friends[id].includes(x), friendName: (x) => names[x] ?? '?', friendProfile: (x) => ({ profile: { name: names[x] } }),
    connected: (x) => links.has(`${id}|${x}`),
    send: (to, m) => { if (!links.has(`${id}|${to}`)) return false; queue.push({ from: id, to, m: JSON.parse(JSON.stringify(m)) }); return true; },
    emit: (e) => events[id].push(e), status: (r) => { statusOf[id] = r; }, now: () => now, log: () => {},
  });
}
const A = nodes[ids.A], B = nodes[ids.B], C = nodes[ids.C];
/** Delivers what is queued (optionally reordered / dropping some), repeatedly until quiet. */
function pump(opts: { reverse?: boolean; drop?: (q: typeof queue[number]) => boolean } = {}) {
  for (let round = 0; round < 20 && queue.length; round++) {
    const batch = queue.splice(0);
    if (opts.reverse) batch.reverse();
    for (const q of batch) { if (opts.drop?.(q)) continue; if (links.has(`${q.from}|${q.to}`)) nodes[q.to].onWire(q.from, q.m); }
  }
}
const members = (n: SM) => n.view().session?.members.map((m) => m.id).sort() ?? [];
const av = (x: number, z: number, st = 'walking', tx: number | null = null, tz: number | null = null) => ({ x, z, h: 0.5, st, tx, tz, t: now });

// ---- 1. invite → accept: one room, two Miis
ok('invite refused for a non-friend (B → C)', (await B.op('mp.invite', { to: ids.C })).ok === false);
const inv = await A.op('mp.invite', { to: ids.B });
pump();
const bi = B.view().invites[0];
ok('A invites B: B sees the invitation with A\'s room look', inv.ok && bi && bi.from === ids.A && bi.room.wall === '0003', { inv, bi });
await B.op('mp.accept', { sid: bi.sid }); pump();
ok('B accepts: both in ONE session, host A, members A + B on both sides', A.view().session?.role === 'host' && B.view().session?.role === 'guest' && B.view().session?.host === ids.A && members(A).join() === [ids.A, ids.B].sort().join() && members(B).join() === members(A).join(), { a: members(A), b: members(B) });
ok('the guest gets the HOST\'s room look (wall 0003), its own save untouched', B.view().session?.room.wall === '0003');
ok('presence: both "in room" (host joinable)', (statusOf[ids.A] as { host: string })?.host === ids.A && (statusOf[ids.B] as { host: string })?.host === ids.A);

// ---- 2. movement: latest state wins, late / reordered ones are dropped
B.local(av(1, 1)); B.local(av(2, 2)); B.local(av(3, 3, 'walking', 10, 5));
pump({ reverse: true });            // arrive in the wrong order
const bAtA = A.view().session!.members.find((m) => m.id === ids.B)!.av!;
ok('B\'s Mii state reaches A; out-of-order updates do not move it back (latest by seq)', bAtA.x === 3 && bAtA.tx === 10 && A.stats.avStale === 2, { bAtA, stale: A.stats.avStale });
A.local(av(-4, 6, 'idle')); pump();
ok('A\'s Mii state reaches B (host → guest)', B.view().session!.members.find((m) => m.id === ids.A)!.av!.x === -4);
ok('bad values are refused (NaN position)', (() => { const before = A.stats.refused; A.onWire(ids.B, { v: 1, op: 'av', sid: A.view().session!.sid, seq: 99, s: { x: NaN, z: 0, h: 0, st: 'idle', t: 1 } }); return A.stats.refused === before + 1; })());

// ---- 3. actions: in order, each applied once (a repeated one after a reconnection is ignored)
B.localAct({ k: 'wave' });
const resent = queue.map((q) => ({ ...q })); pump(); queue.push(...resent); pump();
const waves = events[ids.A].filter((e) => e.type === 'mp.act' && (e.a as { k: string }).k === 'wave');
ok('B waves: A sees it once even if the message comes twice', waves.length === 1 && waves[0].id === ids.B, waves.length);

// ---- 4. nobody speaks for somebody else
const sidAB = A.view().session!.sid;
A.onWire(ids.B, { v: 1, op: 'av', sid: sidAB, id: ids.A, seq: 500, s: av(30, 30, 'idle') });
ok('a guest cannot move the host\'s Mii (id in its message ignored: it is about B)', A.view().session!.members.find((m) => m.id === ids.B)!.av!.x === 30 && A.view().session!.members.find((m) => m.id === ids.A)!.av!.x === -4);
B.onWire(ids.C, { v: 1, op: 'snap', sid: sidAB, snap: { ver: 99, room: { wall: '0009', floor: '0009' }, members: [{ id: ids.B }] } });
ok('a snapshot from somebody who is not the host is refused', B.view().session!.room.wall === '0003' && members(B).length === 2);

// ---- 5. a third player who is NOT a friend of B: knock → admit, star relay
await C.op('mp.knock', { to: ids.A }); pump();
ok('C asks to enter A\'s room: A sees the request', A.view().knocks.some((k) => k.from === ids.C));
await A.op('mp.admit', { from: ids.C }); pump();
ok('A lets C in: three members on all three sides', members(A).length === 3 && members(B).length === 3 && members(C).length === 3, { a: members(A), b: members(B), c: members(C) });
C.local(av(7, -3, 'idle')); pump();
ok('C\'s Mii reaches B through the host (B and C are not friends)', B.view().session!.members.find((m) => m.id === ids.C)?.av?.x === 7);

// ---- 6. lost connection: seat kept, reconnect without a second Mii
links.delete(`${ids.A}|${ids.B}`); links.delete(`${ids.B}|${ids.A}`);
A.peerDown(ids.B); B.peerDown(ids.A);
ok('A–B link lost: B is "lost" at A, B\'s session is "reconnecting" (not ended)', A.view().session!.members.find((m) => m.id === ids.B)!.conn === 'lost' && B.view().session?.state === 'reconnecting');
now += 10_000; A.tick(); B.tick(); pump();
links.add(`${ids.A}|${ids.B}`); links.add(`${ids.B}|${ids.A}`);
B.peerUp(ids.A); pump();
ok('link back within 30 s: B rejoins the SAME seat, still 3 members, no duplicate', B.view().session?.state === 'active' && members(A).length === 3 && A.view().session!.members.find((m) => m.id === ids.B)!.conn === 'ok' && members(B).length === 3, { a: members(A), b: B.view().session?.state });
links.delete(`${ids.A}|${ids.C}`); links.delete(`${ids.C}|${ids.A}`);
A.peerDown(ids.C); C.peerDown(ids.A);
now += GRACE_MS + 1000; A.tick(); C.tick(); pump();
ok('C stays away > 30 s: removed at A and B; C\'s session ended (HOST_LOST)', members(A).length === 2 && members(B).length === 2 && !C.view().session && C.view().last?.why === 'HOST_LOST', { a: members(A), c: C.view().last });
links.add(`${ids.A}|${ids.C}`); links.add(`${ids.C}|${ids.A}`);

// ---- 7. invitations expire
await A.op('mp.invite', { to: ids.C }); pump();
const ci = C.view().invites[0];
now += INVITE_MS + 1000; A.tick(); C.tick();
ok('invitation older than 60 s: gone, accepting it fails', !C.view().invites.length && (await C.op('mp.accept', { sid: ci.sid })).ok === false);
C.onWire(ids.A, { v: 1, op: 'inv', sid: ci.sid, room: { wall: '0003', floor: '0002', variant: 1 }, name: 'Alice' });
await C.op('mp.accept', { sid: ci.sid });
now += 1; pump();
ok('a "join" for an expired invitation is denied by the host (not let in)', !C.view().session && members(A).length === 2 && C.view().last?.kind === 'denied', C.view().last);

// ---- 8. the host leaves: everybody is told
await A.op('mp.leave', {}); pump();
ok('A closes the room: B\'s session ends (HOST_LEFT), A has none', !A.view().session && !B.view().session && B.view().last?.why === 'HOST_LEFT', B.view().last);

// ---- 9. both knock on each other at the same time → one session, the smaller id hosts
await A.op('mp.knock', { to: ids.B }); await B.op('mp.knock', { to: ids.A });
for (let i = 0; i < 5; i++) { pump(); await new Promise((r) => setTimeout(r, 0)); }   // the automatic admit is async
ok('crossed requests: one session, hosted by the smaller id (A), both inside', A.view().session?.role === 'host' && B.view().session?.host === ids.A && members(A).length === 2, { a: A.view().session?.role, b: B.view().session?.host });

console.log(`stats A ${JSON.stringify(A.stats)}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
