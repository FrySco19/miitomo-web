/**
 * REBOOT R5 — one match of a Sala Giochi game: lifecycle and result checks around the game's own logic.
 *   ready → playing → finished   (normal end; the result is validated first)
 *   ready | playing → aborted    (interrupted: the user left; invalid result; every player left)
 * Driven by `tick(dt)` from the room clock: no timers of its own, so it pauses with the room and runs in tests as is.
 */
import type { GameDefinition, GameContext, GameLogic, GamePlayer, GameResult, GameStep, SessionState } from './types';

export type SessionAbort = 'INTERRUPTED' | 'INVALID_RESULT' | 'NO_PLAYERS';
export type SessionEvent =
  | { type: 'state'; state: SessionState }
  | { type: 'step'; step: GameStep }
  | { type: 'player.left'; id: string }
  | { type: 'finished'; result: GameResult }
  | { type: 'aborted'; code: SessionAbort };

let serial = 0;

export class GameSession {
  readonly id: string;
  state: SessionState = 'ready';
  readonly logic: GameLogic;
  private t = 0;
  private left = new Set<string>();
  private subs = new Set<(e: SessionEvent) => void>();
  result: GameResult | null = null;
  abortCode: SessionAbort | null = null;
  constructor(readonly def: GameDefinition, ctx: GameContext, readonly players: GamePlayer[], rnd: () => number, private user: string) {
    this.id = `${def.id}-${Date.now().toString(36)}-${++serial}`;
    this.logic = def.create(ctx, players, rnd);
  }
  subscribe(cb: (e: SessionEvent) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
  private emit(e: SessionEvent) { for (const s of this.subs) { try { s(e); } catch (err) { console.warn(err); } } }
  get active() { return this.state === 'ready' || this.state === 'playing'; }
  get leftIds() { return [...this.left]; }

  start() { if (this.state !== 'ready') return false; this.state = 'playing'; this.emit({ type: 'state', state: 'playing' }); this.emit({ type: 'step', step: { type: 'round', round: 1 } }); return true; }
  tick(dt: number) {
    if (this.state !== 'playing') return;
    this.t += dt;
    for (const step of this.logic.tick(dt)) this.emit({ type: 'step', step });
    if (this.logic.done) this.finish();
  }
  /** The user's input (an answer). */
  input(value: number) {
    if (this.state !== 'playing') return false;
    const ok = this.logic.input(this.user, value);
    if (ok) this.emit({ type: 'step', step: { type: 'answer', player: this.user, correct: null } });
    return ok;
  }
  /** A player left the room: their score stays, they stop playing. The match goes on while the user is in it. */
  playerLeft(id: string) {
    if (!this.active || this.left.has(id) || !this.players.some((p) => p.id === id)) return;
    this.left.add(id); this.logic.drop(id);
    this.emit({ type: 'player.left', id });
    if (id === this.user || this.players.every((p) => this.left.has(p.id))) this.abort(id === this.user ? 'INTERRUPTED' : 'NO_PLAYERS');
  }
  abort(code: SessionAbort) {
    if (!this.active) return false;
    this.state = 'aborted'; this.abortCode = code;
    this.emit({ type: 'aborted', code }); this.emit({ type: 'state', state: 'aborted' });
    return true;
  }
  private finish() {
    const res = this.buildResult();
    if (!res) { this.abort('INVALID_RESULT'); return; }
    this.result = res; this.state = 'finished';
    this.emit({ type: 'finished', result: res }); this.emit({ type: 'state', state: 'finished' });
  }
  /** Ranking from the logic's scores, refused when a score is impossible (not a number, negative, above the maximum). */
  buildResult(scores = this.logic.scores()): GameResult | null {
    const ids = this.players.map((p) => p.id);
    if (Object.keys(scores).some((k) => !ids.includes(k))) return null;
    for (const id of ids) { const v = scores[id]; if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > this.logic.maxScore || !Number.isInteger(v)) return null; }
    const sorted = [...this.players].sort((a, b) => scores[b.id] - scores[a.id]);
    let rank = 0, last = -1;
    const players = sorted.map((p, i) => { if (scores[p.id] !== last) { rank = i + 1; last = scores[p.id]; } return { id: p.id, name: p.name, score: scores[p.id], rank, left: this.left.has(p.id) }; });
    const top = players[0]?.score ?? 0;
    return { sessionId: this.id, gameId: this.def.id, players, winners: top > 0 ? players.filter((p) => p.score === top).map((p) => p.id) : [], durationSec: Math.round(this.t), stats: { rounds: this.logic.view.rounds, max: this.logic.maxScore } };
  }
  dispose() { this.subs.clear(); }
}
