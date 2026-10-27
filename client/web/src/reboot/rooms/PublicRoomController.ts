/**
 * REBOOT R3 — binds the room MODEL (LocalRoomService / later our server) to the room SCENE through RebootHost.
 * It only reacts to realtime events: presence.join → the visitor comes in through the R2 guest machinery (door queue,
 * body, voice...) and R2b social life takes it over with no Public-Room-specific social code; presence.leave → the
 * visitor says goodbye and leaves. The private room is untouched: opening is a configuration switch (capacity, a social
 * policy for objects), closing / leaving restores the private settings and clears every piece of public state.
 */
import type { RebootHost } from '../host';
import type { MultiMii } from '../multimii/MultiMii';
import type { SocialLife } from '../social/SocialLife';
import { LocalRoomService, RoomEvent, OWNER } from './LocalRoomService';
import { LocalVisitors, VisitConfig } from './LocalVisitors';

export type PublicMode = 'private' | 'public' | 'closing';

export class PublicRoomController {
  mode: PublicMode = 'private';
  readonly events: { type: string; id?: string; info?: string }[] = [];
  readonly visitors: LocalVisitors;
  private unsubs: (() => void)[] = [];
  private watch = 0;
  private dismissing = new Set<string>();
  /** Visitors admitted by the room whose Mii could not come in yet (the scene still holds a Mii on its way out). */
  private pending = new Map<string, number>();
  private clock = 0;
  constructor(private host: RebootHost, readonly svc: LocalRoomService, private opts: { multi: MultiMii | null; social: SocialLife | null; visits?: Partial<VisitConfig>; seed?: number }) {
    this.visitors = new LocalVisitors(host, svc, opts.visits, opts.seed);
  }
  private subs = new Set<(e: { type: string; id?: string; info?: string; mode: PublicMode }) => void>();
  /** Lifecycle events of the public room (open / closing / closed / owner-left / join / leave / kick / denied...). */
  subscribe(cb: (e: { type: string; id?: string; info?: string; mode: PublicMode }) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
  private note(type: string, id?: string, info?: string) {
    this.events.push({ type, id, info }); if (this.events.length > 200) this.events.shift();
    for (const s of this.subs) { try { s({ type, id, info, mode: this.mode }); } catch (err) { console.warn(err); } }
  }
  get room() { return this.svc.room; }
  /** Admitted visitors whose Mii is not on screen yet (waiting for a free place in the scene). */
  get pendingIds() { return [...this.pending.keys()]; }
  get isPublic() { return this.mode !== 'private'; }

  /** Open the user's room to visitors. Refused while visiting someone / outside the room, or with guests already in. */
  open(): { ok: boolean; reason?: string } {
    if (this.mode !== 'private') return { ok: false, reason: 'già aperta' };
    if (this.host.screen() !== 'room' || this.host.visiting()) return { ok: false, reason: 'Apri la stanza pubblica dalla tua stanza.' };
    if (this.host.guests().length) return { ok: false, reason: 'Prima congeda gli ospiti della stanza privata.' };
    void this.host.friends().then((fr) => this.svc.setFriends(fr.map((f) => f.id)));
    const r = this.svc.open(); if (!r.ok) return { ok: false, reason: r.error.message };
    this.mode = 'public';
    this.host.setCapacity(this.room.info.capacity - 1);
    this.opts.social?.setPolicy({ canUseObject: (id, obj) => this.canUseObject(id, obj) });
    this.unsubs.push(this.svc.subscribe((e) => this.onRoom(e)));
    this.unsubs.push(this.host.onGuest((e) => { if (e.type === 'leave') this.onGuestLeft(e.id); }));
    this.watch = window.setInterval(() => this.check(), 1000);
    this.visitors.start();
    this.note('open', OWNER, `cap ${this.room.info.capacity}`);
    return { ok: true };
  }
  /** Owner closes: visitors say goodbye and leave through the door; then the private room is back. */
  close(): void {
    if (this.mode !== 'public') return;
    this.mode = 'closing';
    this.pending.clear();
    this.visitors.stop();
    this.svc.close();                                  // presence.leave for everyone → polite exits (onRoom)
    this.note('closing');
    this.check();
  }
  /** Owner action: send a visitor away (and not back in this session). */
  kick(id: string) { const r = this.svc.kick(OWNER, id); if (r.ok) this.note('kick', id); return r.ok; }
  update(patch: Parameters<LocalRoomService['update']>[1]) {
    const r = this.svc.update(OWNER, patch);
    if (r.ok && this.mode === 'public') this.host.setCapacity(r.value.capacity - 1);
    return r;
  }
  /** Object use in the room (social layer policy): owner always; visitors per room permissions + template list. */
  canUseObject(id: string, obj: string): boolean {
    if (!this.isPublic || id === OWNER) return true;
    const list = this.svc.template.interactables;
    if (list === 'none' || (Array.isArray(list) && !list.includes(obj))) return false;
    return this.room.can(id, 'useObjects');
  }

  private onRoom(e: RoomEvent) {
    if (e.type === 'presence.join') {
      const id = e.presence.profileId;
      this.note('join', id);
      this.bringIn(id);
    } else if (e.type === 'presence.leave') {
      this.visitors.forget(e.profileId);
      this.note('leave', e.profileId);
      if (this.host.guests().some((g) => g.id === e.profileId && !g.leaving)) { this.dismissing.add(e.profileId); this.host.dismiss(e.profileId); }
    } else if (e.type === 'room.denied') this.note('denied', e.profileId, `${e.action}:${e.code}`);
  }
  /** Brings an admitted visitor's Mii in; if the scene is momentarily full (Miis still walking out), retry shortly. */
  private bringIn(id: string) {
    if (this.mode !== 'public' || !this.room.has(id)) { this.pending.delete(id); return; }
    void this.host.invite(id).then((ok) => {
      if (ok) { this.pending.delete(id); if (!this.room.has(id) || this.mode !== 'public') this.host.dismiss(id); return; }   // closed meanwhile
      if (!this.room.has(id) || this.mode !== 'public') { this.pending.delete(id); return; }
      if (!this.pending.has(id)) this.pending.set(id, this.clock);
      if (this.clock - this.pending.get(id)! > 30) { this.pending.delete(id); this.note('invite-failed', id); this.svc.leaveAs(id); }
    });
  }
  /** A guest left the scene by itself (or the scene removed it): the presence follows. */
  private onGuestLeft(id: string) {
    this.dismissing.delete(id);
    if (this.room.has(id) && id !== OWNER && !this.pending.has(id)) { this.visitors.forget(id); this.svc.leaveAs(id); }
    if (this.mode === 'public') for (const p of [...this.pending.keys()]) this.bringIn(p);      // a place freed up in the scene
    if (this.mode === 'closing') this.check();
  }
  /** Once a second while public: leaving the room screen ends the public room at once; a finished close cleans up. */
  private check() {
    this.clock++;
    if (this.mode === 'public') for (const p of [...this.pending.keys()]) this.bringIn(p);
    if (this.mode === 'closing') for (const g of this.host.guests()) if (!g.leaving) this.host.dismiss(g.id);   // late arrivals go too
    const away = this.host.screen() !== 'room' || this.host.visiting();
    if (this.mode === 'public' && away) { this.note('owner-left'); this.mode = 'closing'; this.pending.clear(); this.visitors.stop(); this.svc.close(); }
    if (this.mode === 'closing' && (away || !this.host.guests().length)) this.finish();
  }
  private finish() {
    for (const u of this.unsubs) u(); this.unsubs = [];
    clearInterval(this.watch); this.watch = 0;
    this.visitors.stop(); this.dismissing.clear(); this.pending.clear();
    this.opts.social?.setPolicy(null);
    this.opts.social?.resync();
    this.host.setCapacity(this.opts.multi ? this.opts.multi.settings.miis - 1 : 1);
    this.mode = 'private';
    this.note('closed');
  }
  dispose() { if (this.mode === 'public') this.close(); if (this.mode !== 'private') this.finish(); }
}
