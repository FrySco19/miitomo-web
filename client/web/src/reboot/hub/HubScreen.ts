/**
 * REBOOT R4 — Social Hub VIEW. Renders the SocialHub model and sends user intents back to it; it holds no state of its
 * own (no location, no room status). Two pieces:
 *   - a "Piazza" pill on the room screen (with the public room status when it is open), entry point to the hub;
 *   - the hub screen (full overlay while the model says at === 'hub'): destinations as cards, disabled ones marked.
 * One model subscription for the view's whole life; nothing is added per navigation.
 * R5: texts from i18n (with the language choice in the header); a destination with a panel (the friends' rooms) opens
 * its panel inside the hub screen — a view state only: the user is still at the hub until the panel calls go().
 */
import type { SocialHub, DestinationView, HubEvent } from './SocialHub';
import type { I18n } from '../i18n/i18n';
import { LANGS } from '../i18n/i18n';
import './hub.css';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const HUB_ICON: Record<string, string> = {
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  public: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-7 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm14 0a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 13c4 0 7 2 7 5v2H5v-2c0-3 3-5 7-5z"/></svg>',
  future: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3z"/></svg>',
  friends: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 11 8 6l6 5v8H2zm5 3v5h2v-5zM14 10l4-3.5 4 3.5v9h-6v-6h-2z"/></svg>',
  games: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10a5 5 0 0 1 0 10l-2-2H9l-2 2A5 5 0 0 1 7 7zm1 3v1.5H6.5v1.5H8v1.5h1.5V13H11v-1.5H9.5V10zm7.5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>',
};
/** A panel shown inside the hub screen for a destination (mount → unmount). `back` returns to the cards. */
export type HubPanel = (el: HTMLElement, back: () => void) => () => void;

export class HubScreen {
  readonly pill: HTMLButtonElement;
  readonly screen: HTMLElement;
  private unsub: () => void;
  private unsubLang: () => void;
  private timer = 0;
  private panel: string | null = null;
  private unmountPanel: (() => void) | null = null;
  constructor(private hub: SocialHub, private root: HTMLElement, private visible: () => boolean, private opts: { i18n?: I18n; panels?: Record<string, HubPanel> } = {}) {
    this.pill = document.createElement('button'); this.pill.type = 'button'; this.pill.className = 'hub-pill';
    this.pill.addEventListener('click', () => void this.hub.go('hub'));
    this.screen = document.createElement('section'); this.screen.className = 'hub-screen'; this.screen.hidden = true;
    this.screen.setAttribute('role', 'dialog');
    this.screen.addEventListener('click', (e) => this.onClick(e));
    root.append(this.pill, this.screen);
    this.unsub = hub.subscribe((e: HubEvent) => { if (e.type !== 'navigation.started') this.render(); else this.busy(e.to); });
    this.unsubLang = opts.i18n?.subscribe(() => this.render(true)) ?? (() => {});
    this.timer = window.setInterval(() => this.syncVisible(), 400);   // follows the Classic screen (pill only on the own room)
    this.render();
  }
  private get t() { return this.hub.i18n; }
  private onClick(e: Event) {
    const el = e.target as HTMLElement;
    const lang = el.closest<HTMLElement>('[data-lang]'); if (lang) { this.opts.i18n?.set(lang.dataset.lang!); return; }
    if (el.closest('[data-hubback]')) { this.closePanel(); this.render(); return; }
    const b = el.closest<HTMLButtonElement>('[data-dest]'); if (!b || b.disabled) return;
    const id = b.dataset.dest!;
    if (b.dataset.panel && this.opts.panels?.[id]) { this.openPanel(id); return; }
    void this.hub.go(id);
  }
  private openPanel(id: string) { this.closePanel(); this.panel = id; this.render(true); }
  private closePanel() { if (this.unmountPanel) { try { this.unmountPanel(); } catch (err) { console.warn(err); } } this.unmountPanel = null; this.panel = null; }
  private syncVisible() { const v = this.visible(); this.pill.hidden = !v || this.hub.at === 'hub'; if (!v && this.hub.at !== 'hub') this.screen.hidden = true; }
  private busy(to: string) {
    const name = this.hub.destinations().find((d) => d.id === to)?.title ?? (to === 'hub' ? this.t.t('hub.title') : to);
    this.screen.querySelector('[data-navstate]')?.replaceChildren(document.createTextNode(this.t.t('hub.travelling', { to: name })));
    this.screen.querySelectorAll<HTMLButtonElement>('[data-dest]').forEach((b) => (b.disabled = true));
  }
  /** `relabel`: texts changed (language) or a panel opened — rebuild even if the panel is mounted. */
  render(relabel = false) {
    const st = this.hub.state, ps = this.hub.publicStatus, t = (k: string, v?: Record<string, string | number>) => this.t.t(k, v);
    this.pill.innerHTML = `<span class="hub-pin"></span>${esc(t('hub.pill'))}${st.at === 'public' && ps ? ` <span class="hub-chip" data-hubchip>${esc(ps.label)}</span>` : ''}`;
    this.screen.setAttribute('aria-label', t('hub.aria'));
    this.syncVisible();
    this.screen.hidden = st.at !== 'hub';
    if (this.screen.hidden) { this.closePanel(); return; }
    if (this.panel) {
      if (this.unmountPanel && !relabel) { const n = this.screen.querySelector('[data-navstate]'); if (n) n.textContent = st.lastError ? st.lastError.message : ''; return; }
      if (this.unmountPanel) { this.unmountPanel(); this.unmountPanel = null; }
      const def = this.hub.destinations().find((d) => d.id === this.panel);
      this.screen.innerHTML = `<div class="hub-inner"><header class="hub-ph"><button type="button" class="hub-back" data-hubback aria-label="${esc(t('hub.back'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg></button><h1>${esc(def?.title ?? '')}</h1></header><div class="hub-panel"></div><p class="hub-nav" data-navstate role="status">${st.lastError ? esc(st.lastError.message) : ''}</p></div>`;
      const id = this.panel;
      this.unmountPanel = this.opts.panels![id](this.screen.querySelector('.hub-panel')!, () => { this.closePanel(); this.render(); });
      return;
    }
    const cards = this.hub.destinations();
    const card = (d: DestinationView) => `<button type="button" class="hub-card k-${d.kind} d-${esc(d.id)}${d.current ? ' current' : ''}" data-dest="${esc(d.id)}" ${d.panel ? 'data-panel="1"' : ''} ${d.available && !d.current && !st.navigating ? '' : 'disabled'} aria-disabled="${!d.available}">
        <span class="hub-ico">${HUB_ICON[d.id === 'friends' ? 'friends' : d.id === 'games' ? 'games' : d.kind === 'place' ? 'public' : d.kind] ?? HUB_ICON.future}</span><span class="hub-txt"><b>${esc(d.title)}</b><small>${esc(d.subtitle)}</small>${!d.available && d.reason ? `<em>${esc(d.reason)}</em>` : ''}</span>${d.kind === 'future' ? `<span class="hub-soon">${esc(d.phase ?? '')}</span>` : ''}</button>`;
    const main = cards.filter((c) => c.kind !== 'future'), fut = cards.filter((c) => c.kind === 'future');
    const langs = this.opts.i18n ? `<div class="hub-lang" role="group" aria-label="${esc(t('lang.label'))}">${LANGS.map((l) => `<button type="button" data-lang="${l}" aria-pressed="${this.opts.i18n!.lang === l}">${esc(t('lang.' + l))}</button>`).join('')}</div>` : '';
    this.screen.innerHTML = `<div class="hub-inner">
        <header>${langs}<p class="hub-badge">${esc(t('hub.badge'))}</p><h1>${esc(t('hub.title'))}</h1><p class="hub-sub">${esc(t('hub.sub'))}</p></header>
        <div class="hub-grid">${main.map(card).join('')}</div>
        ${fut.length ? `<h2>${esc(t('hub.soon'))}</h2><div class="hub-grid future">${fut.map(card).join('')}</div>` : ''}
        <p class="hub-nav" data-navstate role="status">${st.lastError ? esc(st.lastError.message) : ''}</p>
      </div>`;
  }
  dispose() { this.closePanel(); clearInterval(this.timer); this.unsub(); this.unsubLang(); this.pill.remove(); this.screen.remove(); }
}
