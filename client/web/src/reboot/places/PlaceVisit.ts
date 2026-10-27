/**
 * REBOOT R5 — the user visiting a room that is not theirs (a friend's public room, the Sala Giochi). The visited side
 * of R3: the room is an R3 RoomInstance held by the places service (our server from R10), the scene is bound with the
 * R3 SceneBinding, and R2b social life takes every Mii over with no place-specific social code.
 *
 *   enter: join (validated by the room: closed / private / full / blocked are refused and NOTHING changes)
 *        → the room engine shows the place, the user's Mii comes in through the door
 *        → whoever was already inside is placed inside (no door), later arrivals use the door
 *   inside: presence.join / presence.leave → guests in / out; the user is a VISITOR: object use follows the room
 *           permissions (player taps and social life alike), owner actions are refused by RoomInstance
 *   leave: presence removed, scene emptied at once (the others stay in their room), turnover stopped, policies removed,
 *          social life resynced, guest capacity restored, back home (or straight into the next place)
 *   evicted: the owner closes the room / the room disappears while the user is inside → leave + an `evicted` event
 */
import type { RebootHost, PlaceScene } from '../host';
import type { SocialLife } from '../social/SocialLife';
import { OWNER } from '../rooms/LocalRoomService';
import { SceneBinding } from '../rooms/SceneBinding';
import type { LocalPlacesService, PlaceError, PlaceEvent } from './LocalPlacesService';

export type VisitMode = 'none' | 'entering' | 'inside';
export type VisitEvent =
  | { type: 'entered'; roomId: string }
  | { type: 'left'; roomId: string; why: 'user' | 'away' | 'evicted' | 'switch' }
  | { type: 'evicted'; roomId: string; code: 'CLOSED' | 'REMOVED' | 'KICKED' }
  | { type: 'join' | 'leave'; roomId: string; id: string }
  | { type: 'denied'; roomId: string; id: string; action: string };
export type EnterError = PlaceError | 'BUSY' | 'SCENE' | 'TIMEOUT';

/** Where the Miis that were already inside stand (room units; the room engine clamps them). */
const INSIDE_SPOTS = [{ x: 9, z: 4 }, { x: -11, z: 6 }, { x: 13, z: 14 }, { x: -6, z: 15 }, { x: 16, z: -6 }, { x: -15, z: -5 }, { x: 2, z: 19 }];

export class PlaceVisit {
  mode: VisitMode = 'none';
  roomId: string | null = null;
  private unsubs: (() => void)[] = [];
  private watch = 0;
  private scene: SceneBinding;
  private subs = new Set<(e: VisitEvent) => void>();
  readonly events: VisitEvent[] = [];
  private savedCap = 1;
  private spot = 0;

  constructor(private host: RebootHost, readonly svc: LocalPlacesService, private opts: {
    social: SocialLife | null;
    /** How the place looks: friend → their room, games → a look the user's room does not have. */
    sceneOf: (roomId: string) => PlaceScene | null;
    /** Seconds (room clock) the scene may take to show the place before the visit is abandoned. */
    timeout?: number;
  }) {
    this.scene = new SceneBinding(host, {
      present: (id) => !!this.roomId && !!this.svc.get(this.roomId)?.has(id),
      accepting: () => this.mode === 'inside',
      giveUp: (id) => { if (this.roomId) this.svc.leave(this.roomId, id); },
    });
  }
  subscribe(cb: (e: VisitEvent) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
  private emit(e: VisitEvent) { this.events.push(e); if (this.events.length > 200) this.events.shift(); for (const s of this.subs) { try { s(e); } catch (err) { console.warn(err); } } }
  get inside() { return this.mode !== 'none'; }
  get pendingIds() { return this.scene.pendingIds; }
  /** Live subscriptions / timers held by this visit (soak tests). */
  get resources() { return { unsubs: this.unsubs.length, watch: this.watch ? 1 : 0, pending: this.scene.pendingIds.length }; }

  /** Enter `roomId`. When already inside another place, `switching` moves straight there (leave, then enter). */
  async enter(roomId: string, switching = false): Promise<{ ok: boolean; code?: EnterError }> {
    if (this.mode === 'entering') return { ok: false, code: 'BUSY' };
    if (this.mode === 'inside') { if (this.roomId === roomId) return { ok: false, code: 'ALREADY_IN' }; if (!switching) return { ok: false, code: 'BUSY' }; }
    const look = this.opts.sceneOf(roomId);
    if (!look) return { ok: false, code: 'NOT_FOUND' };
    // validated BEFORE anything changes: a refusal leaves the user exactly where they were
    const pre = this.svc.list().find((v) => v.id === roomId);
    if (!pre) return { ok: false, code: 'NOT_FOUND' };
    if (pre.refusal) { this.svc.join(roomId); return { ok: false, code: pre.refusal }; }      // published as room.denied
    const prev = this.roomId;
    if (prev) { this.leaveRoom(prev); this.finishLeave(prev, 'switch'); }
    else this.savedCap = this.host.capacity();
    const j = this.svc.join(roomId);
    if (!j.ok) { if (prev) { this.host.setCapacity(this.savedCap); this.host.returnHome(); } return { ok: false, code: j.code ?? 'DENIED' }; }
    this.roomId = roomId; this.mode = 'entering'; this.spot = 0;
    if (!this.host.visitPlace(look)) { this.svc.leave(roomId); this.cleanup(); this.host.setCapacity(this.savedCap); this.roomId = null; this.mode = 'none'; return { ok: false, code: 'SCENE' }; }
    const room = this.svc.get(roomId)!;
    this.host.setCapacity(Math.max(1, room.info.capacity - 1));
    this.opts.social?.setPolicy({ canUseObject: (id) => this.svc.can(roomId, id === 'host' ? OWNER : id, 'useObjects') });
    this.host.setObjectPolicy(() => this.svc.attempt(roomId, OWNER, 'useObjects'));
    this.unsubs.push(this.svc.subscribe((e) => this.onRoom(e)));
    this.unsubs.push(this.host.onGuest((e) => { if (e.type === 'leave') this.onGuestLeft(e.id); }));
    this.unsubs.push(this.host.onTick((dt) => this.svc.tick(dt)));
    this.watch = window.setInterval(() => this.check(), 1000);
    // the place is shown when the room engine has the user's Mii on it
    const ready = await this.waitScene(roomId);
    if (this.roomId !== roomId) return { ok: false, code: 'BUSY' };          // left meanwhile
    if (!ready) { this.leave('user'); return { ok: false, code: 'TIMEOUT' }; }
    this.mode = 'inside';
    this.opts.social?.resync();
    for (const p of room.presence()) if (p.profileId !== OWNER) this.scene.bringIn(p.profileId, INSIDE_SPOTS[this.spot++ % INSIDE_SPOTS.length]);
    this.emit({ type: 'entered', roomId });
    return { ok: true };
  }
  private waitScene(roomId: string): Promise<boolean> {
    const ok = () => this.host.screen() === 'place:' + roomId && this.host.miis().some((m) => m.isHost && m.state !== 'outside');
    if (ok()) return Promise.resolve(true);
    const limit = this.opts.timeout ?? 25;
    return new Promise((res) => {
      let t = 0;
      const un = this.host.onTick((dt) => { t += dt; if (this.roomId !== roomId) { un(); res(false); } else if (ok()) { un(); res(true); } else if (t > limit) { un(); res(false); } });
    });
  }
  /** The user leaves the place: back home (`why` = 'away' when the user already went elsewhere by other means). */
  leave(why: 'user' | 'away' | 'evicted' = 'user') {
    const id = this.roomId; if (!id) return false;
    this.leaveRoom(id);
    this.finishLeave(id, why);
    this.host.setCapacity(this.savedCap);
    if (why !== 'away') this.host.returnHome();
    return true;
  }
  /** Presence off + scene emptied (the others stay in their room, they are simply not shown any more). */
  private leaveRoom(id: string) {
    this.cleanup();                                   // first: our own presence.leave must not come back to us as an eviction
    if (this.svc.get(id)?.has(OWNER)) this.svc.leave(id, OWNER);
    this.host.clearGuests();
  }
  private finishLeave(id: string, why: 'user' | 'away' | 'evicted' | 'switch') {
    this.roomId = null; this.mode = 'none';
    this.opts.social?.resync();
    this.emit({ type: 'left', roomId: id, why });
  }
  private cleanup() {
    for (const u of this.unsubs) u(); this.unsubs = [];
    clearInterval(this.watch); this.watch = 0;
    this.scene.clear();
    this.svc.resetTurnover();
    this.opts.social?.setPolicy(null);
    this.host.setObjectPolicy(null);
  }

  /** Visitors only: owner operations go to the room and are refused there (moderation trail). */
  tryOwnerAction(action: 'kick' | 'changeSettings' | 'close', target?: string): boolean {
    const id = this.roomId; if (!id) return false;
    if (action === 'kick') return this.svc.kick(id, OWNER, target ?? '');
    if (action === 'changeSettings') return this.svc.update(id, OWNER, { capacity: 8 });
    return this.svc.close(id, OWNER);
  }

  private onRoom(e: PlaceEvent) {
    const id = this.roomId; if (!id) return;
    if ('roomId' in e && e.roomId !== id) return;
    if (e.type === 'presence.join' && e.presence.profileId !== OWNER) { this.emit({ type: 'join', roomId: id, id: e.presence.profileId }); if (this.mode === 'inside') this.scene.bringIn(e.presence.profileId); }
    else if (e.type === 'presence.leave') {
      if (e.profileId === OWNER) { const r = this.svc.get(id); this.evict(id, !r ? 'REMOVED' : r.state === 'closed' ? 'CLOSED' : 'KICKED'); return; }
      this.emit({ type: 'leave', roomId: id, id: e.profileId });
      this.scene.sendOut(e.profileId);
    } else if (e.type === 'room.removed') this.evict(id, 'REMOVED');
    else if (e.type === 'room.state' && e.state === 'closed' && this.mode !== 'none') this.evict(id, 'CLOSED');
    else if (e.type === 'room.denied' && e.profileId === OWNER && e.action !== 'join') this.emit({ type: 'denied', roomId: id, id: OWNER, action: e.action });
  }
  private evict(id: string, code: 'CLOSED' | 'REMOVED' | 'KICKED') {
    if (this.roomId !== id) return;
    this.emit({ type: 'evicted', roomId: id, code });
    this.leave('evicted');
  }
  private onGuestLeft(id: string) {
    if (this.scene.guestLeft(id) && this.roomId) this.svc.leave(this.roomId, id);
    if (this.mode === 'inside') this.scene.retry();
  }
  /** Once a second: pending arrivals retry; the user going elsewhere by other means (Classic navigation) ends the visit. */
  private check() {
    this.scene.tick();
    const id = this.roomId;
    if (id && this.mode === 'inside' && this.host.screen() !== 'place:' + id) this.leave('away');
  }
  dispose() { if (this.roomId) this.leave('away'); this.subs.clear(); }
}
