// REBOOT R6 (desktop app) — MIInstagram between two real players over a P2P link (in memory here): posts with
// photos, reactions and comments sent to the author and echoed back, deletes, catch-up when a friend comes online,
// what is never carried (simulated Miis) and what is refused (forged updates). Run from client/web:
//   npx tsx ../../tests/unit/p2pfeed.test.mts
import { LocalSocialService } from '../../client/web/src/reboot/miinstagram/LocalSocialService';
import { MemoryPhotoStore } from '../../client/web/src/reboot/miinstagram/PhotoStore';
import { P2PFeedSync, FEED_CH } from '../../client/web/src/reboot/miinstagram/P2PFeedSync';
import { FeedSimulator } from '../../client/web/src/reboot/miinstagram/FeedSimulator';
import { Relations } from '../../client/web/src/reboot/miinstagram/relations';
import type { RebootP2P } from '../../client/web/src/reboot/host';
import { kv } from './r5-fakehost.mts';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const PH = 'data:image/jpeg;base64,' + 'A'.repeat(400);
const A_ID = 'p2p-aaaaaaaaaaaaaaaa', B_ID = 'p2p-bbbbbbbbbbbbbbbb';

/** Two players linked like the P2P engine links them (JSON round trip = what the wire does). */
function link() {
  const subs: Record<string, Map<string, Set<(from: string, d: unknown) => void>>> = { [A_ID]: new Map(), [B_ID]: new Map() };
  const onl: Record<string, Set<(id: string) => void>> = { [A_ID]: new Set(), [B_ID]: new Set() };
  const online = { v: true };
  const sent: { from: string; data: any }[] = [];
  const end = (me: string, other: string): RebootP2P => ({
    me: () => me, online: () => (online.v ? [other] : []),
    send: (ch, data, to) => { if (!online.v || (to && to !== other)) return; sent.push({ from: me, data }); const copy = JSON.parse(JSON.stringify(data)); setTimeout(() => { for (const cb of subs[other].get(ch) ?? []) cb(me, copy); }, 0); },
    on: (ch, cb) => { let s = subs[me].get(ch); if (!s) subs[me].set(ch, (s = new Set())); s.add(cb); return () => s!.delete(cb); },
    onOnline: (cb) => { onl[me].add(cb); return () => onl[me].delete(cb); },
  });
  return { a: end(A_ID, B_ID), b: end(B_ID, A_ID), online, sent, comeOnline: () => { online.v = true; for (const cb of onl[A_ID]) cb(B_ID); for (const cb of onl[B_ID]) cb(A_ID); } };
}
const L = link();
const A = new LocalSocialService(new MemoryPhotoStore(), kv()), B = new LocalSocialService(new MemoryPhotoStore(), kv());
const kvA = kv(), kvB = kv();
let sa = new P2PFeedSync(A, L.a, kvA), sb = new P2PFeedSync(B, L.b, kvB);

// a photo post
const p = await A.createPhotoPost('host', { photo: PH, caption: 'Ciao da Alice', source: 'room' });
await A.react(p.ok ? p.value.id : '', 'f1', 'like');                    // a simulated local Mii on Alice's device
await flush();
const remoteId = `${A_ID}:${(p as any).value.id}`;
const onB = await B.get(remoteId);
ok('post: reaches the friend with its photo, as a post BY that friend', onB.ok && onB.value.authorId === A_ID && onB.value.kind === 'photo' && (onB.value as any).caption === 'Ciao da Alice' && (await B.photo((onB.value as any).photoId)) === PH, onB);
ok('simulated local Miis are never carried (their reaction stays on Alice\'s device)', onB.ok && !('f1' in onB.value.reactions) && !Object.keys(onB.value.reactions).length);

// Bob reacts and comments on Alice's post
await B.react(remoteId, 'host', 'wow'); await B.comment(remoteId, 'host', { text: 'Bellissima!' });
await flush();
const onA = (await A.get((p as any).value.id)) as any;
ok('Bob\'s reaction and comment reach Alice\'s post, under Bob\'s id', onA.value.reactions[B_ID] === 'wow' && onA.value.comments.some((c: any) => c.authorId === B_ID && c.text === 'Bellissima!'), onA.value);
const back = (await B.get(remoteId)) as any;
ok('the author\'s update comes back: Bob sees his own reaction / comment as "host"', back.value.reactions.host === 'wow' && back.value.comments.some((c: any) => c.authorId === 'host' && c.text === 'Bellissima!') && !('f1' in back.value.reactions), back.value);

// forged messages
const before = sb.stats.refused;
L.b.send(FEED_CH, { op: 'react', id: 'nope', reaction: 'like' });                       // not a post of Alice
L.b.send(FEED_CH, { op: 'update', post: { id: 'never-seen', kind: 'answer' } });       // an update for a post Alice does not have
await flush();
ok('refused: reactions on posts that are not the receiver\'s own, updates for unknown posts', sa.stats.refused >= 2 && sb.stats.refused === before);
L.b.send(FEED_CH, { op: 'posts', items: [{ post: { id: 'q-1', authorId: A_ID, createdAt: new Date().toISOString(), reactions: {}, comments: [], kind: 'answer', question: { key: 'x' }, answer: 'fake' }, photo: null }] });
await flush();
const spoof = (await A.feed({ limit: 30 })) as any;
ok('a post claiming another author is stored as the SENDER\'s (no impersonation)', spoof.value.items.filter((x: any) => x.id === `${B_ID}:q-1`).every((x: any) => x.authorId === B_ID) && !spoof.value.items.some((x: any) => x.authorId === A_ID && x.id.startsWith('p2p')), spoof.value.items.map((x: any) => [x.id, x.authorId]));

// delete
await A.deletePost((p as any).value.id, 'host'); await flush();
ok('the author deletes: gone on the friend\'s side too', !(await B.get(remoteId)).ok);

// catch-up when a friend comes online
L.online.v = false;
await A.createAnswerPost('host', { question: { key: 'q.x' }, answer: 'Pizza' });
await flush();
const missed = (await B.feed({ limit: 30 })) as any;
ok('offline: nothing sent', !missed.value.items.some((x: any) => x.kind === 'answer' && x.answer === 'Pizza'));
L.comeOnline(); await flush();
const caught = (await B.feed({ limit: 30 })) as any;
ok('a friend comes online: they get my latest posts', caught.value.items.some((x: any) => x.kind === 'answer' && x.answer === 'Pizza' && x.authorId === A_ID));

// the simulator never acts as a real person
const rel = new Relations(null);
const sim = new FeedSimulator(B, { friends: async () => [{ id: A_ID, name: 'Alice', personality: 3 }, { id: 'f9', name: 'Sim', personality: 3 }], relations: rel, onTick: () => () => {}, seed: 3, config: { meetChance: 5, visitChance: 1, gameChance: 1 } });
await sim.refresh();
sim.visit(A_ID, 'Bob'); sim.conversation(A_ID, 'f9', 6);
sim.game({ sessionId: 's1', winners: [A_ID], players: [{ id: A_ID, name: 'Alice', score: 400 }, { id: 'host', name: 'Bob', score: 100 }] }, 'Quiz');
await B.createPhotoPost('host', { photo: PH, caption: 'x', source: 'room' });
for (let i = 0; i < 400; i++) sim.tick(1);
await flush();
const all = (await B.feed({ limit: 30 })) as any;
const fake = all.value.items.filter((x: any) => x.authorId === A_ID && !x.id.startsWith(A_ID + ':'));
const fakeActs = all.value.items.flatMap((x: any) => [...Object.keys(x.reactions), ...x.comments.map((c: any) => c.authorId)]).filter((id: string) => id === A_ID);
ok('simulator: no post, reaction or comment ever made in a real friend\'s name', !fake.length && !fakeActs.length, { fake, fakeActs });
// ---- 0.2: what happens while the other player's Reboot page is CLOSED (v1 lost all of it)
sb.dispose();                                                          // Bob goes to the launcher: no feed page listening
const away = (await A.createPhotoPost('host', { photo: PH, caption: 'Mentre eri via', source: 'room' })) as any;
await flush();
ok('while Bob\'s page is closed, nothing reaches his feed (nobody listens)', !(await B.get(`${A_ID}:${away.value.id}`)).ok);
sb = new P2PFeedSync(B, L.b, kvB); await flush(); await flush();       // Bob opens Reboot again: hello → Alice answers
const gotAway = (await B.get(`${A_ID}:${away.value.id}`)) as any;
ok('Bob\'s page opens: it asks Alice (hello) and gets the post made meanwhile, with its photo', gotAway.ok && (await B.photo(gotAway.value.photoId)) === PH, gotAway);
sa.dispose();                                                          // now Alice is away
await B.comment(`${A_ID}:${away.value.id}`, 'host', { text: 'Ti ho visto!' });
await A.deletePost((caught.value.items.find((x: any) => x.answer === 'Pizza')?.id ?? '').split(':')[1] ?? '', 'host').catch(() => null);
await flush();
ok('Bob comments while Alice\'s page is closed: kept in Bob\'s outbox (not lost)', sb.pending === 1, sb.pending);
sa = new P2PFeedSync(A, L.a, kvA); await flush(); await flush();
const mineNow = (await A.get(away.value.id)) as any;
ok('Alice\'s page opens: Bob\'s comment arrives (outbox resent, applied once, acknowledged)', mineNow.value.comments.filter((c: any) => c.authorId === B_ID && c.text === 'Ti ho visto!').length === 1 && sb.pending === 0, { c: mineNow.value.comments, pending: sb.pending });
await flush();
const bobCopy = (await B.get(`${A_ID}:${away.value.id}`)) as any;
ok('… and Bob\'s copy shows his comment once (the author\'s update replaced the local one)', bobCopy.value.comments.filter((c: any) => c.text === 'Ti ho visto!').length === 1, bobCopy.value.comments);
// a deletion while Bob's page is closed
sb.dispose();
await A.deletePost(away.value.id, 'host'); await flush();
ok('deleted while Bob is away: still in Bob\'s copy for now', (await B.get(`${A_ID}:${away.value.id}`)).ok);
sb = new P2PFeedSync(B, L.b, kvB); await flush(); await flush();
ok('Bob\'s page opens: the post deleted meanwhile is gone (Alice\'s list of live posts)', !(await B.get(`${A_ID}:${away.value.id}`)).ok);
// a repeated comment message (ack lost) is applied once
const before2 = (await A.get(away.value.id)).ok;
const myP = (await A.createAnswerPost('host', { question: { key: 'q.y' }, answer: 'Mare' })) as any; await flush();
L.b.send(FEED_CH, { v: 2, op: 'comment', oid: 'same-oid', id: myP.value.id, text: 'Uno' });
L.b.send(FEED_CH, { v: 2, op: 'comment', oid: 'same-oid', id: myP.value.id, text: 'Uno' });
await flush();
ok('the same comment sent twice (lost ack) is applied once', ((await A.get(myP.value.id)) as any).value.comments.filter((c: any) => c.text === 'Uno').length === 1 && !before2);
sa.dispose(); sb.dispose(); sim.dispose();
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
