/**
 * REBOOT R6.0b — the Reboot economy (NEW design: Miitomo's prices and coins were server data and are not known; Classic
 * keeps its shop as a catalogue). Coins only: earned by playing, spent in the Reboot shop. No real money, nothing to
 * buy with money, nothing that makes a player stronger.
 *
 * Every change is a ledger entry with a reason (shown to the user as the wallet history). Earning goes through named
 * RULES with an amount, an optional daily cap and an optional `once` key, so the same thing never pays twice:
 *
 *   welcome        +50  once            first start of Reboot (to try the shop at once)
 *   daily          +10  1 a day         first Reboot start of the day
 *   game.played    +10  5 a day         a finished match in the Sala Giochi
 *   game.win       +15  5 a day         won it (on top of game.played)
 *   game.badge     +30  once per badge  a new badge
 *   post.photo     +5   3 a day         a Miifoto / room photo posted on MIInstagram
 *   visit.friend   +5   3 a day, once per friend per day   went into a friend's room
 *   friend.level   +25  once per friend and level          a friend became closer (relationship level up)
 *
 * Local (localStorage `mtw.reboot.wallet`, schema v1) until our server exists (R10): then the server validates every
 * grant and spend with the same rule ids, and this class becomes its cache.
 */
export const WALLET_KEY = 'mtw.reboot.wallet';
export type EarnRule = 'welcome' | 'daily' | 'game.played' | 'game.win' | 'game.badge' | 'post.photo' | 'visit.friend' | 'friend.level';
export const EARN: Readonly<Record<EarnRule, { amount: number; perDay: number | null }>> = {
  welcome: { amount: 50, perDay: null }, daily: { amount: 10, perDay: 1 },
  'game.played': { amount: 10, perDay: 5 }, 'game.win': { amount: 15, perDay: 5 }, 'game.badge': { amount: 30, perDay: null },
  'post.photo': { amount: 5, perDay: 3 }, 'visit.friend': { amount: 5, perDay: 3 }, 'friend.level': { amount: 25, perDay: null },
};
export interface LedgerEntry { at: string; amount: number; reason: string; /** i18n vars for the reason (names, items). */ vars?: Record<string, string> }
export type WalletError = 'CAPPED' | 'ALREADY' | 'INSUFFICIENT' | 'INVALID';
export type WalletEvent = { type: 'earned'; entry: LedgerEntry; balance: number } | { type: 'spent'; entry: LedgerEntry; balance: number };

interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void; }
interface State { v: 1; balance: number; ledger: LedgerEntry[]; once: string[]; day: string; today: Record<string, number> }
const LEDGER_MAX = 100, ONCE_MAX = 500;
const fresh = (): State => ({ v: 1, balance: 0, ledger: [], once: [], day: '', today: {} });

export class Wallet {
  private s: State;
  private subs = new Set<(e: WalletEvent) => void>();
  lastError: string | null = null;
  /** `now` and `today` are injectable for tests (local calendar day, yyyy-mm-dd). */
  constructor(private kv: Kv | null, private clock: { now: () => Date } = { now: () => new Date() }) {
    let raw: unknown = null;
    try { raw = JSON.parse(kv?.getItem(WALLET_KEY) ?? 'null'); } catch { raw = null; }
    this.s = Wallet.sanitize(raw);
  }
  private static sanitize(raw: unknown): State {
    const r = raw as Partial<State> | null;
    if (!r || r.v !== 1 || typeof r.balance !== 'number' || !Number.isFinite(r.balance)) return fresh();
    const ledger = Array.isArray(r.ledger) ? r.ledger.filter((e) => e && typeof e.amount === 'number' && typeof e.reason === 'string' && typeof e.at === 'string').slice(0, LEDGER_MAX) : [];
    const today = r.today && typeof r.today === 'object' ? Object.fromEntries(Object.entries(r.today).filter(([, n]) => typeof n === 'number' && n >= 0)) : {};
    return { v: 1, balance: Math.max(0, Math.floor(r.balance)), ledger, once: Array.isArray(r.once) ? r.once.filter((x) => typeof x === 'string').slice(-ONCE_MAX) : [], day: typeof r.day === 'string' ? r.day : '', today };
  }
  private dayKey() { const d = this.clock.now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  private rollDay() { const k = this.dayKey(); if (this.s.day !== k) { this.s.day = k; this.s.today = {}; } }
  get balance() { return this.s.balance; }
  /** Newest first (copies). */
  get ledger(): LedgerEntry[] { return structuredClone(this.s.ledger); }
  /** How many times a rule paid today (for the "how to earn" list). */
  usedToday(rule: EarnRule) { this.rollDay(); return this.s.today[rule] ?? 0; }
  has(onceKey: string) { return this.s.once.includes(onceKey); }
  subscribe(cb: (e: WalletEvent) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }

  /**
   * Pays a rule. `once` = a key that can pay only once ever (a badge, a friend's level, a friend's visit today).
   * Refused: CAPPED (daily cap reached) or ALREADY (that `once` key already paid). Nothing changes on a refusal.
   */
  earn(rule: EarnRule, opts: { once?: string; vars?: Record<string, string> } = {}): { ok: true; amount: number; balance: number } | { ok: false; code: WalletError } {
    const r = EARN[rule]; if (!r) return { ok: false, code: 'INVALID' };
    this.rollDay();
    if (opts.once && this.s.once.includes(opts.once)) return { ok: false, code: 'ALREADY' };
    if (r.perDay !== null && (this.s.today[rule] ?? 0) >= r.perDay) return { ok: false, code: 'CAPPED' };
    if (opts.once) { this.s.once.push(opts.once); if (this.s.once.length > ONCE_MAX) this.s.once.shift(); }
    this.s.today[rule] = (this.s.today[rule] ?? 0) + 1;
    const entry = this.add(r.amount, `earn.${rule}`, opts.vars);
    this.emit({ type: 'earned', entry, balance: this.s.balance });
    return { ok: true, amount: r.amount, balance: this.s.balance };
  }
  /** Spends coins (the shop). INSUFFICIENT leaves everything as it was. */
  spend(amount: number, reason: string, vars?: Record<string, string>): { ok: true; balance: number } | { ok: false; code: WalletError } {
    if (!Number.isInteger(amount) || amount <= 0 || !reason) return { ok: false, code: 'INVALID' };
    if (amount > this.s.balance) return { ok: false, code: 'INSUFFICIENT' };
    const entry = this.add(-amount, reason, vars);
    this.emit({ type: 'spent', entry, balance: this.s.balance });
    return { ok: true, balance: this.s.balance };
  }
  private add(amount: number, reason: string, vars?: Record<string, string>): LedgerEntry {
    this.s.balance += amount;
    const entry: LedgerEntry = { at: this.clock.now().toISOString(), amount, reason, ...(vars ? { vars } : {}) };
    this.s.ledger.unshift(entry); this.s.ledger.length = Math.min(this.s.ledger.length, LEDGER_MAX);
    this.persist();
    return structuredClone(entry);
  }
  private persist() { try { this.kv?.setItem(WALLET_KEY, JSON.stringify(this.s)); this.lastError = null; } catch (e) { this.lastError = (e as Error)?.name ?? 'WRITE_FAILED'; } }
  private emit(e: WalletEvent) { for (const s of this.subs) { try { s(e); } catch (err) { console.warn(err); } } }
}
