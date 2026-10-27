/**
 * REBOOT R4 — Social Hub VIEW. Renders the SocialHub model and sends user intents back to it; it holds no state of its
 * own (no location, no room status). Two pieces:
 *   - a "Piazza" pill on the room screen (with the public room status when it is open), entry point to the hub;
 *   - the hub screen (full overlay while the model says at === 'hub'): destinations as cards, disabled ones marked.
 * One model subscription for the view's whole life; nothing is added per navigation.
 */
import type { SocialHub, DestinationView, HubEvent } from './SocialHub';
import './hub.css';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ICON: Record<string, string> = {
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  public: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-7 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm14 0a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 13c4 0 7 2 7 5v2H5v-2c0-3 3-5 7-5z"/></svg>',
  future: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3z"/></svg>',
};

export class HubScreen {
  readonly pill: HTMLButtonElement;
  readonly screen: HTMLElement;
  private unsub: () => void;
  private timer = 0;
  constructor(private hub: SocialHub, private root: HTMLElement, private visible: () => boolean) {
    this.pill = document.createElement('button'); this.pill.type = 'button'; this.pill.className = 'hub-pill';
    this.pill.addEventListener('click', () => void this.hub.go('hub'));
    this.screen = document.createElement('section'); this.screen.className = 'hub-screen'; this.screen.hidden = true;
    this.screen.setAttribute('role', 'dialog'); this.screen.setAttribute('aria-label', 'Piazza — Social Hub');
    this.screen.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-dest]'); if (b && !b.disabled) void this.hub.go(b.dataset.dest!); });
    root.append(this.pill, this.screen);
    this.unsub = hub.subscribe((e: HubEvent) => { if (e.type !== 'navigation.started') this.render(); else this.busy(e.to); });
    this.timer = window.setInterval(() => this.syncVisible(), 400);   // follows the Classic screen (pill only on the own room)
    this.render();
  }
  private syncVisible() { const v = this.visible(); this.pill.hidden = !v || this.hub.at === 'hub'; if (!v && this.hub.at !== 'hub') this.screen.hidden = true; }
  private busy(to: string) { this.screen.querySelector('[data-navstate]')?.replaceChildren(document.createTextNode(`In viaggio verso ${to === 'home' ? 'Casa' : to === 'public' ? 'la stanza pubblica' : to}…`)); this.screen.querySelectorAll<HTMLButtonElement>('[data-dest]').forEach((b) => (b.disabled = true)); }
  render() {
    const st = this.hub.state, ps = this.hub.publicStatus;
    this.pill.innerHTML = `<span class="hub-pin"></span>Piazza${st.at === 'public' && ps ? ` <span class="hub-chip" data-hubchip>${esc(ps.label)}</span>` : ''}`;
    this.syncVisible();
    this.screen.hidden = st.at !== 'hub';
    if (this.screen.hidden) return;
    const cards = this.hub.destinations();
    const card = (d: DestinationView) => `<button type="button" class="hub-card k-${d.kind}${d.current ? ' current' : ''}" data-dest="${esc(d.id)}" ${d.available && !d.current && !st.navigating ? '' : 'disabled'} aria-disabled="${!d.available}">
        <span class="hub-ico">${ICON[d.kind]}</span><span class="hub-txt"><b>${esc(d.title)}</b><small>${esc(d.subtitle)}</small>${!d.available && d.reason ? `<em>${esc(d.reason)}</em>` : ''}</span>${d.kind === 'future' ? `<span class="hub-soon">${esc(d.phase ?? '')}</span>` : ''}</button>`;
    const main = cards.filter((c) => c.kind !== 'future'), fut = cards.filter((c) => c.kind === 'future');
    this.screen.innerHTML = `<div class="hub-inner">
        <header><p class="hub-badge">REBOOT · nuovo, non presente in Miitomo</p><h1>Piazza</h1><p class="hub-sub">Da qui vai nella tua stanza o apri la tua stanza agli amici.</p></header>
        <div class="hub-grid">${main.map(card).join('')}</div>
        <h2>In arrivo</h2><div class="hub-grid future">${fut.map(card).join('')}</div>
        <p class="hub-nav" data-navstate role="status">${st.lastError ? esc(st.lastError.message) : ''}</p>
      </div>`;
  }
  dispose() { clearInterval(this.timer); this.unsub(); this.pill.remove(); this.screen.remove(); }
}
