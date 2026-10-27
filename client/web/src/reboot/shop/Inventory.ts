/**
 * REBOOT R6.0b — what the user owns from the Reboot shop and what is in use (one item per kind). Buying goes through
 * the Wallet (the price is spent, the ledger says what was bought); a refused purchase changes nothing. Starter items
 * are always owned. Persisted in `mtw.reboot.inventory` (schema v1); unknown or unowned ids in a stored record are
 * dropped on load.
 */
import { SHOP_ITEMS, SHOP_KINDS, ShopKind, itemById } from './catalog';
import type { Wallet } from '../economy/Wallet';

export const INVENTORY_KEY = 'mtw.reboot.inventory';
export type ShopError = 'UNKNOWN' | 'OWNED' | 'NOT_OWNED' | 'INSUFFICIENT';
interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void; }
interface State { v: 1; owned: string[]; equipped: Record<ShopKind, string> }

const starters = () => SHOP_ITEMS.filter((x) => x.starter).map((x) => x.id);
const starterOf = (k: ShopKind) => SHOP_ITEMS.find((x) => x.kind === k && x.starter)!.id;

export class Inventory {
  private s: State;
  private subs = new Set<() => void>();
  constructor(private kv: Kv | null, private wallet: Wallet) {
    let raw: Partial<State> | null = null;
    try { raw = JSON.parse(kv?.getItem(INVENTORY_KEY) ?? 'null'); } catch { raw = null; }
    const owned = new Set([...starters(), ...(Array.isArray(raw?.owned) ? raw!.owned.filter((id) => typeof id === 'string' && !!itemById(id)) : [])]);
    const equipped = Object.fromEntries(SHOP_KINDS.map((k) => { const id = raw?.equipped?.[k]; const it = typeof id === 'string' ? itemById(id) : null; return [k, it && it.kind === k && owned.has(it.id) ? it.id : starterOf(k)]; })) as Record<ShopKind, string>;
    this.s = { v: 1, owned: [...owned], equipped };
  }
  owns(id: string) { return this.s.owned.includes(id); }
  equipped(kind: ShopKind) { return this.s.equipped[kind]; }
  get ownedCount() { return this.s.owned.length; }
  subscribe(cb: () => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
  /** The ledger keeps the item as an i18n reference, so the history follows the language. */
  buy(id: string): { ok: true } | { ok: false; code: ShopError } {
    const it = itemById(id); if (!it) return { ok: false, code: 'UNKNOWN' };
    if (this.owns(id)) return { ok: false, code: 'OWNED' };
    const r = this.wallet.spend(it.price, 'spend.shop', { item: '@' + it.nameKey });
    if (!r.ok) return { ok: false, code: r.code === 'INSUFFICIENT' ? 'INSUFFICIENT' : 'UNKNOWN' };
    this.s.owned.push(id); this.save();
    return { ok: true };
  }
  equip(id: string): { ok: true } | { ok: false; code: ShopError } {
    const it = itemById(id); if (!it) return { ok: false, code: 'UNKNOWN' };
    if (!this.owns(id)) return { ok: false, code: 'NOT_OWNED' };
    if (this.s.equipped[it.kind] !== id) { this.s.equipped[it.kind] = id; this.save(); }
    return { ok: true };
  }
  private save() {
    try { this.kv?.setItem(INVENTORY_KEY, JSON.stringify(this.s)); } catch { /* memory only this session */ }
    for (const s of this.subs) { try { s(); } catch (e) { console.warn(e); } }
  }
}
