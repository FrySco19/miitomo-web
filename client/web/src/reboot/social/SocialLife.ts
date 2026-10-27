/**
 * REBOOT R2b — social life of the Miis in a room (NEW, not original Nintendo).
 *
 * Small, event + timer driven layer on top of the existing room machinery (RebootHost): it never moves a Mii itself,
 * it asks the RoomDirector to (goTo / face / interact / wave / say), so path finding, personal distance, sliding
 * around others and the stuck guard of R2 stay the only movement code.
 *
 * Priorities (higher wins, lower ones are suspended and resumed, never thrown away):
 *   1 player (tap / command on that Mii)   2 door (entering / leaving)   3 conversation   4 social reaction
 *   5 autonomous activity (wander / inspect / watch)   6 rest (idle)
 *
 * One "floor": only one conversation talks at a time (single room balloon, no chaotic overlap). Several conversations
 * can be set up meanwhile (approach / face); they wait their turn for a while, then give up politely.
 * Decisions run on a 0.25 s step; each Mii decides only when its own timer is due (no per-frame polling).
 */
import type { RebootHost, MiiView } from '../host';
import { TRAITS, Traits, Personality, rng } from './traits';
import { chatLine, LineKind } from './lines';

type Plan =
  | { kind: 'wander'; x: number; z: number; started: boolean }
  | { kind: 'inspect'; object: string; started: boolean }
  | { kind: 'watch'; convo: number; x: number; z: number; started: boolean }
  | { kind: 'rest'; until: number };

interface Agent {
  id: string; p: Personality; t: Traits;
  next: number;                  // time of the next decision
  plan: Plan | null;             // current autonomous activity (priority 5/6)
  suspended: Plan | null;        // activity interrupted by something more important, resumed afterwards
  convo: Convo | null;
  chatAfter: number;             // no new conversation before this time
  playerUntil: number;           // player priority lock
  lookAfter: number;             // no new glance before this time
}
interface Convo {
  id: number; a: string; b: string; mover: string;
  phase: 'approach' | 'face' | 'talk' | 'pause' | 'end';
  seq: [LineKind, string][]; line: number;
  since: number; waitFloor: number; pausedAt: number; retries: number;
  facing: boolean; faced: boolean; speaking: boolean; gapUntil: number;
}
export interface SocialStats {
  started: number; done: number; interrupted: number; aborted: number; pauses: number; resumes: number;
  looks: number; waves: number; lines: number;
  activities: Record<'wander' | 'inspect' | 'watch' | 'rest', number>;
  initiatedBy: Record<Personality, number>;
}
export interface SocialLogEntry { t: number; type: string; ids: string[]; info?: string }

const STEP = 0.25;
const CHAT_DIST = 9.5;          // close enough to talk (personal distance 4.5 + a bit)
const LOOK_RANGE = 24;
const PLAYER_LOCK = 7;          // s of player priority after a tap / command
const PAUSE_MAX = 10;           // s an interrupted conversation waits to resume
const FLOOR_WAIT = 12;          // s a set-up conversation waits for the floor
const ROOM = 28;                // walkable half size used for spot sampling (room 34 − margins)

export class SocialLife {
  now = 0;
  readonly stats: SocialStats = { started: 0, done: 0, interrupted: 0, aborted: 0, pauses: 0, resumes: 0, looks: 0, waves: 0, lines: 0, activities: { wander: 0, inspect: 0, watch: 0, rest: 0 }, initiatedBy: { 0: 0, 1: 0, 2: 0, 3: 0 } };
  readonly log: SocialLogEntry[] = [];
  private agents = new Map<string, Agent>();
  private convos: Convo[] = [];
  private floor: Convo | null = null;
  private timers: { at: number; fn: () => void }[] = [];
  private acc = 0;
  private convoN = 0;
  private views = new Map<string, MiiView>();
  private rnd: () => number;
  private unsub: (() => void)[] = [];
  /** Optional room rules (e.g. a public room's permissions): which objects a Mii may use. null = everything. */
  private policy: { canUseObject(id: string, object: string): boolean } | null = null;

  constructor(private host: RebootHost, seed = (Date.now() ^ 0x5eed) >>> 0) {
    this.rnd = rng(seed);
    host.setGuestWander(false);          // walks are planned here (personality-weighted) instead of the M18 timer
    this.unsub.push(host.onTick((dt) => this.tick(dt)));
    this.unsub.push(host.onSpeech((e) => this.onSpeech(e.speaker)));
    this.unsub.push(host.onPlayer((e) => this.onPlayer(e.id)));
    this.unsub.push(host.onGuest((e) => { if (e.type === 'arrive') this.onArrive(e.id); else this.drop(e.id); }));
  }
  setPolicy(p: { canUseObject(id: string, object: string): boolean } | null) { this.policy = p; }
  /** Forget Miis that are no longer in the room right now (e.g. after the owner left a public room). */
  resync() { this.views = new Map(this.host.miis().map((v) => [v.id, v])); for (const id of [...this.agents.keys()]) if (!this.views.has(id)) this.drop(id); }
  dispose() { for (const u of this.unsub) u(); this.unsub = []; this.host.setGuestWander(true); }

  /** Debug / tests: what every Mii is doing right now. */
  snapshot() {
    return [...this.agents.values()].map((a) => ({ id: a.id, p: a.p, plan: a.plan?.kind ?? null, suspended: a.suspended?.kind ?? null, convo: a.convo ? { id: a.convo.id, phase: a.convo.phase, with: a.convo.a === a.id ? a.convo.b : a.convo.a } : null, locked: this.now < a.playerUntil }));
  }
  get conversations() { return this.convos.map((c) => ({ id: c.id, a: c.a, b: c.b, phase: c.phase, line: c.line, of: c.seq.length })); }
  get floorHolder() { return this.floor?.id ?? null; }
  /** Debug / soak tests: queued timers and known Miis. */
  get pendingTimers() { return this.timers.length; }
  get agentCount() { return this.agents.size; }

  // ---------------------------------------------------------------- time
  tick(dt: number) {
    this.now += dt;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.now);
      if (due.length) { this.timers = this.timers.filter((t) => t.at > this.now); for (const t of due) t.fn(); }
    }
    this.acc += dt;
    if (this.acc >= STEP) { this.acc = 0; this.step(); }
  }
  private after(sec: number, fn: () => void) { this.timers.push({ at: this.now + sec, fn }); }
  private r(a: number, b: number) { return a + (b - a) * this.rnd(); }
  private note(type: string, ids: string[], info?: string) { this.log.push({ t: +this.now.toFixed(2), type, ids, info }); if (this.log.length > 400) this.log.shift(); }

  private step() {
    this.views = new Map(this.host.miis().map((v) => [v.id, v]));
    for (const v of this.views.values()) if (!this.agents.has(v.id) && !v.waiting && v.state !== 'outside') this.addAgent(v);
    for (const id of [...this.agents.keys()]) if (!this.views.has(id)) this.drop(id);
    for (const c of [...this.convos]) this.advance(c);
    for (const a of this.agents.values()) if (this.now >= a.next) this.think(a);
  }
  private addAgent(v: MiiView) {
    const t = TRAITS[v.personality] ?? TRAITS[2];
    // first decision spread out so newcomers / a full room never start in lockstep
    this.agents.set(v.id, { id: v.id, p: v.personality, t, next: this.now + this.r(2, 6) + this.agents.size * 0.7, plan: null, suspended: null, convo: null, chatAfter: this.now + this.r(4, 12), playerUntil: 0, lookAfter: 0 });
  }
  private drop(id: string) {
    const a = this.agents.get(id); if (!a) return;
    if (a.convo) this.end(a.convo, 'gone');
    this.agents.delete(id);
  }
  private free(v: MiiView | undefined) { return !!v && !v.waiting && !v.leaving && v.state !== 'outside' && v.state !== 'entering' && v.state !== 'exiting' && v.state !== 'held'; }
  private dist(a: { x: number; z: number }, b: { x: number; z: number }) { return Math.hypot(a.x - b.x, a.z - b.z); }

  // ---------------------------------------------------------------- decisions (priorities 5 / 6, and starting 3)
  private think(a: Agent) {
    const v = this.views.get(a.id);
    a.next = this.now + this.r(a.t.pause[0], a.t.pause[1]);
    if (!this.free(v)) { a.next = this.now + 1.5; return; }                        // 2 door / leaving
    if (this.now < a.playerUntil) { a.next = a.playerUntil + this.r(0.5, 2); return; }   // 1 player
    if (a.convo) return;                                                            // 3 conversation drives it
    if (a.plan && a.plan.kind !== 'rest') {
      if (v!.state !== 'idle') { a.next = this.now + 1; return; }                  // activity still running
      if (!a.plan.started) { this.startPlan(a, a.plan); return; }
      this.finishPlan(a);
      if (!a.suspended) return;                 // natural pause after an activity (next decision at a.next)
    }
    if (a.plan?.kind === 'rest' && this.now < a.plan.until) { a.next = a.plan.until; return; }
    a.plan = null;
    if (v!.state !== 'idle') { a.next = this.now + 1; return; }
    if (a.suspended) { const s = a.suspended; a.suspended = null; this.note('resume', [a.id], s.kind); this.startPlan(a, s); return; }
    this.choose(a, v!);
  }
  private choose(a: Agent, v: MiiView) {
    const isHost = v.isHost, t = a.t;
    const partner = this.pickPartner(a, v);
    const talking = this.convos.find((c) => c.phase === 'talk' && c.a !== a.id && c.b !== a.id);
    const objs = isHost ? [] : this.freeObjects(a.id);
    const w = {
      chat: partner ? t.chat * (isHost ? 0.5 : 1) : 0,
      watch: !isHost && talking ? t.approach * 0.5 : 0,
      wander: isHost ? 0 : t.wander,
      inspect: objs.length ? t.inspect : 0,
      rest: t.rest,
    };
    const sum = Object.values(w).reduce((s, x) => s + x, 0);
    let k = this.rnd() * sum, pick: keyof typeof w = 'rest';
    for (const [key, x] of Object.entries(w) as [keyof typeof w, number][]) { if ((k -= x) <= 0 && x > 0) { pick = key; break; } }
    if (pick === 'chat' && partner) { this.startConvo(a, partner); return; }
    if (pick === 'watch' && talking) {
      const A = this.views.get(talking.a)!, B = this.views.get(talking.b)!;
      const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, d = Math.max(1, this.dist(v, { x: mx, z: mz }));
      const s = Math.min(1, 8.5 / d);    // stop ~8.5 from the middle of the pair, on our side
      this.startPlan(a, { kind: 'watch', convo: talking.id, x: mx + (v.x - mx) * s, z: mz + (v.z - mz) * s, started: false }); return;
    }
    if (pick === 'inspect' && objs.length) { this.startPlan(a, { kind: 'inspect', object: objs[Math.floor(this.rnd() * objs.length)], started: false }); return; }
    if (pick === 'wander') { const s = this.spot(a, v); this.startPlan(a, { kind: 'wander', x: s.x, z: s.z, started: false }); return; }
    this.startPlan(a, { kind: 'rest', until: this.now + this.r(t.pause[0], t.pause[1]) });
  }
  /** A walk target: alone-lovers pick the emptiest spot, the others a spot near (not on top of) somebody. */
  private spot(a: Agent, v: MiiView) {
    const others = [...this.views.values()].filter((o) => o.id !== a.id && o.state !== 'outside');
    const cands = Array.from({ length: 10 }, () => ({ x: this.r(-ROOM, ROOM), z: this.r(-22, ROOM) }));
    const near = (c: { x: number; z: number }) => others.reduce((m, o) => Math.min(m, this.dist(c, o)), 99);
    if (this.rnd() < a.t.solo || !others.length) return cands.reduce((b, c) => (near(c) > near(b) ? c : b));
    const ok = cands.filter((c) => near(c) > 7 && near(c) < 14);
    return ok.length ? ok[0] : cands.reduce((b, c) => (Math.abs(near(c) - 10) < Math.abs(near(b) - 10) ? c : b));
  }
  private freeObjects(id: string) {
    const used = new Set([...this.agents.values()].filter((x) => x.id !== id && x.plan?.kind === 'inspect').map((x) => (x.plan as { object: string }).object));
    return this.host.objects().filter((o) => !used.has(o.name) && (!this.policy || this.policy.canUseObject(id, o.name)) && [...this.views.values()].every((v) => v.id === id || this.dist(v, o) > 6)).map((o) => o.name);
  }
  /** Social targets stay clear of the door strip (z < −20), where the door passage has no personal-distance push. */
  private clearOfDoor(x: number, z: number) { return { x, z: Math.max(z, -20) }; }
  private startPlan(a: Agent, p: Plan) {
    a.plan = p;
    if (p.kind === 'rest') { this.stats.activities.rest++; a.next = p.until; return; }
    let ok = false;
    if (p.kind === 'wander' || p.kind === 'watch') { const q = this.clearOfDoor(p.x, p.z); ok = this.host.goTo(a.id, q.x, q.z); }
    // the room policy is checked again here: a plan chosen (or suspended) before a permission change must not run after it
    if (p.kind === 'inspect') ok = (!this.policy || this.policy.canUseObject(a.id, p.object)) && this.host.interact(a.id, p.object);
    if (!ok) { a.plan = null; a.next = this.now + this.r(1, 3); return; }
    p.started = true; this.stats.activities[p.kind]++; this.note(p.kind, [a.id], p.kind === 'inspect' ? p.object : undefined);
    a.next = this.now + 1;
  }
  private finishPlan(a: Agent) {
    const p = a.plan; a.plan = null;
    if (p?.kind === 'watch') {          // arrived next to a conversation: look at it (a social glance, priority 4)
      const c = this.convos.find((x) => x.id === p.convo);
      const A = c && this.views.get(c.a), B = c && this.views.get(c.b);
      if (A && B) { void this.host.face(a.id, (A.x + B.x) / 2, (A.z + B.z) / 2); this.stats.looks++; this.note('look', [a.id], 'convo'); }
    }
  }

  // ---------------------------------------------------------------- conversations (priority 3)
  private pickPartner(a: Agent, v: MiiView): Agent | null {
    if (this.now < a.chatAfter) return null;
    const n = this.agents.size, maxConvos = Math.max(1, Math.floor(n / 3));
    if (this.convos.length >= maxConvos) return null;
    let best: Agent | null = null, bestS = 0;
    for (const b of this.agents.values()) {
      if (b === a || b.convo || this.now < b.playerUntil || this.now < b.chatAfter) continue;
      const bv = this.views.get(b.id);
      if (!this.free(bv)) continue;
      if (bv!.state !== 'idle' && !(bv!.state === 'walking' && b.plan && b.plan.kind !== 'rest')) continue;   // may interrupt a walk (5)
      if (bv!.isHost && v.isHost) continue;
      const d = this.dist(v, bv!);
      // nearby partners are preferred; outgoing Miis also go and find someone further away
      const s = (1 / (1 + d / 10)) * (0.4 + a.t.approach) * (0.6 + b.t.chat) * (0.75 + 0.5 * this.rnd());
      if (s > bestS) { bestS = s; best = b; }
    }
    return best;
  }
  private startConvo(a: Agent, b: Agent) {
    const av = this.views.get(a.id)!, bv = this.views.get(b.id)!;
    for (const x of [a, b]) { if (x.plan && x.plan.kind !== 'rest' && x.plan.started) { x.suspended = x.plan; this.note('suspend', [x.id], x.plan.kind); } x.plan = null; }
    if (bv.state === 'walking') this.host.goTo(b.id, bv.x, bv.z);     // stop where it is (same movement API)
    const mover = av.isHost ? b.id : a.id;
    const turns = Math.round(this.r(a.t.turns[0], a.t.turns[1] + 0.99) * 0.5 + this.r(b.t.turns[0], b.t.turns[1] + 0.99) * 0.5);
    const seq: [LineKind, string][] = [['open', a.id], ['reply', b.id]];
    for (let i = 0; i < Math.max(0, turns - 1); i++) seq.push(['follow', i % 2 === 0 ? a.id : b.id]);
    const closer = a.t.approach <= b.t.approach ? a.id : b.id;          // the less sociable one wraps it up
    seq.push(['close', closer], ['closeReply', closer === a.id ? b.id : a.id]);
    const c: Convo = { id: ++this.convoN, a: a.id, b: b.id, mover, phase: 'approach', seq, line: 0, since: this.now, waitFloor: 0, pausedAt: 0, retries: 0, facing: false, faced: false, speaking: false, gapUntil: 0 };
    a.convo = c; b.convo = c; this.convos.push(c);
    this.stats.started++; this.stats.initiatedBy[a.p]++;
    this.note('convo', [a.id, b.id], `start #${c.id} turns ${turns}`);
    this.approach(c);
  }
  private approach(c: Convo) {
    const m = this.views.get(c.mover), o = this.views.get(c.mover === c.a ? c.b : c.a);
    if (!m || !o) return;
    const d = this.dist(m, o);
    if (d <= CHAT_DIST) { c.phase = 'face'; return; }
    const k = 6.5 / d, q = this.clearOfDoor(o.x + (m.x - o.x) * k, o.z + (m.z - o.z) * k);
    if (!this.host.goTo(c.mover, q.x, q.z)) c.retries++;
  }
  private advance(c: Convo) {
    const A = this.views.get(c.a), B = this.views.get(c.b);
    const ag = this.agents.get(c.a), bg = this.agents.get(c.b);
    if (!ag || !bg || !this.free(A) || !this.free(B)) { this.end(c, 'gone'); return; }
    const locked = this.now < ag.playerUntil || this.now < bg.playerUntil;
    if (locked) {                                     // priority 1: hold the conversation, keep its state
      if (c.phase !== 'pause') { this.pause(c); }
      else if (this.now - c.pausedAt > PAUSE_MAX) this.end(c, 'interrupted');
      return;
    }
    if (c.phase === 'pause') {
      if (this.now - c.pausedAt > PAUSE_MAX) { this.end(c, 'interrupted'); return; }
      if (A!.state === 'idle' && B!.state === 'idle') { c.phase = 'face'; c.facing = false; c.faced = false; this.stats.resumes++; this.note('resume', [c.a, c.b], `#${c.id} line ${c.line}`); }
      return;
    }
    if (c.phase === 'approach') {
      const mv = this.views.get(c.mover)!;
      if (this.dist(A!, B!) <= CHAT_DIST && mv.state === 'idle') { c.phase = 'face'; return; }
      if (this.now - c.since > 18 || c.retries > 3) { this.end(c, 'stuck'); return; }
      if (mv.state === 'idle') { c.retries++; this.approach(c); }         // stopped short (avoidance / stuck guard): try again
      return;
    }
    if (c.phase === 'face') {
      if (!c.facing) {
        c.facing = true;
        void Promise.all([this.host.face(c.a, B!.x, B!.z), this.host.face(c.b, A!.x, A!.z)]).then(() => { if (c.phase === 'face') c.faced = true; });
        this.after(3, () => { if (c.phase === 'face') c.faced = true; });   // a refused / interrupted turn never blocks
      }
      if (c.faced) { c.phase = 'talk'; c.waitFloor = this.now; }
      return;
    }
    if (c.phase === 'talk') {
      if (c.speaking || this.now < c.gapUntil) return;
      if (this.floor && this.floor !== c) { if (this.now - c.waitFloor > FLOOR_WAIT) this.end(c, 'noFloor'); return; }
      if (this.host.balloonBusy()) { if (this.now - c.waitFloor > FLOOR_WAIT * 2) this.end(c, 'noFloor'); return; }
      if (c.line >= c.seq.length) { this.end(c, 'done'); return; }
      this.floor = c;
      const [kind, who] = c.seq[c.line];
      const other = who === c.a ? B! : A!, sp = this.agents.get(who)!;
      const text = chatLine(kind, sp.p, other.name, this.rnd);
      c.speaking = true; this.stats.lines++;
      this.note('say', [who, other.id], text);
      void this.host.say(who, text, this.r(1.0, 1.6)).then((r) => {
        c.speaking = false;
        if (!this.convos.includes(c)) return;
        // A balloon closed by the player's tap is an interruption, not a finished line (also on the last line).
        const tapped = this.now < (this.agents.get(c.a)?.playerUntil ?? 0) || this.now < (this.agents.get(c.b)?.playerUntil ?? 0);
        if (r === 'done' && tapped) { this.pause(c); return; }
        if (r === 'done') { c.line++; c.waitFloor = this.now; c.gapUntil = this.now + this.r(0.4, 1.2); if (c.line >= c.seq.length) this.end(c, 'done'); }
        else if (r === 'interrupted') this.pause(c);
        else c.gapUntil = this.now + 1;      // busy: try again
      });
    }
  }
  private pause(c: Convo) {
    c.phase = 'pause'; c.pausedAt = this.now; c.speaking = false;
    if (this.floor === c) this.floor = null;
    this.stats.pauses++; this.note('pause', [c.a, c.b], `#${c.id} line ${c.line}`);
  }
  private end(c: Convo, why: 'done' | 'interrupted' | 'gone' | 'stuck' | 'noFloor') {
    const i = this.convos.indexOf(c); if (i < 0) return;
    this.convos.splice(i, 1); c.phase = 'end';
    if (this.floor === c) this.floor = null;
    if (why === 'done') this.stats.done++; else if (why === 'interrupted' || why === 'gone') this.stats.interrupted++; else this.stats.aborted++;
    this.note('end', [c.a, c.b], `#${c.id} ${why}`);
    for (const id of [c.a, c.b]) {
      const x = this.agents.get(id); if (!x) continue;
      x.convo = null;
      x.chatAfter = this.now + this.r(18, 34) * (1.4 - x.t.chat);
      x.next = this.now + this.r(0.8, 3.5);                // then: resume what was suspended, or decide again
      const v = this.views.get(id);
      // walking away afterwards is more likely for the less sociable one
      if (why === 'done' && v && !v.isHost && !x.suspended && this.rnd() > x.t.approach + 0.2) {
        const s = this.spot(x, v); x.plan = { kind: 'wander', x: s.x, z: s.z, started: false }; x.next = this.now + this.r(0.5, 1.5);
      }
    }
  }

  // ---------------------------------------------------------------- reactions (priority 4)
  private onSpeech(speaker: string | null) {
    if (!speaker) return;
    const sv = this.views.get(speaker) ?? this.host.miis().find((m) => m.id === speaker);
    if (!sv) return;
    const partner = this.agents.get(speaker)?.convo; const pid = partner ? (partner.a === speaker ? partner.b : partner.a) : null;
    const cands = [...this.agents.values()].filter((x) => {
      const v = this.views.get(x.id);
      return x.id !== speaker && x.id !== pid && !x.convo && v?.state === 'idle' && !v.leaving && this.now >= x.lookAfter && this.now >= x.playerUntil && this.dist(v, sv) < LOOK_RANGE;
    });
    // never everybody: at most half of them (max 3), each with its own personality chance and its own delay
    const max = Math.min(3, Math.ceil(cands.length / 2));
    let n = 0;
    for (const x of cands.sort(() => this.rnd() - 0.5)) {
      if (n >= max) break;
      if (this.rnd() > x.t.react) continue;
      n++; x.lookAfter = this.now + this.r(6, 12);
      this.after(this.r(0.25, 1.6), () => {
        const v = this.views.get(x.id), s = this.views.get(speaker);
        if (!v || !s || v.state !== 'idle' || x.convo || this.now < x.playerUntil) return;
        void this.host.face(x.id, s.x, s.z); this.stats.looks++; this.note('look', [x.id, speaker]);
      });
    }
  }
  private onArrive(id: string) {
    const door = { x: 0, z: -27 };
    let n = 0;
    for (const x of [...this.agents.values()].sort(() => this.rnd() - 0.5)) {
      if (x.id === id || x.convo || n >= 2 || this.rnd() > x.t.react) continue;
      n++;
      this.after(this.r(1, 3), () => {
        const v = this.views.get(x.id);
        if (!v || v.state !== 'idle' || v.leaving || x.convo || this.now < x.playerUntil) return;
        void this.host.face(x.id, door.x, door.z).then((ok) => {
          this.stats.looks++; this.note('look', [x.id, id], 'arrival');
          if (ok && x.t.react > 0.85 && this.rnd() < 0.4 && this.host.wave(x.id)) { this.stats.waves++; this.note('wave', [x.id, id]); }
        });
      });
    }
  }
  // ---------------------------------------------------------------- player (priority 1)
  private onPlayer(id: string) {
    const a = this.agents.get(id); if (!a) return;
    a.playerUntil = this.now + PLAYER_LOCK;
    if (a.plan && a.plan.kind !== 'rest' && a.plan.started) { a.suspended = a.plan; this.note('suspend', [id], `${a.plan.kind} (player)`); }
    a.plan = null;
    this.note('player', [id]);
  }
}
