/**
 * REBOOT R5 — views of the places (no state of their own: they render the models and send intents back).
 *   friendRoomsPanel  the "Stanze degli amici" list inside the Piazza screen (from the places service)
 *   PlaceBar          the bar shown while the user is in a place: where, who is there, the user's role, Piazza / Casa
 * Navigation always goes through the SocialHub (one owner of "where am I"), never around it.
 */
import type { I18n } from '../i18n/i18n';
import type { SocialHub } from '../hub/SocialHub';
import type { LocalPlacesService, PlaceView } from './LocalPlacesService';
import type { PlaceVisit, VisitEvent } from './PlaceVisit';
import type { HubPanel } from '../hub/HubScreen';
import './places.css';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const MII_COLORS = ['#5aa9e6', '#7bc96f', '#f2c14e', '#ff7a2f'];

export function friendRoomsPanel(svc: LocalPlacesService, hub: SocialHub, i18n: I18n): HubPanel {
  return (el, back) => {
    let alive = true;
    const t = (k: string, v?: Record<string, string | number>) => i18n.t(k, v);
    const card = (p: PlaceView) => {
      const off = !!p.refusal;
      return `<article class="fr-card${off ? ' off' : ''}" data-room="${esc(p.id)}">
        <div class="fr-top"><span class="fr-av" style="background:${MII_COLORS[p.personality] ?? MII_COLORS[2]}" aria-hidden="true">${esc((p.ownerName.trim()[0] ?? '?').toUpperCase())}</span>
          <span class="fr-name"><b>${esc(t('fr.roomOf', { name: p.ownerName }))}</b><small>${esc(t('place.activity.' + p.activity))}</small></span></div>
        <div class="fr-st"><span class="fr-chip s-${p.status}">${esc(t('fr.status.' + p.status))}</span>${p.status === 'open' || p.status === 'full' ? `<span class="fr-chip" data-count>${p.present}/${p.capacity}</span>` : ''}</div>
        ${off ? `<p class="fr-why">${esc(t('place.err.' + p.refusal))}</p>` : ''}
        <button type="button" class="fr-enter" data-enter="${esc(p.id)}" ${off ? 'disabled' : ''}>${esc(t('fr.enter'))}</button>
      </article>`;
    };
    const render = () => {
      if (!alive) return;
      const list = svc.list('friend');
      el.innerHTML = `<p class="fr-intro">${esc(t('fr.intro'))}</p>
        ${list.length ? `<div class="fr-list">${list.map(card).join('')}</div>` : `<div class="fr-empty"><p>${esc(t('fr.empty'))}</p></div>`}
        <p class="fr-note">${esc(t('fr.localNote'))}</p>`;
    };
    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-enter]'); if (!b || b.disabled) return;
      el.querySelectorAll<HTMLButtonElement>('[data-enter]').forEach((x) => (x.disabled = true));
      void hub.go('friends', b.dataset.enter!).then((r) => { if (r.ok) back(); else render(); });
    };
    el.addEventListener('click', onClick);
    const unsubs = [svc.subscribe(() => render()), i18n.subscribe(() => render())];
    el.innerHTML = `<p class="fr-intro">${esc(t('fr.loading'))}</p>`;
    void svc.refresh().then(render);
    return () => { alive = false; el.removeEventListener('click', onClick); for (const u of unsubs) u(); el.innerHTML = ''; };
  };
}

/** The bar of the place the user is in (friend room or Sala Giochi). */
export class PlaceBar {
  readonly el: HTMLElement;
  private unsubs: (() => void)[] = [];
  private toastTimer = 0;
  constructor(private visit: PlaceVisit, private svc: LocalPlacesService, private hub: SocialHub, private i18n: I18n, root: HTMLElement, private names: (id: string) => string) {
    this.el = document.createElement('nav'); this.el.className = 'pb-bar'; this.el.hidden = true;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-go]'); if (!b) return;
      b.disabled = true; void this.hub.go(b.dataset.go!).finally(() => { b.disabled = false; });
    });
    root.append(this.el);
    this.unsubs.push(visit.subscribe((e) => this.onVisit(e)));
    this.unsubs.push(svc.subscribe(() => this.render()));
    this.unsubs.push(i18n.subscribe(() => this.render()));
    this.render();
  }
  private onVisit(e: VisitEvent) {
    const t = (k: string, v?: Record<string, string | number>) => this.i18n.t(k, v);
    if (e.type === 'join') this.toast(t('pb.join', { name: this.names(e.id) }));
    if (e.type === 'leave') this.toast(t('pb.leave', { name: this.names(e.id) }));
    if (e.type === 'denied') this.toast(t('pb.denied.' + e.action));
    this.render();
  }
  private toast(text: string) {
    let el = this.el.querySelector<HTMLElement>('.pb-toast');
    if (!el) { el = document.createElement('p'); el.className = 'pb-toast'; el.setAttribute('role', 'status'); this.el.append(el); }
    el.textContent = text; el.hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => { if (el) el.hidden = true; }, 3000);
  }
  render() {
    const id = this.visit.roomId, room = id ? this.svc.get(id) : null, info = id ? this.svc.place(id) : null;
    this.el.hidden = !id || !room || !info;
    if (this.el.hidden) { this.el.innerHTML = ''; return; }
    const t = (k: string, v?: Record<string, string | number>) => this.i18n.t(k, v);
    const title = info!.kind === 'games' ? t('games.title') : t('fr.roomOf', { name: info!.owner?.name ?? '' });
    const role = room!.role('host') ?? 'visitor';
    const toast = this.el.querySelector('.pb-toast');
    this.el.setAttribute('aria-label', title);
    this.el.innerHTML = `<div class="pb-main"><span class="pb-ico ${info!.kind}" aria-hidden="true"></span><span class="pb-txt"><b>${esc(title)}</b><small data-pbcount>${esc(t('pb.present', { n: room!.presence().length, cap: room!.info.capacity }))} · ${esc(t('role.' + role))}</small></span></div>
      <div class="pb-actions"><button type="button" data-go="hub">${esc(t('hub.pill'))}</button><button type="button" data-go="home">${esc(t('hub.dest.home.title'))}</button></div>`;
    if (toast) this.el.append(toast);
  }
  dispose() { clearTimeout(this.toastTimer); for (const u of this.unsubs) u(); this.unsubs = []; this.el.remove(); }
}
