// REBOOT R2b unit tests: SocialLife on a simulated room (fake RebootHost with the same contracts: goTo walks over time,
// face turns, interact takes a while, ONE balloon, say resolves when it closes). Deterministic seeds.
// Run from client/web: npx tsx ../../tests/unit/social.test.mts
import { SocialLife } from '../../client/web/src/reboot/social/SocialLife';
import { TRAITS } from '../../client/web/src/reboot/social/traits';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };

type St = 'idle' | 'walking' | 'interacting' | 'reacting' | 'entering' | 'exiting' | 'outside';
interface M { id: string; name: string; personality: 0 | 1 | 2 | 3; x: number; z: number; heading: number; state: St; isHost: boolean; leaving: boolean; waiting: boolean; tx?: number; tz?: number; busyT?: number; faceCb?: (() => void) | null }
class FakeHost {
  miisL: M[] = [];
  balloon: { id: string; left: number; cb: (r: 'done' | 'interrupted') => void } | null = null;
  ticks = new Set<(dt: number) => void>(); speech = new Set<(e: { speaker: string | null }) => void>(); player = new Set<(e: { id: string; kind: string }) => void>(); guest = new Set<(e: any) => void>();
  wander = true; overlaps = 0; says: { id: string; t: number }[] = []; t = 0; cmds: { t: number; id: string; c: string }[] = [];
  constructor(n: number, pers: (0 | 1 | 2 | 3)[]) {
    for (let i = 0; i < n; i++) this.miisL.push({ id: i === 0 ? 'host' : 'g' + i, name: 'M' + i, personality: pers[i % pers.length], x: -20 + (i % 4) * 13, z: -10 + Math.floor(i / 4) * 16, heading: 0, state: 'idle', isHost: i === 0, leaving: false, waiting: false });
  }
  root = null as any; screen = () => 'room'; visiting = () => false; friends = async () => []; guests = () => []; invite = async () => false; dismiss = () => false; capacity = () => 7; setCapacity = (n: number) => n;
  onGuest(cb: any) { this.guest.add(cb); return () => this.guest.delete(cb); }
  miis() { return this.miisL.map((m) => ({ ...m })); }
  objects() { return [{ name: 'shelf', x: -24, z: -20 }, { name: 'chest', x: 22, z: -18 }, { name: 'cushion', x: -18, z: 18 }]; }
  m(id: string) { return this.miisL.find((x) => x.id === id)!; }
  goTo(id: string, x: number, z: number) { const m = this.m(id); if (m.state !== 'idle' && m.state !== 'walking') return false; m.tx = Math.max(-31, Math.min(31, x)); m.tz = Math.max(-31, Math.min(31, z)); m.state = 'walking'; this.cmds.push({ t: this.t, id, c: 'goTo' }); return true; }
  face(id: string, x: number, z: number) { const m = this.m(id); if (m.state !== 'idle') return Promise.resolve(false); m.heading = Math.atan2(x - m.x, z - m.z); this.cmds.push({ t: this.t, id, c: 'face' }); return Promise.resolve(true); }
  interact(id: string, o: string) { const m = this.m(id); const ob = this.objects().find((x) => x.name === o)!; if (!this.goTo(id, ob.x, ob.z)) return false; m.busyT = 4; return true; }
  wave(id: string) { const m = this.m(id); if (m.state !== 'idle') return false; m.state = 'reacting'; m.busyT = 2; return true; }
  say(id: string, text: string, ac: number) {
    if (this.balloon) { this.overlaps++; return Promise.resolve('busy' as const); }
    this.says.push({ id, t: this.t });
    for (const l of this.speech) l({ speaker: id });
    return new Promise<'done' | 'interrupted'>((res) => { this.balloon = { id, left: text.length / 38 + ac, cb: res }; });
  }
  balloonBusy() { return !!this.balloon; }
  setGuestWander(on: boolean) { this.wander = on; }
  onTick(cb: any) { this.ticks.add(cb); return () => this.ticks.delete(cb); }
  onSpeech(cb: any) { this.speech.add(cb); return () => this.speech.delete(cb); }
  onPlayer(cb: any) { this.player.add(cb); return () => this.player.delete(cb); }
  /** player taps a Mii: original touch reaction (stops walking, 2 s), closes the balloon (like the game) */
  tap(id: string) { const m = this.m(id); if (this.balloon) { const b = this.balloon; this.balloon = null; b.cb('interrupted'); } for (const l of this.player) l({ id, kind: id === 'host' ? 'mii' : 'guest' }); m.state = 'reacting'; m.tx = undefined; m.busyT = 2; }
  /** the real engine's order (main.ts roomClick): player event first, then the balloon closes through its onClose ('done') */
  tapEngine(id: string) { const m = this.m(id); for (const l of this.player) l({ id, kind: id === 'host' ? 'mii' : 'guest' }); if (this.balloon) { const b = this.balloon; this.balloon = null; b.cb('done'); } m.state = 'reacting'; m.tx = undefined; m.busyT = 2; }
  step(dt: number) {
    this.t += dt;
    for (const m of this.miisL) {
      if (m.state === 'walking' && m.tx !== undefined) {
        const dx = m.tx - m.x, dz = m.tz! - m.z, d = Math.hypot(dx, dz);
        if (d < 0.3) { m.state = m.busyT ? 'interacting' : 'idle'; m.tx = undefined; }
        else { const s = Math.min(d, 10 * dt); m.x += (dx / d) * s; m.z += (dz / d) * s; }
      } else if (m.state === 'walking') m.state = 'idle';
      else if ((m.state === 'interacting' || m.state === 'reacting') && m.busyT !== undefined) { m.busyT -= dt; if (m.busyT <= 0) { m.busyT = undefined; m.state = 'idle'; } }
    }
    if (this.balloon) { this.balloon.left -= dt; if (this.balloon.left <= 0) { const b = this.balloon; this.balloon = null; b.cb('done'); } }
    for (const l of this.ticks) l(dt);
  }
  async run(sec: number, dt = 1 / 20, every?: (t: number) => void) { for (let t = 0; t < sec; t += dt) { this.step(dt); if (every) every(this.t); if (Math.round(this.t / dt) % 10 === 0) await Promise.resolve(); } await Promise.resolve(); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---- 8 Miis, mixed personalities: life happens, one floor, no lockstep, no stuck
{
  const h = new FakeHost(8, [3, 0, 1, 2]);
  const s = new SocialLife(h as any, 42);
  ok('social turns the M18 built-in wander off (it plans walks itself)', h.wander === false);
  let lock = 0, samples = 0, maxWalk = new Map<string, number>(), walking = new Map<string, number>(), talkWhileWalk = 0;
  const statesAt: string[][] = [];
  await h.run(600, 1 / 20, (t) => {
    for (const m of h.miisL) { if (m.state === 'walking') { const w = (walking.get(m.id) ?? 0) + 1 / 20; walking.set(m.id, w); maxWalk.set(m.id, Math.max(maxWalk.get(m.id) ?? 0, w)); } else walking.set(m.id, 0); }
    if (Math.abs(t % 2) < 1 / 40) {
      samples++;
      const snap = new Map(s.snapshot().map((x) => [x.id, x]));
      const st = h.miisL.filter((m) => !m.isHost).map((m) => { const x = snap.get(m.id); return x?.convo ? 'talk' : m.state === 'walking' ? 'walk:' + (x?.plan ?? '') : x?.plan ?? 'idle'; });
      statesAt.push(st);
      if (new Set(st).size === 1) lock++;
      if (h.balloon && h.miisL.some((m) => m.state === 'walking')) talkWhileWalk++;
    }
  });
  await flush();
  const st = s.stats;
  const pairs = new Set(s.log.filter((l) => l.type === 'convo').map((l) => [...l.ids].sort().join('+')));
  ok('8 Miis: several conversations over 10 min, between different pairs', st.started >= 6 && st.done >= 4 && pairs.size >= 4, { st, pairs: [...pairs] });
  ok('one floor: never two balloons at once (no overlapping say)', h.overlaps === 0, h.overlaps);
  ok('conversations do not block movement: others walk while two talk', talkWhileWalk >= 5, talkWhileWalk);
  ok('variety: all guests rarely doing the same thing (no lockstep)', lock / samples < 0.1, { lock, samples });
  const byT = new Map<string, number>(); for (const c of h.cmds) { const k = `${c.c}@${c.t.toFixed(2)}`; byT.set(k, (byT.get(k) ?? 0) + 1); }
  ok('no synchronised commands (never 3+ Miis given the same order at the same instant)', [...byT.values()].every((n) => n < 3), [...byT.entries()].filter(([, n]) => n >= 3));
  const mix = statesAt.filter((x) => new Set(x).size >= 3).length / samples;
  ok('mixed room most of the time (≥ 3 different activities at once)', mix > 0.5, mix);
  ok('varied activities: wander, inspect, rest, watch all happen', st.activities.wander > 5 && st.activities.inspect > 2 && st.activities.rest > 5 && st.activities.watch >= 1, st.activities);
  ok('nobody stays stuck walking (> 15 s continuously)', [...maxWalk.values()].every((w) => w < 15), Object.fromEntries(maxWalk));
  ok('the host never walks on its own (only the player moves the user\'s Mii)', !h.cmds.some((c) => c.id === 'host' && c.c === 'goTo'), null);
  ok('reactions: Miis turn toward whoever talks', st.looks >= 5, st.looks);
  // a single speech never makes everyone look: max 3 glances per line
  const looks = s.log.filter((l) => l.type === 'look' && !l.info);
  const bySpeech = new Map<string, number>(); for (const l of looks) { const k = `${l.ids[1]}@${Math.floor(l.t / 2.5)}`; bySpeech.set(k, (bySpeech.get(k) ?? 0) + 1); }
  ok('glances are limited and asynchronous (≤ 3 per line, different delays)', [...bySpeech.values()].every((n) => n <= 3) && new Set(looks.map((l) => l.t)).size > looks.length * 0.6, [...bySpeech.values()]);
  ok('nobody is left in a conversation forever', s.conversations.every((c) => c.line <= c.of), s.conversations);
  s.dispose();
  ok('dispose restores the M18 wander', h.wander === true);
}
// ---- personality: Nori (3) vs Cool (0), same room, many seeds
{
  const init = { 0: 0, 3: 0 }, alone = { 0: 0, 3: 0 }, n = { 0: 0, 3: 0 }, turns = { 0: [] as number[], 3: [] as number[] };
  for (let seed = 1; seed <= 6; seed++) {
    const h = new FakeHost(6, [2, 3, 0, 3, 0, 2]);
    const s = new SocialLife(h as any, seed * 97);
    await h.run(400, 1 / 10, () => {
      for (const m of h.miisL) if (m.personality === 0 || m.personality === 3) {
        const near = Math.min(...h.miisL.filter((o) => o !== m).map((o) => Math.hypot(o.x - m.x, o.z - m.z)));
        alone[m.personality] += near; n[m.personality]++;
      }
    });
    init[0] += s.stats.initiatedBy[0]; init[3] += s.stats.initiatedBy[3];
    for (const l of s.log.filter((x) => x.type === 'convo')) { const p = h.m(l.ids[0]).personality; const k = Number(/turns (\d+)/.exec(l.info ?? '')?.[1] ?? 0); if (p === 0 || p === 3) turns[p].push(k); }
    s.dispose();
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  ok('personality: Nori starts more conversations than Cool', init[3] > init[0] * 1.5, init);
  ok('personality: Cool stays further from the others (likes being alone)', alone[0] / n[0] > alone[3] / n[3], { cool: alone[0] / n[0], nori: alone[3] / n[3] });
  ok('personality: Nori\'s conversations last longer', avg(turns[3]) > avg(turns[0]), { nori: avg(turns[3]), cool: avg(turns[0]) });
  ok('traits: every original type has the same small parameter set', [0, 1, 2, 3].every((p) => Object.keys(TRAITS[p as 0]).length === 9));
}
// ---- priorities: player tap pauses a conversation and it resumes (state kept); suspended activity resumes
{
  const h = new FakeHost(3, [3, 3, 3]);
  const s = new SocialLife(h as any, 7);
  let paused = false, resumed = false, tapped = '';
  await h.run(300, 1 / 20, (t) => {
    const c = s.conversations.find((x) => x.phase === 'talk' && x.line >= 1);
    if (!tapped && c && h.balloon) { tapped = h.balloon.id; h.tap(tapped); }
  });
  paused = s.log.some((l) => l.type === 'pause'); resumed = s.log.some((l) => l.type === 'resume' && /line/.test(l.info ?? ''));
  const after = s.log.filter((l) => l.type === 'say' && l.t > (s.log.find((x) => x.type === 'pause')?.t ?? 1e9));
  ok('player tap (priority 1) pauses the conversation and locks that Mii', paused && s.log.some((l) => l.type === 'player' && l.ids[0] === tapped), { paused, tapped });
  ok('the paused conversation resumes from the same line afterwards (state kept)', resumed && after.length > 0, { resumed, after: after.length, log: s.log.filter((l) => ['pause', 'resume', 'end'].includes(l.type)).slice(0, 6) });
  // activity suspended by a conversation / player and resumed later
  ok('activities suspended by something more important are resumed', s.log.some((l) => l.type === 'suspend') ? s.log.some((l) => l.type === 'resume' && !/line/.test(l.info ?? '')) : true, s.log.filter((l) => l.type === 'suspend' || l.type === 'resume').slice(0, 6));
  s.dispose();
}
// ---- regression (r2b, 2026-10-27): a tap on the LAST line, in the engine's event order, pauses instead of ending the conversation
{
  const h = new FakeHost(3, [3, 3, 3]);
  const s = new SocialLife(h as any, 11);
  let tapped: { id: number; line: number; of: number } | null = null;
  await h.run(400, 1 / 20, () => {
    const c = s.conversations.find((x) => x.phase === 'talk' && x.line === x.of - 1);
    if (!tapped && c && h.balloon && [c.a, c.b].includes(h.balloon.id)) { tapped = { id: c.id, line: c.line, of: c.of }; h.tapEngine(h.balloon.id); }
  });
  const t = tapped as { id: number; line: number; of: number } | null;
  const pause = t && s.log.find((l) => l.type === 'pause' && (l.info ?? '').startsWith(`#${t.id} `));
  const resume = t && s.log.find((l) => l.type === 'resume' && (l.info ?? '') === `#${t.id} line ${t.line}`);
  ok('tap on the last line (engine order) pauses the conversation and resumes the same line', !!t && !!pause && !!resume, { t, pause, resume });
  s.dispose();
}
// ---- 2 Miis and door states
{
  const h = new FakeHost(2, [3, 3]);
  h.m('g1').state = 'entering';
  const s = new SocialLife(h as any, 3);
  await h.run(20, 1 / 20);
  ok('a Mii coming through the door (priority 2) is left alone', !h.cmds.some((c) => c.id === 'g1'), h.cmds.filter((c) => c.id === 'g1'));
  h.m('g1').state = 'idle';
  await h.run(240, 1 / 20);
  ok('2 Miis: host and guest talk with each other', s.stats.done >= 1 && s.log.some((l) => l.type === 'say' && l.ids[0] === 'host'), s.stats);
  h.miisL.splice(1, 1);   // the guest leaves mid-whatever
  await h.run(5, 1 / 20);
  ok('a Mii that leaves ends its conversation cleanly', s.conversations.length === 0);
  s.dispose();
}
// ---- regression (r3, 2026-10-27): an object activity suspended BEFORE a permission change must not run after it
{
  const h = new FakeHost(2, [3, 3]);
  const s = new SocialLife(h as any, 5);
  await h.run(2, 1 / 20);
  const id = h.miisL.find((m) => m.id !== 'host')!.id;
  const ag = (s as any).agents.get(id);
  ag.suspended = { kind: 'inspect', object: 'shelf', started: true }; ag.plan = null; ag.convo = null; ag.next = 0;
  const before = s.stats.activities.inspect;
  s.setPolicy({ canUseObject: (who) => who === 'host' });
  await h.run(5, 1 / 20);
  ok('a suspended object activity is not resumed after the room forbids objects', s.stats.activities.inspect === before && !s.log.some((l) => l.type === 'inspect' && l.ids[0] === id), { before, after: s.stats.activities.inspect });
  s.dispose();
}
// ---- room policy (R3 public room): visitors not allowed to use objects never do
{
  const h = new FakeHost(6, [3, 1, 2, 0]);
  const s = new SocialLife(h as any, 11);
  s.setPolicy({ canUseObject: (id) => id === 'host' });
  await h.run(300, 1 / 20);
  ok('social respects the room policy: no object use when the room forbids it', s.stats.activities.inspect === 0 && s.stats.activities.wander > 3, s.stats.activities);
  s.setPolicy(null); await h.run(300, 1 / 20);
  ok('policy removed: objects used again', s.stats.activities.inspect > 0, s.stats.activities);
  s.dispose();
}
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else console.log('ALL PASS');
