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
 *
 * R5: registered PLACES (friends' rooms, Sala Giochi) are destinations with `here()` / `leave()`: the location is
 *   at = 'hub' | 'public' | <the place the user is in> | 'home'
 * still derived, never stored twice (the place's own visit owns "I am inside"). Leaving a place before going anywhere
 * else is the place's own cleanup; the hub only asks for it. All texts come from the i18n table.
 */
import type { PublicRoomController, PublicMode } from '../rooms/PublicRoomController';
import { I18n } from '../i18n/i18n';
import { roomTitle } from '../rooms/templates';

/** 'home' | 'hub' | 'public' | the id of a registered place (R5). */
export type Location = string;
export type NavError = 'BUSY' | 'ALREADY_THERE' | 'UNAVAILABLE' | 'CLOSING' | 'OPEN_REFUSED' | 'NOT_IN_ROOM' | 'TIMEOUT' | 'INTERRUPTED' | 'REFUSED' | 'EVICTED';
export type HubEvent =
  | { type: 'navigation.started'; from: Location; to: string }
  | { type: 'navigation.completed'; from: Location; to: Location }
  | { type: 'navigation.failed'; from: Location; to: string; code: NavError; message: string }
  | { type: 'public.changed'; status: PublicStatus }
  | { type: 'state'; state: HubState };

export interface PublicStatus { mode: PublicMode; state: 'closed' | 'open' | 'full'; present: number; capacity: number; visitors: number; title: string; label: string; }
export interface DestinationView { id: string; title: string; subtitle: string; kind: 'home' | 'public' | 'place' | 'future'; available: boolean; reason: string | null; current: boolean; phase?: string; panel?: boolean; }
export interface HubState { at: Location; navigating: { to: string; since: number } | null; lastError: { code: NavError; message: string } | null; counters: { navigations: number; completed: number; failed: number }; }

type Text = string | (() => string);
/**
 * Extension point: a social space. `go` must resolve ok / not ok; until it exists, `available` is false.
 * R5 places add `here` (the user is inside it) and `leave` (its own cleanup, back home); `panel` = the card opens a
 * panel of the view (e.g. the list of friends' rooms) and the panel calls go(id, arg).
 */
export interface DestinationDef {
  id: string; title: Text; subtitle: Text; phase: string;
  available: () => { ok: boolean; reason: string };
  go?: (arg?: string) => Promise<{ ok: boolean; reason?: string; code?: string }>;
  here?: () => boolean;
  leave?: () => boolean;
  panel?: boolean;
}
const txt = (t: Text) => (typeof t === 'function' ? t() : t);

/** Declared, NOT implemented: shown disabled with the phase that brings them. No fake networking behind them. */
export function futureDestinations(i18n: I18n): DestinationDef[] {
  return [
    { id: 'events', title: () => i18n.t('hub.dest.events.title'), subtitle: () => i18n.t('hub.dest.events.sub'), phase: 'R8', available: () => ({ ok: false, reason: i18n.t('hub.dest.events.reason') }) },
  ];
}
/** R4 shape kept for callers that count them (R5 made friends' rooms and the Sala Giochi real, MIInstagram moved to the MiiPhone). */
export const FUTURE_DESTINATIONS: DestinationDef[] = futureDestinations(I18n.fixed('it'));

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
  /** R5: texts. Default: Italian (what R4 shipped). */
  i18n?: I18n;
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
  readonly i18n: I18n;
  private future: DestinationDef[];

  constructor(private deps: HubDeps) {
    this.i18n = deps.i18n ?? I18n.fixed('it');
    this.future = futureDestinations(this.i18n);
    // domain → hub: one subscription per source for the hub's whole life (no per-navigation listeners)
    if (deps.rooms) {
      this.unsubs.push(deps.rooms.subscribe(() => this.publicChanged()));
      this.unsubs.push(deps.rooms.svc.subscribe((e) => { if (e.type === 'room.state' || e.type === 'presence.join' || e.type === 'presence.leave' || e.type === 'room.updated') this.publicChanged(); }));
    }
  }
  dispose() { for (const u of this.unsubs) u(); this.unsubs = []; this.subs.clear(); }

  // ------------------------------------------------------------------ read model
  get at(): Location { return this.hubOpen ? 'hub' : this.deps.rooms?.isPublic ? 'public' : this.place()?.id ?? 'home'; }
  /** The registered place the user is in (R5), if any. */
  private place() { return this.extra.find((d) => d.here?.()) ?? null; }
  get state(): HubState { return { at: this.at, navigating: this.nav, lastError: this.lastError, counters: { ...this.counters } }; }
  /** Public Room status, read from the R3 domain (never cached here). */
  get publicStatus(): PublicStatus | null {
    const r = this.deps.rooms; if (!r) return null;
    const room = r.room, info = room.info, present = room.presence().length, st = room.state;
    const t = this.i18n;
    const label = r.mode === 'closing' ? t.t('hub.public.closing') : st === 'closed' ? t.t('hub.public.closed') : st === 'full' ? t.t('hub.public.full') : t.t('hub.public.open', { n: present, cap: info.capacity });
    return { mode: r.mode, state: st, present, capacity: info.capacity, visitors: room.visitors().length, title: roomTitle(info, this.i18n), label };
  }
  destinations(): DestinationView[] {
    const at = this.at, ps = this.publicStatus, t = (k: string) => this.i18n.t(k);
    const out: DestinationView[] = [
      { id: 'home', title: t('hub.dest.home.title'), subtitle: t('hub.dest.home.sub'), kind: 'home', available: true, reason: null, current: at === 'home' },
    ];
    if (ps) {
      const closing = ps.mode === 'closing';
      out.push({ id: 'public', title: t('hub.dest.public.title'), subtitle: `${ps.title} · ${ps.label}`, kind: 'public', available: !closing, reason: closing ? t('hub.dest.public.closingReason') : null, current: at === 'public' });
    } else out.push({ id: 'public', title: t('hub.dest.public.title'), subtitle: t('hub.dest.public.off'), kind: 'public', available: false, reason: t('hub.dest.public.offReason'), current: false });
    for (const d of this.extra) { const a = d.available(); out.push({ id: d.id, title: txt(d.title), subtitle: txt(d.subtitle), kind: d.here ? 'place' : 'future', available: a.ok, reason: a.ok ? null : a.reason, current: at === d.id, phase: d.phase, panel: d.panel }); }
    for (const d of this.future) { const a = d.available(); out.push({ id: d.id, title: txt(d.title), subtitle: txt(d.subtitle), kind: 'future', available: a.ok, reason: a.ok ? null : a.reason, current: false, phase: d.phase }); }
    return out;
  }
  /** Extension point for destinations (R5 places, R10). Same id twice is refused. */
  register(d: DestinationDef) { if ([...this.extra, ...this.future].some((x) => x.id === d.id) || ['home', 'hub', 'public'].includes(d.id)) return false; this.extra.push(d); this.emit({ type: 'state', state: this.state }); return true; }
  /**
   * R5: the place the user was in sent them out (its owner closed it, it disappeared). The place already cleaned up and
   * went home; the user lands in the Piazza with the reason — never in a half state.
   */
  evicted(placeId: string, code: string) {
    this.hubOpen = true;
    const message = this.i18n.t(`place.evicted.${code}`);
    this.lastError = { code: 'EVICTED', message }; this.counters.failed++;
    this.emit({ type: 'navigation.failed', from: placeId, to: 'hub', code: 'EVICTED', message });
    this.emit({ type: 'state', state: this.state });
  }
  private title(id: string) { const t = (k: string) => this.i18n.t(k); if (id === 'home') return t('hub.dest.home.title'); if (id === 'public') return t('hub.dest.public.title'); if (id === 'hub') return t('hub.title'); const d = this.extra.find((x) => x.id === id); return d ? txt(d.title) : id; }

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
  async go(to: string, arg?: string): Promise<{ ok: boolean; code?: NavError; message?: string; detail?: string }> {
    const from = this.at, t = this.i18n;
    if (this.nav) return this.fail(from, to, 'BUSY', t.t('hub.err.BUSY', { to: this.title(this.nav.to) }), false);
    const here = this.place();
    const dest = this.extra.find((d) => d.id === to) ?? null;
    if (to === from && !(here && dest === here && arg)) return this.fail(from, to, 'ALREADY_THERE', t.t('hub.err.ALREADY_THERE'), false);
    if (!this.deps.inRoom() && !here) return this.fail(from, to, 'NOT_IN_ROOM', t.t('hub.err.NOT_IN_ROOM'), false);
    const fut = this.future.find((d) => d.id === to) ?? null;
    if (fut) { const a = fut.available(); if (!a.ok || !fut.go) return this.fail(from, to, 'UNAVAILABLE', a.reason || t.t('hub.err.UNAVAILABLE'), false); }
    if (dest) { const a = dest.available(); if (!a.ok || !dest.go) return this.fail(from, to, 'UNAVAILABLE', a.reason || t.t('hub.err.UNAVAILABLE'), false); }
    if (!['home', 'hub', 'public'].includes(to) && !fut && !dest) return this.fail(from, to, 'UNAVAILABLE', t.t('hub.err.unknown'), false);
    const rooms = this.deps.rooms;
    if (to === 'public' && !rooms) return this.fail(from, to, 'UNAVAILABLE', t.t('hub.dest.public.offReason'), false);
    if (to === 'public' && rooms!.mode === 'closing') return this.fail(from, to, 'CLOSING', t.t('hub.err.CLOSING'), false);

    this.nav = { to, since: this.clock }; this.counters.navigations++;
    this.emit({ type: 'navigation.started', from, to });
    try {
      const closeTimeout = (ok: boolean | null) => this.fail(from, to, ok === null ? 'INTERRUPTED' : 'TIMEOUT', ok === null ? t.t('hub.err.INTERRUPTED') : t.t('hub.err.TIMEOUT'));
      if (fut) { const r = await fut.go!(arg); if (!r.ok) return this.fail(from, to, 'UNAVAILABLE', r.reason ?? t.t('hub.err.UNAVAILABLE')); return this.done(from); }
      if (dest?.here) {
        // R5 place: the public room closes first (R3 cleanup, polite exits); the place itself handles leaving another place
        if (from === 'public' || rooms?.mode === 'closing') {
          if (from === 'public') rooms!.close();
          const ok = await this.waitFor(() => rooms!.mode === 'private');
          if (!ok) return closeTimeout(ok);
        }
        const r = await dest.go!(arg);
        if (!r.ok) {
          const msg = r.code ? t.t(`place.err.${r.code}`) : r.reason ?? t.t('hub.err.UNAVAILABLE');
          const res = this.fail(from, to, 'REFUSED', msg);
          return { ...res, detail: r.code };
        }
        this.hubOpen = false;
        return this.done(from);
      }
      if (here && to !== here.id) here.leave?.();          // the place's own cleanup (presence, scene, policies), back home
      if (to === 'hub') {
        if (from === 'public') rooms!.close();              // R3 cleanup (visitors leave politely, R3 restores the private room)
        this.hubOpen = true;
        return this.done(from);
      }
      if (to === 'home') {
        if (from === 'hub' || here) {
          // the public room may still be closing in the background (public → hub): arrive home when R3 is done
          if (rooms?.mode === 'closing') {
            const ok = await this.waitFor(() => rooms.mode === 'private');
            if (!ok) return closeTimeout(ok);
          }
          this.hubOpen = false; return this.done(from);
        }
        // public → home: R3 closes; arrive when R3 says the room is private again
        rooms!.close();
        const ok = await this.waitFor(() => rooms!.mode === 'private');
        if (!ok) return closeTimeout(ok);
        return this.done(from);
      }
      // to === 'public'
      const r = rooms!.isPublic ? { ok: true } : rooms!.open();
      if (!r.ok) { const rr = r as { reason?: string; code?: string }; return this.fail(from, to, 'OPEN_REFUSED', rr.code ? t.t(`hub.open.${rr.code}`) : rr.reason ?? t.t('hub.err.OPEN_REFUSED')); }
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
