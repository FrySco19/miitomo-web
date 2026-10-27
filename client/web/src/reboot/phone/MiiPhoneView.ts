/**
 * REBOOT R5 — MiiPhone VIEW. A small phone resting on the right edge of the screen (not a web button): tap it and it
 * slides in over the world, which stays visible and is only slightly dimmed. On a narrow screen the phone becomes the
 * whole screen (no tiny phone inside the real phone). It renders the MiiPhone model and sends intents back; apps are
 * mounted into its screen and unmounted when they leave it (their listeners go with them).
 */
import type { MiiPhone, PhoneEvent } from './MiiPhone';
import type { I18n } from '../i18n/i18n';
import './phone.css';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export class MiiPhoneView {
  readonly button: HTMLButtonElement;
  readonly backdrop: HTMLElement;
  readonly panel: HTMLElement;
  private screen: HTMLElement;
  private unmount: (() => void) | null = null;
  private mounted = '';
  private unsubs: (() => void)[] = [];
  private timer = 0;
  private settleTimer = 0;
  private badge = 0;
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && this.phone.phase === 'open') { e.stopPropagation(); this.phone.back(); } };
  constructor(private phone: MiiPhone, private i18n: I18n, root: HTMLElement) {
    this.button = document.createElement('button'); this.button.type = 'button'; this.button.className = 'mp-dock';
    this.button.innerHTML = '<span class="mp-dock-body"><span class="mp-dock-cam"></span><span class="mp-dock-screen"><span class="mp-dock-face"></span></span><span class="mp-dock-badge" hidden></span></span>';
    this.button.addEventListener('click', () => this.phone.open());
    this.backdrop = document.createElement('div'); this.backdrop.className = 'mp-backdrop'; this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', () => this.phone.close());
    this.panel = document.createElement('section'); this.panel.className = 'mp-phone'; this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-modal', 'false');
    this.panel.innerHTML = `<div class="mp-frame"><div class="mp-speaker"></div><header class="mp-bar"><button type="button" class="mp-back" data-p="back"></button><b class="mp-title"></b><button type="button" class="mp-x" data-p="close"></button></header><div class="mp-screen"></div></div>`;
    this.screen = this.panel.querySelector('.mp-screen')!;
    this.panel.addEventListener('click', (e) => this.onClick(e));
    this.panel.addEventListener('animationend', (e) => { if (e.target === this.panel) this.phone.settle(); });
    root.append(this.backdrop, this.panel, this.button);
    this.unsubs.push(phone.subscribe((e) => this.onPhone(e)));
    this.unsubs.push(i18n.subscribe(() => this.render(true)));
    window.addEventListener('keydown', this.onKey);
    this.timer = window.setInterval(() => this.sync(), 400);
    this.render(true);
  }
  /** New things in MIInstagram since the phone was last opened (a small dot on the phone). */
  notify(n: number) { this.badge = Math.max(0, n); const b = this.button.querySelector<HTMLElement>('.mp-dock-badge')!; b.hidden = !this.badge || this.phone.isOpen; b.textContent = this.badge > 9 ? '9+' : String(this.badge); }
  /** Shows / hides the phone for the current place (also called at once when a match starts or ends). */
  sync() {
    const ok = this.phone.available;
    this.button.hidden = !ok || this.phone.phase !== 'closed';
    if (!ok && this.phone.phase !== 'closed') this.phone.forceClose();
  }
  private onPhone(e: PhoneEvent) {
    if (e.type === 'error') { this.toast(e.info && this.i18n.has(e.info) ? this.i18n.t(e.info) : this.i18n.t(`phone.err.${e.code}`)); return; }
    clearTimeout(this.settleTimer);
    if (e.phase === 'opening' || e.phase === 'closing') {
      // animations end with `animationend`; with reduced motion (or a hidden tab) the transition completes anyway
      const m = document.documentElement.dataset.motion;   // set by Reboot Settings; the OS preference otherwise
      const reduce = m ? m === 'reduced' : typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.settleTimer = window.setTimeout(() => this.phone.settle(), reduce ? 0 : 420);
    }
    if (e.phase === 'opening') this.notify(0);
    this.render(false);
  }
  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-p],[data-app]'); if (!t) return;
    if (t.dataset.p === 'close') this.phone.close();
    else if (t.dataset.p === 'back') this.phone.back();
    else if (t.dataset.app) this.phone.launch(t.dataset.app);
  }
  private toast(text: string) {
    let el = this.panel.querySelector<HTMLElement>('.mp-toast');
    if (!el) { el = document.createElement('p'); el.className = 'mp-toast'; el.setAttribute('role', 'status'); this.panel.querySelector('.mp-frame')!.append(el); }
    el.textContent = text; el.hidden = false; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
    window.setTimeout(() => { if (el) el.hidden = true; }, 2600);
  }
  /** `relabel` = texts changed (language); the mounted app re-renders itself on the same signal. */
  private render(relabel: boolean) {
    const t = (k: string) => this.i18n.t(k), ph = this.phone.phase;
    this.button.setAttribute('aria-label', t('phone.open')); this.button.title = t('phone.open');
    this.panel.setAttribute('aria-label', t('phone.name'));
    this.panel.querySelector('.mp-back')!.setAttribute('aria-label', t('phone.back'));
    this.panel.querySelector('.mp-back')!.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>';
    this.panel.querySelector('.mp-x')!.setAttribute('aria-label', t('phone.close'));
    this.panel.querySelector('.mp-x')!.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    const hidden = ph === 'closed';
    this.panel.hidden = hidden; this.backdrop.hidden = hidden;
    this.panel.classList.toggle('opening', ph === 'opening'); this.panel.classList.toggle('closing', ph === 'closing');
    this.backdrop.classList.toggle('closing', ph === 'closing');
    this.sync();
    if (hidden) { this.unmountApp(); return; }
    const app = this.phone.app;
    this.panel.querySelector('.mp-title')!.textContent = app === 'home' ? t('phone.name') : t(this.phone.apps.get(app)?.titleKey ?? app);
    this.panel.querySelector<HTMLElement>('.mp-back')!.hidden = app === 'home';
    if (app === this.mounted && !relabel) return;
    if (app === 'home') { this.unmountApp(); this.home(); this.mounted = 'home'; return; }
    if (app !== this.mounted) {
      this.unmountApp();
      const def = this.phone.apps.get(app);
      if (!def) { this.home(); this.mounted = 'home'; return; }
      this.screen.innerHTML = '';
      try { this.unmount = def.mount ? def.mount(this.screen) : null; } catch (err) { console.warn(err); this.screen.innerHTML = `<p class="mp-empty">${esc(t('phone.err.APP_UNAVAILABLE'))}</p>`; }
      this.mounted = app;
    }
  }
  private home() {
    const t = (k: string) => this.i18n.t(k);
    const apps = this.phone.apps.visible();
    const now = new Date();
    this.screen.innerHTML = `<div class="mp-home">
        <div class="mp-status"><time>${esc(now.toLocaleTimeString(this.i18n.locale, { hour: '2-digit', minute: '2-digit' }))}</time><span>${esc(now.toLocaleDateString(this.i18n.locale, { weekday: 'long', day: 'numeric', month: 'long' }))}</span></div>
        <p class="mp-hello">${esc(t('phone.hello'))}</p>
        <div class="mp-apps">${apps.map((a, i) => { const n = a.badge?.() ?? 0; return `<button type="button" class="mp-app" data-app="${esc(a.id)}" style="--i:${i}"><span class="mp-app-ico" style="background:${a.color ?? 'var(--r-accent-hi)'}">${a.icon}${n ? `<span class="mp-app-badge" aria-label="${n}">${n > 9 ? '9+' : n}</span>` : ''}</span><span class="mp-app-name">${esc(t(a.titleKey))}</span></button>`; }).join('') || `<p class="r-empty">${esc(t('phone.noApps'))}</p>`}</div>
        <p class="r-note mp-note">${esc(t('reboot.badge'))}</p>
      </div>`;
  }
  private unmountApp() { if (this.unmount) { try { this.unmount(); } catch (e) { console.warn(e); } } this.unmount = null; this.mounted = ''; }
  dispose() { this.unmountApp(); clearInterval(this.timer); clearTimeout(this.settleTimer); for (const u of this.unsubs) u(); this.unsubs = []; window.removeEventListener('keydown', this.onKey); this.button.remove(); this.backdrop.remove(); this.panel.remove(); }
}
