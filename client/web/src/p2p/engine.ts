/**
 * P2P ENGINE — runs in the account's hidden page (p2p.html) of the desktop app, so connections survive the game page
 * reloading (launcher → Classic → Reboot). The game pages talk to it on a BroadcastChannel (same origin, same account
 * partition): requests (op) and events (state, app data). See client.ts.
 *
 * Friends (NEW: the original friends were on Nintendo's server):
 *   nearby (LAN)   players of the same network appear by themselves; "Add" connects and sends a friend request;
 *                  the other side accepts or declines. Friends on the LAN reconnect by themselves.
 *   invite codes   over the internet, with no server: invite code → reply code (codes.ts); an accepted invite makes
 *                  both friends at once (both chose to exchange the codes).
 * A friend is pinned to their public key: the same id with another key is refused (KEY_CHANGED).
 * Stored in localStorage `mtw.p2p.v1` of the account (friends, requests, settings). Profiles from peers are untrusted
 * and sanitized by the game (sanitizeFriend) before use; here they are only size-checked.
 */
import { Peer, Identity, CloseReason } from './Peer';
import type { Wire } from './protocol';
import { PEER_ID, PUB } from './protocol';
import { encodeCode, decodeCode } from './codes';

export const P2P_KEY = 'mtw.p2p.v1';
export const P2P_CHANNEL = 'mtw-p2p';
export const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
const MAX_PEERS = 32, MAX_STRANGERS = 8, STRANGER_MS = 120_000, PROFILE_MAX = 6000;

export interface FriendRec { id: string; pub: string; name: string; profile: unknown; since: string; lastSeen: string | null; via: 'lan' | 'invite' }
export interface RequestRec { id: string; pub: string; name: string; profile: unknown; at: string }
interface Store { v: 1; friends: FriendRec[]; incoming: RequestRec[]; outgoing: { id: string; name: string; at: string }[]; settings: { stun: boolean } }
export interface NearbyPeer { id: string; pub: string; name: string; code: string }
export interface LanApi {
  start(me: { name: string }): Promise<boolean>;
  stop(): Promise<boolean>;
  signal(peerId: string, data: unknown): Promise<boolean>;
  onPeers(cb: (list: NearbyPeer[]) => void): () => void;
  onSignal(cb: (m: { from: string; data: unknown }) => void): () => void;
}
export interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void }
export interface ChannelLike { postMessage(m: unknown): void; addEventListener(t: 'message', cb: (e: MessageEvent) => void): void; close(): void }
export interface EngineDeps {
  me: Identity & { code: string };
  lan: LanApi | null;
  kv: Kv | null;
  channel: ChannelLike;
  /** The user's current game profile to send to friends ({ profile, outfit, room } of the save), null = no Mii yet. */
  profile(): Promise<{ profile: unknown; outfit: unknown; room: unknown } | null>;
}
export type P2PError = 'NO_MII' | 'OFFLINE' | 'NOT_FOUND' | 'ALREADY_FRIENDS' | 'FORMAT' | 'KIND' | 'EXPIRED' | 'SELF' | 'NO_INVITE' | 'FAILED' | 'LIMIT' | 'UNKNOWN_OP';
export interface P2PState {
  me: { id: string; code: string; name: string };
  lan: 'off' | 'on' | 'error';
  friends: { id: string; name: string; online: boolean; since: string; lastSeen: string | null; via: 'lan' | 'invite'; nearby: boolean }[];
  nearby: { id: string; name: string; code: string; friend: boolean; requested: boolean }[];
  incoming: { id: string; name: string; at: string }[];
  outgoing: { id: string; name: string; at: string }[];
  invite: 'none' | 'waiting';
  settings: { stun: boolean };
}

const now = () => new Date().toISOString();
const sizeOk = (v: unknown) => { try { return JSON.stringify(v).length <= PROFILE_MAX; } catch { return false; } };

export class P2PEngine {
  private s: Store;
  private peers = new Map<string, Peer>();
  private nearby = new Map<string, NearbyPeer>();
  private lanState: P2PState['lan'] = 'off';
  private invite: Peer | null = null;
  private unsubs: (() => void)[] = [];
  readonly log: string[] = [];

  constructor(private d: EngineDeps) {
    let raw: Partial<Store> | null = null;
    try { raw = JSON.parse(d.kv?.getItem(P2P_KEY) ?? 'null'); } catch { raw = null; }
    const ok = (f: { id?: unknown; pub?: unknown }) => typeof f?.id === 'string' && PEER_ID.test(f.id) && typeof f.pub === 'string' && PUB.test(f.pub);
    this.s = {
      v: 1,
      friends: Array.isArray(raw?.friends) ? raw!.friends.filter(ok) : [],
      incoming: Array.isArray(raw?.incoming) ? raw!.incoming.filter(ok).slice(0, 50) : [],
      outgoing: Array.isArray(raw?.outgoing) ? raw!.outgoing.filter((o) => typeof o?.id === 'string' && PEER_ID.test(o.id)).slice(0, 50) : [],
      settings: { stun: raw?.settings?.stun !== false },
    };
    d.channel.addEventListener('message', (e) => { void this.onPage(e.data); });
  }
  private note(m: string) { this.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`); if (this.log.length > 200) this.log.shift(); }
  private save() { try { this.d.kv?.setItem(P2P_KEY, JSON.stringify(this.s)); } catch { /* memory only */ } }
  private ice() { return this.s.settings.stun ? STUN : []; }
  friend(id: string) { return this.s.friends.find((f) => f.id === id) ?? null; }
  private ready(id: string) { const p = this.peers.get(id); return p && p.state === 'ready' ? p : null; }

  // ------------------------------------------------------------ lifecycle
  async start() {
    const lan = this.d.lan;
    if (lan) {
      this.unsubs.push(lan.onPeers((list) => this.onNearby(list)), lan.onSignal((m) => { void this.onSignal(m.from, m.data); }));
      this.lanState = (await lan.start({ name: this.d.me.name }).catch(() => false)) ? 'on' : 'error';
    }
    this.emit();
  }
  stop() { for (const u of this.unsubs) u(); this.unsubs = []; for (const p of [...this.peers.values()]) p.close('BYE'); this.invite?.close('BYE'); void this.d.lan?.stop(); }

  state(): P2PState {
    return {
      me: { id: this.d.me.id, code: this.d.me.code, name: this.d.me.name }, lan: this.lanState,
      friends: this.s.friends.map((f) => ({ id: f.id, name: f.name, online: !!this.ready(f.id), since: f.since, lastSeen: f.lastSeen, via: f.via, nearby: this.nearby.has(f.id) })),
      nearby: [...this.nearby.values()].map((n) => ({ id: n.id, name: n.name, code: n.code, friend: !!this.friend(n.id), requested: this.s.outgoing.some((o) => o.id === n.id) })),
      incoming: this.s.incoming.map(({ id, name, at }) => ({ id, name, at })), outgoing: [...this.s.outgoing],
      invite: this.invite && this.invite.state !== 'closed' && this.invite.state !== 'ready' ? 'waiting' : 'none',
      settings: { ...this.s.settings },
    };
  }
  /** The friends as the game needs them (the profile is sanitized there). */
  friendProfiles() { return this.s.friends.map((f) => ({ id: f.id, name: f.name, profile: f.profile, online: !!this.ready(f.id) })); }
  private emit() { this.d.channel.postMessage({ kind: 'ev', type: 'state', state: this.state(), friends: this.friendProfiles() }); }

  // ------------------------------------------------------------ connections
  private makePeer(o: { expectId?: string; expectPub?: string; meta?: Record<string, unknown> }) {
    const p = new Peer(this.d.me, {
      iceServers: this.ice(), expectId: o.expectId, expectPub: o.expectPub,
      onReady: (x) => this.onReady(x), onMessage: (x, m) => { void this.onWire(x, m); }, onClose: (x, why) => this.onClosed(x, why),
    });
    Object.assign(p.meta, o.meta ?? {});
    return p;
  }
  private onReady(p: Peer) {
    const r = p.remote!;
    const f = this.friend(r.id);
    if (f && f.pub !== r.pub) { this.note(`key changed for ${r.id}: refused`); p.close('MISMATCH'); return; }
    const old = this.peers.get(r.id);
    if (old && old !== p) {
      // two connections to the same peer (both started): keep the one the smaller id started, on both sides
      const keepNew = (p.meta.initiator ? this.d.me.id : r.id) < (old.meta.initiator ? this.d.me.id : r.id);
      if (!keepNew && old.state === 'ready') { p.close('REPLACED'); return; }
      old.close('REPLACED');
    }
    if (!f && [...this.peers.values()].filter((x) => x.remote && !this.friend(x.remote.id)).length >= MAX_STRANGERS) { p.close('LIMIT'); return; }
    this.peers.set(r.id, p);
    if (this.invite === p) this.invite = null;
    this.note(`ready ${r.id} (${f ? 'friend' : 'not a friend'})`);
    if (f) { f.lastSeen = now(); f.name = r.name || f.name; this.save(); void this.sendProfile(p, 'profile'); }
    else if (p.meta.invite) void this.sendProfile(p, 'facc');
    else if (this.s.outgoing.some((o) => o.id === r.id)) void this.sendProfile(p, 'freq');
    else p.meta.strangerTimer = window.setTimeout(() => { if (!this.friend(r.id) && !this.s.incoming.some((i) => i.id === r.id)) p.close('TIMEOUT'); }, STRANGER_MS);
    this.emit();
  }
  private onClosed(p: Peer, why: CloseReason) {
    if (p.remote && this.peers.get(p.remote.id) === p) { this.peers.delete(p.remote.id); const f = this.friend(p.remote.id); if (f) { f.lastSeen = now(); this.save(); } }
    for (const [k, v] of this.peers) if (v === p) this.peers.delete(k);
    if (this.invite === p) this.invite = null;
    clearTimeout(p.meta.strangerTimer as number);
    this.note(`closed ${p.remote?.id ?? '?'} ${why}${p.problem ? ` (${p.problem})` : ''} state=${p.pc.connectionState}`); if (why !== 'BYE' && why !== 'REPLACED') for (const t of p.trace) this.note('  ' + t);
    this.emit();
  }
  private async sendProfile(p: Peer, t: 'profile' | 'freq' | 'facc') {
    const prof = await this.d.profile();
    if (!prof) { this.note('no Mii yet: profile not sent'); return false; }
    return p.send({ t, profile: prof });
  }
  private async onWire(p: Peer, m: Wire) {
    const r = p.remote!, f = this.friend(r.id);
    if (m.t === 'profile' || m.t === 'facc') {
      if (!sizeOk(m.profile)) return;
      if (f) { f.profile = m.profile; f.name = r.name || f.name; f.lastSeen = now(); this.save(); this.emit(); return; }
      // a friendship both chose: an accepted request, or an invite code exchanged
      const asked = this.s.outgoing.some((o) => o.id === r.id);
      if (m.t === 'facc' && (asked || p.meta.invite)) {
        this.addFriend(r, m.profile, p.meta.invite ? 'invite' : 'lan');
      }
      return;
    }
    if (m.t === 'freq') {
      if (!sizeOk(m.profile) || f) return;
      if (this.s.outgoing.some((o) => o.id === r.id)) { this.addFriend(r, m.profile, 'lan'); void this.sendProfile(p, 'facc'); return; }   // both asked
      this.s.incoming = [{ id: r.id, pub: r.pub, name: r.name, profile: m.profile, at: now() }, ...this.s.incoming.filter((i) => i.id !== r.id)].slice(0, 50);
      clearTimeout(p.meta.strangerTimer as number);
      this.save(); this.emit();
      return;
    }
    if (m.t === 'fdec') { this.s.outgoing = this.s.outgoing.filter((o) => o.id !== r.id); this.save(); this.emit(); p.close('BYE'); return; }
    if (m.t === 'unfriend') { if (f) { this.s.friends = this.s.friends.filter((x) => x.id !== r.id); this.save(); this.emit(); } p.close('BYE'); return; }
    if (m.t === 'app' && f) this.d.channel.postMessage({ kind: 'ev', type: 'app', from: r.id, ch: m.ch, data: m.data });
  }
  private addFriend(r: { id: string; pub: string; name: string }, profile: unknown, via: 'lan' | 'invite') {
    if (this.friend(r.id)) return;
    this.s.friends.push({ id: r.id, pub: r.pub, name: r.name, profile, since: now(), lastSeen: now(), via });
    this.s.outgoing = this.s.outgoing.filter((o) => o.id !== r.id);
    this.s.incoming = this.s.incoming.filter((i) => i.id !== r.id);
    const p = this.peers.get(r.id); if (p) clearTimeout(p.meta.strangerTimer as number);
    this.save(); this.note(`friend ${r.id} (${via})`); this.emit();
  }

  // ------------------------------------------------------------ LAN
  private onNearby(list: NearbyPeer[]) {
    this.nearby = new Map(list.filter((n) => PEER_ID.test(n.id) && PUB.test(n.pub)).map((n) => [n.id, n]));
    // friends on the network reconnect by themselves (the smaller id calls, the other waits)
    for (const n of this.nearby.values()) if (this.friend(n.id) && !this.peers.has(n.id) && this.d.me.id < n.id) void this.connectLan(n.id);
    this.emit();
  }
  private async connectLan(id: string) {
    const n = this.nearby.get(id); if (!n || !this.d.lan) return false;
    if (this.peers.size >= MAX_PEERS) return false;
    const f = this.friend(id);
    const p = this.makePeer({ expectId: id, expectPub: f?.pub ?? n.pub, meta: { initiator: true, via: 'lan' } });
    this.peers.set(id, p);
    try {
      const sdp = await p.offer();
      await this.d.lan.signal(id, { k: 'offer', sdp });
      // UDP may lose it: send the same offer again while no answer came (3 more times, 3 s apart)
      let n = 0;
      const again = window.setInterval(() => { if (p.state !== 'connecting' || p.pc.remoteDescription || ++n > 3) { clearInterval(again); return; } void this.d.lan?.signal(id, { k: 'offer', sdp }); }, 3000);
    } catch { p.close('NETWORK'); return false; }
    return true;
  }
  private async onSignal(from: string, data: unknown) {
    const m = data as { k?: unknown; sdp?: unknown } | null;
    if (!PEER_ID.test(from) || !m || typeof m.sdp !== 'string' || m.sdp.length > 20_000) return;
    if (m.k === 'offer') {
      const cur = this.peers.get(from);
      if (cur && cur.state === 'ready') return;
      // the same offer again (resent over UDP): answer it again, do not start over
      if (cur && !cur.meta.initiator && cur.meta.offer === m.sdp) { if (cur.pc.localDescription) void this.d.lan?.signal(from, { k: 'answer', sdp: cur.pc.localDescription.sdp }); return; }
      // both called at once: the smaller id's call wins
      if (cur && cur.meta.initiator && this.d.me.id < from) return;
      cur?.close('REPLACED');
      if (this.peers.size >= MAX_PEERS) return;
      const f = this.friend(from), n = this.nearby.get(from);
      const p = this.makePeer({ expectId: from, expectPub: f?.pub ?? n?.pub, meta: { initiator: false, via: 'lan', offer: m.sdp } });
      this.peers.set(from, p);
      try { const sdp = await p.answer(m.sdp); await this.d.lan?.signal(from, { k: 'answer', sdp }); } catch { p.close('NETWORK'); }
    } else if (m.k === 'answer') {
      const p = this.peers.get(from);
      if (p && p.meta.initiator && p.state === 'connecting') { try { await p.accept(m.sdp); } catch { p.close('NETWORK'); } }
    }
  }

  // ------------------------------------------------------------ operations asked by the game pages
  async op(op: string, a: Record<string, unknown> = {}): Promise<{ ok: true; value?: unknown } | { ok: false; code: P2PError }> {
    switch (op) {
      case 'state': return { ok: true, value: { state: this.state(), friends: this.friendProfiles() } };
      case 'add': {
        const id = String(a.id ?? '');
        if (this.friend(id)) return { ok: false, code: 'ALREADY_FRIENDS' };
        if (!this.nearby.has(id)) return { ok: false, code: 'OFFLINE' };
        if (!(await this.d.profile())) return { ok: false, code: 'NO_MII' };
        const n = this.nearby.get(id)!;
        this.s.outgoing = [{ id, name: n.name, at: now() }, ...this.s.outgoing.filter((o) => o.id !== id)].slice(0, 50); this.save();
        const p = this.ready(id);
        if (p) await this.sendProfile(p, 'freq'); else await this.connectLan(id);
        this.emit(); return { ok: true };
      }
      case 'accept': case 'decline': {
        const id = String(a.id ?? ''), req = this.s.incoming.find((i) => i.id === id);
        if (!req) return { ok: false, code: 'NOT_FOUND' };
        const p = this.ready(id);
        if (op === 'decline') { this.s.incoming = this.s.incoming.filter((i) => i.id !== id); this.save(); p?.send({ t: 'fdec' }); p?.close('BYE'); this.emit(); return { ok: true }; }
        if (!(await this.d.profile())) return { ok: false, code: 'NO_MII' };
        if (!p) { if (this.nearby.has(id)) void this.connectLan(id); return { ok: false, code: 'OFFLINE' }; }
        this.addFriend(req, req.profile, (p.meta.via as 'lan' | 'invite') ?? 'lan');
        await this.sendProfile(p, 'facc');
        return { ok: true };
      }
      case 'unfriend': {
        const id = String(a.id ?? '');
        if (!this.friend(id)) return { ok: false, code: 'NOT_FOUND' };
        this.ready(id)?.send({ t: 'unfriend' });
        this.s.friends = this.s.friends.filter((f) => f.id !== id); this.save();
        this.peers.get(id)?.close('BYE'); this.emit();
        return { ok: true };
      }
      case 'invite.create': {
        if (!(await this.d.profile())) return { ok: false, code: 'NO_MII' };
        this.invite?.close('REPLACED');
        const p = this.makePeer({ meta: { initiator: true, invite: true, via: 'invite' } });
        this.invite = p;
        try {
          const sdp = await p.offer();
          this.emit();
          return { ok: true, value: encodeCode({ kind: 'invite', id: this.d.me.id, pub: this.d.me.pub, name: this.d.me.name, sdp, at: Date.now() }) };
        } catch { p.close('NETWORK'); return { ok: false, code: 'FAILED' }; }
      }
      case 'invite.accept': {
        const c = decodeCode(String(a.code ?? ''), 'invite');
        if (!c.ok) return { ok: false, code: c.code };
        if (c.body.id === this.d.me.id) return { ok: false, code: 'SELF' };
        if (!(await this.d.profile())) return { ok: false, code: 'NO_MII' };
        const f = this.friend(c.body.id);
        if (f && f.pub !== c.body.pub) return { ok: false, code: 'FAILED' };
        this.peers.get(c.body.id)?.close('REPLACED');
        const p = this.makePeer({ expectId: c.body.id, expectPub: c.body.pub, meta: { initiator: false, invite: true, via: 'invite' } });
        this.peers.set(c.body.id, p);
        try {
          const sdp = await p.answer(c.body.sdp);
          return { ok: true, value: encodeCode({ kind: 'reply', id: this.d.me.id, pub: this.d.me.pub, name: this.d.me.name, sdp, at: Date.now() }) };
        } catch { p.close('NETWORK'); return { ok: false, code: 'FAILED' }; }
      }
      case 'invite.complete': {
        const c = decodeCode(String(a.code ?? ''), 'reply');
        if (!c.ok) return { ok: false, code: c.code };
        const p = this.invite;
        if (!p || p.state !== 'connecting') return { ok: false, code: 'NO_INVITE' };
        if (c.body.id === this.d.me.id) return { ok: false, code: 'SELF' };
        const f = this.friend(c.body.id);
        if (f && f.pub !== c.body.pub) return { ok: false, code: 'FAILED' };
        p.expect(c.body.id, c.body.pub);
        try { await p.accept(c.body.sdp); } catch { p.close('NETWORK'); return { ok: false, code: 'FAILED' }; }
        return { ok: true };
      }
      case 'invite.cancel': this.invite?.close('BYE'); this.invite = null; this.emit(); return { ok: true };
      case 'settings': if (typeof a.stun === 'boolean') { this.s.settings.stun = a.stun; this.save(); this.emit(); } return { ok: true };
      case 'send': {
        const ch = String(a.ch ?? ''), to = String(a.to ?? '*');
        if (!/^[a-z0-9.-]{1,24}$/.test(ch)) return { ok: false, code: 'FORMAT' };
        let n = 0;
        for (const f of this.s.friends) if (to === '*' || to === f.id) { const p = this.ready(f.id); if (p && p.send({ t: 'app', ch, data: a.data })) n++; }
        return { ok: true, value: n };
      }
      case 'profile.push': { let n = 0; for (const f of this.s.friends) { const p = this.ready(f.id); if (p && (await this.sendProfile(p, 'profile'))) n++; } return { ok: true, value: n }; }
      default: return { ok: false, code: 'UNKNOWN_OP' };
    }
  }
  private async onPage(m: unknown) {
    const r = m as { kind?: string; rid?: string; op?: string; args?: Record<string, unknown> } | null;
    if (!r || r.kind !== 'req' || typeof r.rid !== 'string' || typeof r.op !== 'string') return;
    const res = await this.op(r.op, r.args ?? {}).catch(() => ({ ok: false as const, code: 'FAILED' as const }));
    this.d.channel.postMessage({ kind: 'res', rid: r.rid, ...res });
  }
}
