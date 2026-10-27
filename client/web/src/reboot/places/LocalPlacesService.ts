/**
 * REBOOT R5 — local stand-in for the part of OUR server that holds OTHER people's rooms (until R10): the public rooms of
 * the user's friends and the Sala Giochi. It is the visited side of R3: every room is an R3 `RoomInstance` (same
 * presence, roles, permissions, capacity, join rules) and every change is published as the same realtime events
 * (presence.join / presence.leave / room.state / room.updated / room.denied), so the scene code is the one of R3.
 *
 * Nothing here pretends to be online. The rooms belong to the user's LOCAL friends (profiles made on this device);
 * which room is open, closed, private or full comes from a deterministic fixture (FRIEND_ROOM_FIXTURE) so tests and
 * screenshots are reproducible. Who is inside are other local friends, each one in one place at a time. When the
 * backend exists, `ServerPlacesService` answers the same calls from `GET /v1/rooms?kind=public` + presence.
 */
import type { Id, Presence, Result, RoomPermissions, ApiError } from '../api/contracts';
import { RoomInstance, RoomAction, JoinCtx } from '../rooms/RoomInstance';
import { OWNER, RoomEvent } from '../rooms/LocalRoomService';
import type { FriendInfo, RoomSkin } from '../host';
import { rng } from '../social/traits';

export type PlaceKind = 'friend' | 'games';
export type PlaceStatus = 'open' | 'full' | 'closed' | 'private' | 'unavailable';
/** Why a place cannot be entered (UI texts: i18n `place.err.<code>`). */
export type PlaceError = 'NOT_FOUND' | 'CLOSED' | 'PRIVATE' | 'FULL' | 'BLOCKED' | 'DENIED' | 'UNAVAILABLE' | 'ALREADY_IN';
export type PlaceEvent = RoomEvent | { type: 'room.removed'; roomId: Id };

export interface PlaceView {
  id: Id; kind: PlaceKind; ownerId: Id; ownerName: string; personality: 0 | 1 | 2 | 3;
  status: PlaceStatus; present: number; capacity: number;
  /** i18n key suffix of what is going on there (`place.activity.<id>`). */
  activity: string;
  /** null = enterable; otherwise the error the server would answer. */
  refusal: PlaceError | null;
  youAreIn: boolean;
}

interface FixtureRow { status: 'open' | 'closed' | 'private' | 'full'; capacity: number; visitors: number; activity: string; objects: RoomPermissions['whoCanInteract']; }
/** The n-th local friend (ordered by id) gets row n % length. NEW data, local only. */
export const FRIEND_ROOM_FIXTURE: readonly FixtureRow[] = [
  { status: 'open', capacity: 8, visitors: 2, activity: 'chat', objects: 'everyone' },
  { status: 'closed', capacity: 6, visitors: 0, activity: 'relax', objects: 'everyone' },
  { status: 'open', capacity: 3, visitors: 1, activity: 'relax', objects: 'owner' },       // almost full: 2/3
  { status: 'private', capacity: 6, visitors: 0, activity: 'chat', objects: 'everyone' },
  { status: 'full', capacity: 2, visitors: 1, activity: 'party', objects: 'everyone' },    // 2/2
  { status: 'closed', capacity: 6, visitors: 0, activity: 'party', objects: 'everyone' },
];
/** Who is out and about fills the rooms in this order: full ones, almost full ones, the Sala Giochi (2), the others. */
const FILL_ORDER = (row: FixtureRow) => (row.status === 'full' ? 0 : row.capacity - row.visitors <= 2 ? 1 : 3);
export const GAMES_ID = 'place:games';
export const GAMES_OWNER = 'system:games';

interface Place { id: Id; kind: PlaceKind; owner: FriendInfo | null; room: RoomInstance; status: PlaceStatus; activity: string; skin: RoomSkin | null; removed: boolean; }

export class LocalPlacesService {
  private places = new Map<Id, Place>();
  private friends: FriendInfo[] = [];
  private subs = new Set<(e: PlaceEvent) => void>();
  readonly log: PlaceEvent[] = [];
  private rnd: () => number;
  private now = 0;
  private leaveAt = new Map<Id, number>();
  private nextArrival = 0;
  /** Simulated arrivals / departures (turnover) in the room the user is in. */
  turnover = { gap: [25, 60] as [number, number], stay: [50, 140] as [number, number] };
  constructor(private ctx: { friends: () => Promise<FriendInfo[]>; blocked: () => Iterable<Id> }, seed = 17) { this.rnd = rng(seed); }

  subscribe(cb: (e: PlaceEvent) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
  private emit(e: PlaceEvent) { this.log.push(e); if (this.log.length > 300) this.log.shift(); for (const s of this.subs) { try { s(e); } catch (err) { console.warn(err); } } }
  private jctx(): JoinCtx { return { friends: new Set([OWNER, ...this.friends.map((f) => f.id)]), blocked: new Set(this.ctx.blocked()) }; }
  private r(a: number, b: number) { return a + (b - a) * this.rnd(); }

  /**
   * Builds the places from the current local friends (fixture rows). A place the user is in is kept as it is; a friend
   * who is gone makes their room `removed` (and anybody inside it is sent out).
   */
  async refresh(): Promise<void> {
    let list: FriendInfo[] = [];
    try { list = await this.ctx.friends(); } catch { list = []; }
    const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // same friends as before: the world goes on as it is (who came and went stays); only a changed list rebuilds it
    if (this.places.size && sorted.map((f) => f.id + f.name).join() === this.friends.map((f) => f.id + f.name).join()) return;
    this.friends = sorted;
    const ids = new Set(this.friends.map((f) => 'room:' + f.id));
    for (const p of this.places.values()) if (p.kind === 'friend' && !ids.has(p.id) && !p.removed) this.remove(p.id);
    const keep = [...this.places.values()].find((p) => p.room.has(OWNER) && !p.removed);
    const old = this.places;
    this.places = new Map();
    if (keep) this.places.set(keep.id, keep);
    // who is "out" (their own room is closed or private): they are the ones visiting others / at the Sala Giochi
    const rows = this.friends.map((f, i) => ({ f, row: FRIEND_ROOM_FIXTURE[i % FRIEND_ROOM_FIXTURE.length] }));
    const busy = new Set<Id>(keep ? keep.room.presence().map((p) => p.profileId) : []);
    const pool = rows.filter((x) => (x.row.status === 'closed' || x.row.status === 'private') && !busy.has(x.f.id)).map((x) => x.f.id);
    const take = (n: number) => { const out: Id[] = []; while (out.length < n && pool.length) { const id = pool.shift()!; if (!busy.has(id)) { busy.add(id); out.push(id); } } return out; };
    const made: Place[] = [];
    for (const { f, row } of rows) {
      const id = 'room:' + f.id; if (keep?.id === id || old.get(id)?.removed) continue;
      made.push(this.makePlace(id, 'friend', f, row, f.room ?? null));
    }
    const fill = (p: Place, n: number) => { for (const v of take(Math.max(0, n))) p.room.join(v, this.jctx()); };
    const rowOf = (p: Place) => FRIEND_ROOM_FIXTURE[this.friends.findIndex((f) => 'room:' + f.id === p.id) % FRIEND_ROOM_FIXTURE.length];
    const open = made.filter((p) => p.status === 'open' || p.status === 'full').sort((a, b) => FILL_ORDER(rowOf(a)) - FILL_ORDER(rowOf(b)));
    for (const p of open.filter((x) => FILL_ORDER(rowOf(x)) < 3)) fill(p, p.status === 'full' ? p.room.info.capacity - 1 : rowOf(p).visitors);
    if (!keep || keep.id !== GAMES_ID) {
      const g = this.makePlace(GAMES_ID, 'games', null, { status: 'open', capacity: 8, visitors: 0, activity: 'games', objects: 'everyone' }, null);
      fill(g, 2);
      this.places.set(g.id, g);
    }
    for (const p of open.filter((x) => FILL_ORDER(rowOf(x)) >= 3)) fill(p, rowOf(p).visitors);
    for (const p of made) {
      if (p.status === 'full' && p.room.presence().length < p.room.info.capacity) p.status = 'open';   // not enough Miis to fill it
      this.places.set(p.id, p);
    }
  }
  private makePlace(id: Id, kind: PlaceKind, owner: FriendInfo | null, row: FixtureRow, skin: RoomSkin | null): Place {
    const room = new RoomInstance({
      id, ownerId: owner?.id ?? GAMES_OWNER, kind: 'public', templateId: kind === 'games' ? 'games' : 'lounge', title: owner?.name ?? 'Sala Giochi',
      capacity: row.capacity, permissions: { whoCanEnter: row.status === 'private' ? 'private' : kind === 'games' ? 'public' : 'friends', whoCanInteract: row.objects, activitiesOpen: true },
      skin: skin ?? { wall: '', floor: '', variant: 0 }, activityId: row.activity,
    });
    // closed / private rooms are not open to visitors (their owner is out); nobody owns the Sala Giochi as a Mii
    if (row.status === 'open' || row.status === 'full') room.open(room.ownerId, undefined, { ownerInside: kind !== 'games' });
    return { id, kind, owner, room, status: row.status === 'full' ? 'full' : row.status, activity: row.activity, skin, removed: false };
  }

  // ------------------------------------------------------------------ read
  get(id: Id): RoomInstance | null { const p = this.places.get(id); return p && !p.removed ? p.room : null; }
  place(id: Id) { const p = this.places.get(id); return p && !p.removed ? { id: p.id, kind: p.kind, owner: p.owner, skin: p.skin, activity: p.activity } : null; }
  /** Where the user is (null = not in any of these places). */
  get current(): Id | null { for (const p of this.places.values()) if (!p.removed && p.room.has(OWNER)) return p.id; return null; }
  list(kind?: PlaceKind): PlaceView[] {
    return [...this.places.values()].filter((p) => !p.removed && (!kind || p.kind === kind)).map((p) => this.view(p));
  }
  private view(p: Place): PlaceView {
    const pres = p.room.presence().length, cap = p.room.info.capacity;
    const status: PlaceStatus = p.status === 'closed' || p.status === 'private' || p.status === 'unavailable' ? p.status : pres >= cap ? 'full' : 'open';
    return { id: p.id, kind: p.kind, ownerId: p.room.ownerId, ownerName: p.owner?.name ?? '', personality: p.owner?.personality ?? 2, status, present: pres, capacity: cap, activity: p.activity, refusal: p.room.has(OWNER) ? null : this.refusal(p), youAreIn: p.room.has(OWNER) };
  }
  private refusal(p: Place): PlaceError | null {
    if (p.removed) return 'NOT_FOUND';
    if (p.status === 'unavailable') return 'UNAVAILABLE';
    if (p.status === 'closed') return 'CLOSED';
    if (p.status === 'private') return 'PRIVATE';
    if (new Set(this.ctx.blocked()).has(p.room.ownerId)) return 'BLOCKED';
    if (p.room.presence().length >= p.room.info.capacity) return 'FULL';
    return null;
  }

  // ------------------------------------------------------------------ the user (and simulated friends) come and go
  /** Join as a visitor. Errors leave everything as it was (nothing is half-joined). */
  join(roomId: Id, who: Id = OWNER): Result<Presence> & { code?: PlaceError } {
    const p = this.places.get(roomId);
    if (!p || p.removed) return this.refuse(roomId, who, 'NOT_FOUND');
    if (who === OWNER) { const here = this.current; if (here === roomId) return this.refuse(roomId, who, 'ALREADY_IN'); if (here) return this.refuse(roomId, who, 'DENIED'); }
    const pre = this.refusal(p);
    if (pre && pre !== 'FULL') return this.refuse(roomId, who, pre);
    const r = p.room.join(who, this.jctx());
    if (!r.ok) return this.refuse(roomId, who, r.error.code === 'ROOM_FULL' ? 'FULL' : r.error.code === 'BLOCKED' ? 'BLOCKED' : r.error.code === 'NOT_FOUND' ? 'CLOSED' : /privata/i.test(r.error.message) ? 'PRIVATE' : 'DENIED', r.error);
    this.emit({ type: 'presence.join', roomId, presence: r.value });
    this.emit({ type: 'room.state', roomId, state: p.room.state });
    return r;
  }
  private refuse(roomId: Id, who: Id, code: PlaceError, e?: ApiError): { ok: false; error: ApiError; code: PlaceError } {
    this.emit({ type: 'room.denied', roomId, profileId: who, action: 'join', code });
    return { ok: false, error: e ?? { code: code === 'FULL' ? 'ROOM_FULL' : code === 'NOT_FOUND' ? 'NOT_FOUND' : code === 'BLOCKED' ? 'BLOCKED' : 'FORBIDDEN', message: code }, code };
  }
  leave(roomId: Id, who: Id = OWNER): Result<true> {
    const p = this.places.get(roomId); if (!p) return { ok: false, error: { code: 'NOT_FOUND', message: 'room' } };
    const r = p.room.leave(who);
    if (r.ok) { this.leaveAt.delete(who); this.emit({ type: 'presence.leave', roomId, profileId: who }); this.emit({ type: 'room.state', roomId, state: p.room.state }); }
    return r;
  }
  /** Read-only permission check (social life deciding what a Mii may do): nothing is logged. */
  can(roomId: Id, who: Id, action: RoomAction): boolean { const p = this.places.get(roomId); return !!p && !p.removed && p.room.can(who, action, this.jctx().friends); }
  /** A visitor (the user included) tries an action; refused ones are published as room.denied (moderation trail). */
  attempt(roomId: Id, by: Id, action: RoomAction): boolean {
    const p = this.places.get(roomId); if (!p) return false;
    const ok = p.room.can(by, action, this.jctx().friends);
    if (!ok) this.emit({ type: 'room.denied', roomId, profileId: by, action, code: 'FORBIDDEN' });
    return ok;
  }
  /** Owner-only operations asked by somebody else (a visitor): always refused, through RoomInstance. */
  kick(roomId: Id, by: Id, target: Id) { const p = this.places.get(roomId); if (!p) return false; const r = p.room.kick(by, target); if (!r.ok) this.emit({ type: 'room.denied', roomId, profileId: by, action: 'kick', code: r.error.code }); else this.emit({ type: 'presence.leave', roomId, profileId: target }); return r.ok; }
  update(roomId: Id, by: Id, patch: Parameters<RoomInstance['update']>[1]) { const p = this.places.get(roomId); if (!p) return false; const r = p.room.update(by, patch); if (!r.ok) this.emit({ type: 'room.denied', roomId, profileId: by, action: 'changeSettings', code: r.error.code }); else this.emit({ type: 'room.updated', room: r.value }); return r.ok; }
  close(roomId: Id, by: Id) { const p = this.places.get(roomId); if (!p) return false; if (by !== p.room.ownerId) { this.emit({ type: 'room.denied', roomId, profileId: by, action: 'close', code: 'FORBIDDEN' }); return false; } this.ownerCloses(roomId); return true; }

  // ------------------------------------------------------------------ server-side events (simulation, tests)
  /** The owner closes their room: everybody inside (the user too) is sent out, then the room is closed. */
  ownerCloses(roomId: Id) {
    const p = this.places.get(roomId); if (!p || p.removed) return;
    const r = p.room.close(p.room.ownerId); if (!r.ok) return;
    for (const id of r.value) { this.leaveAt.delete(id); this.emit({ type: 'presence.leave', roomId, profileId: id }); }
    p.status = 'closed';
    this.emit({ type: 'room.state', roomId, state: 'closed' });
  }
  /** The room no longer exists (friend removed). */
  remove(roomId: Id) {
    const p = this.places.get(roomId); if (!p || p.removed) return;
    const out = p.room.close(p.room.ownerId);
    p.removed = true; p.status = 'unavailable';
    for (const id of out.ok ? out.value : []) { this.leaveAt.delete(id); this.emit({ type: 'presence.leave', roomId, profileId: id }); }
    this.emit({ type: 'room.removed', roomId });
  }

  /**
   * Turnover in the room the user is in (room clock): visitors stay a while and go; now and then another local friend
   * who is not somewhere else comes by (refused when the room is full, like a real join).
   */
  tick(dt: number) {
    this.now += dt;
    const here = this.current; if (!here) return;
    const p = this.places.get(here)!;
    for (const v of p.room.visitors()) if (v !== OWNER && !this.leaveAt.has(v)) this.leaveAt.set(v, this.now + this.r(this.turnover.stay[0], this.turnover.stay[1]));
    for (const [id, t] of [...this.leaveAt]) if (this.now >= t) { this.leaveAt.delete(id); if (p.room.has(id)) this.leave(here, id); }
    // the Sala Giochi draws a crowd: while fewer than 3 Miis are there, somebody who is out comes by much sooner
    const gap: [number, number] = p.kind === 'games' && p.room.visitors().filter((v) => v !== OWNER).length < 3 ? [2, 6] : this.turnover.gap;
    if (!this.nextArrival) this.nextArrival = this.now + this.r(gap[0], gap[1]);
    if (this.now >= this.nextArrival) {
      this.nextArrival = this.now + this.r(gap[0], gap[1]);
      // somebody who is out (not at home, not here) drops by; if they were in another place they leave it first
      const cands = this.friends.filter((f) => f.id !== p.room.ownerId && !p.room.has(f.id) && !this.isHome(f.id));
      if (cands.length) {
        const f = cands[Math.floor(this.rnd() * cands.length)];
        if (p.room.presence().length < p.room.info.capacity) for (const o of this.places.values()) if (o !== p && !o.removed && o.room.has(f.id) && o.room.role(f.id) !== 'owner') this.leave(o.id, f.id);
        this.join(here, f.id);
      }
    }
  }
  /** Owners of an open room stay home. */
  private isHome(id: Id) { const p = this.places.get('room:' + id); return !!p && !p.removed && (p.status === 'open' || p.status === 'full'); }
  /** Stop the turnover clock (the user left). */
  resetTurnover() { this.leaveAt.clear(); this.nextArrival = 0; }
}
