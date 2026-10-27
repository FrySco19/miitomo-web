/**
 * REBOOT R6.0b — what the Reboot shop sells. NEW cosmetics drawn for Reboot (CSS colours and patterns, no images, no
 * Nintendo assets), each with a visible effect:
 *   cover  the MiiPhone's body (the phone on the screen edge and the open phone)
 *   card   the background of the user's card on "My page"
 *   frame  a frame around the user's own photos on MIInstagram
 * Clothes are not sold here: the Classic closet already lets the user wear every item of their wardrobe files, so
 * selling them would only lock what is free. Furniture joins this catalogue with the house (R6.1).
 * Prices are a NEW design (a few matches or posts for the cheapest item, a week of play for the dearest).
 */
export type ShopKind = 'cover' | 'card' | 'frame';
export interface ShopItemDef {
  id: string; kind: ShopKind; price: number;
  /** i18n key of the name. */
  nameKey: string;
  /** Two CSS colours: gradient / frame / card (also the swatch in the shop). */
  a: string; b: string;
  /** Free and owned from the start (the look Reboot had before R6.0b). */
  starter?: boolean;
}
export const SHOP_KINDS: readonly ShopKind[] = ['cover', 'card', 'frame'];
export const SHOP_ITEMS: readonly ShopItemDef[] = [
  { id: 'cover.orange', kind: 'cover', price: 0, nameKey: 'item.cover.orange', a: '#ff9a52', b: '#ff7a2f', starter: true },
  { id: 'cover.mint', kind: 'cover', price: 40, nameKey: 'item.cover.mint', a: '#7fdcc0', b: '#2fae8c' },
  { id: 'cover.sky', kind: 'cover', price: 40, nameKey: 'item.cover.sky', a: '#8fd0ff', b: '#3a8fe0' },
  { id: 'cover.berry', kind: 'cover', price: 60, nameKey: 'item.cover.berry', a: '#ff8fb6', b: '#d93a74' },
  { id: 'cover.grape', kind: 'cover', price: 60, nameKey: 'item.cover.grape', a: '#b9a3ff', b: '#6b4fe0' },
  { id: 'cover.night', kind: 'cover', price: 120, nameKey: 'item.cover.night', a: '#4a5578', b: '#1f2540' },
  { id: 'card.plain', kind: 'card', price: 0, nameKey: 'item.card.plain', a: '#ffffff', b: '#ffffff', starter: true },
  { id: 'card.sunset', kind: 'card', price: 50, nameKey: 'item.card.sunset', a: '#ffe1c2', b: '#ffc2d4' },
  { id: 'card.lagoon', kind: 'card', price: 50, nameKey: 'item.card.lagoon', a: '#d4f3ff', b: '#d9ffe9' },
  { id: 'card.lilac', kind: 'card', price: 80, nameKey: 'item.card.lilac', a: '#efe6ff', b: '#ffe6f6' },
  { id: 'frame.none', kind: 'frame', price: 0, nameKey: 'item.frame.none', a: 'transparent', b: 'transparent', starter: true },
  { id: 'frame.gold', kind: 'frame', price: 70, nameKey: 'item.frame.gold', a: '#ffd36b', b: '#e0a020' },
  { id: 'frame.candy', kind: 'frame', price: 70, nameKey: 'item.frame.candy', a: '#ff9ec7', b: '#8fd0ff' },
  { id: 'frame.leaf', kind: 'frame', price: 90, nameKey: 'item.frame.leaf', a: '#a8e07a', b: '#3f9a4a' },
];
export const itemById = (id: string) => SHOP_ITEMS.find((x) => x.id === id) ?? null;
