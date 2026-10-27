/**
 * SHARED ROOM — the multiplayer session (NEW: the original Miitomo had no real-time multiplayer; a friend's room was a
 * recording of their Mii). Two or more players, each with their OWN Mii, in one room at the same time.
 *
 * Runs in the account's P2P engine page (engine.ts), so a session survives the game page changing (launcher → Classic
 * → Reboot). Game pages draw it (mp/SceneSync.ts) and send their own Mii's state through the engine.
 *
 * Authority
 *   host     the player whose room it is. Decides who is in (invites, requests to enter, leaving, reconnecting), the
 *            room look and the member list. Each change bumps `ver` and goes to everybody as one snapshot (`snap`).
 *            Star topology: guests talk to the host only, the host relays — guests need not be friends of each other.
 *   member   authoritative for its OWN Mii only: position, heading, state, walking target (`av`, latest wins by `seq`)
 *            and actions (`act`: wave, touch reaction, object, line said — ordered, each `seq` applied once).
 *            Nobody can move, dress or rename another player's Mii: what arrives is keyed by the sender's
 *            authenticated id (the host relays it under that id).
 *
 * Messages (wire { t: 'mp', m }), all { v: 1, op, sid }:
 *   inv {room,name}  host → friend    invitation (60 s)        knock {}         friend → host  "may I come in?" (60 s)
 *   join {resume?}   guest → host     accept / come back       decline {}       guest → host   invitation refused
 *   welcome {snap}   host → guest     you are in               deny {why}       host → guest   not in (EXPIRED, FULL, …)
 *   snap {ver,…}     host → all       authoritative member list + room
 *   av {id?,seq,s}   member → host → others                    act {id?,seq,a}  member → host → others
 *   leave {}         guest → host                              end {why}        host → all     session closed
 *   ping/pong {at}   latency (host ↔ member)
 * Lost connection: the seat is kept 30 s (member "reconnecting"); the guest's engine re-sends `join {resume}` when the
 * link is back — same id, so never a second Mii. After 30 s the member is removed / the guest's session ends.
 */
export const MP_V = 1;
export const INVITE_MS = 60_000, GRACE_MS = 30_000, MAX_MEMBERS = 8;
export interface RoomSkin { wall: string; floor: string; variant: number }
/** A member's Mii as its owner sees it. x / z room units, h heading (rad), st director state, tx / tz walking target. */
export interface AvState { x: number; z: number; h: number; st: string; tx: number | null; tz: number | null; t: number }
/** wave / touch (my Mii's own reaction) / interact (object o) / say (a line) / poke (I tapped player o's Mii: their Mii reacts, by them) */
export interface MpAct { k: 'wave' | 'touch' | 'interact' | 'say' | 'poke'; o?: string; text?: string; lang?: string }
export interface MemberView { id: string; name: string; profile: unknown; conn: 'ok' | 'lost'; joinedAt: number; av: (AvState & { seq: number }) | null; rtt: number | null }
export interface MpView {
  me: string;
  session: { sid: string; role: 'host' | 'guest'; host: string; room: RoomSkin; ver: number; state: 'active' | 'reconnecting'; startedAt: number; members: MemberView[] } | null;
  invites: { sid: string; from: string; name: string; room: RoomSkin; exp: number }[];
  knocks: { from: string; name: string; exp: number }[];
  pending: { kind: 'inv' | 'join' | 'knock'; to: string; exp: number }[];
  last: { kind: 'denied' | 'declined' | 'ended' | 'left' | 'expired' | 'error'; who: string | null; why: string; at: number } | null;
}
export type MpError = 'NOT_FRIEND' | 'OFFLINE' | 'NOT_HOST' | 'NO_INVITE' | 'NO_KNOCK' | 'NO_SESSION' | 'FULL' | 'NO_MII' | 'BUSY';

export interface SessionDeps {
  me(): { id: string; name: string };
  /** My Mii + room for the others ({ profile, outfit, room } of the save); null = no Mii yet. */
  myProfile(): Promise<{ profile: unknown; outfit: unknown; room: unknown } | null>;
  isFriend(id: string): boolean;
  friendName(id: string): string;
  /** What a friend sent about themselves (same shape as myProfile), for the member list. */
  friendProfile(id: string): unknown;
  connected(id: string): boolean;
  send(id: string, m: Record<string, unknown>): boolean;
  emit(e: Record<string, unknown>): void;
  /** My presence changed (in a room / not). */
  status(inRoom: { host: string; joinable: boolean } | null): void;
  now(): number;
  log(m: string): void;
}

const ST = new Set(['outside', 'entering', 'idle', 'walking', 'interacting', 'reacting', 'exiting', 'held']);
const ID = /^p2p-[0-9a-f]{16}$/;
const SID = /^[A-Za-z0-9_-]{8,40}$/;
const num = (v: unknown, lim: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : null);
/** Checks a received Mii state; null = refused. */
export function cleanAv(raw: unknown): AvState | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s !== 'object') return null;
  const x = num(s.x, 80), z = num(s.z, 80), h = num(s.h, 20), t = num(s.t, 1e15);
  if (x === null || z === null || h === null || t === null || typeof s.st !== 'string' || !ST.has(s.st)) return null;
  const tx = s.tx === null || s.tx === undefined ? null : num(s.tx, 80), tz = s.tz === null || s.tz === undefined ? null : num(s.tz, 80);
  return { x, z, h, st: s.st, tx: tx !== null && tz !== null ? tx : null, tz: tx !== null && tz !== null ? tz : null, t };
}
export function cleanAct(raw: unknown): MpAct | null {
  const a = raw as Record<string, unknown> | null;
  if (!a || typeof a !== 'object') return null;
  if (a.k === 'wave' || a.k === 'touch') return { k: a.k };
  if (a.k === 'interact' && typeof a.o === 'string' && /^[A-Za-z0-9_]{1,24}$/.test(a.o)) return { k: 'interact', o: a.o };
  if (a.k === 'poke' && typeof a.o === 'string' && ID.test(a.o)) return { k: 'poke', o: a.o };
  if (a.k === 'say' && typeof a.text === 'string' && a.text.trim()) return { k: 'say', text: a.text.slice(0, 120), lang: a.lang === 'en' ? 'en' : 'it' };
  return null;
}
export function cleanRoom(raw: unknown): RoomSkin | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.wall !== 'string' || !/^\d{4}$/.test(r.wall) || typeof r.floor !== 'string' || !/^\d{4}$/.test(r.floor)) return null;
  return { wall: r.wall, floor: r.floor, variant: Math.max(0, Math.min(31, Math.round(Number(r.variant) || 0))) };
}
const sid = () => { const b = crypto.getRandomValues(new Uint8Array(12)); return 's' + [...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20); };

interface Member { id: string; name: string; profile: unknown; conn: 'ok' | 'lost'; joinedAt: number; lostAt: number; av: (AvState & { seq: number }) | null; actSeq: number; rtt: number | null }
interface Session { sid: string; role: 'host' | 'guest'; host: string; room: RoomSkin; ver: number; state: 'active' | 'reconnecting'; lostAt: number; startedAt: number; members: Map<string, Member> }

export class SessionManager {
  private s: Session | null = null;
  private invites = new Map<string, MpView['invites'][number]>();
  private knocks = new Map<string, MpView['knocks'][number]>();
  private pending: (MpView['pending'][number] & { sid: string })[] = [];
  private last: MpView['last'] = null;
  private avSeq = 0;
  private actSeq = 0;
  private myAv: AvState | null = null;
  readonly stats = { avIn: 0, avOut: 0, avStale: 0, actIn: 0, actOut: 0, actDup: 0, refused: 0, bytesOut: 0 };
  constructor(private d: SessionDeps) {}

  // ------------------------------------------------------------------ views
  view(): MpView {
    const s = this.s, now = this.d.now();
    return {
      me: this.d.me().id,
      session: s ? { sid: s.sid, role: s.role, host: s.host, room: { ...s.room }, ver: s.ver, state: s.state, startedAt: s.startedAt, members: [...s.members.values()].map((m) => ({ id: m.id, name: m.name, profile: m.profile, conn: m.conn, joinedAt: m.joinedAt, av: m.av ? { ...m.av } : null, rtt: m.rtt })) } : null,
      invites: [...this.invites.values()].filter((i) => i.exp > now),
      knocks: [...this.knocks.values()].filter((k) => k.exp > now),
      pending: this.pending.filter((p) => p.exp > now).map(({ kind, to, exp }) => ({ kind, to, exp })),
      last: this.last,
    };
  }
  get active() { return !!this.s; }
  private changed() {
    this.d.emit({ type: 'mp', view: this.view() });
    const s = this.s;
    this.d.status(s ? { host: s.host, joinable: s.role === 'host' && s.members.size < MAX_MEMBERS } : null);
  }
  private note(kind: NonNullable<MpView['last']>['kind'], who: string | null, why: string) { this.last = { kind, who, why, at: this.d.now() }; this.d.log(`mp ${kind} ${who ?? ''} ${why}`); }
  private out(to: string, op: string, body: Record<string, unknown> = {}) {
    const m = { v: MP_V, op, sid: body.sid ?? this.s?.sid ?? '', ...body };
    const ok = this.d.send(to, m);
    if (ok) try { this.stats.bytesOut += JSON.stringify(m).length; } catch { /* */ }
    return ok;
  }
  /** Snapshot sent by the host (authoritative). */
  private snap() {
    const s = this.s!;
    return { ver: s.ver, room: s.room, host: s.host, startedAt: s.startedAt, members: [...s.members.values()].map((m) => ({ id: m.id, name: m.name, profile: m.profile, joinedAt: m.joinedAt, conn: m.conn, av: m.av })) };
  }
  private broadcastSnap() {
    const s = this.s; if (!s || s.role !== 'host') return;
    s.ver++;
    for (const m of s.members.values()) if (m.id !== s.host && m.conn === 'ok') this.out(m.id, 'snap', { sid: s.sid, snap: this.snap() });
  }
  private async hostSession(): Promise<Session | null> {
    if (this.s?.role === 'host') return this.s;
    const mine = await this.d.myProfile(); if (!mine) return null;
    const room = cleanRoom(mine.room) ?? { wall: '0000', floor: '0000', variant: 0 };
    const me = this.d.me();
    const now = this.d.now();
    this.s = { sid: sid(), role: 'host', host: me.id, room, ver: 1, state: 'active', lostAt: 0, startedAt: now, members: new Map([[me.id, { id: me.id, name: me.name, profile: mine, conn: 'ok', joinedAt: now, lostAt: 0, av: this.myAv ? { ...this.myAv, seq: this.avSeq } : null, actSeq: 0, rtt: null }]]) };
    this.d.log(`mp hosting ${this.s.sid}`);
    return this.s;
  }
  private addMember(id: string) {
    const s = this.s!;
    const cur = s.members.get(id);
    if (cur) { cur.conn = 'ok'; cur.lostAt = 0; return cur; }   // the same player coming back: same seat, never a second Mii
    const m: Member = { id, name: this.d.friendName(id), profile: this.d.friendProfile(id), conn: 'ok', joinedAt: this.d.now(), lostAt: 0, av: null, actSeq: 0, rtt: null };
    s.members.set(id, m);
    return m;
  }

  // ------------------------------------------------------------------ operations (from the game pages)
  async op(op: string, a: Record<string, unknown>): Promise<{ ok: true; value?: unknown } | { ok: false; code: MpError }> {
    const now = this.d.now(), me = this.d.me().id;
    switch (op) {
      case 'mp.state': return { ok: true, value: this.view() };
      case 'mp.invite': {
        const to = String(a.to ?? '');
        if (!this.d.isFriend(to)) return { ok: false, code: 'NOT_FRIEND' };
        if (!this.d.connected(to)) return { ok: false, code: 'OFFLINE' };
        if (this.s && this.s.role !== 'host') return { ok: false, code: 'NOT_HOST' };
        if (this.s && this.s.members.has(to)) return { ok: true };
        if (this.s && this.s.members.size >= MAX_MEMBERS) return { ok: false, code: 'FULL' };
        const s = await this.hostSession(); if (!s) return { ok: false, code: 'NO_MII' };
        this.pending = this.pending.filter((p) => !(p.kind === 'inv' && p.to === to));
        this.pending.push({ kind: 'inv', to, sid: s.sid, exp: now + INVITE_MS });
        this.out(to, 'inv', { sid: s.sid, room: s.room, name: this.d.me().name });
        this.changed();
        return { ok: true };
      }
      case 'mp.knock': {
        const to = String(a.to ?? '');
        if (!this.d.isFriend(to)) return { ok: false, code: 'NOT_FRIEND' };
        if (!this.d.connected(to)) return { ok: false, code: 'OFFLINE' };
        if (this.s?.host === to) return { ok: true };
        if (!(await this.d.myProfile())) return { ok: false, code: 'NO_MII' };
        // both asked to enter each other's room: both want to be together → the smaller id hosts, at once
        if (this.knocks.has(to) && me < to) return this.op('mp.admit', { from: to });
        this.pending = this.pending.filter((p) => !(p.kind === 'knock' && p.to === to));
        this.pending.push({ kind: 'knock', to, sid: '', exp: now + INVITE_MS });
        this.out(to, 'knock', { sid: '' });
        this.changed();
        return { ok: true };
      }
      case 'mp.accept': {
        const inv = this.invites.get(String(a.sid ?? ''));
        if (!inv || inv.exp <= now) return { ok: false, code: 'NO_INVITE' };
        if (!this.d.connected(inv.from)) return { ok: false, code: 'OFFLINE' };
        if (!(await this.d.myProfile())) return { ok: false, code: 'NO_MII' };
        this.invites.delete(inv.sid);
        this.pending = this.pending.filter((p) => !(p.kind === 'join'));
        this.pending.push({ kind: 'join', to: inv.from, sid: inv.sid, exp: now + INVITE_MS });
        this.out(inv.from, 'join', { sid: inv.sid });
        this.changed();
        return { ok: true };
      }
      case 'mp.decline': {
        const inv = this.invites.get(String(a.sid ?? '')); if (!inv) return { ok: false, code: 'NO_INVITE' };
        this.invites.delete(inv.sid); this.out(inv.from, 'decline', { sid: inv.sid }); this.changed();
        return { ok: true };
      }
      case 'mp.admit': {
        const from = String(a.from ?? ''); const k = this.knocks.get(from);
        if (!k || k.exp <= now) return { ok: false, code: 'NO_KNOCK' };
        if (!this.d.connected(from)) return { ok: false, code: 'OFFLINE' };
        if (this.s && this.s.role !== 'host') this.leave('JOINED_OTHER');
        const s = await this.hostSession(); if (!s) return { ok: false, code: 'NO_MII' };
        if (s.members.size >= MAX_MEMBERS && !s.members.has(from)) { this.out(from, 'deny', { sid: s.sid, why: 'FULL' }); return { ok: false, code: 'FULL' }; }
        this.knocks.delete(from);
        this.pending = this.pending.filter((p) => !(p.kind === 'knock' && p.to === from));
        this.addMember(from);
        this.out(from, 'welcome', { sid: s.sid, snap: null });   // the snapshot follows (one place builds it)
        this.broadcastSnap(); this.changed();
        return { ok: true };
      }
      case 'mp.refuse': {
        const from = String(a.from ?? ''); if (!this.knocks.delete(from)) return { ok: false, code: 'NO_KNOCK' };
        this.out(from, 'deny', { sid: '', why: 'DECLINED' }); this.changed();
        return { ok: true };
      }
      case 'mp.leave': if (!this.s) return { ok: false, code: 'NO_SESSION' }; this.leave('LEFT'); return { ok: true };
      default: return { ok: false, code: 'NO_SESSION' };
    }
  }
  /** I leave (guest) or close (host) the session. */
  leave(why: string) {
    const s = this.s; if (!s) return;
    if (s.role === 'host') { for (const m of s.members.values()) if (m.id !== s.host) this.out(m.id, 'end', { sid: s.sid, why: why === 'LEFT' ? 'HOST_LEFT' : why }); }
    else this.out(s.host, 'leave', { sid: s.sid });
    this.s = null; this.pending = this.pending.filter((p) => p.kind !== 'inv');
    this.note('left', null, why); this.changed();
  }
  /** My own Mii (from the game page): the latest state wins, the host relays it. */
  local(s: unknown) {
    const av = cleanAv(s); if (!av) return;
    this.myAv = av; const seq = ++this.avSeq;
    const ses = this.s; if (!ses) return;
    const me = ses.members.get(this.d.me().id); if (me) me.av = { ...av, seq };
    if (ses.role === 'host') { for (const m of ses.members.values()) if (m.id !== ses.host && m.conn === 'ok') { this.out(m.id, 'av', { id: ses.host, seq, s: av }); this.stats.avOut++; } }
    else if (ses.state === 'active') { this.out(ses.host, 'av', { seq, s: av }); this.stats.avOut++; }
  }
  localAct(a: unknown) {
    const act = cleanAct(a); if (!act) return;
    const ses = this.s; if (!ses) return;
    const seq = ++this.actSeq;
    if (ses.role === 'host') { for (const m of ses.members.values()) if (m.id !== ses.host && m.conn === 'ok') { this.out(m.id, 'act', { id: ses.host, seq, a: act }); this.stats.actOut++; } }
    else { this.out(ses.host, 'act', { seq, a: act }); this.stats.actOut++; }
  }

  // ------------------------------------------------------------------ from the peers
  onWire(from: string, raw: unknown) {
    const m = raw as Record<string, unknown> | null;
    if (!m || m.v !== MP_V || typeof m.op !== 'string' || typeof m.sid !== 'string' || (m.sid && !SID.test(m.sid))) { this.stats.refused++; return; }
    const now = this.d.now(), me = this.d.me().id, s = this.s;
    const friend = this.d.isFriend(from);
    switch (m.op) {
      case 'inv': {
        const room = cleanRoom(m.room);
        if (!friend || !room || !m.sid) { this.stats.refused++; return; }
        if (s?.sid === m.sid) return;
        this.invites.set(m.sid, { sid: m.sid, from, name: String(m.name ?? this.d.friendName(from)).slice(0, 16), room, exp: now + INVITE_MS });
        this.changed(); return;
      }
      case 'knock': {
        if (!friend) { this.stats.refused++; return; }
        if (s?.members.has(from)) return;
        // crossed requests (I knocked on them too): both want it — the smaller id hosts
        if (this.pending.some((p) => p.kind === 'knock' && p.to === from) && me < from) { this.knocks.set(from, { from, name: this.d.friendName(from), exp: now + INVITE_MS }); void this.op('mp.admit', { from }); return; }
        this.knocks.set(from, { from, name: this.d.friendName(from), exp: now + INVITE_MS });
        this.changed(); return;
      }
      case 'join': {
        if (!s || s.role !== 'host' || s.sid !== m.sid) { this.out(from, 'deny', { sid: m.sid, why: 'NO_SESSION' }); return; }
        const invited = this.pending.find((p) => p.kind === 'inv' && p.to === from && p.sid === m.sid);
        const back = s.members.has(from);
        if (!back && (!invited || invited.exp <= now)) { this.out(from, 'deny', { sid: m.sid, why: invited ? 'EXPIRED' : 'NOT_INVITED' }); return; }
        // crossed: I am also trying to join THEM — the smaller id keeps hosting
        const mine = this.pending.find((p) => p.kind === 'join' && p.to === from);
        if (mine) { if (me < from) this.pending = this.pending.filter((p) => p !== mine); else { this.out(from, 'deny', { sid: m.sid, why: 'CROSSED' }); return; } }
        if (!back && s.members.size >= MAX_MEMBERS) { this.out(from, 'deny', { sid: m.sid, why: 'FULL' }); return; }
        this.pending = this.pending.filter((p) => p !== invited);
        this.addMember(from);
        this.out(from, 'welcome', { sid: s.sid, snap: null });
        this.broadcastSnap(); this.changed(); return;
      }
      case 'welcome': {
        // a "welcome" counts only for a join / knock I sent to that host (or my seat while reconnecting)
        const asked = this.pending.find((p) => (p.kind === 'join' && p.to === from && p.sid === m.sid) || (p.kind === 'knock' && p.to === from));
        const resume = s && s.role === 'guest' && s.host === from && s.sid === m.sid;
        if (!asked && !resume) { this.stats.refused++; return; }
        this.pending = this.pending.filter((p) => p !== asked && !(p.kind === 'join' || p.kind === 'knock'));
        if (!resume) {
          if (s) this.leave('JOINED_OTHER');
          this.s = { sid: m.sid, role: 'guest', host: from, room: { wall: '0000', floor: '0000', variant: 0 }, ver: 0, state: 'active', lostAt: 0, startedAt: now, members: new Map() };
          this.d.log(`mp joined ${m.sid} at ${from}`);
        } else { s!.state = 'active'; s!.lostAt = 0; }
        this.changed();
        if (this.myAv) this.local(this.myAv);
        return;
      }
      case 'deny': {
        const p = this.pending.find((x) => (x.kind === 'join' || x.kind === 'knock') && x.to === from);
        if (!p) return;
        this.pending = this.pending.filter((x) => x !== p);
        this.note('denied', from, String(m.why ?? 'DENIED').slice(0, 20));
        if (s && s.role === 'guest' && s.host === from && s.state === 'reconnecting') { this.s = null; this.note('ended', from, 'SEAT_LOST'); }
        this.changed(); return;
      }
      case 'decline': {
        const p = this.pending.find((x) => x.kind === 'inv' && x.to === from && x.sid === m.sid); if (!p) return;
        this.pending = this.pending.filter((x) => x !== p); this.note('declined', from, 'DECLINED'); this.changed(); return;
      }
      case 'snap': {
        if (!s || s.role !== 'guest' || s.host !== from || s.sid !== m.sid) { this.stats.refused++; return; }
        const sn = m.snap as Record<string, unknown> | null; if (!sn || typeof sn !== 'object') return;
        const ver = Number(sn.ver); if (!Number.isFinite(ver) || ver <= s.ver) return;   // old / repeated snapshot
        const room = cleanRoom(sn.room); if (room) s.room = room;
        s.ver = ver;
        const list = Array.isArray(sn.members) ? (sn.members as Record<string, unknown>[]).slice(0, MAX_MEMBERS) : [];
        if (!list.some((x) => x?.id === me)) { this.s = null; this.note('ended', from, 'REMOVED'); this.changed(); return; }
        const next = new Map<string, Member>();
        for (const x of list) {
          if (!x || typeof x.id !== 'string' || !ID.test(x.id)) continue;
          const old = s.members.get(x.id), av = cleanAv(x.av);
          next.set(x.id, { id: x.id, name: String(x.name ?? '').slice(0, 16), profile: x.profile ?? null, conn: x.conn === 'lost' ? 'lost' : 'ok', joinedAt: Number(x.joinedAt) || now, lostAt: 0,
            av: old?.av ?? (av ? { ...av, seq: 0 } : null), actSeq: old?.actSeq ?? 0, rtt: old?.rtt ?? null });
        }
        s.members = next;
        this.changed(); return;
      }
      case 'av': case 'act': {
        if (!s || s.sid !== m.sid) { this.stats.refused++; return; }
        // who it is about: the host relays others under their id; a guest speaks only for itself
        const id = s.role === 'guest' ? (from === s.host && typeof m.id === 'string' ? m.id : null) : from;
        const mem = id ? s.members.get(id) : null;
        if (!id || !mem || id === me) { this.stats.refused++; return; }
        const seq = Number(m.seq); if (!Number.isInteger(seq) || seq < 1) { this.stats.refused++; return; }
        if (m.op === 'av') {
          const av = cleanAv(m.s); if (!av) { this.stats.refused++; return; }
          if (mem.av && seq <= mem.av.seq) { this.stats.avStale++; return; }      // late / out of order: a newer one is already here
          mem.av = { ...av, seq }; this.stats.avIn++;
          this.d.emit({ type: 'mp.av', id, seq, s: av });
          if (s.role === 'host') for (const o of s.members.values()) if (o.id !== s.host && o.id !== id && o.conn === 'ok') this.out(o.id, 'av', { id, seq, s: av });
        } else {
          const act = cleanAct(m.a); if (!act) { this.stats.refused++; return; }
          if (seq <= mem.actSeq) { this.stats.actDup++; return; }                 // already applied (resent after a reconnection)
          mem.actSeq = seq; this.stats.actIn++;
          this.d.emit({ type: 'mp.act', id, seq, a: act });
          if (s.role === 'host') for (const o of s.members.values()) if (o.id !== s.host && o.id !== id && o.conn === 'ok') this.out(o.id, 'act', { id, seq, a: act });
        }
        return;
      }
      case 'leave': {
        if (!s || s.role !== 'host' || s.sid !== m.sid || !s.members.has(from)) return;
        s.members.delete(from); this.broadcastSnap(); this.changed(); return;
      }
      case 'end': {
        if (!s || s.role !== 'guest' || s.host !== from || s.sid !== m.sid) return;
        this.s = null; this.note('ended', from, String(m.why ?? 'HOST_LEFT').slice(0, 20)); this.changed(); return;
      }
      case 'ping': this.out(from, 'pong', { sid: m.sid, at: m.at }); return;
      case 'pong': { const mem = s?.members.get(from); const at = Number(m.at); if (mem && Number.isFinite(at)) mem.rtt = Math.max(0, this.d.now() - at); return; }
      default: this.stats.refused++;
    }
  }
  /** The direct link to `id` closed / came back (engine). */
  peerDown(id: string) {
    const s = this.s, now = this.d.now();
    if (s?.role === 'host') { const m = s.members.get(id); if (m && m.id !== s.host) { m.conn = 'lost'; m.lostAt = now; this.broadcastSnap(); this.changed(); } }
    else if (s?.role === 'guest' && s.host === id && s.state === 'active') { s.state = 'reconnecting'; s.lostAt = now; this.changed(); }
  }
  peerUp(id: string) {
    const s = this.s;
    if (s?.role === 'guest' && s.host === id) { this.pending.push({ kind: 'join', to: id, sid: s.sid, exp: this.d.now() + GRACE_MS }); this.out(id, 'join', { sid: s.sid, resume: true }); }
  }
  /** Once a second (engine): time-outs, latency probes. */
  tick() {
    const now = this.d.now(); let changed = false;
    for (const [k, i] of this.invites) if (i.exp <= now) { this.invites.delete(k); changed = true; }
    for (const [k, i] of this.knocks) if (i.exp <= now) { this.knocks.delete(k); changed = true; }
    const before = this.pending.length;
    for (const p of this.pending) if (p.exp <= now && (p.kind === 'join' || p.kind === 'knock')) this.note('expired', p.to, 'NO_ANSWER');
    this.pending = this.pending.filter((p) => p.exp > now); if (this.pending.length !== before) changed = true;
    const s = this.s;
    if (s?.role === 'host') {
      let gone = false;
      for (const m of [...s.members.values()]) if (m.conn === 'lost' && now - m.lostAt > GRACE_MS) { s.members.delete(m.id); gone = true; this.d.log(`mp ${m.id} removed (lost)`); }
      if (gone) { this.broadcastSnap(); changed = true; }
      for (const m of s.members.values()) if (m.id !== s.host && m.conn === 'ok') this.out(m.id, 'ping', { sid: s.sid, at: now });
    } else if (s?.role === 'guest' && s.state === 'reconnecting' && now - s.lostAt > GRACE_MS) { this.s = null; this.note('ended', s.host, 'HOST_LOST'); changed = true; }
    if (changed) this.changed();
  }
  /** The account logs out / the engine stops: tell the others now (no ghost seat). */
  shutdown() { if (this.s) this.leave('LOGOUT'); }
}
