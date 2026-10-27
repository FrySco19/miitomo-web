/**
 * Shop catalogue (M15). User decision 2026-10-26: SHOP = CATALOGUE ONLY — catalogue enabled, economy disabled.
 *
 *  ORIGINAL   items (models + capture2 thumbnails the user imported), item names (Wearname), category icons, shop texts
 *             (Layout/shop, Layout/room shopTopImageList*), top banners (asset/shopBanner2/*.webp), shop interior model.
 *  VERIFIED   weekly delivery dates of the items (dated CDN zips, Thursdays 2016-11-10 … 2018-04-05).
 *  DEDUCED    those dates are the shop's "Arrivi dd/mm" groups (categoryTextBtn00: "Arrivi {2.2}/{2.1}").
 *  SERVER-ONLY (unknown, never invented): prices, currency balance, ownership / stock, sale rotations, banner contents,
 *             candy / drop game rules. The economy provider below is the explicit "disabled" implementation; a future
 *             ServerEconomy (our own backend) or recovered master data can implement the same interface.
 */
import type { Category } from '../body/Wardrobe';
import { CLOSET_ORDER, itemName, colours } from './Closet';

export interface ShopItem {
  cat: Category; id: string; name: string; nameOriginal: boolean;
  arrival: string | null;            // yyyymmdd of the weekly delivery, null = launch set / unknown
  price: number | null;              // SERVER-ONLY: always null while the economy is disabled
  owned: boolean | null;             // SERVER-ONLY: null = unknown
}
/** Economy provider. Only the disabled implementation exists today. */
export interface ShopEconomy {
  readonly enabled: boolean;
  readonly currency: string | null;
  price(item: ShopItem): number | null;
  owned(item: ShopItem): boolean | null;
  /** Why the economy is not available (shown as a short note). */
  readonly note: string;
}
export const DISABLED_ECONOMY: ShopEconomy = {
  enabled: false, currency: null,
  price: () => null, owned: () => null,
  note: 'Prezzi, monete e disponibilità erano dati del server Miitomo e non sono stati preservati: il negozio è consultabile come catalogo.'
};

export function buildCatalog(all: Map<Category, { id: string }[]>, dates: Record<string, string>, dirOf: (c: Category) => string, economy: ShopEconomy = DISABLED_ECONOMY): ShopItem[] {
  const out: ShopItem[] = [];
  for (const cat of CLOSET_ORDER) {
    for (const { id } of all.get(cat) ?? []) {
      if (/^9\d{3}/.test(id)) continue;   // 9000/9999 = base / naked bodies, not shop items (DEDUCED from the ids)
      const n = itemName(cat, id);
      const d = dates[`${dirOf(cat)}/${id}`] ?? null;
      const it: ShopItem = { cat, id, name: n.text, nameOriginal: n.original, arrival: d && d > '20151231' ? d : null, price: null, owned: null };
      it.price = economy.price(it); it.owned = economy.owned(it);
      out.push(it);
    }
  }
  return out;
}
/** Weekly arrival groups, newest first. */
export function arrivalGroups(items: ShopItem[]): { date: string; items: ShopItem[] }[] {
  const m = new Map<string, ShopItem[]>();
  for (const it of items) if (it.arrival) (m.get(it.arrival) ?? m.set(it.arrival, []).get(it.arrival)!).push(it);
  return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, items]) => ({ date, items }));
}
export const dayMonth = (d: string) => ({ day: d.slice(6, 8), month: d.slice(4, 6), year: d.slice(0, 4) });
export { colours };
