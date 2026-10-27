/**
 * REBOOT R6.0b — the Reboot shop, a MiiPhone app. Tabs: phone covers, profile cards, photo frames, and the wallet
 * (balance, how coins are earned with today's use, history). Every item shows its look; a cover can be tried on the
 * phone itself before buying (the try-on ends when the shop closes). Buying asks for a second tap when confirmations
 * are on (Settings). Prices and rules are the NEW Reboot economy (economy/Wallet.ts).
 */
import type { I18n } from '../i18n/i18n';
import type { Wallet, EarnRule } from '../economy/Wallet';
import { EARN } from '../economy/Wallet';
import type { Inventory } from './Inventory';
import { SHOP_ITEMS, ShopKind, ShopItemDef } from './catalog';
import './shop.css';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const COIN_ICON = '<svg class="sh-coin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#ffc83d" stroke="#d08a00" stroke-width="2"/><path d="M12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.5h-3a1.8 1.8 0 0 0 0 3.5h4" fill="none" stroke="#a86a00" stroke-width="1.8" stroke-linecap="round"/></svg>';

export interface ShopDeps {
  i18n: I18n; wallet: Wallet; inventory: Inventory;
  confirm: () => boolean;
  /** Try a cover on the phone (null = back to the one in use). */
  previewCover: (id: string | null) => void;
}

export function shopApp(d: ShopDeps) {
  return (el: HTMLElement) => {
    let tab: ShopKind | 'wallet' = 'cover', armed = '', msg = '', trying: string | null = null;
    const t = (k: string, v?: Record<string, string | number>) => d.i18n.t(k, v);
    const swatch = (it: ShopItemDef) => it.kind === 'cover'
      ? `<span class="sh-sw cover" style="--a:${it.a};--b:${it.b}"><i></i></span>`
      : it.kind === 'card' ? `<span class="sh-sw card" style="--a:${it.a};--b:${it.b}"><i></i><b></b></span>`
        : `<span class="sh-sw frame ${it.id === 'frame.none' ? 'none' : ''}" style="--a:${it.a};--b:${it.b}"><i></i></span>`;
    const card = (it: ShopItemDef) => {
      const owned = d.inventory.owns(it.id), inUse = d.inventory.equipped(it.kind) === it.id, afford = d.wallet.balance >= it.price;
      const name = t(it.nameKey);
      const action = inUse ? `<span class="r-chip ok">${esc(t('shop.inUse'))}</span>`
        : owned ? `<button type="button" class="r-btn sm" data-use="${it.id}">${esc(t('shop.use'))}</button>`
          : `<button type="button" class="r-btn primary sm" data-buy="${it.id}" ${afford ? '' : 'disabled'}>${esc(armed === it.id ? t('shop.buyConfirm', { price: it.price }) : t('shop.buy'))}</button>`;
      const price = owned ? `<small>${esc(t('shop.owned'))}</small>` : `<small class="sh-price">${COIN_ICON}${it.price}${afford ? '' : ` · ${esc(t('shop.missing', { n: it.price - d.wallet.balance }))}`}</small>`;
      return `<li class="r-card sh-item${trying === it.id ? ' trying' : ''}" data-id="${it.id}">
          <button type="button" class="sh-look" ${it.kind === 'cover' && !inUse ? `data-try="${it.id}"` : 'tabindex="-1"'} aria-label="${esc(it.kind === 'cover' ? t('shop.try', { name }) : name)}">${swatch(it)}</button>
          <b>${esc(name)}</b>${price}${action}</li>`;
    };
    const wallet = () => {
      const rules = Object.keys(EARN) as EarnRule[];
      const hist = d.wallet.ledger.slice(0, 30);
      return `<section class="ap-sec"><h3 class="r-sub">${esc(t('wallet.how'))}</h3><ul class="r-list sh-rules">${rules.map((r) => { const e = EARN[r];
          return `<li class="r-row"><span class="r-grow"><b>${esc(t('rule.' + r))}</b><small>${esc(e.perDay ? t('wallet.perDay', { used: d.wallet.usedToday(r), max: e.perDay }) : t('wallet.once'))}</small></span><span class="sh-amt plus">+${e.amount}</span></li>`; }).join('')}</ul></section>
        <section class="ap-sec"><h3 class="r-sub">${esc(t('wallet.history'))}</h3>${hist.length ? `<ul class="r-list sh-hist">${hist.map((e) => `<li class="r-row"><span class="r-grow"><b>${esc(t(e.reason, e.vars))}</b><small>${esc(d.i18n.ago(e.at))}</small></span><span class="sh-amt ${e.amount > 0 ? 'plus' : 'minus'}">${e.amount > 0 ? '+' : '−'}${Math.abs(e.amount)}</span></li>`).join('')}</ul>` : `<p class="r-note">${esc(t('wallet.empty'))}</p>`}</section>`;
    };
    const render = () => {
      el.innerHTML = `<div class="ap sh">
          <div class="sh-bal" aria-live="polite">${COIN_ICON}<b data-balance>${d.wallet.balance}</b><span>${esc(t('shop.coins'))}</span></div>
          <div class="r-tabs" role="tablist">${(['cover', 'card', 'frame', 'wallet'] as const).map((k) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${esc(t('shop.tab.' + k))}</button>`).join('')}</div>
          <p class="r-msg" role="status">${esc(msg)}</p>
          ${tab === 'wallet' ? wallet() : `<ul class="sh-grid">${SHOP_ITEMS.filter((x) => x.kind === tab).map(card).join('')}</ul>${tab === 'cover' ? `<p class="r-note">${esc(t('shop.tryNote'))}</p>` : ''}`}
          <p class="r-note">${esc(t('shop.note'))}</p>
        </div>`;
    };
    const stopTry = () => { if (trying) { trying = null; d.previewCover(null); } };
    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab],[data-buy],[data-use],[data-try]'); if (!b) return;
      msg = '';
      if (b.dataset.tab) { tab = b.dataset.tab as typeof tab; armed = ''; stopTry(); render(); return; }
      if (b.dataset.try) { trying = trying === b.dataset.try ? null : b.dataset.try; d.previewCover(trying); render(); return; }
      if (b.dataset.use) { d.inventory.equip(b.dataset.use); trying = null; d.previewCover(null); msg = t('shop.equipped'); render(); return; }
      const id = b.dataset.buy!;
      if (d.confirm() && armed !== id) { armed = id; render(); return; }
      armed = '';
      const it = SHOP_ITEMS.find((x) => x.id === id)!;
      const r = d.inventory.buy(id);
      if (r.ok) { d.inventory.equip(id); trying = null; d.previewCover(null); msg = t('shop.bought', { name: t(it.nameKey) }); }
      else msg = t('shop.err.' + r.code);
      render();
    };
    el.addEventListener('click', onClick);
    const unsubs = [d.i18n.subscribe(() => render()), d.wallet.subscribe(() => render()), d.inventory.subscribe(() => render())];
    render();
    return () => { stopTry(); for (const u of unsubs) u(); el.removeEventListener('click', onClick); el.innerHTML = ''; };
  };
}
