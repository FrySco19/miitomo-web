/**
 * REBOOT R4 — Social Hub MODEL (no DOM). The central place from which the user moves between their private life (Casa)
 * and their social life (their Public Room; later: other spaces).
 *
 * Single source of truth for "where am I":
 *   at = 'hub'    while the hub is the current destination (the hub owns only this flag)
 *      = 'public' while the R3 controller says the room is public (or closing)
 *      = 'home'   otherwise
 * The Public Room state shown by the hub is never stored here: it is read from the R3 domain (controller + room model)
 * whenever a domain event arrives (room.state / presence.* / open / closing / closed). Opening, closing and every
 * cleanup stay in R3 (PublicRoomController); the hub only asks for them.
 *
 * Local only: no server, no remote rooms, no networking. Future destinations are declared, shown disabled, and become
 * real by registering a DestinationDef (see docs/reboot/SOCIAL-HUB.md).
 */
import type { PublicRoomController, PublicMode } from '../rooms/PublicRoomController';

export type Location = 'home' | 'hub' | 'public';
export type NavError = 'BUSY' | 'ALREADY_THERE' | 'UNAVAILABLE' | 'CLOSING' | 'OPEN_REFUSED' | 'NOT_IN_ROOM' | 'TIMEOUT' | 'INTERRUPTED';
export type HubEvent =
  | { type: 'navigation.started'; from: Location; to: string }
  | { type: 'navigation.completed'; from: Location; to: Location }
  | { type: 'navigation.failed'; from: Location; to: string; code: NavError; message: string }
  | { type: 'public.changed'; status: PublicStatus }
  | { type: 'state'; state: HubState };

export interface PublicStatus { mode: PublicMode; state: 'closed' | 'open' | 'full'; present: number; capacity: number; visitors: number; title: string; label: string; }
export interface DestinationView { id: string; title: string; subtitle: string; kind: 'home' | 'public' | 'future'; available: boolean; reason: string | null; current: boolean; phase?: string; }
export interface HubState { at: Location; navigating: { to: string; since: number } | null; lastError: { code: NavError; message: string } | null; counters: { navigations: number; completed: number; failed: number }; }

/** Extension point: a future social space. `go` must resolve ok / not ok; until it exists, `available` is false. */
export interface DestinationDef { id: string; title: string; subtitle: string; phase: string; available: () => { ok: boolean; reason: string }; go?: () => Promise<{ ok: boolean; reason?: string }>; }

/** Declared, NOT implemented: shown disabled with the phase that brings them. No fake networking behind them. */
export const FUTURE_DESTINATIONS: DestinationDef[] = [
  { id: 'friends-rooms', title: 'Stanze degli amici', subtitle: 'Le stanze pubbliche dei tuoi amici', phase: 'R10', available: () => ({ ok: false, reason: 'Serve il nostro server (R10).' }) },
  { id: 'games', title: 'Sala giochi', subtitle: 'Minigiochi con gli altri Mii', phase: 'R6–R7', available: () => ({ ok: false, reason: 'In arrivo con i minigiochi (R6–R7).' }) },
  { id: 'miinstagram', title: 'MIInstagram', subtitle: 'Le Miifoto di tutti', phase: 'R5', available: () => ({ ok: false, reason: 'In arrivo (R5).' }) },
];

export interface HubDeps {
  rooms: PublicRoomController | null;
  /** Is the user in their own room screen (where the hub lives)? Read-only check from the host. */
  inRoom: () => boolean;
  /** Room simulation clock (for transition time-outs); returns an unsubscribe. */
  onTick: (cb: (dt: number) => void) => () => void;
  /** Called after arriving in the public room: shows the R3 management panel (not duplicated here). */
  showRoomPanel?: () => void;
  /** How long a transition may wait for R3 to finish its cleanup (simulation seconds). */
  timeout?: number;
}

export class SocialHub {
  private hubOpen = false;
  private nav: { to: string; since: number } | null = null;
  private lastError: HubState['lastError'] = null;
  private counters = { navigations: 0, completed: 0, failed: 0 };
  private subs = new Set<(e: HubEvent) => void>();
  private unsubs: (() => void)[] = [];
  private extra: DestinationDef[] = [];
  readonly log: HubEvent[] = [];
  private clock = 0;

  constructor(private deps: HubDeps) {
    // domain → hub: one subscription per source for the hub's whole life (no per-navigation listeners)
    if (deps.rooms) {
      this.unsubs.push(deps.rooms.subscribe(() => this.publicChanged()));
      this.unsubs.push(deps.rooms.svc.subscribe((e) => { if (e.type === 'room.state' || e.type === 'presence.join' || e.type === 'presence.leave' || e.type === 'room.updated') this.publicChanged(); }));
    }
  }
  dispose() { for (const u of this.unsubs) u(); this.unsubs = []; this.subs.clear(); }

  // ------------------------------------------------------------------ read model
  get at(): Location { return this.hubOpen ? 'hub' : this.deps.rooms?.isPublic ? 'public' : 'home'; }
  get state(): HubState { return { at: this.at, navigating: this.nav, lastError: this.lastError, counters: { ...this.counters } }; }
  /** Public Room status, read from the R3 domain (never cached here). */
  get publicStatus(): PublicStatus | null {
    const r = this.deps.rooms; if (!r) return null;
    const room = r.room, info = room.info, present = room.presence().length, st = room.state;
    const label = r.mode === 'closing' ? 'In chiusura…' : st === 'closed' ? 'Chiusa' : st === 'full' ? 'Aperta · piena' : `Aperta · ${present}/${info.capacity}`;
    return { mode: r.mode, state: st, present, capacity: info.capacity, visitors: room.visitors().length, title: info.title, label };
  }
  destinations(): DestinationView[] {
    const at = this.at, ps = this.publicStatus;
    const out: DestinationView[] = [
      { id: 'home', title: 'Casa', subtitle: 'La tua stanza privata', kind: 'home', available: true, reason: null, current: at === 'home' },
    ];
    if (ps) {
      const closing = ps.mode === 'closing';
      out.push({ id: 'public', title: 'La mia stanza pubblica', subtitle: `${ps.title} · ${ps.label}`, kind: 'public', available: !closing, reason: closing ? 'Si sta chiudendo: i visitatori stanno uscendo.' : null, current: at === 'public' });
    } else out.push({ id: 'public', title: 'La mia stanza pubblica', subtitle: 'Disattivata', kind: 'public', available: false, reason: 'Funzione "Stanza pubblica" disattivata.', current: false });
    for (const d of [...this.extra, ...FUTURE_DESTINATIONS]) { const a = d.available(); out.push({ id: d.id, title: d.title, subtitle: d.subtitle, kind: 'future', available: a.ok, reason: a.ok ? null : a.reason, current: false, phase: d.phase }); }
    return out;
  }
  /** Extension point for future destinations (R5+, R10). Same id twice is refused. */
  register(d: DestinationDef) { if ([...this.extra, ...FUTURE_DESTINATIONS].some((x) => x.id === d.id) || ['home', 'hub', 'public'].includes(d.id)) return false; this.extra.push(d); this.emit({ type: 'state', state: this.state }); return true; }

  subscribe(cb: (e: HubEvent) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
  private emit(e: HubEvent) { this.log.push(e); if (this.log.length > 300) this.log.shift(); for (const s of this.subs) { try { s(e); } catch (err) { console.warn(err); } } }
  private publicChanged() { const st = this.publicStatus; if (st) this.emit({ type: 'public.changed', status: st }); this.emit({ type: 'state', state: this.state }); }

  // ------------------------------------------------------------------ navigation
  /**
   * Explicit transitions only:
   *   home → hub, public → hub (R3 closes the room: same cleanup as R3), hub → home, public → home (waits for R3 to finish),
   *   hub → public, home → public (R3 opens the room; refused reasons come back as OPEN_REFUSED).
   * One transition at a time (BUSY); failures leave the previous state as it was and are logged / emitted.
   */
  async go(to: string): Promise<{ ok: boolean; code?: NavError; message?: string }> {
    const from = this.at;
    if (this.nav) return this.fail(from, to, 'BUSY', `Sto già andando a "${this.nav.to}".`, false);
    if (to === from) return this.fail(from, to, 'ALREADY_THERE', 'Ci sei già.', false);
    if (!this.deps.inRoom()) return this.fail(from, to, 'NOT_IN_ROOM', 'Il Social Hub si usa dalla tua stanza.', false);
    const fut = [...this.extra, ...FUTURE_DESTINATIONS].find((d) => d.id === to);
    if (fut) { const a = fut.available(); if (!a.ok || !fut.go) return this.fail(from, to, 'UNAVAILABLE', a.reason || 'Non disponibile.', false); }
    if (!['home', 'hub', 'public'].includes(to) && !fut) return this.fail(from, to, 'UNAVAILABLE', 'Destinazione sconosciuta.', false);
    const rooms = this.deps.rooms;
    if (to === 'public' && !rooms) return this.fail(from, to, 'UNAVAILABLE', 'Stanza pubblica disattivata.', false);
    if (to === 'public' && rooms!.mode === 'closing') return this.fail(from, to, 'CLOSING', 'La stanza pubblica si sta ancora chiudendo.', false);

    this.nav = { to, since: this.clock }; this.counters.navigations++;
    this.emit({ type: 'navigation.started', from, to });
    try {
      if (fut) { const r = await fut.go!(); if (!r.ok) return this.fail(from, to, 'UNAVAILABLE', r.reason ?? 'Non disponibile.'); return this.done(from); }
      if (to === 'hub') {
        if (from === 'public') rooms!.close();              // R3 cleanup (visitors leave politely, R3 restores the private room)
        this.hubOpen = true;
        return this.done(from);
      }
      if (to === 'home') {
        if (from === 'hub') {
          // the public room may still be closing in the background (public → hub): arrive home when R3 is done
          if (rooms?.mode === 'closing') {
            const ok = await this.waitFor(() => rooms.mode === 'private');
            if (!ok) return this.fail(from, to, ok === null ? 'INTERRUPTED' : 'TIMEOUT', ok === null ? 'Uscita interrotta.' : 'La stanza non si è chiusa in tempo (pulizia incompleta).');
          }
          this.hubOpen = false; return this.done(from);
        }
        // public → home: R3 closes; arrive when R3 says the room is private again
        rooms!.close();
        const ok = await this.waitFor(() => rooms!.mode === 'private');
        if (!ok) return this.fail(from, to, ok === null ? 'INTERRUPTED' : 'TIMEOUT', ok === null ? 'Uscita interrotta.' : 'La stanza non si è chiusa in tempo (pulizia incompleta).');
        return this.done(from);
      }
      // to === 'public'
      const r = rooms!.isPublic ? { ok: true } : rooms!.open();
      if (!r.ok) return this.fail(from, to, 'OPEN_REFUSED', (r as { reason?: string }).reason ?? 'Impossibile aprire la stanza.');
      this.hubOpen = false;
      this.deps.showRoomPanel?.();
      return this.done(from);
    } catch (e) {
      return this.fail(from, to, 'INTERRUPTED', (e as Error).message);
    }
  }
  /** Waits (on the room clock) for a domain condition; false on time-out, null if the user left the room meanwhile. */
  private waitFor(cond: () => boolean): Promise<boolean | null> {
    if (cond()) return Promise.resolve(true);
    const limit = this.deps.timeout ?? 180;
    return new Promise((res) => {
      let t = 0, done = false;
      const finish = (v: boolean | null) => { if (done) return; done = true; un(); unRoom?.(); res(v); };
      const un = this.deps.onTick((dt) => { t += dt; this.clock += dt; if (cond()) finish(true); else if (t > limit) finish(false); });
      const unRoom = this.deps.rooms?.subscribe(() => { if (cond()) finish(true); else if (!this.deps.inRoom()) finish(null); });
    });
  }
  private done(from: Location) {
    this.nav = null; this.lastError = null; this.counters.completed++;
    this.emit({ type: 'navigation.completed', from, to: this.at });
    this.emit({ type: 'state', state: this.state });
    return { ok: true };
  }
  private fail(from: Location, to: string, code: NavError, message: string, clearNav = true) {
    if (clearNav) this.nav = null;
    this.lastError = { code, message }; this.counters.failed++;
    this.emit({ type: 'navigation.failed', from, to, code, message });
    this.emit({ type: 'state', state: this.state });
    return { ok: false, code, message };
  }
}
