/**
 * REBOOT R3 — the room as a DOMAIN object (no rendering, no timers): who is in it, with which role, what each role may
 * do, capacity, open / closed. The same rules will run on our server (R10); the local service uses this class as-is,
 * so switching to the backend changes the provider, not the room.
 */
import type { RoomInfo, Presence, RoomRole, Result, ApiError, Id, RoomPermissions } from '../api/contracts';

export type RoomAction = 'enter' | 'useObjects' | 'interact' | 'invite' | 'kick' | 'changeSettings' | 'close';

/** What each role may do. Visitors never get host actions; object use / interaction follow the room permissions. */
const ROLE_ACTIONS: Record<RoomRole, RoomAction[]> = {
  owner: ['enter', 'useObjects', 'interact', 'invite', 'kick', 'changeSettings', 'close'],
  moderator: ['enter', 'useObjects', 'interact', 'kick'],
  visitor: ['enter', 'useObjects', 'interact'],
};
export type RoomState = 'closed' | 'open' | 'full';
export interface JoinCtx { friends: ReadonlySet<Id>; blocked: ReadonlySet<Id>; now?: () => string; }

const fail = (code: ApiError['code'], message: string): { ok: false; error: ApiError } => ({ ok: false, error: { code, message } });

export class RoomInstance {
  private present = new Map<Id, Presence>();
  private kicked = new Set<Id>();
  private isOpen = false;
  constructor(public info: RoomInfo) {}

  get id() { return this.info.id; }
  get ownerId() { return this.info.ownerId; }
  get state(): RoomState { return !this.isOpen ? 'closed' : this.present.size >= this.info.capacity ? 'full' : 'open'; }
  presence(): Presence[] { return [...this.present.values()]; }
  visitors(): Id[] { return this.presence().filter((p) => p.role !== 'owner').map((p) => p.profileId); }
  has(id: Id) { return this.present.has(id); }
  role(id: Id): RoomRole | null { return this.present.get(id)?.role ?? (id === this.info.ownerId ? 'owner' : null); }

  /** May `id` perform `action`? (Room permissions narrow what visitors can touch.) */
  can(id: Id, action: RoomAction, friends?: ReadonlySet<Id>): boolean {
    const r = this.role(id); if (!r || !ROLE_ACTIONS[r].includes(action)) return false;
    if (r !== 'owner' && (action === 'useObjects' || action === 'interact')) {
      const w = this.info.permissions.whoCanInteract;
      if (w === 'owner') return false;
      if (w === 'friends' && friends && !friends.has(id)) return false;
      if (action === 'useObjects' && !this.info.permissions.activitiesOpen) return false;
    }
    return true;
  }

  /**
   * Owner opens the room: the owner is present, visitors may come. R5: a place nobody owns as a Mii (the Sala Giochi,
   * owned by the system) opens with `ownerInside: false`.
   */
  open(by: Id, now = () => new Date().toISOString(), opts: { ownerInside?: boolean } = {}): Result<RoomInfo> {
    if (by !== this.info.ownerId) return fail('FORBIDDEN', 'Solo il proprietario apre la stanza.');
    this.isOpen = true;
    if (opts.ownerInside !== false && !this.present.has(by)) this.present.set(by, this.pres(by, 'owner', now));
    return { ok: true, value: this.info };
  }
  /** Owner closes: everybody but the owner is removed (returned so the caller can see them out). */
  close(by: Id): Result<Id[]> {
    if (by !== this.info.ownerId) return fail('FORBIDDEN', 'Solo il proprietario chiude la stanza.');
    const out = this.visitors();
    this.present.clear(); this.kicked.clear(); this.isOpen = false;
    return { ok: true, value: out };
  }
  join(id: Id, ctx: JoinCtx): Result<Presence> {
    if (typeof id !== 'string' || !id || id.length > 64) return fail('INVALID', 'id');
    if (!this.isOpen) return fail('NOT_FOUND', 'La stanza è chiusa.');
    if (this.present.has(id)) return { ok: true, value: this.present.get(id)! };
    if (ctx.blocked.has(id)) return fail('BLOCKED', 'Bloccato.');
    if (this.kicked.has(id)) return fail('FORBIDDEN', 'Allontanato da questa stanza.');
    const w = this.info.permissions.whoCanEnter;
    if (w === 'private') return fail('FORBIDDEN', 'Stanza privata.');
    if (w === 'friends' && !ctx.friends.has(id)) return fail('FORBIDDEN', 'Solo amici.');
    if (this.present.size >= this.info.capacity) return fail('ROOM_FULL', 'Stanza piena.');
    const p = this.pres(id, 'visitor', ctx.now ?? (() => new Date().toISOString()));
    this.present.set(id, p);
    return { ok: true, value: p };
  }
  leave(id: Id): Result<true> {
    if (id === this.info.ownerId) return fail('INVALID', 'Il proprietario chiude la stanza, non la lascia.');
    if (!this.present.delete(id)) return fail('NOT_FOUND', 'Non presente.');
    return { ok: true, value: true };
  }
  kick(by: Id, target: Id): Result<true> {
    if (!this.can(by, 'kick')) return fail('FORBIDDEN', 'Non puoi allontanare nessuno.');
    if (target === this.info.ownerId) return fail('FORBIDDEN', 'Il proprietario non si allontana.');
    if (!this.present.delete(target)) return fail('NOT_FOUND', 'Non presente.');
    this.kicked.add(target);
    return { ok: true, value: true };
  }
  update(by: Id, patch: Partial<Pick<RoomInfo, 'title' | 'capacity' | 'permissions'>>): Result<RoomInfo> {
    if (!this.can(by, 'changeSettings')) return fail('FORBIDDEN', 'Solo il proprietario cambia le impostazioni.');
    const next: RoomInfo = { ...this.info, permissions: { ...this.info.permissions } };
    if (patch.title !== undefined) { if (typeof patch.title !== 'string' || patch.title.length > 40) return fail('INVALID', 'title'); next.title = patch.title.trim() || this.info.title; }
    if (patch.capacity !== undefined) {
      const c = Math.round(Number(patch.capacity));
      if (!(c >= 2 && c <= 8)) return fail('INVALID', 'capacity 2..8');
      if (c < this.present.size) return fail('CONFLICT', 'Ci sono già più Mii di così nella stanza.');
      next.capacity = c;
    }
    if (patch.permissions) next.permissions = sanitizePermissions({ ...next.permissions, ...patch.permissions });
    this.info = next;
    return { ok: true, value: next };
  }
  private pres(id: Id, role: RoomRole, now: () => string): Presence {
    return { profileId: id, roomId: this.info.id, role, joinedAt: now(), state: { pos: { x: 0, z: -27 }, heading: 0, state: 'entering' } };
  }
}

export function sanitizePermissions(p: Partial<RoomPermissions>): RoomPermissions {
  const vis = ['private', 'friends', 'public'] as const, who = ['everyone', 'friends', 'owner'] as const;
  return {
    whoCanEnter: vis.includes(p.whoCanEnter as never) ? p.whoCanEnter! : 'friends',
    whoCanInteract: who.includes(p.whoCanInteract as never) ? p.whoCanInteract! : 'everyone',
    activitiesOpen: p.activitiesOpen !== false,
  };
}
