// REBOOT R5 unit tests — Sala Giochi: registry, Quiz dei Mii (questions only from the user's facts), sessions
// (start / finish / interruption / player left / invalid result), rewards, stats, cleanup, and the R2b additions it
// relies on (reserve / release, attraction, affinity) on a REAL SocialLife. Run from client/web:
//   npx tsx ../../tests/unit/gameroom.test.mts
import { FakeHost, makeFriends, kv, flush, installWindow } from './r5-fakehost.mts';
import { LocalPlacesService, GAMES_ID } from '../../client/web/src/reboot/places/LocalPlacesService';
import { PlaceVisit } from '../../client/web/src/reboot/places/PlaceVisit';
import { GameRegistry } from '../../client/web/src/reboot/games/GameRegistry';
import { MII_QUIZ, questionBank } from '../../client/web/src/reboot/games/MiiQuiz';
import { GameSession } from '../../client/web/src/reboot/games/GameSession';
import { GameRoomController, loadStats } from '../../client/web/src/reboot/games/GameRoomController';
import type { GameDefinition, GameContext } from '../../client/web/src/reboot/games/types';
import { SocialLife } from '../../client/web/src/reboot/social/SocialLife';
import { I18n } from '../../client/web/src/reboot/i18n/i18n';
import { rng } from '../../client/web/src/reboot/social/traits';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
installWindow();
const i18n = I18n.fixed('it');
const ctxOf = (n: number): GameContext => ({ me: { id: 'host', name: 'Kelly', personality: 3, birthday: { month: 5, day: 2 }, greeting: 'Eccomi!' }, friends: makeFriends(n) });

// ---- registry
{
  const reg = new GameRegistry();
  ok('registry: a game registers once', reg.register(MII_QUIZ) && !reg.register(MII_QUIZ) && reg.list().length === 1);
  ok('registry: invalid definitions refused (id, players)', !reg.register({ ...MII_QUIZ, id: 'Bad Id!' }) && !reg.register({ ...MII_QUIZ, id: 'x-ok', players: { min: 3, max: 2 } }) && !reg.register({ ...MII_QUIZ, id: 'x-big', players: { min: 1, max: 9 } }));
  const st = reg.status(ctxOf(0));
  ok('registry: availability per game (no facts → NOT_ENOUGH_DATA, said explicitly)', st[0].availability.ok === false && (st[0].availability as any).code === 'NOT_ENOUGH_DATA');
  ok('registry: available with a few local friends', reg.status(ctxOf(3))[0].availability.ok);
}
// ---- quiz: questions only from the facts the user entered
{
  const ctx = ctxOf(5), qs = questionBank(ctx, rng(3));
  const people = [ctx.me, ...ctx.friends.map((f) => ({ id: f.id, name: f.name, birthday: f.birthday!, greeting: f.greeting!, personality: f.personality! }))];
  let wrongFact = 0;
  for (const q of qs) {
    const right = people.find((p) => p.id === q.ids[q.correct])!;
    if (q.prompt.key === 'quiz.q.birthday' && !(right.birthday && right.birthday.day === q.prompt.vars!.day && right.birthday.month === q.prompt.vars!.month)) wrongFact++;
    if (q.prompt.key === 'quiz.q.greeting' && !String(right.greeting).startsWith(String(q.prompt.vars!.text))) wrongFact++;
    if (q.options.length < 2 || q.options.length > 4 || new Set(q.ids).size !== q.ids.length) wrongFact++;
    if (q.ids.some((id) => !people.some((p) => p.id === id))) wrongFact++;
  }
  ok('quiz: a question bank from birthdays, greetings, personalities (several kinds)', qs.length >= 10 && new Set(qs.map((q) => q.prompt.key)).size >= 3, { n: qs.length, kinds: [...new Set(qs.map((q) => q.prompt.key))] });
  ok('quiz: every right answer is TRUE according to the user\'s own data; options are real names, 2–4, no duplicates', wrongFact === 0, wrongFact);
  ok('quiz: texts are i18n lines (rendered in both languages)', qs.every((q) => I18n.fixed('en').t(q.prompt.key) !== q.prompt.key && i18n.t(q.prompt.key) !== q.prompt.key));
  const pq = qs.find((q) => q.prompt.key === 'quiz.q.personality');
  ok('quiz: a personality name inside a question is translated', !pq || (/\b(riservato|deciso|tranquillo|espansivo)\b/.test(i18n.line(pq.prompt)) && /\b(reserved|decisive|easygoing|outgoing)\b/.test(I18n.fixed('en').line(pq.prompt))), pq && i18n.line(pq.prompt));
}
// ---- session: start, rounds, finish, ranking, validated result
{
  const ctx = ctxOf(4);
  const players = [{ id: 'host', name: 'Kelly', personality: 3 as const, isUser: true }, { id: 'f0', name: 'Lucia', personality: 0 as const, isUser: false }, { id: 'f1', name: 'Marco', personality: 1 as const, isUser: false }];
  const s = new GameSession(MII_QUIZ, ctx, players, rng(7), 'host');
  const steps: string[] = []; s.subscribe((e) => steps.push(e.type === 'step' ? e.step.type : e.type));
  ok('session: ready before start, inputs refused', s.state === 'ready' && !s.input(0));
  s.start();
  let answered = 0;
  for (let t = 0; t < 120 && s.active; t += 0.25) {
    const v = s.logic.view;
    if (v.phase === 'question' && v.answered.host === null && v.timeLimit - v.timeLeft > 1.5) { if (s.input(v.correct ?? 0)) answered++; }
    s.tick(0.25);
  }
  ok('session: plays all rounds and finishes (ready → playing → finished)', s.state === 'finished' && steps.includes('reveal') && steps.includes('finished'), { state: s.state, steps: steps.slice(-5) });
  ok('session: the user\'s answers are accepted once per round', answered === s.logic.view.rounds, { answered, rounds: s.logic.view.rounds });
  ok('session: simulated players answer by themselves (scores move)', s.result!.players.filter((p) => p.id !== 'host').some((p) => p.score > 0), s.result!.players);
  const r = s.result!;
  ok('result: ranking sorted by score, ranks shared on ties, scores within 0..max', r.players.every((p, i) => i === 0 || r.players[i - 1].score >= p.score) && r.players.every((p) => p.score >= 0 && p.score <= s.logic.maxScore) && r.players[0].rank === 1);
  ok('result: invalid scores are refused (NaN / negative / above max / unknown player)', s.buildResult({ host: NaN, f0: 0, f1: 0 }) === null && s.buildResult({ host: -1, f0: 0, f1: 0 }) === null && s.buildResult({ host: 99999, f0: 0, f1: 0 }) === null && s.buildResult({ host: 0, f0: 0, f1: 0, zz: 3 }) === null);
}
// ---- invalid result from a game → aborted INVALID_RESULT (never shown as a result)
{
  const cheat: GameDefinition = { ...MII_QUIZ, id: 'cheat', create: () => ({ view: { round: 1, rounds: 1, phase: 'done', prompt: { key: 'x' }, options: [], timeLeft: 0, timeLimit: 1, answered: {}, correct: null, scores: {} }, done: true, maxScore: 10, tick: () => [], input: () => false, drop: () => {}, scores: () => ({ host: 500 }) }) };
  const s = new GameSession(cheat, ctxOf(3), [{ id: 'host', name: 'K', personality: 3, isUser: true }], rng(1), 'host');
  s.start(); s.tick(0.1);
  ok('invalid result: session aborted with INVALID_RESULT, no result', s.state === 'aborted' && s.abortCode === 'INVALID_RESULT' && s.result === null);
}
// ---- the Sala Giochi: a real place, Miis reserved from social life, interruption, player left, cleanup, stats
function room() {
  const host = new FakeHost(makeFriends(7));
  const places = new LocalPlacesService({ friends: host.friends, blocked: () => [] }, 5);
  const social = new SocialLife(host, 11);
  const visit = new PlaceVisit(host, places, { social, sceneOf: (id) => ({ id, skin: { wall: '0001', floor: '0001', variant: 0 }, friendHost: null }) });
  const reg = new GameRegistry(); reg.register(MII_QUIZ);
  const store = kv();
  const games = new GameRoomController(host, visit, reg, { social, i18n, friends: host.friends, kv: store, seed: 4 });
  return { host, places, social, visit, games, store };
}
{
  const { host, places, social, visit, games, store } = room();
  await places.refresh();
  const notIn = await games.start('mii-quiz');
  ok('start outside the Sala Giochi → NOT_IN_ROOM', !notIn.ok && notIn.code === 'NOT_IN_ROOM');
  const e = await games.enter();
  ok('enter: the Sala Giochi is a real place (the Mii walks in, others already there)', e.ok && host.scr === 'place:' + GAMES_ID && visit.mode === 'inside', e);
  await host.run(3);
  ok('enter: Miis hanging out in the Sala Giochi are in the scene', host.guests().length >= 1, host.guests());
  ok('unknown game → GAME_UNAVAILABLE', (await games.start('nope')).code === 'GAME_UNAVAILABLE');
  const before = host.ticks.size;
  const s1 = await games.start('mii-quiz');
  ok('start: a match with the user + free Miis', s1.ok && games.session!.players.length >= 2 && games.session!.players[0].id === 'host', s1);
  const playerIds = games.session!.players.map((p) => p.id);
  ok('start: players reserved from social life (no conversation / activity of their own)', playerIds.every((id) => social.isReserved(id)));
  ok('start: a second match while one runs → SESSION_ACTIVE', (await games.start('mii-quiz')).code === 'SESSION_ACTIVE');
  ok('start: players walk to their spots (existing goTo), one tick subscription for the match', host.ms.filter((m) => playerIds.includes(m.id)).some((m) => m.state === 'walking') && host.ticks.size === before + 1, { ticks: host.ticks.size, before });
  // play it through, the user answering right
  for (let t = 0; t < 120 && games.session?.active; t += 0.25) { const v = games.session!.logic.view; if (v.phase === 'question' && v.answered.host === null && v.timeLimit - v.timeLeft > 1) games.answer(0); host.step(0.25); if (Math.round(t * 4) % 8 === 0) await flush(); }
  const s = games.session!;
  ok('finish: result shown (finished), reactions with the existing commands (waves / a line)', s.state === 'finished' && (host.waves.length > 0 || host.says.length > 0), { st: s.state, waves: host.waves.length, says: host.says.length });
  ok('finish: players released to social life, attraction removed, match tick gone', playerIds.every((id) => !social.isReserved(id)) && host.ticks.size === before, { ticks: host.ticks.size, before });
  ok('stats persisted (played, best score) under mtw.reboot.games', loadStats(store).played === 1 && (loadStats(store).best['mii-quiz'] ?? -1) >= 0);
  games.closeResult();
  ok('back to the room: no session left', games.session === null);
  // player left during a match: drops out, the match goes on
  await host.run(3);
  const s2 = await games.start('mii-quiz');
  const other = games.session!.players.find((p) => !p.isUser)!;
  ok('a new match after the result (players free again)', s2.ok && !!other, { s2, players: games.session?.players, guests: host.guests() });
  host.dismiss(other.id); await host.run(4);
  ok('player left the room: dropped (left), released, the match continues', games.session!.leftIds.includes(other.id) && games.session!.active && !social.isReserved(other.id), { left: games.session!.leftIds });
  // the user leaves the room mid-match → aborted INTERRUPTED, everything freed
  const ids2 = games.session!.players.map((p) => p.id);
  games.leave();
  ok('interrupted: the user leaves the Sala Giochi mid-match → match aborted, session closed, Miis released', games.session === null && ids2.every((id) => !social.isReserved(id)) && host.scr === 'room', { sess: games.session?.state });
  await host.run(2);
  ok('interrupted: no tick listener of the match or of the place left (only social life\'s own)', host.ticks.size === 1, host.ticks.size);
  // reward: rank 1 with ≥ 300 points gives the local badge (when it happens)
  const stats = loadStats(store);
  ok('reward: badge stored once if won (quiz-star), never duplicated', stats.badges.filter((b) => b === 'quiz-star').length <= 1 && (stats.wins === 0 || stats.badges.length <= stats.wins));
  games.dispose(); visit.dispose(); social.dispose();
  ok('dispose: nothing left subscribed on the host', host.ticks.size === 0 && host.guestL.size === 0, host.listeners());
}
// ---- R2b additions used by the room: reserve ends a conversation politely; affinity favours friends
{
  const host = new FakeHost(makeFriends(4));
  for (const f of host.fr.slice(0, 3)) host.ms.push({ id: f.id, name: f.name, personality: 3, x: (host.ms.length - 2) * 7, z: 4, heading: 0, state: 'idle', isHost: false, leaving: false, waiting: false });
  const social = new SocialLife(host, 21);
  for (let i = 0; i < 4 && !social.conversations.length; i++) await host.run(60);
  const c = social.conversations[0];
  if (c) social.reserve([c.a], 'test');
  ok('reserve: a Mii in a conversation is taken over — the conversation ends politely', !!c && !social.conversations.some((x) => x.a === c!.a || x.b === c!.a), c);
  social.release('test');
  ok('release: the Mii is social again', !!c && !social.isReserved(c.a));
  social.dispose();
}
{
  // when f0 / f1 start a conversation, their close friend is picked more often than f2 (same personality, same room) — over 10 seeds
  let friend = 0, others = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const host = new FakeHost(makeFriends(4));
    for (const f of host.fr.slice(0, 3)) host.ms.push({ id: f.id, name: f.name, personality: 3, x: (host.ms.length - 2) * 7, z: 4, heading: 0, state: 'idle', isHost: false, leaving: false, waiting: false });
    const social = new SocialLife(host, seed);
    social.setAffinity((a, b) => ((a === 'f0' && b === 'f1') || (a === 'f1' && b === 'f0') ? 1 : 0));
    social.subscribe((e) => { if (e.type !== 'convo.start' || (e.a !== 'f0' && e.a !== 'f1')) return; if (e.b === 'f0' || e.b === 'f1') friend++; else if (e.b === 'f2') others++; });
    await host.run(900);
    social.dispose();
  }
  console.log('   affinity picks', { friend, others });
  ok('affinity: Miis pick their close friend as a partner clearly more often (10 seeds)', friend > others * 1.3, { friend, others });
}
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
