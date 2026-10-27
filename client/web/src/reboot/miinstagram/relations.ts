/**
 * REBOOT R5 — how well two Miis know each other (0..1). A small, explainable base for "friends behave like friends":
 * social life picks friends as partners more often, MIInstagram reactions / comments favour friends, the quiz players
 * know their friends' facts better. NOT an algorithm with hidden weights: a starting value + named bumps.
 *
 *   start: the user and each local friend 0.35 (they are the user's friends); two local friends 0.15
 *   bumps: a finished conversation +0.04, a visit +0.03, a match together +0.03, a comment +0.02, a reaction +0.01
 * Persisted in `mtw.reboot.relations` (schema v1, at most 400 pairs, the weakest dropped first).
 */
const KEY = 'mtw.reboot.relations';
interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void; }
export type Bump = 'conversation' | 'visit' | 'game' | 'comment' | 'reaction';
const AMOUNT: Record<Bump, number> = { conversation: 0.04, visit: 0.03, game: 0.03, comment: 0.02, reaction: 0.01 };
const MAX_PAIRS = 400;

export class Relations {
  private pairs = new Map<string, number>();
  constructor(private kv: Kv | null = null, private user = 'host') {
    try {
      const v = JSON.parse(kv?.getItem(KEY) ?? 'null');
      if (v && v.v === 1 && v.pairs && typeof v.pairs === 'object') for (const [k, x] of Object.entries(v.pairs)) if (/^[\w:-]{1,64}\|[\w:-]{1,64}$/.test(k) && typeof x === 'number' && x >= 0 && x <= 1) this.pairs.set(k, x);
    } catch { /* corrupt → start values */ }
  }
  private key(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
  private start(a: string, b: string) { return a === this.user || b === this.user ? 0.35 : 0.15; }
  get(a: string, b: string): number { if (a === b) return 1; return this.pairs.get(this.key(a, b)) ?? this.start(a, b); }
  bump(a: string, b: string, why: Bump) {
    if (!a || !b || a === b) return this.get(a, b);
    const v = Math.min(1, this.get(a, b) + AMOUNT[why]);
    this.pairs.set(this.key(a, b), +v.toFixed(3));
    if (this.pairs.size > MAX_PAIRS) { const weakest = [...this.pairs].sort((x, y) => x[1] - y[1])[0]; this.pairs.delete(weakest[0]); }
    try { this.kv?.setItem(KEY, JSON.stringify({ v: 1, pairs: Object.fromEntries(this.pairs) })); } catch { /* memory only */ }
    return v;
  }
  /** Closest Miis of `a` among `others` (best first). */
  closest(a: string, others: string[]) { return [...others].sort((x, y) => this.get(a, y) - this.get(a, x)); }
  get size() { return this.pairs.size; }
}
