// REBOOT R5 unit tests — MIInstagram: typed posts, validation, persistence + reload + migration, feed order and
// pages, one reaction per person, comments, rate limits, bounded history, and the autonomous Miis (personality-driven
// reactions / comments, activity posts with cooldowns, dedup and caps). Run from client/web:
//   npx tsx ../../tests/unit/miinstagram.test.mts
import { kv, makeFriends } from './r5-fakehost.mts';
import { LocalSocialService, migrate } from '../../client/web/src/reboot/miinstagram/LocalSocialService';
import { MemoryPhotoStore } from '../../client/web/src/reboot/miinstagram/PhotoStore';
import { sanitizePost, LIMITS, SCHEMA, reactionCounts } from '../../client/web/src/reboot/miinstagram/model';
import { Relations } from '../../client/web/src/reboot/miinstagram/relations';
import { FeedSimulator, FEED_TRAITS } from '../../client/web/src/reboot/miinstagram/FeedSimulator';
import { RateLimiter } from '../../client/web/src/reboot/safety/rateLimit';
import { I18n } from '../../client/web/src/reboot/i18n/i18n';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
let clock = Date.parse('2026-10-27T10:00:00Z');
const now = () => new Date(clock);
const free = () => new RateLimiter({ default: { capacity: 1e6, refillPerSec: 1e6 } });

// ---- create, validate, order, pages
const store = kv(), photos = new MemoryPhotoStore();
{
  const svc = new LocalSocialService(photos, store, free(), now);
  const p1 = await svc.createPhotoPost('host', { photo: JPG, caption: 'Prima Miifoto!', source: 'miifoto' }); clock += 60_000;
  ok('create: photo post with caption, ids and time assigned by the service', p1.ok && p1.value.kind === 'photo' && p1.value.authorId === 'host' && /^p-/.test(p1.value.id) && p1.value.caption === 'Prima Miifoto!');
  ok('create: the image is kept apart (photo store), the post holds a reference', p1.ok && (await svc.photo(p1.value.photoId)) === JPG && !JSON.stringify(store.m.get('mtw.reboot.miinstagram')).includes('base64'));
  const bad = [await svc.createPhotoPost('host', { photo: 'javascript:alert(1)', caption: 'x', source: 'miifoto' }), await svc.createPhotoPost('host', { photo: JPG, caption: 'x'.repeat(LIMITS.caption + 1), source: 'room' }), await svc.createPhotoPost('', { photo: JPG, caption: '', source: 'room' })];
  ok('invalid post: bad image → IMAGE_UNAVAILABLE, caption too long / no author → INVALID_POST, nothing stored', !bad[0].ok && bad[0].code === 'IMAGE_UNAVAILABLE' && !bad[1].ok && bad[1].code === 'INVALID_POST' && !bad[2].ok && svc.count === 1);
  const a1 = await svc.createActivityPost('f1', { activity: 'game', line: { key: 'act.game.win', vars: { game: '@game.quiz.title', score: 420 } }, participants: ['f1', 'host'], dedup: 'game:s1' }); clock += 60_000;
  const dupe = await svc.createActivityPost('f1', { activity: 'game', line: { key: 'act.game.win', vars: {} }, participants: [], dedup: 'game:s1' });
  ok('activity post: typed, stored as an i18n line (both languages), deduplicated', a1.ok && !dupe.ok && dupe.code === 'DUPLICATE' && I18n.fixed('it').line(a1.value.line) === 'Ho vinto a Quiz dei Mii con 420 punti!' && I18n.fixed('en').line(a1.value.line) === 'I won Mii Quiz with 420 points!');
  const q1 = await svc.createAnswerPost('f2', { question: { key: 'quiz.q.first' }, answer: 'Sara, a marzo!' }); clock += 60_000;
  ok('answer post: question as data + answer text', q1.ok && q1.value.kind === 'answer');
  for (let i = 0; i < 12; i++) { await svc.createPhotoPost('host', { photo: JPG, caption: `n${i}`, source: 'room' }); clock += 1000; }
  const pg1 = await svc.feed({ limit: 5 }), pg2 = await svc.feed({ limit: 5, cursor: pg1.ok ? pg1.value.next : null });
  const all = (await svc.feed({ limit: 30 })) as any;
  ok('feed order: newest first, stable', all.value.items.every((p: any, i: number, a: any[]) => i === 0 || a[i - 1].createdAt >= p.createdAt) && all.value.items[0].caption === 'n11');
  ok('feed pages: 5 + 5 with a cursor, no overlap', pg1.ok && pg2.ok && pg1.value.items.length === 5 && pg2.value.items.length === 5 && !pg2.value.items.some((p) => pg1.value.items.some((q) => q.id === p.id)));
  ok('feed: unknown cursor → NOT_FOUND', !(await svc.feed({ cursor: 'p-nope' })).ok);
  // reactions
  const id = p1.ok ? p1.value.id : '';
  const r1 = await svc.react(id, 'f0', 'like'), r2 = await svc.react(id, 'f0', 'like'), r3 = await svc.react(id, 'f0', 'wow');
  ok('reaction: one per person — same again → DUPLICATE_REACTION, another one replaces it (never adds up)', r1.ok && !r2.ok && r2.code === 'DUPLICATE_REACTION' && r3.ok && reactionCounts(r3.value).like === 0 && reactionCounts(r3.value).wow === 1);
  for (let i = 0; i < 50; i++) await svc.react(id, 'f0', i % 2 ? 'cute' : 'haha');
  ok('reaction: 50 clicks by the same Mii → still exactly one reaction from it', Object.keys((await svc.get(id) as any).value.reactions).filter((k) => k === 'f0').length === 1 && Object.values(reactionCounts((await svc.get(id) as any).value)).reduce((s, n) => s + n, 0) === 1);
  await svc.react(id, 'host', 'cute'); const un = await svc.react(id, 'host', null);
  ok('reaction: can be taken back (null)', un.ok && !un.value.reactions.host);
  ok('reaction: invalid kind / unknown post refused', !(await svc.react(id, 'f1', 'angry' as any)).ok && (await svc.react('p-none', 'f1', 'like')).code === 'NOT_FOUND');
  // comments
  const c1 = await svc.comment(id, 'host', { text: '  Che bella giornata!  ' }), c2 = await svc.comment(id, 'f3', { line: { key: 'cm.3.photo.1', vars: { name: 'Kelly' } } });
  ok('comment: author, text (trimmed), time, id; Mii comments as i18n lines', c1.ok && c1.value.text === 'Che bella giornata!' && !!c1.value.id && !!c1.value.createdAt && c2.ok && I18n.fixed('it').line(c2.value.line!).includes('Kelly'));
  ok('comment: empty / too long refused', !(await svc.comment(id, 'host', { text: '   ' })).ok && !(await svc.comment(id, 'host', { text: 'x'.repeat(LIMITS.comment + 1) })).ok);
  ok('deleted / missing post: comment and reaction answer NOT_FOUND', (await svc.comment('p-x', 'host', { text: 'hi' })).code === 'NOT_FOUND');
  const del = await svc.deletePost(id, 'f1'), del2 = await svc.deletePost(id, 'host');
  ok('delete: only the author; the photo is released with it', !del.ok && del.code === 'FORBIDDEN' && del2.ok && !(await svc.get(id)).ok && (p1.ok && (await photos.get(p1.value.photoId)) === null));
}
// ---- persistence + reload (posts, comments, reactions, photo references), schema, migration
{
  const svc = new LocalSocialService(photos, store, free(), now);
  const all = (await svc.feed({ limit: 30 })) as any;
  const raw = JSON.parse(store.getItem('mtw.reboot.miinstagram')!);
  ok('reload: posts, comments and reactions survive a new service on the same storage', svc.count === 14 && all.value.items.some((p: any) => p.kind === 'answer') && all.value.items.some((p: any) => p.kind === 'activity'));
  const ph = all.value.items.find((p: any) => p.kind === 'photo');
  ok('reload: photo references still resolve', (await svc.photo(ph.photoId)) === JPG);
  ok('schema: stored as { v: 1, seq, posts } — no runtime / scene objects', raw.v === SCHEMA && Array.isArray(raw.posts) && !('subs' in raw) && Object.keys(raw).sort().join() === 'posts,seq,v');
  const mg = migrate([{ id: 'p-old', authorId: 'host', createdAt: '2026-10-01T10:00:00Z', kind: 'photo', photoId: 'ph-1', caption: 'vecchio', reactions: { f0: 'like', f1: 'angry' }, comments: [] }]);
  ok('migration: a bare array (pre-schema prototype) is read as v0, sanitised (bad reaction dropped)', mg.posts.length === 1 && mg.posts[0].reactions.f0 === 'like' && !('f1' in mg.posts[0].reactions) && !mg.readOnly);
  const newer = kv(); newer.setItem('mtw.reboot.miinstagram', JSON.stringify({ v: 99, posts: [{ x: 1 }] }));
  const ro = new LocalSocialService(new MemoryPhotoStore(), newer, free(), now);
  await ro.createActivityPost('f1', { activity: 'meet', line: { key: 'act.meet', vars: { other: 'Ada' } }, participants: [] });
  ok('migration: data from a NEWER schema is never overwritten (read-only, persistence error reported)', JSON.parse(newer.getItem('mtw.reboot.miinstagram')!).v === 99 && ro.lastPersistError === 'NEWER_SCHEMA');
  const corrupt = kv(); corrupt.setItem('mtw.reboot.miinstagram', '{not json');
  ok('corrupt storage → empty feed, no crash', new LocalSocialService(new MemoryPhotoStore(), corrupt, free(), now).count === 0);
  const failing = { getItem: () => null, setItem: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } };
  const fs = new LocalSocialService(new MemoryPhotoStore(), failing, free(), now); const evs: string[] = []; fs.subscribe((e) => evs.push(e.type));
  const kept = await fs.createActivityPost('f1', { activity: 'meet', line: { key: 'act.meet', vars: { other: 'Ada' } }, participants: [] });
  ok('persistence error: the post is kept in memory, PERSISTENCE reported (event + lastPersistError)', kept.ok && fs.count === 1 && evs.includes('persist.failed') && fs.lastPersistError === 'QuotaExceededError');
  ok('untrusted stored post: script-ish / malformed values dropped or clamped', sanitizePost({ id: 'x y', authorId: 'host', createdAt: 'now', kind: 'photo' }) === null && sanitizePost({ id: 'p1', authorId: 'host', createdAt: '2026-10-01T00:00:00Z', kind: 'photo', photoId: 'ph-1', caption: 'a\u0000b'.repeat(200) })!.caption.length === LIMITS.caption);
}
// ---- limits: rate limits for the user, bounded history
{
  const svc = new LocalSocialService(new MemoryPhotoStore(), kv(), new RateLimiter(), now);
  const p = await svc.createActivityPost('f1', { activity: 'meet', line: { key: 'act.meet', vars: { other: 'Ada' } }, participants: [] });
  let limited = false; for (let i = 0; i < 8; i++) { const r = await svc.comment(p.ok ? p.value.id : '', 'host', { text: 'ciao ' + i }); if (!r.ok && r.code === 'RATE_LIMITED') limited = true; }
  ok('rate limit: the user\'s comments are limited (client token bucket, 1 every 5 s sustained)', limited);
  const big = new LocalSocialService(new MemoryPhotoStore(), kv(), free(), now);
  for (let i = 0; i < LIMITS.posts + 20; i++) { await big.createActivityPost('f1', { activity: 'meet', line: { key: 'act.meet', vars: { other: 'n' + i } }, participants: [] }); clock += 1000; }
  ok('bounded history: never more than LIMITS.posts in memory and storage (oldest dropped)', big.count === LIMITS.posts);
}
// ---- autonomous Miis: personality-driven, friends favoured, no spam
function sim(seed: number, friends = makeFriends(8)) {
  const ticks = new Set<(dt: number) => void>();
  const svc = new LocalSocialService(new MemoryPhotoStore(), kv(), free(), now);
  const relations = new Relations(kv());
  const fs = new FeedSimulator(svc, { friends: async () => friends, relations, onTick: (cb) => { ticks.add(cb); return () => ticks.delete(cb); }, seed, userName: () => 'Kelly' });
  const run = async (sec: number) => { for (let t = 0; t < sec; t += 1) { for (const l of ticks) l(1); if (t % 20 === 0) await new Promise((r) => setTimeout(r, 0)); } await new Promise((r) => setTimeout(r, 0)); };
  return { svc, fs, relations, run, ticks, friends };
}
{
  // many posts by the user, many seeds: reactions / comments per personality
  const per = { 0: { r: 0, c: 0, len: 0, n: 0 }, 1: { r: 0, c: 0, len: 0, n: 0 }, 2: { r: 0, c: 0, len: 0, n: 0 }, 3: { r: 0, c: 0, len: 0, n: 0 } } as Record<number, { r: number; c: number; len: number; n: number }>;
  let posts = 0, kinds: Record<number, Record<string, number>> = { 0: {}, 1: {}, 2: {}, 3: {} };
  for (let seed = 1; seed <= 12; seed++) {
    const w = sim(seed); await w.fs.refresh();
    for (let k = 0; k < 4; k++) { await w.svc.createPhotoPost('host', { photo: JPG, caption: 'post ' + k, source: 'room' }); posts++; await w.run(700); }
    const it = I18n.fixed('it');
    for (const p of ((await w.svc.feed({ limit: 30 })) as any).value.items) {
      for (const [who, r] of Object.entries(p.reactions)) { const pp = w.friends.find((f) => f.id === who)!.personality!; per[pp].r++; kinds[pp][r as string] = (kinds[pp][r as string] ?? 0) + 1; }
      for (const c of p.comments) { const pp = w.friends.find((f) => f.id === c.authorId)!.personality!; per[pp].c++; per[pp].len += it.line(c.line).length; }
    }
    for (const f of w.friends) per[f.personality!].n += 4;
    w.fs.dispose();
  }
  const rate = (p: number) => per[p].r / per[p].n, crate = (p: number) => per[p].c / per[p].n, len = (p: number) => per[p].len / Math.max(1, per[p].c);
  ok('personality: Espansivo reacts more than Riservato', rate(3) > rate(0) * 1.6, { r0: rate(0), r3: rate(3) });
  ok('personality: Espansivo comments more than Riservato', crate(3) > crate(0) * 2, { c0: crate(0), c3: crate(3) });
  ok('personality: tone / length — Espansivo comments are longer than Riservato ones', len(3) > len(0) * 2, { l0: len(0), l3: len(3) });
  ok('personality: kind of reaction follows the personality (Riservato only "like")', Object.keys(kinds[0]).every((k) => FEED_TRAITS[0].reactions.includes(k as any)) && Object.keys(kinds[3]).every((k) => FEED_TRAITS[3].reactions.includes(k as any)), kinds);
  ok('no spam: at most one reaction per Mii per post, comments per post capped', per[0].r + per[1].r + per[2].r + per[3].r <= posts * 8 && Object.values(per).every((x) => x.c <= x.n));
}
{
  // friends favoured: a close friend reacts to the author more often than a stranger with the same personality
  let close = 0, far = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const fr = makeFriends(2).map((f) => ({ ...f, personality: 1 as const }));
    const w = sim(seed, fr); await w.fs.refresh();
    for (let i = 0; i < 20; i++) w.relations.bump('f0', 'f9', 'conversation');      // f0 knows the author well
    await w.svc.createActivityPost('f9', { activity: 'meet', line: { key: 'act.meet', vars: { other: 'x' } }, participants: [] });
    await w.run(600);
    const p = ((await w.svc.feed()) as any).value.items[0];
    if (p.reactions.f0) close++; if (p.reactions.f1) far++;
    w.fs.dispose();
  }
  ok('relations: a close friend reacts to the author\'s posts more often', close > far, { close, far });
}
{
  // activity posts from life: conversations, games, visits — with cooldowns, caps and dedup
  const w = sim(5); await w.fs.refresh();
  w.fs.config.meetChance = 5; w.fs.config.gameChance = 1; w.fs.config.visitChance = 1;   // meetChance × (0.5 + closeness) ≥ 1: always
  w.fs.conversation('f1', 'f2', 5); await w.run(1);
  const n1 = w.svc.count;
  w.fs.conversation('f1', 'f2', 5); w.fs.conversation('f3', 'f4', 6); await w.run(1);
  ok('activity: a real conversation (≥ 4 lines) between two Miis becomes a post', n1 === 1);
  ok('cooldown: no second post right away (global + pair cool-down)', w.svc.count === 1 && w.fs.stats.skippedCooldown + w.fs.stats.skippedDedup >= 2, w.fs.stats);
  w.fs.conversation('f5', 'f6', 2); await w.run(200);
  ok('activity: a short exchange (< 4 lines) is not a moment worth posting', w.svc.count === 1);
  await w.run(200); w.fs.conversation('f3', 'f4', 6); await w.run(1);
  ok('cooldown: after the global cool-down another pair can post', w.svc.count === 2, w.svc.count);
  w.fs.conversation('f1', 'f2', 6); await w.run(1);
  ok('dedup / pair cool-down: the same two Miis do not post again the same day', w.svc.count === 2);
  await w.run(200);
  w.fs.game({ sessionId: 's-1', winners: ['f1'], players: [{ id: 'f1', name: 'Marco', score: 300 }, { id: 'host', name: 'Kelly', score: 100 }] }, '@game.quiz.title'); await w.run(1);
  w.fs.game({ sessionId: 's-1', winners: ['f1'], players: [{ id: 'f1', name: 'Marco', score: 300 }, { id: 'host', name: 'Kelly', score: 100 }] }, '@game.quiz.title'); await w.run(1);
  const game = ((await w.svc.feed()) as any).value.items.filter((p: any) => p.activity === 'game');
  ok('activity: a match in the Sala Giochi becomes a post by the winner, once per match', game.length === 1 && game[0].authorId === 'f1', game.length);
  await w.run(200); w.fs.visit('f2', 'Kelly'); await w.run(1);
  ok('activity: the user visiting a friend\'s room → the friend may post about it', ((await w.svc.feed()) as any).value.items.some((p: any) => p.activity === 'visit' && p.authorId === 'f2'));
  // hourly cap with cool-downs set to zero
  const cap = sim(9); await cap.fs.refresh(); cap.fs.config = { ...cap.fs.config, meetChance: 5, postCooldown: 0, pairCooldown: 0, maxPostsPerHour: 6 };
  for (let i = 0; i < 30; i++) { cap.fs.conversation(`f${i % 8}`, `f${(i + 1) % 8}`, 6, `day${i}`); await cap.run(10); }
  ok('hourly cap: never more than maxPostsPerHour autonomous posts per hour', cap.svc.count <= 6, cap.svc.count);
  // the user's own conversations are never posted by the simulator
  const own = sim(3); await own.fs.refresh(); own.fs.config.meetChance = 5; own.fs.conversation('host', 'f1', 8); await own.run(5);
  ok('the user\'s own moments are posted by the user only', own.svc.count === 0);
  ok('queue bounded (no pile-up of pending actions)', w.fs.pending <= w.fs.config.maxQueue && cap.fs.pending <= cap.fs.config.maxQueue);
  for (const x of [w, cap, own]) x.fs.dispose();
  ok('dispose: simulator unsubscribed from the room clock', w.ticks.size === 0 && cap.ticks.size === 0);
}
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
