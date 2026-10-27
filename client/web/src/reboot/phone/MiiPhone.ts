/**
 * REBOOT R5 — MiiPhone: the Miis' digital layer, above the physical one (Casa → Piazza → places). Opening the phone
 * never changes where the user is: no location, presence or scene change — the world keeps running behind it.
 *
 * State (owned here, the view only renders it):
 *   phase  closed → opening → open → closing → closed   (one transition at a time; the view reports when it ends)
 *   stack  ['home'] or ['home', <app>]                  (back = pop)
 *   last   the app that was on screen when the phone was closed: reopening restores it
 * Apps come from a registry (AppDefinition). Only implemented apps are shown; declared future apps stay hidden.
 * Errors (never a broken state): APP_UNAVAILABLE, ALREADY_OPEN, ALREADY_CLOSED, BUSY (input during a transition),
 * HIDDEN (the phone is not offered here, e.g. during a match or in Classic screens).
 */
export interface AppDefinition {
  id: string;
  titleKey: string;
  /** Inline SVG (decorative). */
  icon: string;
  /** false = declared for the future: never shown, never opened. */
  implemented: boolean;
  /** Mounts the app into the phone screen; returns the unmount (listeners, timers, object URLs released there). */
  mount(el: HTMLElement): () => void;
}
export type PhonePhase = 'closed' | 'opening' | 'open' | 'closing';
export type PhoneError = 'APP_UNAVAILABLE' | 'ALREADY_OPEN' | 'ALREADY_CLOSED' | 'BUSY' | 'HIDDEN';
export type PhoneEvent = { type: 'state'; phase: PhonePhase; app: string } | { type: 'error'; code: PhoneError; info?: string };

export class MiiPhoneApps {
  private defs = new Map<string, AppDefinition>();
  register(d: AppDefinition) { if (!/^[a-z0-9-]{2,24}$/.test(d.id) || d.id === 'home' || this.defs.has(d.id)) return false; this.defs.set(d.id, d); return true; }
  get(id: string) { const d = this.defs.get(id); return d && d.implemented ? d : null; }
  /** What the home screen shows: implemented apps only. */
  visible() { return [...this.defs.values()].filter((d) => d.implemented); }
  get declared() { return this.defs.size; }
}

export class MiiPhone {
  phase: PhonePhase = 'closed';
  private stack: string[] = ['home'];
  private last = 'home';
  private subs = new Set<(e: PhoneEvent) => void>();
  readonly log: PhoneEvent[] = [];
  readonly counters = { opens: 0, closes: 0, refused: 0 };
  constructor(readonly apps: MiiPhoneApps, private allowed: () => boolean) {}
  subscribe(cb: (e: PhoneEvent) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
  private emit(e: PhoneEvent) { this.log.push(e); if (this.log.length > 100) this.log.shift(); for (const s of this.subs) { try { s(e); } catch (err) { console.warn(err); } } }
  private fail(code: PhoneError, info?: string) { this.counters.refused++; this.emit({ type: 'error', code, info }); return { ok: false as const, code }; }
  private state() { this.emit({ type: 'state', phase: this.phase, app: this.app }); return { ok: true as const }; }
  get app() { return this.stack[this.stack.length - 1]; }
  get isOpen() { return this.phase === 'open' || this.phase === 'opening'; }
  get available() { return this.allowed(); }

  /** Tap on the phone: opens it on the app it showed last (or `app`). */
  open(app?: string) {
    if (!this.allowed()) return this.fail('HIDDEN');
    if (this.phase === 'opening' || this.phase === 'closing') return this.fail('BUSY');
    if (this.phase === 'open') return this.fail('ALREADY_OPEN');
    const target = app ?? this.last;
    if (target !== 'home' && !this.apps.get(target)) { if (app) return this.fail('APP_UNAVAILABLE', app); this.stack = ['home']; }
    else this.stack = target === 'home' ? ['home'] : ['home', target];
    this.phase = 'opening'; this.counters.opens++;
    return this.state();
  }
  close() {
    if (this.phase === 'closed') return this.fail('ALREADY_CLOSED');
    if (this.phase !== 'open') return this.fail('BUSY');
    this.last = this.app; this.phase = 'closing'; this.counters.closes++;
    return this.state();
  }
  /** The view's animation ended (or the reduced-motion shortcut): the transition is complete. */
  settle() {
    if (this.phase === 'opening') { this.phase = 'open'; return this.state(); }
    if (this.phase === 'closing') { this.phase = 'closed'; return this.state(); }
    return { ok: true as const };
  }
  launch(id: string) {
    if (this.phase !== 'open') return this.fail(this.phase === 'closed' ? 'ALREADY_CLOSED' : 'BUSY');
    if (!this.apps.get(id)) return this.fail('APP_UNAVAILABLE', id);
    if (this.app === id) return { ok: true as const };
    this.stack = ['home', id];
    return this.state();
  }
  back() {
    if (this.phase !== 'open') return this.fail('BUSY');
    if (this.stack.length > 1) { this.stack.pop(); return this.state(); }
    return this.close();
  }
  /** The place stopped allowing the phone (a match started, a Classic screen): closes at once, keeps the last app. */
  forceClose() { if (this.phase === 'closed') return; this.last = this.app; this.phase = 'closed'; this.state(); }
}
