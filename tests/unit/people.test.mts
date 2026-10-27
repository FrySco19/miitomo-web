// REBOOT R6 unit tests — "My page" / "Friends" models: relationship levels over the R5 Relations value, where each
// local friend is (read from the places, consistent with presence), and a visit started like the Friends app does it
// (through the REAL SocialHub). Run from client/web: npx tsx ../../tests/unit/people.test.mts
import { FakeHost, makeFriends, kv, flush, installWindow } from './r5-fakehost.mts';
import { LocalPlacesService, GAMES_ID } from '../../client/web/src/reboot/places/LocalPlacesService';
import { PlaceVisit } from '../../client/web/src/reboot/places/PlaceVisit';
import { SocialHub } from '../../client/web/src/reboot/hub/SocialHub';
import { I18n } from '../../client/web/src/reboot/i18n/i18n';
import { Relations } from '../../client/web/src/reboot/miinstagram/relations';
import { relationLevel, LEVEL_FROM } from '../../client/web/src/reboot/people/levels';
import { LocalSocialService } from '../../client/web/src/reboot/miinstagram/LocalSocialService';
import { MemoryPhotoStore } from '../../client/web/src/reboot/miinstagram/PhotoStore';
import { roomTitle, PUBLIC_TEMPLATES } from '../../client/web/src/reboot/rooms/templates';

installWindow();
let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };

// ---------------- levels
const L = (v: number) => relationLevel(v);
ok('levels: every friend starts at "Friend", 0% of the way', L(0.35).level === 0 && L(0.35).progress === 0 && L(0.35).next === 1);
ok('levels: thresholds 0.5 / 0.7 / 0.9', L(0.499).level === 0 && L(0.5).level === 1 && L(0.699).level === 1 && L(0.7).level === 2 && L(0.9).level === 3);
ok('levels: progress inside a level, top level full', Math.abs(L(0.6).progress - 0.5) < 1e-9 && L(1).progress === 1 && L(1).next === null);
ok('levels: bad values are safe (NaN → start, >1 clamped)', L(NaN).level === 0 && L(7).level === 3 && L(-1).progress === 0);
const rel = new Relations(null);
for (let i = 0; i < 4; i++) rel.bump('host', 'f1', 'conversation');
ok('levels: real things move it — 4 finished chats make a "Good friend"', L(rel.get('host', 'f1')).level === 1 && L(rel.get('host', 'f2')).level === 0, rel.get('host', 'f1'));
ok('levels: thresholds documented as LEVEL_FROM', LEVEL_FROM.join() === '0.35,0.5,0.7,0.9');

// ---------------- where each friend is
const host = new FakeHost(makeFriends(7));
const places = new LocalPlacesService({ friends: host.friends, blocked: () => [] }, 5);
ok('whereIs before the places exist: unknown, nowhere to go', places.whereIs('f0').at === 'unknown' && places.whereIs('f0').placeId === null);
await places.refresh();
const all = makeFriends(7).map((f) => ({ id: f.id, w: places.whereIs(f.id) }));
const consistent = all.every(({ id, w }) => {
  if (w.at === 'home') return w.placeId === 'room:' + id && !!places.get(w.placeId)?.has(id);
  if (w.at === 'room') return !!w.placeId && w.placeId !== 'room:' + id && !!places.get(w.placeId)?.has(id) && !!w.ownerName;
  if (w.at === 'games') return w.placeId === GAMES_ID && !!places.get(GAMES_ID)?.has(id);
  return w.placeId === null && places.list().every((p) => !places.get(p.id)!.has(id));
});
ok('whereIs: matches presence for every friend (home / visiting / Sala Giochi / out / private)', consistent, all);
const kinds = new Set(all.map((x) => x.w.at));
ok('whereIs: the fixture world has friends at home, visiting someone and in the Sala Giochi', kinds.has('home') && kinds.has('room') && kinds.has('games'), [...kinds]);
ok('whereIs: an unknown id is unknown', places.whereIs('nobody').at === 'unknown');
ok('refusalOf: same answer as the listing', places.list('friend').every((p) => places.refusalOf(p.id) === p.refusal) && places.refusalOf('nope') === 'NOT_FOUND');

// ---------------- visit a friend like the Friends app does (through the Piazza model)
{
  const visit = new PlaceVisit(host, places, { social: null, sceneOf: (id) => { const p = places.place(id); return p ? { id, skin: p.skin ?? { wall: '0000', floor: '0000', variant: 0 }, friendHost: p.owner?.personality ?? null } : null; } });
  const hub = new SocialHub({ rooms: null, inRoom: () => host.scr === 'room', onTick: (cb) => host.onTick(cb), i18n: I18n.fixed('en'), timeout: 60 });
  hub.register({ id: 'friends', title: 'Friends', subtitle: '', phase: 'R5', available: () => ({ ok: true, reason: '' }),
    go: async (roomId) => { if (!roomId) return { ok: false, code: 'NOT_FOUND' }; const r = await visit.enter(roomId, visit.inside); return { ok: r.ok, code: r.code }; },
    here: () => !!visit.roomId && places.place(visit.roomId)?.kind === 'friend', leave: () => visit.leave('user') });
  const go = async (to: string, arg?: string) => { const p = hub.go(to, arg); let res: any; void p.then((r) => (res = r)); for (let t = 0; t < 8 && res === undefined; t += 0.25) { host.step(0.25); await flush(); } return res ?? (await p); };
  const target = all.find((x) => x.w.at === 'home' && places.refusalOf(x.w.placeId!) === null)!;
  const r = await go('friends', target.w.placeId!);
  ok('visit from Friends: at the friend\'s room, as a visitor', r.ok && places.current === target.w.placeId && hub.at === 'friends', { r, cur: places.current });
  const blockedOne = all.find((x) => x.w.placeId && places.refusalOf(x.w.placeId) === 'FULL');
  if (blockedOne) {
    const r2 = await go('friends', blockedOne.w.placeId!);
    ok('visit a full room: refused with a translated reason, still where you were', !r2.ok && /full/i.test(r2.message ?? '') && places.current === target.w.placeId, r2);
  } else ok('visit a full room: (fixture has one)', false, all);
  await go('home');
  ok('back home: no presence left anywhere', places.current === null && host.scr === 'room');
  visit.dispose(); hub.dispose();
}

// ---------------- My page data
{
  const svc = new LocalSocialService(new MemoryPhotoStore(), kv());
  await svc.createActivityPost('f1', { activity: 'meet', line: { key: 'act.meet', vars: { other: 'Kelly' } }, participants: [] });
  await svc.createPhotoPost('host', { photo: 'data:image/jpeg;base64,/9j/AAAA', caption: 'one', source: 'room' });
  await svc.createPhotoPost('host', { photo: 'data:image/jpeg;base64,/9j/AAAA', caption: 'two', source: 'room' });
  const mine = svc.postsBy('host');
  ok('My page posts: only the user\'s posts, newest first, copies', mine.length === 2 && mine.every((p) => p.authorId === 'host') && (mine[0] as any).caption === 'two' && (mine[0].reactions.x = 'like' as any, !svc.postsBy('host')[0].reactions.x));
}
// ---------------- template titles follow the language (the user's custom title stays)
{
  const tpl = PUBLIC_TEMPLATES[0];
  ok('room title: template default translated, custom title untouched', roomTitle({ title: tpl.title, templateId: tpl.id }, I18n.fixed('en')) === 'Open lounge' && roomTitle({ title: tpl.title, templateId: tpl.id }, I18n.fixed('it')) === 'Salotto aperto' && roomTitle({ title: 'Da Kelly', templateId: tpl.id }, I18n.fixed('en')) === 'Da Kelly');
}
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
