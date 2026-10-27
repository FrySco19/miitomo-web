/**
 * REBOOT social traits per ORIGINAL personality type (0 Cool · Riservato, 1 Dry · Deciso, 2 Nagomi · Tranquillo,
 * 3 Nori · Espansivo — type order REVERSED in Classic, docs/CLASSIFICATION.md). The numbers are NEW Reboot design
 * values (not from the game): few parameters, each one used by SocialLife and visible in its behaviour.
 */
export type Personality = 0 | 1 | 2 | 3;

export interface Traits {
  /** Chance to start a conversation when deciding what to do. */
  chat: number;
  /** Exchanges in a conversation [min, max] (interaction length). */
  turns: [number, number];
  /** Propensity to walk up to others (approach the partner, join / watch a group) vs. staying put. */
  approach: number;
  /** Chance that a walk goes to a quiet spot away from the others (likes being alone). */
  solo: number;
  /** Chance to turn toward somebody who talks or comes in (reaction to others). */
  react: number;
  /** Activity weights when not talking. */
  wander: number; inspect: number; rest: number;
  /** Rest between decisions, seconds [min, max] (natural idle time). */
  pause: [number, number];
}

export const TRAITS: Record<Personality, Traits> = {
  0: { chat: 0.18, turns: [1, 2], approach: 0.25, solo: 0.65, react: 0.35, wander: 0.30, inspect: 0.30, rest: 0.40, pause: [5, 11] },
  1: { chat: 0.35, turns: [1, 3], approach: 0.50, solo: 0.35, react: 0.55, wander: 0.45, inspect: 0.30, rest: 0.25, pause: [3, 8] },
  2: { chat: 0.40, turns: [2, 3], approach: 0.40, solo: 0.30, react: 0.80, wander: 0.20, inspect: 0.30, rest: 0.50, pause: [4, 9] },
  3: { chat: 0.65, turns: [2, 4], approach: 0.85, solo: 0.10, react: 0.90, wander: 0.45, inspect: 0.25, rest: 0.30, pause: [2, 6] },
};

/** Small deterministic PRNG (mulberry32) so runs can be reproduced in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
