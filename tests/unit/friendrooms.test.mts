// REBOOT R5 unit tests — friends' rooms: the visited side of R3 (RoomInstance, events, SceneBinding) on a fake host,
// navigated through the REAL SocialHub with the REAL R3 controller beside it. Run from client/web:
//   npx tsx ../../tests/unit/friendrooms.test.mts
import { FakeHost, makeFriends, kv, flush, installWindow } from './r5-fakehost.mts';
import { LocalPlacesService, FRIEND_ROOM_FIXTURE, GAMES_ID } from '../../client/web/src/reboot/places/LocalPlacesService';
import { PlaceVisit } from '../../client/web/src/reboot/places/PlaceVisit';
import { SocialHub } from '../../client/web/src/reboot/hub/SocialHub';
import { LocalRoomService } from '../../client/web/src/reboot/rooms/LocalRoomService';
import { PublicRoomController } from '../../client/web/src/reboot/rooms/PublicRoomController';
import { I18n } from '../../client/web/src/reboot/i18n/i18n';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
installWindow();

function world(nFriends = 7) {
  const host = new FakeHost(makeFriends(nFriends));
  const blocked: string[] = [];
  const places = new LocalPlacesService({ friends: host.friends, blocked: () => blocked }, 5);
  const policies: unknown[] = [];
  const social: any = { setPolicy: (p: unknown) => policies.push(p), resync: () => policies.push('resync') };
  const visit = new PlaceVisit(host, places, { social, sceneOf: (id) => { const p = places.place(id); return p ? { id, skin: p.skin ?? { wall: '0000', floor: '0000', variant: 0 }, friendHost: p.owner?.personality ?? null } : null; } });
  const rooms = new PublicRoomController(host, new LocalRoomService({ blocked: () => [] }, kv()), { multi: { settings: { miis: 4 } } as any, social: null, visits: { gap: [1, 2], stay: [30, 60], mischief: 0 }, seed: 2 });
  const hub = new SocialHub({ rooms, inRoom: () => host.scr === 'room', onTick: (cb) => host.onTick(cb), i18n: I18n.fixed('en'), timeout: 60 });
  hub.register({ id: 'friends', title: 'Friends', subtitle: '', phase: 'R5', panel: true, available: () => ({ ok: true, reason: '' }),
    go: async (roomId) => { if (!roomId) return { ok: false, code: 'NOT_FOUND' }; await places.refresh(); const r = await visit.enter(roomId, visit.inside); return { ok: r.ok, code: r.code }; },
    here: () => !!visit.roomId && places.place(visit.roomId)?.kind === 'friend', leave: () => visit.leave('user') });
  const evicted: string[] = [];
  visit.subscribe((e) => { if (e.type === 'evicted') { evicted.push(e.code); hub.evicted('friends', e.code); } });
  /** navigation runs on the room clock: drive the room while a navigation is pending */
  const go = async (to: string, arg?: string, sec = 6) => { const p = hub.go(to, arg); let res: any; void p.then((r) => (res = r)); for (let t = 0; t < sec && res === undefined; t += 0.25) { host.step(0.25); await flush(); } return res ?? (await p); };
  return { host, places, visit, hub, rooms, social, policies, blocked, go, evicted };
}

// ---- listing (deterministic fixture, local friends only)
{
  const w = world(7); await w.places.refresh();
  const list = w.places.list('friend');
  ok('listing: one room per local friend, in fixture order, nobody invented', list.length === 7 && list.every((p, i) => p.ownerId === `f${i}`), list.map((p) => p.ownerId));
  const st = list.map((p) => p.status);
  ok('listing: open, closed, almost full, private, full rooms from the fixture', st.includes('open') && st.includes('closed') && st.includes('private') && st.includes('full') && list[2].present === list[2].capacity - 1, st);
  ok('listing: presence counts include the owner, capacity from the room (e.g. 3/8)', list[0].present >= 1 && list[0].capacity === FRIEND_ROOM_FIXTURE[0].capacity && list.every((p) => p.present <= p.capacity));
  const everyone = new Set<string>(); let dup = 0;
  for (const p of [...list.map((v) => w.places.get(v.id)!), w.places.get(GAMES_ID)!]) for (const pr of p.presence()) { if (everyone.has(pr.profileId)) dup++; everyone.add(pr.profileId); }
  ok('listing: every Mii is in one place at a time (no Mii in two rooms)', dup === 0, dup);
  ok('listing: refusals already known (closed / private / full) before trying', list[1].refusal === 'CLOSED' && list[3].refusal === 'PRIVATE' && list[4].refusal === 'FULL' && list[0].refusal === null);
  const again = (await w.places.refresh(), w.places.list('friend'));
  ok('listing: stable (same friends → same world, refresh does not reshuffle)', JSON.stringify(again.map((p) => [p.id, p.present])) === JSON.stringify(list.map((p) => [p.id, p.present])));
  const none = new LocalPlacesService({ friends: async () => [], blocked: () => [] }); await none.refresh();
  ok('listing: no local friends → empty list (the UI shows an empty state), Sala Giochi still there', none.list('friend').length === 0 && !!none.get(GAMES_ID));
}
// ---- enter as a visitor, permissions, exit with cleanup (through the hub)
{
  const w = world(7); const { host, places, visit, hub } = w;
  await w.places.refresh();
  const base = { ...host.listeners(), svc: places.listenerCount };
  await hub.go('hub');
  const room = places.list('friend')[0];
  const r = await w.go('friends', room.id);
  ok('enter: navigation completed, location = friends, screen = the friend\'s place', r.ok && hub.at === 'friends' && host.scr === 'place:' + room.id && visit.mode === 'inside', { r, at: hub.at, scr: host.scr, mode: visit.mode });
  const inst = places.get(room.id)!;
  ok('enter: the user is a VISITOR, the friend stays OWNER', inst.role('host') === 'visitor' && inst.role(inst.ownerId) === 'owner');
  ok('enter: room capacity applied to the scene (capacity − 1 guests)', host.cap === inst.info.capacity - 1, host.cap);
  await host.run(2);
  const inScene = host.guests().map((g) => g.id).sort().join(), present = inst.presence().map((p) => p.profileId).filter((x) => x !== 'host').sort().join();
  ok('enter: whoever was inside is in the scene (owner + visitors, placed inside, no door)', inScene === present && host.guests().every((g) => g.state === 'idle'), { inScene, present });
  ok('permissions: visitor cannot kick / change settings / close (refused by RoomInstance, logged)', !visit.tryOwnerAction('kick', inst.ownerId) && !visit.tryOwnerAction('changeSettings') && !visit.tryOwnerAction('close') && places.log.filter((e) => e.type === 'room.denied' && (e as any).profileId === 'host').length >= 3 && inst.info.capacity === room.capacity);
  ok('permissions: interacting with the room is allowed when the owner allows objects', host.tapObject('shelf') === true);
  ok('social life: object policy installed for the visited room', typeof (w.policies.find((p) => p && typeof p === 'object') as any)?.canUseObject === 'function');
  // leave → Casa: complete cleanup
  const back = await w.go('home');
  await host.run(1);
  ok('exit → Casa: at home, presence removed from the friend\'s room, the others stay there', back.ok && hub.at === 'home' && !inst.has('host') && inst.presence().length >= 1 && host.homes === 1, { back, at: hub.at });
  ok('exit: scene emptied, capacity back, object policy removed, social policy removed + resync', host.guests().length === 0 && host.cap === 3 && host.objectPolicy === null && w.policies.includes(null) && w.policies.includes('resync'));
  ok('exit: no listener / timer left (ticks, guests, service)', host.listeners().tick === base.tick && host.listeners().guest === base.guest && places.listenerCount === base.svc && visit.resources.watch === 0 && visit.resources.unsubs === 0, { base, now: host.listeners(), svc: places.listenerCount, res: visit.resources });
}
// ---- full room / private / closed: refused, previous state intact
{
  const w = world(7); const { host, places, hub } = w;
  await places.refresh(); await hub.go('hub');
  const full = places.list('friend').find((p) => p.status === 'full')!;
  const before = { at: hub.at, scr: host.scr, cap: host.cap, guests: host.guests().length, ticks: host.ticks.size, pres: places.get(full.id)!.presence().length };
  const r = await w.go('friends', full.id);
  ok('full room: refused with FULL (REFUSED navigation), nothing changed', !r.ok && r.code === 'REFUSED' && r.detail === 'FULL' && hub.at === 'hub' && host.scr === before.scr && host.cap === before.cap && host.ticks.size === before.ticks && places.get(full.id)!.presence().length === before.pres, { r, at: hub.at });
  ok('full room: the error is observable in the hub state (message)', hub.state.lastError?.code === 'REFUSED' && /full/i.test(hub.state.lastError.message));
  const priv = places.list('friend').find((p) => p.status === 'private')!, closed = places.list('friend').find((p) => p.status === 'closed')!;
  const rp = await w.go('friends', priv.id), rc = await w.go('friends', closed.id);
  ok('private / closed rooms: refused (PRIVATE / CLOSED), still at the hub', rp.detail === 'PRIVATE' && rc.detail === 'CLOSED' && hub.at === 'hub');
  ok('denied joins are published as room.denied (moderation trail)', places.log.filter((e) => e.type === 'room.denied' && (e as any).action === 'join').length >= 3);
  w.blocked.push(places.list('friend')[0].ownerId);
  const rb = await w.go('friends', places.list('friend')[0].id);
  ok('blocked owner: refused (BLOCKED)', rb.detail === 'BLOCKED', rb);
  const rn = await w.go('friends', 'room:nobody');
  ok('unknown / removed room: refused (NOT_FOUND)', rn.detail === 'NOT_FOUND', rn);
}
// ---- objects reserved to the owner, switching rooms, room closed while visiting
{
  const w = world(7); const { host, places, visit, hub } = w;
  await places.refresh(); await hub.go('hub');
  const owner = places.list('friend')[2];          // fixture row 2: objects only for the owner
  await w.go('friends', owner.id);
  ok('permissions: "objects: owner only" → the player\'s object tap is refused and reported', host.tapObject('shelf') === false && visit.events.some((e) => e.type === 'denied' && e.action === 'useObjects'));
  const other = places.list('friend').find((p) => !p.refusal && p.id !== owner.id)!;
  const sw = await w.go('friends', other.id);
  await host.run(1);
  ok('switching: friend room → another friend room (leave + enter, one place at a time)', sw.ok && visit.roomId === other.id && !places.get(owner.id)!.has('host') && places.get(other.id)!.has('host') && host.places.slice(-2).join() === `${owner.id},${other.id}`, { sw, room: visit.roomId });
  const ghosts = host.guests().filter((g) => !places.get(other.id)!.has(g.id)).length;
  ok('switching: no ghost visitor from the previous room', ghosts === 0, host.guests());
  ok('switching: still one tick subscription (the visit\'s room clock), no duplicates', host.ticks.size === 1, host.ticks.size);
  places.ownerCloses(other.id);
  await host.run(1);
  ok('room closed while visiting: user sent out (evicted CLOSED), at the hub with the reason, scene clean', w.evicted.includes('CLOSED') && hub.at === 'hub' && visit.mode === 'none' && host.scr === 'room' && host.guests().length === 0 && /closed/i.test(hub.state.lastError?.message ?? ''), { ev: w.evicted, at: hub.at, err: hub.state.lastError });
  const again = await w.go('friends', other.id);
  ok('the closed room now refuses (CLOSED), hub usable', again.detail === 'CLOSED' && hub.at === 'hub');
  // removed while visiting
  const third = places.list('friend').find((p) => !p.refusal)!;
  await w.go('friends', third.id);
  places.remove(third.id); await host.run(1);
  ok('room removed while visiting: evicted REMOVED, back at the hub', w.evicted.includes('REMOVED') && hub.at === 'hub' && visit.mode === 'none');
}
// ---- turnover (others come and go through the door), presence ↔ scene in sync, Friend Room → Piazza
{
  const w = world(10); const { host, places, visit, hub } = w;
  places.turnover = { gap: [3, 6], stay: [8, 16] };
  await places.refresh(); await hub.go('hub');
  const room = places.list('friend')[0];
  await w.go('friends', room.id);
  let mismatch = 0, joins = 0, leaves = 0;
  visit.subscribe((e) => { if (e.type === 'join') joins++; if (e.type === 'leave') leaves++; });
  for (let i = 0; i < 40; i++) {
    await host.run(2); (visit as any).check();
    const inst = places.get(room.id)!; const pv = inst.presence().map((p) => p.profileId).filter((x) => x !== 'host').sort().join(); const gv = host.guests().filter((g) => !g.leaving && g.state !== 'exiting').map((g) => g.id).sort().join();
    if (pv !== gv && !visit.pendingIds.length) mismatch++;
  }
  ok('turnover: local friends come in (door) and leave while the user visits', joins >= 2 && leaves >= 2, { joins, leaves });
  ok('turnover: presence and scene stay in sync (no ghosts, nobody lost)', mismatch <= 3, mismatch);
  const r = await w.go('hub');
  ok('Friend Room → Piazza: at the hub, presence removed, scene emptied', r.ok && hub.at === 'hub' && !places.get(room.id)!.has('host') && host.guests().length === 0 && host.scr === 'room');
}
// ---- soak: 12 cycles Casa → Piazza → friend room → Piazza / Casa, nothing accumulates
{
  const w = world(7); const { host, places, visit, hub } = w;
  await places.refresh();
  const base = { ...host.listeners(), svc: places.listenerCount, hub: hub.listenerCount };
  let bad = 0;
  for (let i = 0; i < 12; i++) {
    await w.go('hub');
    const open = places.list('friend').filter((p) => !p.refusal);
    const r = await w.go('friends', open[i % open.length].id); if (!r.ok) bad++;
    await host.run(3);
    const r2 = await w.go(i % 2 ? 'hub' : 'home'); if (!r2.ok) bad++;
  }
  await w.go('home').catch(() => {});
  const now = { ...host.listeners(), svc: places.listenerCount, hub: hub.listenerCount };
  ok('soak: 12 cycles all completed', bad === 0, bad);
  ok('soak: listeners back to the start (ticks, guests, service, hub)', now.tick === base.tick && now.guest === base.guest && now.svc === base.svc && now.hub === base.hub, { base, now });
  ok('soak: no presence of the user anywhere, no guests, capacity back, no pending', places.current === null && host.guests().length === 0 && host.cap === 3 && visit.pendingIds.length === 0 && visit.resources.watch === 0);
  visit.dispose(); hub.dispose(); w.rooms.dispose();
}
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
