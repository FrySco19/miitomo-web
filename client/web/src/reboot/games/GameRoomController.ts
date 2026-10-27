/**
 * REBOOT R5 — the Sala Giochi: a real Reboot place (a room the Mii walks into, through the R5 PlaceVisit) where the
 * Miis present can play the registered games together.
 *
 *   start(game): the user + up to (max − 1) Miis who are free in the room become the players. R2b social life gives
 *                them to the game (reserve: their chat ends politely, their activity is suspended) and keeps running
 *                for everybody else, who may come closer to watch (attraction) and glance at whoever talks.
 *   during:      the game's steps become Mii reactions with the existing commands (walk to a spot, face, wave, a line
 *                in the room balloon): right answers wave, a wrong one complains, the winner celebrates.
 *   end:         result checked by the session, local stats (and a badge, if the game gives one) persisted; "back to
 *                the room" releases the players to social life.
 *   errors:      GAME_UNAVAILABLE, SESSION_ACTIVE, NOT_IN_ROOM, NOT_ENOUGH_PLAYERS; a player leaving the room drops out;
 *                the user leaving aborts the match (INTERRUPTED) and frees everybody.
 */
import type { RebootHost } from '../host';
import type { SocialLife } from '../social/SocialLife';
import type { I18n } from '../i18n/i18n';
import type { PlaceVisit } from '../places/PlaceVisit';
import { GAMES_ID } from '../places/LocalPlacesService';
import { GameRegistry } from './GameRegistry';
import { GameSession, SessionEvent } from './GameSession';
import type { GameContext, GamePlayer, GameResult, GameReward } from './types';
import { rng } from '../social/traits';

export type GameStartError = 'NOT_IN_ROOM' | 'SESSION_ACTIVE' | 'GAME_UNAVAILABLE' | 'NOT_ENOUGH_PLAYERS';
export type GameRoomEvent =
  | { type: 'session'; e: SessionEvent; session: GameSession }
  | { type: 'started'; session: GameSession }
  | { type: 'closed' };

const KEY = 'mtw.reboot.games';
interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void; }
export interface GameStats { v: 1; played: number; wins: number; best: Record<string, number>; badges: string[]; }
const STAGE = { x: 0, z: 6 };
const SPOTS = [{ x: -3.5, z: 9 }, { x: 3.5, z: 9 }, { x: -10, z: 7 }, { x: 10, z: 7 }];

export function loadStats(kv: Kv | null): GameStats {
  try { const v = JSON.parse(kv?.getItem(KEY) ?? 'null'); if (v && v.v === 1) return { v: 1, played: Math.max(0, Number(v.played) | 0), wins: Math.max(0, Number(v.wins) | 0), best: typeof v.best === 'object' && v.best ? v.best : {}, badges: Array.isArray(v.badges) ? v.badges.filter((b: unknown) => typeof b === 'string').slice(0, 50) : [] }; } catch { /* corrupt → fresh */ }
  return { v: 1, played: 0, wins: 0, best: {}, badges: [] };
}

export class GameRoomController {
  session: GameSession | null = null;
  lastReward: GameReward | null = null;
  stats: GameStats;
  private unsubs: (() => void)[] = [];
  private sessUnsubs: (() => void)[] = [];
  private subs = new Set<(e: GameRoomEvent) => void>();
  private rnd: () => number;
  constructor(private host: RebootHost, readonly visit: PlaceVisit, readonly registry: GameRegistry, private opts: {
    social: SocialLife | null; i18n: I18n; friends: () => Promise<GameContext['friends']>; affinity?: (a: string, b: string) => number; kv?: Kv | null; seed?: number;
  }) {
    this.rnd = rng(opts.seed ?? 99);
    this.stats = loadStats(opts.kv ?? null);
    this.unsubs.push(visit.subscribe((e) => {
      if (e.type === 'leave' && this.session?.active) this.session.playerLeft(e.id);
      if (e.type === 'left' && e.roomId === GAMES_ID) this.endSession('INTERRUPTED');
    }));
    this.unsubs.push(host.onGuest((e) => { if (e.type === 'leave' && this.session?.active) this.session.playerLeft(e.id); }));
  }
  subscribe(cb: (e: GameRoomEvent) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
  private emit(e: GameRoomEvent) { for (const s of this.subs) { try { s(e); } catch (err) { console.warn(err); } } }
  get here() { return this.visit.roomId === GAMES_ID; }
  get sessionActive() { return !!this.session?.active; }
  enter() { return this.visit.enter(GAMES_ID, this.visit.inside); }
  leave() { return this.visit.leave('user'); }

  async context(): Promise<GameContext> {
    const p = this.host.profile();
    return { me: { id: 'host', name: p.name, personality: p.personality, birthday: p.birthday, greeting: p.greeting }, friends: await this.opts.friends().catch(() => []), affinity: this.opts.affinity };
  }
  /** Miis in the room who could join a match now (not leaving, not at the door). */
  freeMiis() { return this.host.miis().filter((m) => !m.isHost && !m.leaving && !m.waiting && (m.state === 'idle' || m.state === 'walking')); }

  async start(gameId: string): Promise<{ ok: boolean; code?: GameStartError; detail?: string }> {
    if (!this.here || this.visit.mode !== 'inside') return { ok: false, code: 'NOT_IN_ROOM' };
    if (this.session?.active) return { ok: false, code: 'SESSION_ACTIVE' };
    const def = this.registry.get(gameId);
    if (!def) return { ok: false, code: 'GAME_UNAVAILABLE', detail: 'UNKNOWN' };
    const ctx = await this.context();
    const av = def.available(ctx);
    if (!av.ok) return { ok: false, code: 'GAME_UNAVAILABLE', detail: av.code };
    if (this.session?.active) return { ok: false, code: 'SESSION_ACTIVE' };      // started meanwhile
    const p = this.host.profile();
    const others = this.freeMiis().slice(0, def.players.max - 1);
    if (others.length + 1 < def.players.min) return { ok: false, code: 'NOT_ENOUGH_PLAYERS' };
    const players: GamePlayer[] = [{ id: 'host', name: p.name, personality: p.personality, isUser: true }, ...others.map((m) => ({ id: m.id, name: m.name, personality: m.personality, isUser: false }))];
    this.closeResult();
    const s = new GameSession(def, ctx, players, this.rnd, 'host');
    this.session = s; this.lastReward = null;
    this.opts.social?.reserve(players.map((x) => x.id), 'game:' + s.id);
    this.opts.social?.setAttraction(STAGE);
    players.forEach((pl, i) => { const q = SPOTS[i % SPOTS.length]; this.host.goTo(pl.id, q.x, q.z); });
    this.sessUnsubs.push(s.subscribe((e) => this.onSession(s, e)));
    this.sessUnsubs.push(this.host.onTick((dt) => s.tick(dt)));
    s.start();
    this.emit({ type: 'started', session: s });
    return { ok: true };
  }
  answer(i: number) { return !!this.session && this.session.input(i); }

  private onSession(s: GameSession, e: SessionEvent) {
    const t = this.opts.i18n;
    if (e.type === 'step') {
      const st = e.step;
      if (st.type === 'round') for (const pl of s.players) if (!s.leftIds.includes(pl.id)) void this.host.face(pl.id, 0, 40);
      if (st.type === 'reveal') {
        for (const id of st.right) this.host.wave(id);
        const miss = st.wrong.find((id) => id !== 'host');
        if (miss) void this.host.say(miss, t.t('game.react.miss'), 1.2);
      }
    }
    if (e.type === 'player.left') this.opts.social?.release('game:' + s.id, [e.id]);
    if (e.type === 'finished') this.onFinished(s, e.result);
    if (e.type === 'aborted') this.stopSession(s);
    this.emit({ type: 'session', e, session: s });
  }
  private onFinished(s: GameSession, r: GameResult) {
    const won = r.winners.includes('host');
    this.stats.played++; if (won) this.stats.wins++;
    const mine = r.players.find((p) => p.id === 'host')?.score ?? 0;
    this.stats.best[r.gameId] = Math.max(this.stats.best[r.gameId] ?? 0, mine);
    const reward = s.def.reward?.(r, 'host') ?? null;
    if (reward && !this.stats.badges.includes(reward.id)) this.stats.badges.push(reward.id);
    this.lastReward = reward;
    this.saveStats();
    const w = r.winners[0];
    if (w) {
      this.host.wave(w);
      if (w !== 'host') void this.host.say(w, this.opts.i18n.t('game.react.win'), 1.6);
      for (const p of s.players) if (p.id !== w && !p.isUser) void this.host.face(p.id, ...this.posOf(w));
    }
    this.stopSession(s);
  }
  private posOf(id: string): [number, number] { const m = this.host.miis().find((x) => x.id === id); return m ? [m.x, m.z] : [0, 0]; }
  /** Ends the running part of a match (ticks, reserved Miis); the result stays on screen until closeResult(). */
  private stopSession(s: GameSession) {
    for (const u of this.sessUnsubs) u(); this.sessUnsubs = [];
    this.opts.social?.release('game:' + s.id);
    this.opts.social?.setAttraction(null);
  }
  private endSession(code: 'INTERRUPTED') { const s = this.session; if (s?.active) s.abort(code); this.closeResult(); }
  /** Back to the room after the result (or after an abort): nothing of the match is left running. */
  closeResult() {
    const s = this.session; if (!s) return;
    if (s.active) s.abort('INTERRUPTED');
    this.stopSession(s); s.dispose(); this.session = null;
    this.emit({ type: 'closed' });
  }
  private saveStats() { try { this.opts.kv?.setItem(KEY, JSON.stringify(this.stats)); } catch { /* quota / private mode: kept for this session */ } }
  dispose() { this.closeResult(); for (const u of this.unsubs) u(); this.unsubs = []; this.subs.clear(); }
}
