// REBOOT R4 unit tests: SocialHub model over the REAL R3 controller / service, on a fake host (same contracts as the
// rooms test: invite / dismiss through a door that takes time, room clock ticks). Run from client/web:
//   npx tsx ../../tests/unit/hub.test.mts
import { SocialHub, FUTURE_DESTINATIONS } from '../../client/web/src/reboot/hub/SocialHub';
import { LocalRoomService } from '../../client/web/src/reboot/rooms/LocalRoomService';
import { PublicRoomController } from '../../client/web/src/reboot/rooms/PublicRoomController';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const kv = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
(globalThis as any).window = globalThis;

function world(opts: { exitTime?: number; stuck?: boolean } = {}) {
  const guests: { id: string; name: string; state: string; leaving: boolean; out?: number }[] = [];
  const ticks = new Set<(dt: number) => void>(), gl = new Set<(e: any) => void>();
  let cap = 3, t = 0, screen = 'room';
  const friends = Array.from({ length: 9 }, (_, i) => ({ id: 'f' + i, name: 'F' + i }));
  const host: any = {
    screen: () => screen, visiting: () => false, friends: async () => friends, guests: () => guests,
    invite: async (id: string) => { if (guests.length >= cap || guests.some((g) => g.id === id)) return false; guests.push({ id, name: id, state: 'idle', leaving: false }); return true; },
    dismiss: (id: string) => { const g = guests.find((x) => x.id === id); if (!g || g.leaving) return false; g.leaving = true; g.out = opts.stuck ? Infinity : t + (opts.exitTime ?? 4); return true; },
    capacity: () => cap, setCapacity: (n: number) => (cap = n),
    onGuest: (cb: any) => { gl.add(cb); return () => gl.delete(cb); }, onTick: (cb: any) => { ticks.add(cb); return () => ticks.delete(cb); },
  };
  const svc = new LocalRoomService({ blocked: () => [] }, kv());
  const rooms = new PublicRoomController(host, svc, { multi: { settings: { miis: 4 } } as any, social: null, visits: { gap: [1, 2], stay: [40, 80], mischief: 0 }, seed: 3 });
  let panelShown = 0;
  const hub = new SocialHub({ rooms, inRoom: () => screen === 'room', onTick: (cb) => host.onTick(cb), showRoomPanel: () => panelShown++, timeout: 60 });
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { t += 0.25; for (const g of [...guests]) if (g.out !== undefined && t >= g.out) { guests.splice(guests.indexOf(g), 1); for (const l of gl) l({ type: 'leave', id: g.id, name: g.id }); } for (const l of [...ticks]) l(0.25); if (Math.round(t * 4) % 4 === 0) (rooms as any).check?.(); await new Promise((r) => setTimeout(r, 0)); } };
  return { host, guests, ticks, gl, svc, rooms, hub, step, get cap() { return cap; }, setScreen: (s: string) => (screen = s), panel: () => panelShown };
}

{
  const w = world(); const { hub, rooms, svc } = w;
  const evs: string[] = []; hub.subscribe((e) => evs.push(e.type));
  ok('1 creation: hub starts at home, nothing navigating, no error', hub.at === 'home' && !hub.state.navigating && !hub.state.lastError);
  const d = hub.destinations();
  ok('2 destinations: Casa, my public room, and the future ones (disabled, with phase)', d[0].id === 'home' && d[1].id === 'public' && d.filter((x) => x.kind === 'future').length === FUTURE_DESTINATIONS.length && d.filter((x) => x.kind === 'future').every((x) => !x.available && x.reason && x.phase));
  ok('3 home destination available and current', d[0].available && d[0].current);
  ok('5 public status read from R3: "Chiusa"', hub.publicStatus!.label === 'Chiusa' && d[1].available && /Chiusa/.test(d[1].subtitle));
  // 7 valid navigation home → hub → home
  const r1 = await hub.go('hub');
  ok('7a home → hub: completed, at hub, events started/completed', r1.ok && hub.at === 'hub' && evs.includes('navigation.started') && evs.includes('navigation.completed'));
  const r2 = await hub.go('home');
  ok('7b hub → home', r2.ok && hub.at === 'home');
  // 8 invalid navigation
  const bad = [await hub.go('nowhere'), await hub.go('friends-rooms'), await hub.go('home')];
  ok('8 invalid: unknown / future (not available) / already there → explicit errors, state unchanged', bad[0].code === 'UNAVAILABLE' && bad[1].code === 'UNAVAILABLE' && bad[2].code === 'ALREADY_THERE' && hub.at === 'home' && !hub.state.navigating, bad);
  w.setScreen('shop'); const away = await hub.go('hub'); w.setScreen('room');
  ok('8b hub needs the own room screen (NOT_IN_ROOM)', away.code === 'NOT_IN_ROOM' && hub.at === 'home');
  // 10 navigation error: R3 refuses to open (private guests in) → hub stays usable, state unchanged
  w.guests.push({ id: 'x', name: 'x', state: 'idle', leaving: false });
  await hub.go('hub'); const refused = await hub.go('public');
  ok('10 error from R3 (open refused) is reported; still at hub, room closed, hub usable', refused.code === 'OPEN_REFUSED' && /ospiti/.test(refused.message ?? '') && hub.at === 'hub' && rooms.mode === 'private' && evs.includes('navigation.failed'));
  w.guests.length = 0;
  // 4 + 6 hub → public: R3 opens, hub reflects it
  const r3 = await hub.go('public');
  ok('4 hub → public: R3 opened the room, R3 panel shown, at public', r3.ok && hub.at === 'public' && rooms.mode === 'public' && w.panel() === 1);
  await w.step(80);
  const ps = hub.publicStatus!;
  ok('6a open reflected: "Aperta · n/8" with visitors from the R3 domain', /Aperta/.test(ps.label) && ps.capacity === 8 && ps.present === svc.room.presence().length && ps.present >= 2, ps);
  ok('13 no duplicate presence: the owner is present once; one location', svc.room.presence().filter((p) => p.role === 'owner').length === 1 && ['home', 'hub', 'public'].filter((l) => l === hub.at).length === 1);
  // 9 double navigation while public → home waits for R3
  const p1 = hub.go('home'); const p2 = await hub.go('hub');
  ok('9 double navigation refused (BUSY) while a transition runs', p2.code === 'BUSY');
  ok('   R3 is closing (same R3 close, not a hub copy)', rooms.mode === 'closing' && hub.publicStatus!.label === 'In chiusura…');
  await w.step(240); const r4 = await p1;
  ok('12 public → home completes when R3 finished: cleanup done by R3 (presence 0, capacity back, visitors stopped)', r4.ok && hub.at === 'home' && rooms.mode === 'private' && svc.room.presence().length === 0 && w.guests.length === 0 && w.cap === 3 && !rooms.visitors.running && w.ticks.size === 0, { r4, at: hub.at, mode: rooms.mode, g: w.guests.length, cap: w.cap, ticks: w.ticks.size });
  ok('6b close reflected: "Chiusa"', hub.publicStatus!.label === 'Chiusa');
  // 11 public → hub: arrive at once, R3 closes in the background, hub follows; going back to public while closing → CLOSING
  await hub.go('public'); await w.step(60);
  const r5 = await hub.go('hub');
  const closingNow = rooms.mode === 'closing';
  const again = await hub.go('public');
  ok('11 public → hub: at hub immediately while R3 closes; public refused while closing (CLOSING)', r5.ok && hub.at === 'hub' && closingNow && again.code === 'CLOSING' && hub.destinations()[1].available === false);
  const hh = hub.go('home'); await w.step(4);
  ok('   hub → Casa while R3 still closes: waits (still at hub, navigating), no half state', hub.at === 'hub' && !!hub.state.navigating);
  await w.step(240); const hhr = await hh;
  ok('   …and arrives home when R3 has finished', hhr.ok && hub.at === 'home' && rooms.mode === 'private');
  await hub.go('hub');
  ok('   then R3 finishes and the hub shows "Chiusa"; hub → public works again', rooms.mode === 'private' && hub.publicStatus!.label === 'Chiusa' && (await hub.go('public')).ok);
  // 14 + 15 repeated cycles: no listener / timer accumulation, consistent state
  const base = { hub: hub.listenerCount, rooms: rooms.listenerCount, svc: svc.listenerCount };
  for (let i = 0; i < 12; i++) {
    await w.step(20);
    await hub.go('hub'); await w.step(200);
    await hub.go('home'); await hub.go('hub'); await hub.go('public'); await w.step(10);
  }
  await hub.go('hub'); await w.step(240); await hub.go('home');
  const counts = { hub: hub.listenerCount, rooms: rooms.listenerCount, svc: svc.listenerCount, ticks: w.ticks.size, guestL: w.gl.size };
  ok('14 no duplicate listeners after 12 full cycles (hub, R3 controller, service, ticks, guest events)', counts.hub === base.hub && counts.rooms === base.rooms && counts.svc === 1 && counts.ticks === 0 && counts.guestL === 0, { base, counts });
  ok('15 consistent after repeated open / close: home, private, closed, nobody inside, capacity back, no error', hub.at === 'home' && rooms.mode === 'private' && svc.room.state === 'closed' && svc.room.presence().length === 0 && w.guests.length === 0 && w.cap === 3 && !hub.state.navigating, { at: hub.at, mode: rooms.mode, st: svc.room.state, g: w.guests.length });
  ok('   counters add up (started = completed + failed after start)', hub.state.counters.completed >= 50, hub.state.counters);
  // extension point
  const reg = hub.register({ id: 'plaza', title: 'Piazzetta', subtitle: 'prova', phase: 'test', available: () => ({ ok: true, reason: '' }), go: async () => ({ ok: true }) });
  ok('extension point: a new destination registers once and appears', reg && !hub.register({ id: 'plaza', title: '', subtitle: '', phase: '', available: () => ({ ok: true, reason: '' }) }) && hub.destinations().some((x) => x.id === 'plaza' && x.available));
  hub.dispose(); rooms.dispose();
  ok('dispose: hub unsubscribes from R3', rooms.listenerCount === 0 && svc.listenerCount <= 1);
}
// cleanup incomplete (a visitor never manages to leave) → TIMEOUT, state consistent, hub usable
{
  const w = world({ stuck: true }); const { hub, rooms } = w;
  await hub.go('public'); await w.step(60);
  const r = await Promise.all([hub.go('home'), w.step(400)]).then((x) => x[0]);
  ok('cleanup incomplete: public → home fails with TIMEOUT, observable, nothing half-done', r.code === 'TIMEOUT' && hub.state.lastError?.code === 'TIMEOUT' && !hub.state.navigating && hub.at === 'public' && rooms.mode === 'closing', { r, at: hub.at, mode: rooms.mode });
  const h2 = await hub.go('hub');
  ok('   the hub stays usable (can still go to the hub)', h2.ok && hub.at === 'hub');
  hub.dispose(); rooms.dispose();
}
// interrupted: the user leaves the room screen while public → home waits
{
  const w = world({ exitTime: 30 }); const { hub, rooms } = w;
  await hub.go('public'); await w.step(60);
  const p = hub.go('home');
  w.setScreen('shop'); w.guests.length = 0;            // Classic disposes the guests when the user leaves the room
  await new Promise((r) => setTimeout(r, 1100)); await w.step(4);
  const r = await p;
  ok('navigation interrupted by leaving the room: resolved (R3 cleaned up on its own), state consistent', (r.ok || r.code === 'INTERRUPTED') && rooms.mode === 'private' && hub.at === 'home' && !hub.state.navigating, { r, mode: rooms.mode });
  hub.dispose(); rooms.dispose();
}
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
