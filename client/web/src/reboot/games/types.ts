/**
 * REBOOT R5 — Sala Giochi game model (the R6 MiniGameEngine starts here). A game is DATA + a small time-driven logic:
 *   GameDefinition  what a game is (id, texts, players, duration, availability, rules, reward)
 *   GameLogic       one running match: rounds, inputs, scores (pure: no DOM, no scene, driven by the room clock)
 *   GameSession     lifecycle around a logic: ready → playing → finished | aborted, players leaving, result checks
 *   GameResult      ranking + stats, validated before anybody sees it
 *   GameReward      optional, local until the reward system (R8)
 * The room, the Miis and the UI never depend on a specific game: adding a game = registering a definition.
 */
import type { FriendInfo } from '../host';
import type { Line, Vars } from '../i18n/i18n';

export type SessionState = 'ready' | 'playing' | 'finished' | 'aborted';
export interface GamePlayer { id: string; name: string; personality: 0 | 1 | 2 | 3; isUser: boolean; }
export interface GameContext {
  me: { id: string; name: string; personality: 0 | 1 | 2 | 3; birthday: { month: number; day: number } | null; greeting: string };
  friends: FriendInfo[];
  /** 0..1, how well two Miis know each other (relations). */
  affinity?: (a: string, b: string) => number;
}
export type Availability = { ok: true } | { ok: false; code: 'NOT_ENOUGH_DATA' | 'NOT_ENOUGH_PLAYERS'; vars?: Vars };

/** What a running match shows (the view renders it, never changes it). */
export interface GameView {
  round: number; rounds: number; phase: 'question' | 'reveal' | 'done';
  prompt: Line; options: string[]; timeLeft: number; timeLimit: number;
  answered: Record<string, number | null>; correct: number | null;
  scores: Record<string, number>;
}
/** Things that happened during a step (the room turns them into Mii reactions). */
export type GameStep =
  | { type: 'round'; round: number }
  | { type: 'answer'; player: string; correct: boolean | null }
  | { type: 'reveal'; round: number; correct: number; right: string[]; wrong: string[] }
  | { type: 'done' };

export interface GameLogic {
  readonly view: GameView;
  readonly done: boolean;
  readonly maxScore: number;
  tick(dt: number): GameStep[];
  /** An input from a player (the user's answer). false = not accepted (wrong phase, already answered, bad value). */
  input(player: string, value: number): boolean;
  /** A player left: their answers stop counting from now on. */
  drop(player: string): void;
  scores(): Record<string, number>;
}

export interface GameDefinition {
  id: string;
  titleKey: string; descKey: string; rulesKey: string;
  players: { min: number; max: number };
  /** Nominal length of a match, seconds. */
  durationSec: number;
  available(ctx: GameContext): Availability;
  create(ctx: GameContext, players: GamePlayer[], rnd: () => number): GameLogic;
  reward?(result: GameResult, me: string): GameReward | null;
}

export interface GameResult {
  sessionId: string; gameId: string;
  players: { id: string; name: string; score: number; rank: number; left: boolean }[];
  winners: string[];
  durationSec: number;
  stats: Record<string, number>;
}
export interface GameReward { id: string; kind: 'badge'; titleKey: string; }
