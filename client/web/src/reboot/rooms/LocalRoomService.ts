/**
 * REBOOT R3 — local stand-in for the room part of OUR server (until R10). It owns the user's room as a RoomInstance,
 * persists its configuration (not who is inside: presence is live state), validates every join / leave / kick /
 * settings change through RoomInstance, and publishes the SAME realtime events the server will send
 * (presence.join / presence.leave / room.updated). The scene controller only listens to these events, so the backend
 * can replace this class without touching the room.
 */
import type { Id, RealtimeEvent, Result, RoomInfo } from '../api/contracts';
import { RoomInstance, RoomAction, sanitizePermissions } from './RoomInstance';
import { templateById, PublicRoomTemplate } from './templates';

export type RoomEvent =
  | RealtimeEvent
  | { type: 'room.state'; roomId: Id; state: 'closed' | 'open' | 'full' }
  | { type: 'room.denied'; roomId: Id; profileId: Id; action: RoomAction | 'join'; code: string };

const KEY = 'mtw.reboot.rooms';
export const OWNER = 'host';          // the user's own Mii / account in the local world
interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void; }

export class LocalRoomService {
  readonly room: RoomInstance;
  readonly template: PublicRoomTemplate;
  private subs = new Set<(e: RoomEvent) => void>();
  readonly log: { t: string; e: RoomEvent }[] = [];
  private friendIds = new Set<Id>();
  /** Local friends list (the "friends" of the room permission); refreshed by whoever reads the friends provider. */
  setFriends(ids: Iterable<Id>) { this.friendIds = new Set(ids); }
  constructor(private ctx: { blocked: () => Iterable<Id> }, private kv: Kv | null = safeKv()) {
    let saved: Partial<RoomInfo> = {};
    try { saved = JSON.parse(kv?.getItem(KEY) ?? '{}')?.mine ?? {}; } catch { saved = {}; }
    this.template = templateById(saved.templateId);
    const t = this.template;
    const cap = Math.round(Number(saved.capacity));
    this.room = new RoomInstance({
      id: 'room:' + OWNER, ownerId: OWNER, kind: 'public', templateId: t.id,
      title: typeof saved.title === 'string' && saved.title.trim() ? saved.title.slice(0, 40) : t.title,
      capacity: cap >= 2 && cap <= 8 ? cap : t.capacity,
      permissions: sanitizePermissions({ ...t.permissions, ...(saved.permissions ?? {}) }),
      skin: t.layout ?? { wall: '', floor: '', variant: 0 }, activityId: t.activity,
    });
  }
  subscribe(cb: (e: RoomEvent) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
  private emit(e: RoomEvent) { this.log.push({ t: new Date().toISOString(), e }); if (this.log.length > 300) this.log.shift(); for (const s of this.subs) { try { s(e); } catch (err) { console.warn(err); } } }
  private jctx() { return { friends: this.friendIds, blocked: new Set(this.ctx.blocked()) }; }
  private stateNow() { this.emit({ type: 'room.state', roomId: this.room.id, state: this.room.state }); }

  open(): Result<RoomInfo> { const r = this.room.open(OWNER); if (r.ok) { this.emit({ type: 'room.updated', room: this.room.info }); this.stateNow(); } return r; }
  /** Closing sends every visitor out (presence.leave each), then the room is closed. */
  close(): Result<Id[]> {
    const r = this.room.close(OWNER);
    if (r.ok) { for (const id of r.value) this.emit({ type: 'presence.leave', roomId: this.room.id, profileId: id }); this.stateNow(); }
    return r;
  }
  /** A (simulated, until R10) user asks to come in. */
  joinAs(id: Id): Result<true> {
    const r = this.room.join(id, this.jctx());
    if (!r.ok) { this.emit({ type: 'room.denied', roomId: this.room.id, profileId: id, action: 'join', code: r.error.code }); return r; }
    this.emit({ type: 'presence.join', roomId: this.room.id, presence: r.value }); this.stateNow();
    return { ok: true, value: true };
  }
  leaveAs(id: Id): Result<true> {
    const r = this.room.leave(id);
    if (r.ok) { this.emit({ type: 'presence.leave', roomId: this.room.id, profileId: id }); this.stateNow(); }
    return r;
  }
  kick(by: Id, target: Id): Result<true> {
    const r = this.room.kick(by, target);
    if (!r.ok) { this.emit({ type: 'room.denied', roomId: this.room.id, profileId: by, action: 'kick', code: r.error.code }); return r; }
    this.emit({ type: 'presence.leave', roomId: this.room.id, profileId: target }); this.stateNow();
    return r;
  }
  update(by: Id, patch: Partial<Pick<RoomInfo, 'title' | 'capacity' | 'permissions'>>): Result<RoomInfo> {
    const r = this.room.update(by, patch);
    if (!r.ok) { this.emit({ type: 'room.denied', roomId: this.room.id, profileId: by, action: 'changeSettings', code: r.error.code }); return r; }
    this.save(); this.emit({ type: 'room.updated', room: r.value }); this.stateNow();
    return r;
  }
  /** A visitor (or anybody) tries an action: refused ones are reported as room.denied (moderation trail). */
  attempt(by: Id, action: RoomAction): boolean {
    const ok = this.room.can(by, action, this.jctx().friends);
    if (!ok) this.emit({ type: 'room.denied', roomId: this.room.id, profileId: by, action, code: 'FORBIDDEN' });
    return ok;
  }
  private save() {
    const i = this.room.info;
    try { this.kv?.setItem(KEY, JSON.stringify({ mine: { templateId: i.templateId, title: i.title, capacity: i.capacity, permissions: i.permissions } })); } catch { /* private mode */ }
  }
}
function safeKv(): Kv | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
