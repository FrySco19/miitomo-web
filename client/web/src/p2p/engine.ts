/**
 * P2P ENGINE — runs in the account's hidden page (p2p.html) of the desktop app, so connections and the shared-room
 * session survive the game page reloading (launcher → Classic → Reboot). The game pages talk to it on a
 * BroadcastChannel (same origin, same account partition): requests (op), casts (frequent, no answer) and events.
 *
 * Friends (NEW: the original friends were on Nintendo's server) — added ONCE, kept in the account (localStorage
 * `mtw.p2p.v1`), pinned to their public key (the same id with another key is refused: KEY_CHANGED):
 *   nearby (LAN)     players of the same network appear by themselves (UDP, desktop/lib/lan.cjs); "Add" sends a request
 *   personal code    MTW-XXXX-XXXX-XXXX through OUR presence server (server/signal, optional): the request waits for an
 *                    offline friend; once accepted both keep each other
 *   invite codes     one-off codes with no server (MTWI1 / MTWR1): kept as an alternative
 * Finding a friend again (no codes): on the LAN by the beacons; over the internet through the presence server, which
 * also carries the WebRTC set-up (signaling). The connection itself is direct (STUN), or relayed by TURN when the
 * networks do not allow a direct one (credentials from the server, short-lived). The smaller id calls, the other waits.
 * Presence (online / busy / in a room) travels on the direct link ('pres') and through the server.
 * Shared room: session.ts (inside this engine). Profiles from peers are untrusted (sanitized by the game).
 */
import { Peer, Identity, CloseReason } from './Peer';
import type { Wire } from './protocol';
import { PEER_ID, PUB } from './protocol';
import { encodeCode, decodeCode } from './codes';
import { SignalLink, SignalState, Presence } from './signal';
import { SessionManager } from './session';

export const P2P_KEY = 'mtw.p2p.v1';
export const P2P_CHANNEL = 'mtw-p2p';
export const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
const MAX_PEERS = 32, MAX_STRANGERS = 8, STRANGER_MS = 120_000, PROFILE_MAX = 6000, RECONNECT_MS = 8000;
const CODE_RE = /^MTW-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

export type FriendVia = 'lan' | 'invite' | 'server';
export interface FriendRec { id: string; pub: string; name: string; profile: unknown; since: string; lastSeen: string | null; via: FriendVia }
export interface RequestRec { id: string; pub: string; name: string; profile: unknown; at: string; via?: 'lan' | 'server' }
interface Store { v: 1; friends: FriendRec[]; incoming: RequestRec[]; outgoing: { id: string; name: string; at: string; via?: 'lan' | 'server'; pub?: string }[]; settings: { stun: boolean; server: string; busy: boolean; relayOnly: boolean } }
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
  /** Presence server URL given by the app (config / MTW_SIGNAL); the user's own setting wins. */
  defaultServer?: string;
  /** WebSocket implementation (tests). */
  WebSocket?: new (url: string) => WebSocket;
}
export type P2PError = 'NO_MII' | 'OFFLINE' | 'NOT_FOUND' | 'ALREADY_FRIENDS' | 'FORMAT' | 'KIND' | 'EXPIRED' | 'SELF' | 'NO_INVITE' | 'FAILED' | 'LIMIT' | 'UNKNOWN_OP' | 'NO_SERVER';
export type PresenceStatus = 'offline' | 'online' | 'busy' | 'in-room';
export interface P2PState {
  me: { id: string; code: string; name: string };
  lan: 'off' | 'on' | 'error';
  server: { url: string; state: SignalState; why: string };
  friends: { id: string; name: string; online: boolean; since: string; lastSeen: string | null; via: FriendVia; nearby: boolean; presence: PresenceStatus; room: { host: string | null; joinable: boolean } | null; reachable: 'direct' | 'lan' | 'server' | 'none'; route: string | null }[];
  nearby: { id: string; name: string; code: string; friend: boolean; requested: boolean }[];
  incoming: { id: string; name: string; at: string; via: 'lan' | 'server' }[];
  outgoing: { id: string; name: string; at: string; via: 'lan' | 'server' }[];
  invite: 'none' | 'waiting';
  settings: { stun: boolean; server: string; busy: boolean; relayOnly: boolean };
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
  private link: SignalLink | null = null;
  private serverIce: RTCIceServer[] | null = null;
  /** Presence as heard from the server (mutual friends) and on the direct link. */
  private presence = new Map<string, Presence>();
  private direct = new Map<string, { status: PresenceStatus; room: Presence['room'] }>();
  private timers: number[] = [];
  readonly mp: SessionManager;
  readonly log: string[] = [];

  constructor(private d: EngineDeps) {
    let raw: Partial<Store> | null = null;
    try { raw = JSON.parse(d.kv?.getItem(P2P_KEY) ?? 'null'); } catch { raw = null; }
    const ok = (f: { id?: unknown; pub?: unknown }) => typeof f?.id === 'string' && PEER_ID.test(f.id) && typeof f.pub === 'string' && PUB.test(f.pub);
    const st = (raw?.settings ?? {}) as Partial<Store['settings']>;
    this.s = {
      v: 1,
      friends: Array.isArray(raw?.friends) ? raw!.friends.filter(ok) : [],
      incoming: Array.isArray(raw?.incoming) ? raw!.incoming.filter(ok).slice(0, 50) : [],
      outgoing: Array.isArray(raw?.outgoing) ? raw!.outgoing.filter((o) => typeof o?.id === 'string' && PEER_ID.test(o.id)).slice(0, 50) : [],
      settings: { stun: st.stun !== false, server: typeof st.server === 'string' ? st.server.slice(0, 200) : '', busy: !!st.busy, relayOnly: !!st.relayOnly },
    };
    this.mp = new SessionManager({
      me: () => ({ id: this.d.me.id, name: this.d.me.name }),
      myProfile: () => this.d.profile(),
      isFriend: (id) => !!this.friend(id),
      friendName: (id) => this.friend(id)?.name ?? id.slice(4, 10),
      friendProfile: (id) => this.friend(id)?.profile ?? null,
      connected: (id) => !!this.ready(id),
      send: (id, m) => this.ready(id)?.send({ t: 'mp', m }) ?? false,
      emit: (e) => this.d.channel.postMessage({ kind: 'ev', ...e }),
      status: () => this.pushPresence(),
      now: () => Date.now(),
      log: (m) => this.note(m),
    });
    d.channel.addEventListener('message', (e) => { void this.onPage(e.data); });
  }
  private note(m: string) { this.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`); if (this.log.length > 300) this.log.shift(); }
  private save() { try { this.d.kv?.setItem(P2P_KEY, JSON.stringify(this.s)); } catch { /* memory only */ } }
  /** ICE: the server's (STUN + short-lived TURN) when connected to one, else public STUN (setting), else none (LAN). */
  private ice(): RTCIceServer[] { if (this.serverIce?.length) return this.serverIce; return this.s.settings.stun ? STUN : []; }
  friend(id: string) { return this.s.friends.find((f) => f.id === id) ?? null; }
  private ready(id: string) { const p = this.peers.get(id); return p && p.state === 'ready' ? p : null; }
  get serverUrl() { return this.s.settings.server || this.d.defaultServer || ''; }

  // ------------------------------------------------------------ lifecycle
  async start() {
    const lan = this.d.lan;
    if (lan) {
      this.unsubs.push(lan.onPeers((list) => this.onNearby(list)), lan.onSignal((m) => { void this.onSignal(m.from, m.data, 'lan'); }));
      this.lanState = (await lan.start({ name: this.d.me.name }).catch(() => false)) ? 'on' : 'error';
    }
    this.startServer();
    this.timers.push(window.setInterval(() => this.mp.tick(), 1000), window.setInterval(() => this.reconnectSweep(), RECONNECT_MS));
    this.emit();
  }
  stop() {
    this.mp.shutdown();
    for (const t of this.timers) clearInterval(t); this.timers = [];
    for (const u of this.unsubs) u(); this.unsubs = [];
    this.link?.stop(); this.link = null;
    for (const p of [...this.peers.values()]) p.close('BYE'); this.invite?.close('BYE'); void this.d.lan?.stop();
  }
  private startServer() {
    this.link?.stop(); this.link = null; this.serverIce = null; this.presence.clear();
    const url = this.serverUrl;
    if (!url) { this.emit(); return; }
    this.link = new SignalLink(url, { pub: this.d.me.pub, name: this.d.me.name, sign: (t) => this.d.me.sign(t) }, {
      welcome: (e) => { this.serverIce = e.ice.length ? e.ice : null; this.note(`server on (${e.ice.length} ICE)`); this.emit(); },
      presence: (p) => { this.presence.set(p.id, p); if (p.online) void this.maybeConnect(p.id); this.emit(); },
      signal: (from, data) => { void this.onSignal(from, data, 'server'); },
      freq: (r) => this.onServerRequest(r),
      facc: (r) => {
        if (!this.s.outgoing.some((o) => o.id === r.from)) return;
        this.addFriend({ id: r.from, pub: r.pub, name: r.name }, null, 'server');
        void this.maybeConnect(r.from);
      },
      freqSent: (r) => { this.s.outgoing = [{ id: r.to, name: r.name, at: now(), via: 'server' as const, pub: r.pub }, ...this.s.outgoing.filter((o) => o.id !== r.to)].slice(0, 50); this.save(); this.emit(); },
      error: (e) => { this.note(`server error ${e.code} ${e.ref ?? ''} ${e.to ?? ''}`); this.lastServerError = e.code; this.emit(); },
      state: (s, why) => { this.note(`server ${s} ${why}`); if (s !== 'on') this.serverIce = null; this.emit(); },
    }, this.d.WebSocket);
    this.link.setFriends(this.s.friends.map((f) => f.id));
    this.link.start();
  }
  lastServerError: string | null = null;

  /** My presence: busy (setting) / in a room (session) / online — to the server and to every connected friend. */
  private myPresence(): { status: 'online' | 'busy' | 'in-room'; room: Presence['room'] } {
    const v = this.mp.view().session;
    if (v) return { status: 'in-room', room: { host: v.host, joinable: v.role === 'host' } };
    return { status: this.s.settings.busy ? 'busy' : 'online', room: null };
  }
  private pushPresence() {
    const p = this.myPresence();
    this.link?.setStatus(p.status, p.room);
    for (const f of this.s.friends) this.ready(f.id)?.send({ t: 'pres', status: p.status, room: p.room });
    this.emit();
  }

  state(): P2PState {
    return {
      me: { id: this.d.me.id, code: this.d.me.code, name: this.d.me.name }, lan: this.lanState,
      server: { url: this.serverUrl, state: this.link?.state ?? 'off', why: this.link?.why ?? '' },
      friends: this.s.friends.map((f) => {
        const online = !!this.ready(f.id), sp = this.presence.get(f.id), dp = this.direct.get(f.id);
        const reachable = online ? 'direct' : this.nearby.has(f.id) ? 'lan' : sp?.online ? 'server' : 'none';
        const presence: PresenceStatus = online ? dp?.status ?? 'online' : sp?.online ? (sp.status as PresenceStatus) : this.nearby.has(f.id) ? 'online' : 'offline';
        const p = this.peers.get(f.id);
        return { id: f.id, name: f.name, online, since: f.since, lastSeen: f.lastSeen ?? sp?.lastSeen ?? null, via: f.via, nearby: this.nearby.has(f.id), presence, room: (online ? dp?.room : sp?.room) ?? null, reachable, route: online ? String(p?.meta.route ?? p?.meta.via ?? '') : null };
      }),
      nearby: [...this.nearby.values()].map((n) => ({ id: n.id, name: n.name, code: n.code, friend: !!this.friend(n.id), requested: this.s.outgoing.some((o) => o.id === n.id) })),
      incoming: this.s.incoming.map(({ id, name, at, via }) => ({ id, name, at, via: via ?? 'lan' })), outgoing: this.s.outgoing.map(({ id, name, at, via }) => ({ id, name, at, via: via ?? 'lan' })),
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
      iceServers: this.ice(), policy: this.s.settings.relayOnly ? 'relay' : 'all', expectId: o.expectId, expectPub: o.expectPub,
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
    void this.route(p);
    this.note(`ready ${r.id} (${f ? 'friend' : 'not a friend'}, ${p.meta.via})`);
    if (f) {
      f.lastSeen = now(); f.name = r.name || f.name; this.save(); void this.sendProfile(p, 'profile');
      const me = this.myPresence(); p.send({ t: 'pres', status: me.status, room: me.room });
      this.mp.peerUp(r.id);
    }
    else if (p.meta.invite) void this.sendProfile(p, 'facc');
    else if (this.s.outgoing.some((o) => o.id === r.id)) void this.sendProfile(p, 'freq');
    else p.meta.strangerTimer = window.setTimeout(() => { if (!this.friend(r.id) && !this.s.incoming.some((i) => i.id === r.id)) p.close('TIMEOUT'); }, STRANGER_MS);
    this.emit();
  }
  /** Which path the connection really took (host = direct LAN / public, srflx = through NAT, relay = TURN). */
  private async route(p: Peer) {
    try {
      const st = await p.pc.getStats();
      let pair: { localCandidateId?: string; remoteCandidateId?: string } | null = null;
      st.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId) ?? pair; });
      if (!pair) st.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) pair = r; });
      const loc = pair ? st.get((pair as { localCandidateId: string }).localCandidateId) : null;
      p.meta.route = loc?.candidateType ?? 'unknown';
      this.emit();
    } catch { p.meta.route = 'unknown'; }
  }
  private onClosed(p: Peer, why: CloseReason) {
    let wasFriendLink = false;
    if (p.remote && this.peers.get(p.remote.id) === p) {
      this.peers.delete(p.remote.id); this.direct.delete(p.remote.id);
      const f = this.friend(p.remote.id); if (f) { f.lastSeen = now(); this.save(); wasFriendLink = true; }
    }
    for (const [k, v] of this.peers) if (v === p) this.peers.delete(k);
    if (this.invite === p) this.invite = null;
    clearTimeout(p.meta.strangerTimer as number);
    this.note(`closed ${p.remote?.id ?? '?'} ${why}${p.problem ? ` (${p.problem})` : ''} state=${p.pc.connectionState}`); if (why !== 'BYE' && why !== 'REPLACED') for (const t of p.trace) this.note('  ' + t);
    if (wasFriendLink && p.remote) this.mp.peerDown(p.remote.id);
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
      this.s.incoming = [{ id: r.id, pub: r.pub, name: r.name, profile: m.profile, at: now(), via: 'lan' as const }, ...this.s.incoming.filter((i) => i.id !== r.id)].slice(0, 50);
      clearTimeout(p.meta.strangerTimer as number);
      this.save(); this.emit();
      return;
    }
    if (m.t === 'fdec') { this.s.outgoing = this.s.outgoing.filter((o) => o.id !== r.id); this.save(); this.emit(); p.close('BYE'); return; }
    if (m.t === 'unfriend') { if (f) { this.s.friends = this.s.friends.filter((x) => x.id !== r.id); this.save(); this.link?.setFriends(this.s.friends.map((x) => x.id)); this.emit(); } p.close('BYE'); return; }
    if (!f) return;
    if (m.t === 'pres') { this.direct.set(r.id, { status: m.status, room: m.room }); this.emit(); return; }
    if (m.t === 'mp') { this.mp.onWire(r.id, m.m); return; }
    if (m.t === 'app') this.d.channel.postMessage({ kind: 'ev', type: 'app', from: r.id, ch: m.ch, data: m.data });
  }
  private addFriend(r: { id: string; pub: string; name: string }, profile: unknown, via: FriendVia) {
    if (this.friend(r.id)) return;
    this.s.friends.push({ id: r.id, pub: r.pub, name: r.name, profile, since: now(), lastSeen: now(), via });
    this.s.outgoing = this.s.outgoing.filter((o) => o.id !== r.id);
    this.s.incoming = this.s.incoming.filter((i) => i.id !== r.id);
    const p = this.peers.get(r.id); if (p) clearTimeout(p.meta.strangerTimer as number);
    this.save(); this.note(`friend ${r.id} (${via})`);
    this.link?.setFriends(this.s.friends.map((f) => f.id));
    this.emit();
  }

  // ------------------------------------------------------------ finding friends again (LAN beacons / presence server)
  private onNearby(list: NearbyPeer[]) {
    this.nearby = new Map(list.filter((n) => PEER_ID.test(n.id) && PUB.test(n.pub)).map((n) => [n.id, n]));
    for (const n of this.nearby.values()) if (this.friend(n.id)) void this.maybeConnect(n.id);
    this.emit();
  }
  /** A friend who can be reached and is not connected: the smaller id calls (LAN first, then the server). */
  private async maybeConnect(id: string) {
    if (!this.friend(id) || this.peers.has(id) || this.d.me.id > id) return false;
    if (this.nearby.has(id) && this.d.lan) return this.connect(id, 'lan');
    if (this.link?.state === 'on' && this.presence.get(id)?.online) return this.connect(id, 'server');
    return false;
  }
  private reconnectSweep() { for (const f of this.s.friends) void this.maybeConnect(f.id); }
  private signalTo(id: string, route: 'lan' | 'server', data: unknown) {
    if (route === 'lan') return this.d.lan ? this.d.lan.signal(id, data) : Promise.resolve(false);
    return Promise.resolve(this.link?.signal(id, data) ?? false);
  }
  private async connect(id: string, route: 'lan' | 'server') {
    if (this.peers.size >= MAX_PEERS || this.peers.has(id)) return false;
    const f = this.friend(id), n = this.nearby.get(id);
    const p = this.makePeer({ expectId: id, expectPub: f?.pub ?? n?.pub ?? this.s.outgoing.find((o) => o.id === id)?.pub, meta: { initiator: true, via: route } });
    this.peers.set(id, p);
    try {
      const sdp = await p.offer();
      await this.signalTo(id, route, { k: 'offer', sdp });
      // a set-up message can be lost (UDP; a server reconnecting): send the same offer again while no answer came
      let k = 0;
      const again = window.setInterval(() => { if (p.state !== 'connecting' || p.pc.remoteDescription || ++k > 3) { clearInterval(again); return; } void this.signalTo(id, route, { k: 'offer', sdp }); }, 3000);
    } catch { p.close('NETWORK'); return false; }
    return true;
  }
  private async onSignal(from: string, data: unknown, route: 'lan' | 'server') {
    const m = data as { k?: unknown; sdp?: unknown } | null;
    if (!PEER_ID.test(from) || !m || typeof m.sdp !== 'string' || m.sdp.length > 20_000) return;
    // over the server only friends (and people I asked / who asked me) may set up a connection
    if (route === 'server' && !this.friend(from) && !this.s.outgoing.some((o) => o.id === from) && !this.s.incoming.some((i) => i.id === from)) return;
    if (m.k === 'offer') {
      const cur = this.peers.get(from);
      if (cur && cur.state === 'ready') return;
      // the same offer again (resent): answer it again, do not start over
      if (cur && !cur.meta.initiator && cur.meta.offer === m.sdp) { if (cur.pc.localDescription) void this.signalTo(from, route, { k: 'answer', sdp: cur.pc.localDescription.sdp }); return; }
      // both called at once: the smaller id's call wins
      if (cur && cur.meta.initiator && this.d.me.id < from) return;
      cur?.close('REPLACED');
      if (this.peers.size >= MAX_PEERS) return;
      const f = this.friend(from), n = this.nearby.get(from);
      const pub = f?.pub ?? n?.pub ?? this.s.outgoing.find((o) => o.id === from)?.pub ?? this.s.incoming.find((i) => i.id === from)?.pub;
      const p = this.makePeer({ expectId: from, expectPub: pub, meta: { initiator: false, via: route, offer: m.sdp } });
      this.peers.set(from, p);
      try { const sdp = await p.answer(m.sdp); await this.signalTo(from, route, { k: 'answer', sdp }); } catch { p.close('NETWORK'); }
    } else if (m.k === 'answer') {
      const p = this.peers.get(from);
      if (p && p.meta.initiator && p.state === 'connecting') { try { await p.accept(m.sdp); } catch { p.close('NETWORK'); } }
    }
  }
  private onServerRequest(r: { from: string; pub: string; name: string; at: number }) {
    if (this.friend(r.from)) { this.link?.answer(r.from, true); return; }            // already friends (e.g. re-added): confirm
    if (this.s.outgoing.some((o) => o.id === r.from)) {                              // both asked each other
      this.link?.answer(r.from, true); this.addFriend({ id: r.from, pub: r.pub, name: r.name }, null, 'server'); void this.maybeConnect(r.from); return;
    }
    this.s.incoming = [{ id: r.from, pub: r.pub, name: r.name, profile: null, at: new Date(r.at).toISOString(), via: 'server' as const }, ...this.s.incoming.filter((i) => i.id !== r.from)].slice(0, 50);
    this.save(); this.emit();
  }

  // ------------------------------------------------------------ operations asked by the game pages
  async op(op: string, a: Record<string, unknown> = {}): Promise<{ ok: true; value?: unknown } | { ok: false; code: P2PError | string }> {
    if (op.startsWith('mp.')) return this.mp.op(op, a);
    switch (op) {
      case 'state': return { ok: true, value: { state: this.state(), friends: this.friendProfiles(), mp: this.mp.view() } };
      case 'add': {
        const id = String(a.id ?? '');
        if (this.friend(id)) return { ok: false, code: 'ALREADY_FRIENDS' };
        if (!this.nearby.has(id)) return { ok: false, code: 'OFFLINE' };
        if (!(await this.d.profile())) return { ok: false, code: 'NO_MII' };
        const n = this.nearby.get(id)!;
        this.s.outgoing = [{ id, name: n.name, at: now(), via: 'lan' as const }, ...this.s.outgoing.filter((o) => o.id !== id)].slice(0, 50); this.save();
        const p = this.ready(id);
        if (p) await this.sendProfile(p, 'freq'); else await this.connect(id, 'lan');
        this.emit(); return { ok: true };
      }
      case 'friend.code': {
        // the personal code: a player nearby → the LAN request; otherwise through the presence server
        // as people type or paste it: any case, spaces / dashes / dots anywhere, with or without "MTW"
        const raw = String(a.code ?? '').toUpperCase().replace(/[^0-9A-Z]/g, ''), hex = raw.startsWith('MTW') ? raw.slice(3) : raw;
        const code = /^[0-9A-F]{12}$/.test(hex) ? `MTW-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8)}` : '';
        if (!CODE_RE.test(code)) return { ok: false, code: 'FORMAT' };
        if (code === this.d.me.code) return { ok: false, code: 'SELF' };
        if (!(await this.d.profile())) return { ok: false, code: 'NO_MII' };
        const near = [...this.nearby.values()].find((n) => n.code === code);
        if (near) return this.op('add', { id: near.id });
        if (!this.link || this.link.state !== 'on') return { ok: false, code: 'NO_SERVER' };
        this.lastServerError = null;
        this.link.friendRequest(code);
        for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 100)); if (this.lastServerError) return { ok: false, code: this.lastServerError }; if (this.s.outgoing.some((o) => o.via === 'server' && Date.now() - Date.parse(o.at) < 5000)) return { ok: true }; }
        return { ok: false, code: 'FAILED' };
      }
      case 'accept': case 'decline': {
        const id = String(a.id ?? ''), req = this.s.incoming.find((i) => i.id === id);
        if (!req) return { ok: false, code: 'NOT_FOUND' };
        if (req.via === 'server') {
          if (!this.link || this.link.state !== 'on') return { ok: false, code: 'NO_SERVER' };
          this.link.answer(id, op === 'accept');
          this.s.incoming = this.s.incoming.filter((i) => i.id !== id);
          if (op === 'accept') { this.addFriend(req, null, 'server'); void this.maybeConnect(id); } else { this.save(); this.emit(); }
          return { ok: true };
        }
        const p = this.ready(id);
        if (op === 'decline') { this.s.incoming = this.s.incoming.filter((i) => i.id !== id); this.save(); p?.send({ t: 'fdec' }); p?.close('BYE'); this.emit(); return { ok: true }; }
        if (!(await this.d.profile())) return { ok: false, code: 'NO_MII' };
        if (!p) { if (this.nearby.has(id)) void this.connect(id, 'lan'); return { ok: false, code: 'OFFLINE' }; }
        this.addFriend(req, req.profile, (p.meta.via as 'lan' | 'invite') ?? 'lan');
        await this.sendProfile(p, 'facc');
        return { ok: true };
      }
      case 'unfriend': {
        const id = String(a.id ?? '');
        if (!this.friend(id)) return { ok: false, code: 'NOT_FOUND' };
        this.ready(id)?.send({ t: 'unfriend' });
        this.s.friends = this.s.friends.filter((f) => f.id !== id); this.save();
        this.link?.setFriends(this.s.friends.map((f) => f.id));
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
      case 'settings': {
        const st = this.s.settings;
        if (typeof a.stun === 'boolean') st.stun = a.stun;
        if (typeof a.busy === 'boolean') { st.busy = a.busy; this.pushPresence(); }
        if (typeof a.relayOnly === 'boolean') st.relayOnly = a.relayOnly;
        if (typeof a.server === 'string') {
          const u = a.server.trim();
          if (u && !/^wss?:\/\/[^\s]{3,200}$/.test(u)) return { ok: false, code: 'FORMAT' };
          if (u !== st.server) { st.server = u; this.save(); this.startServer(); }
        }
        this.save(); this.emit(); return { ok: true };
      }
      case 'send': {
        const ch = String(a.ch ?? ''), to = String(a.to ?? '*');
        if (!/^[a-z0-9.-]{1,24}$/.test(ch)) return { ok: false, code: 'FORMAT' };
        let n = 0;
        for (const f of this.s.friends) if (to === '*' || to === f.id) { const p = this.ready(f.id); if (p && p.send({ t: 'app', ch, data: a.data })) n++; }
        return { ok: true, value: n };
      }
      case 'profile.push': { let n = 0; for (const f of this.s.friends) { const p = this.ready(f.id); if (p && (await this.sendProfile(p, 'profile'))) n++; } return { ok: true, value: n }; }
      case 'diag': return { ok: true, value: { log: this.log.slice(-80), mp: this.mp.stats, server: this.link?.stats ?? null, peers: [...this.peers.entries()].map(([id, p]) => ({ id, state: p.state, via: p.meta.via, route: p.meta.route ?? null, sent: p.stats.sent, received: p.stats.received })) } };
      default: return { ok: false, code: 'UNKNOWN_OP' };
    }
  }
  private async onPage(m: unknown) {
    const r = m as { kind?: string; rid?: string; op?: string; args?: Record<string, unknown>; s?: unknown; a?: unknown } | null;
    if (!r) return;
    // frequent, no answer: my own Mii's state / actions in the shared room
    if (r.kind === 'cast') { if (r.op === 'mp.av') this.mp.local(r.s); else if (r.op === 'mp.act') this.mp.localAct(r.a); return; }
    if (r.kind !== 'req' || typeof r.rid !== 'string' || typeof r.op !== 'string') return;
    const res = await this.op(r.op, r.args ?? {}).catch(() => ({ ok: false as const, code: 'FAILED' as const }));
    this.d.channel.postMessage({ kind: 'res', rid: r.rid, ...res });
  }
}
