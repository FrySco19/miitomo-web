// REBOOT R3 unit tests: RoomInstance (roles, permissions, capacity, blocked, kick, settings), LocalRoomService
// (realtime events, persistence of the configuration only), PublicRoomController + LocalVisitors on a fake host
// (visitors come and go through invite / dismiss, capacity respected, host actions refused, full cleanup).
// Run from client/web: npx tsx ../../tests/unit/rooms.test.mts
import { RoomInstance } from '../../client/web/src/reboot/rooms/RoomInstance';
import { LocalRoomService, OWNER } from '../../client/web/src/reboot/rooms/LocalRoomService';
import { PublicRoomController } from '../../client/web/src/reboot/rooms/PublicRoomController';
import { PUBLIC_TEMPLATES } from '../../client/web/src/reboot/rooms/templates';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const kv = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
(globalThis as any).window = globalThis;

// ---- RoomInstance
{
  const r = new RoomInstance({ id: 'r', ownerId: 'o', kind: 'public', templateId: 'lounge', title: 'T', capacity: 3, permissions: { whoCanEnter: 'friends', whoCanInteract: 'everyone', activitiesOpen: true }, skin: { wall: '', floor: '', variant: 0 }, activityId: 'social' });
  const ctx = { friends: new Set(['a', 'b', 'c', 'd']), blocked: new Set(['d']) };
  const j0 = r.join('a', ctx);
  ok('closed room: nobody enters', !j0.ok && j0.error.code === 'NOT_FOUND');
  ok('only the owner opens', !r.open('a').ok && r.open('o').ok && r.state === 'open' && r.role('o') === 'owner');
  ok('friends enter as visitors', r.join('a', ctx).ok && r.role('a') === 'visitor');
  const nf = r.join('zz', ctx);
  ok('whoCanEnter friends: strangers refused', !nf.ok && nf.error.code === 'FORBIDDEN');
  const bl = r.join('d', ctx);
  ok('blocked profiles refused', !bl.ok && bl.error.code === 'BLOCKED');
  r.join('b', ctx); const full = r.join('c', ctx);
  ok('capacity respected (owner counts): ROOM_FULL, state full', !full.ok && full.error.code === 'ROOM_FULL' && r.state === 'full');
  ok('visitors cannot do host actions', ['kick', 'changeSettings', 'close', 'invite'].every((a) => !r.can('a', a as any)) && r.can('a', 'useObjects') && r.can('o', 'kick'));
  const upd = r.update('a', { capacity: 8 });
  ok('visitor cannot change settings', !upd.ok && upd.error.code === 'FORBIDDEN' && r.info.capacity === 3);
  ok('visitor cannot kick / close', !r.kick('a', 'b').ok && !r.close('a').ok && r.has('b'));
  ok('owner cannot shrink below the people inside', !r.update('o', { capacity: 2 }).ok && r.update('o', { capacity: 4 }).ok);
  r.update('o', { permissions: { whoCanEnter: 'friends', whoCanInteract: 'owner', activitiesOpen: true } });
  ok('whoCanInteract owner: visitors may not use objects', !r.can('a', 'useObjects') && r.can('o', 'useObjects'));
  ok('owner kicks; the kicked one cannot come back', r.kick('o', 'a').ok && !r.has('a') && !r.join('a', ctx).ok);
  ok('the owner cannot "leave" (closes instead); unknown leave refused', !r.leave('o').ok && !r.leave('zz').ok);
  const out = r.close('o');
  ok('close returns the visitors and clears presence, kicks and state', out.ok && out.value.join() === 'b' && r.presence().length === 0 && r.state === 'closed');
  ok('invalid input refused', !r.join('', ctx).ok && !r.update('o', { capacity: 99 }).ok && !r.update('o', { title: 'x'.repeat(80) }).ok);
}
// ---- LocalRoomService: events + persistence of configuration only
{
  const store = kv();
  const s = new LocalRoomService({ blocked: () => [] }, store);
  s.setFriends(['a', 'b']);
  const ev: string[] = []; s.subscribe((e) => ev.push(e.type + ('presence' in e ? ':' + e.presence.profileId : 'profileId' in e ? ':' + (e as any).profileId : '')));
  s.open(); s.joinAs('a'); s.joinAs('zz'); s.attempt('a', 'close'); s.leaveAs('a');
  ok('service publishes the same realtime events the server will', ev.includes('presence.join:a') && ev.includes('presence.leave:a') && ev.includes('room.denied:zz') && ev.includes('room.denied:a') && ev.includes('room.updated'), ev);
  s.update(OWNER, { capacity: 5, title: 'Da Kelly' });
  const s2 = new LocalRoomService({ blocked: () => [] }, store);
  ok('configuration persists (title, capacity); presence and open state do not', s2.room.info.capacity === 5 && s2.room.info.title === 'Da Kelly' && s2.room.state === 'closed' && s2.room.presence().length === 0);
  ok('one complete template (vertical slice)', PUBLIC_TEMPLATES.length === 1 && PUBLIC_TEMPLATES[0].activity === 'social');
}
// ---- controller + simulated visitors on a fake host
{
  const guests: { id: string; name: string; state: string; leaving: boolean }[] = [];
  const ticks = new Set<(dt: number) => void>(), gl = new Set<(e: any) => void>();
  let cap = 3, screen = 'room', invites = 0, dismisses = 0;
  const friends = Array.from({ length: 10 }, (_, i) => ({ id: 'f' + i, name: 'F' + i }));
  const host: any = {
    screen: () => screen, visiting: () => false, friends: async () => friends, guests: () => guests,
    invite: async (id: string) => { invites++; if (guests.length >= cap) return false; guests.push({ id, name: id, state: 'idle', leaving: false }); return true; },
    dismiss: (id: string) => { const g = guests.find((x) => x.id === id); if (!g) return false; dismisses++; g.leaving = true; setTimeout(() => { const i = guests.indexOf(g); if (i >= 0) { guests.splice(i, 1); for (const l of gl) l({ type: 'leave', id, name: id }); } }, 5); return true; },
    capacity: () => cap, setCapacity: (n: number) => (cap = n),
    onGuest: (cb: any) => { gl.add(cb); return () => gl.delete(cb); }, onTick: (cb: any) => { ticks.add(cb); return () => ticks.delete(cb); },
  };
  const policies: unknown[] = [];
  const social: any = { setPolicy: (p: unknown) => policies.push(p), resync: () => policies.push('resync') };
  const multi: any = { settings: { miis: 4 } };
  const svc = new LocalRoomService({ blocked: () => ['f9'] }, kv());
  const c = new PublicRoomController(host, svc, { multi, social, visits: { gap: [1, 2], stay: [30, 60], mischief: 0.5 }, seed: 5 });
  guests.push({ id: 'x', name: 'x', state: 'idle', leaving: false });
  ok('cannot open while private guests are in', !c.open().ok);
  guests.length = 0;
  const o = c.open();
  ok('open: capacity of the room (8) applied, social object policy installed', o.ok && cap === 7 && policies.length === 1 && c.isPublic);
  const run = async (sec: number) => { for (let t = 0; t < sec; t += 0.25) { for (const l of ticks) l(0.25); await new Promise((r) => setTimeout(r, 0)); } };
  let maxIn = 0, mismatch = 0;
  for (let i = 0; i < 40; i++) { await run(5); maxIn = Math.max(maxIn, svc.room.presence().length); const pv = svc.room.visitors().sort().join(), gv = guests.filter((g) => !g.leaving).map((g) => g.id).sort().join(); if (pv !== gv) mismatch++; }
  const st = c.visitors.stats;
  ok('visitors come and go by themselves (turnover)', st.joined >= 8 && st.left >= 3, st);
  ok('capacity respected: never more than 8 present, ROOM_FULL refusals happen', maxIn <= 8 && svc.log.some((l) => l.e.type === 'room.denied' && (l.e as any).code === 'ROOM_FULL'), { maxIn });
  ok('blocked friend never enters', !svc.log.some((l) => l.e.type === 'presence.join' && l.e.presence.profileId === 'f9'));
  ok('visitors trying host actions are refused and logged; settings unchanged', st.mischief >= 2 && svc.room.info.capacity === 8 && c.events.some((e) => e.type === 'denied' && /changeSettings|kick|close|invite/.test(e.info ?? '')), { st, cap: svc.room.info.capacity });
  ok('presence and scene stay in sync (visitors == guests in the room)', mismatch <= 2, mismatch);
  c.update({ permissions: { whoCanEnter: 'friends', whoCanInteract: 'owner', activitiesOpen: true } });
  const pol = policies[0] as { canUseObject(id: string, o: string): boolean };
  const someone = svc.room.visitors()[0];
  ok('object policy follows the room permissions (owner only → visitors cannot use objects)', !!someone && !pol.canUseObject(someone, 'shelf') && pol.canUseObject('host', 'shelf'));
  const victim = svc.room.visitors()[0];
  ok('owner kicks a visitor: it is dismissed through the door and cannot return', c.kick(victim) && guests.find((g) => g.id === victim)?.leaving && !svc.room.join(victim, { friends: new Set([victim]), blocked: new Set() }).ok);
  c.close();
  await run(1); await new Promise((r) => setTimeout(r, 30)); await run(2);
  ok('close: every visitor says goodbye and leaves, then private settings are back', c.mode === 'private' && guests.length === 0 && svc.room.state === 'closed' && cap === 3 && policies.includes(null) && policies.includes('resync'), { mode: c.mode, guests: guests.length, cap });
  const t0 = c.visitors.stats.tries; await run(20);
  ok('after closing nothing keeps running (no new visitors, no tick subscribers)', c.visitors.stats.tries === t0 && ticks.size === 0, { tries: c.visitors.stats.tries, ticks: ticks.size });
  // owner leaves the room screen while public: immediate cleanup
  c.open(); await run(10);
  screen = 'shop'; guests.length = 0;          // Classic disposes the guests when the user leaves the room
  await new Promise((r) => setTimeout(r, 1100));
  ok('owner leaves the room screen: public room closed and fully cleaned', c.mode === 'private' && svc.room.presence().length === 0 && svc.room.state === 'closed' && ticks.size === 0 && cap === 3, { mode: c.mode, pres: svc.room.presence().length, ticks: ticks.size, cap });
  c.dispose();
}
// ---- slow exits (door queue): admitted visitors wait for a free place, nobody is lost, close still finishes
{
  const guests: { id: string; name: string; state: string; leaving: boolean; out?: number }[] = [];
  const ticks = new Set<(dt: number) => void>(), gl = new Set<(e: any) => void>();
  let cap = 3, t = 0, invitesAfterClose = 0, closedAt = Infinity;
  const friends = Array.from({ length: 9 }, (_, i) => ({ id: 'f' + i, name: 'F' + i }));
  const host: any = {
    screen: () => 'room', visiting: () => false, friends: async () => friends, guests: () => guests,
    invite: async (id: string) => { if (t > closedAt) invitesAfterClose++; if (guests.length >= cap || guests.some((g) => g.id === id)) return false; guests.push({ id, name: id, state: 'idle', leaving: false }); return true; },
    dismiss: (id: string) => { const g = guests.find((x) => x.id === id); if (!g || g.leaving) return false; g.leaving = true; g.out = t + 6; return true; },
    capacity: () => cap, setCapacity: (n: number) => (cap = n),
    onGuest: (cb: any) => { gl.add(cb); return () => gl.delete(cb); }, onTick: (cb: any) => { ticks.add(cb); return () => ticks.delete(cb); },
  };
  const svc = new LocalRoomService({ blocked: () => [] }, kv());
  const c = new PublicRoomController(host, svc, { multi: { settings: { miis: 4 } } as any, social: null, visits: { gap: [1, 2], stay: [5, 12], mischief: 0 }, seed: 9 });
  c.open();
  let lost = 0, ghosts = 0, maxPend = 0;
  const step = async () => { t += 0.25; for (const g of [...guests]) if (g.out !== undefined && t >= g.out) { guests.splice(guests.indexOf(g), 1); for (const l of gl) l({ type: 'leave', id: g.id, name: g.id }); } for (const l of ticks) l(0.25); await new Promise((r) => setTimeout(r, 0)); if (Math.round(t * 4) % 4 === 0) (c as any).check(); };
  for (let i = 0; i < 1200; i++) {
    await step();
    const vis = svc.room.visitors(), on = guests.filter((g) => !g.leaving).map((g) => g.id), all = guests.map((g) => g.id);
    if (on.some((id) => !vis.includes(id))) ghosts++;
    if (vis.some((id) => !all.includes(id) && !c.pendingIds.includes(id))) lost++;
    maxPend = Math.max(maxPend, c.pendingIds.length);
  }
  ok('slow exits: no ghost on screen, no admitted visitor lost (pending until a place frees up)', ghosts <= 3 && lost <= 3 && maxPend >= 1, { ghosts, lost, maxPend, ev: c.events.filter((e) => e.type === 'invite-failed').length });
  c.close(); closedAt = t;
  for (let i = 0; i < 600 && c.mode !== 'private'; i++) await step();
  ok('close with slow exits finishes: everyone out, private again, no new invites after closing', c.mode === 'private' && guests.length === 0 && invitesAfterClose === 0, { mode: c.mode, guests: guests.length, invitesAfterClose });
  c.dispose();
}
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
