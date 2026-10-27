/**
 * Client-side token buckets (REBOOT safety). The server keeps its own limits; these keep this client polite and give
 * the UI a "wait N s" answer before a request is even made.
 */
export interface Limit { capacity: number; refillPerSec: number; }
export const DEFAULT_LIMITS: Record<string, Limit> = {
  default: { capacity: 30, refillPerSec: 5 },
  comment: { capacity: 5, refillPerSec: 0.2 },      // 1 comment / 5 s sustained
  createPost: { capacity: 3, refillPerSec: 1 / 30 },
  react: { capacity: 20, refillPerSec: 2 },
  report: { capacity: 5, refillPerSec: 1 / 60 },
  move: { capacity: 20, refillPerSec: 10 },
};

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; t: number }>();
  constructor(private limits: Record<string, Limit> = DEFAULT_LIMITS, private now: () => number = () => Date.now()) {}
  /** Takes one token; returns 0 when allowed, otherwise the ms to wait. */
  take(op: string): number {
    const l = this.limits[op] ?? this.limits.default;
    const t = this.now();
    const b = this.buckets.get(op) ?? { tokens: l.capacity, t };
    b.tokens = Math.min(l.capacity, b.tokens + ((t - b.t) / 1000) * l.refillPerSec); b.t = t;
    if (b.tokens >= 1) { b.tokens -= 1; this.buckets.set(op, b); return 0; }
    this.buckets.set(op, b);
    return Math.ceil(((1 - b.tokens) / l.refillPerSec) * 1000);
  }
}
