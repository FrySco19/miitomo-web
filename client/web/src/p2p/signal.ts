/**
 * The P2P engine's link to OUR presence / signaling server (server/signal, optional). Over the internet two friends
 * cannot find each other without a meeting point: the server says who is online (mutual friends only), carries friend
 * requests by personal code and the WebRTC set-up messages, and hands out STUN / short-lived TURN credentials. The game
 * data never goes through it. Without a server URL the engine works as before (LAN + invite codes).
 *
 * Login = the account key signs the server's fresh challenge (text "mtw-signal-auth|v1|<nonce>", domain-separated from
 * the peer handshake). The link reconnects by itself (1 s → 30 s backoff) and re-sends friends + status each time.
 */
export type SignalState = 'off' | 'connecting' | 'on' | 'error';
export interface Presence { id: string; online: boolean; status: string; room: { host: string | null; joinable: boolean } | null; lastSeen?: string | null }
export interface FriendNote { from: string; pub: string; name: string; at: number }
export interface SignalEvents {
  welcome(e: { id: string; code: string; ice: RTCIceServer[] }): void;
  presence(p: Presence): void;
  signal(from: string, data: unknown): void;
  freq(r: FriendNote): void;
  facc(r: FriendNote): void;
  freqSent(r: { to: string; name: string; pub: string }): void;
  error(e: { code: string; to?: string; ref?: string | null }): void;
  state(s: SignalState, why: string): void;
}
export interface SignalMe { pub: string; name: string; sign(text: string): Promise<string | null> }
type WsCtor = new (url: string) => WebSocket;

export const authText = (nonce: string) => `mtw-signal-auth|v1|${nonce}`;
const ID = /^p2p-[0-9a-f]{16}$/;

export class SignalLink {
  state: SignalState = 'off';
  why = '';
  private ws: WebSocket | null = null;
  private stopped = true;
  private backoff = 1000;
  private timer = 0;
  private friends: string[] = [];
  private status: { status: string; room: Presence['room'] } = { status: 'online', room: null };
  readonly stats = { connects: 0, signalsOut: 0, signalsIn: 0 };
  constructor(readonly url: string, private me: SignalMe, private ev: SignalEvents, private Ws: WsCtor = WebSocket) {}

  private set(s: SignalState, why = '') { this.state = s; this.why = why; this.ev.state(s, why); }
  start() { if (!this.stopped) return; this.stopped = false; this.open(); }
  stop() { this.stopped = true; clearTimeout(this.timer); try { this.ws?.close(); } catch { /* */ } this.ws = null; this.set('off'); }
  private retry(why: string) {
    this.ws = null;
    if (this.stopped) return;
    this.set('error', why);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.open(), this.backoff);
    this.backoff = Math.min(30_000, this.backoff * 2);
  }
  private open() {
    if (this.stopped) return;
    let ws: WebSocket;
    try { ws = new this.Ws(this.url); } catch (e) { this.retry(`URL non valido: ${(e as Error).message}`); return; }
    this.ws = ws; this.set('connecting');
    ws.addEventListener('message', (e) => { void this.onMessage(ws, e.data); });
    ws.addEventListener('close', (e) => { if (this.ws === ws) this.retry(e.code === 4003 ? 'accesso rifiutato (firma)' : e.code === 4000 ? 'sostituito da un altro accesso' : `chiuso (${e.code})`); });
    ws.addEventListener('error', () => { /* close follows */ });
  }
  private send(m: unknown) { if (this.ws && this.ws.readyState === 1 && this.state === 'on') { this.ws.send(JSON.stringify(m)); return true; } return false; }
  private async onMessage(ws: WebSocket, raw: unknown) {
    if (ws !== this.ws || typeof raw !== 'string' || raw.length > 70_000) return;
    let m: Record<string, unknown>; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'challenge' && typeof m.nonce === 'string') {
      const sig = await this.me.sign(authText(m.nonce));
      if (!sig) { ws.close(); this.retry('firma non disponibile'); return; }
      ws.send(JSON.stringify({ t: 'auth', pub: this.me.pub, name: this.me.name, sig }));
      return;
    }
    if (m.t === 'welcome') {
      this.backoff = 1000; this.stats.connects++;
      this.set('on');
      this.ev.welcome({ id: String(m.id), code: String(m.code), ice: Array.isArray(m.ice) ? (m.ice as RTCIceServer[]) : [] });
      this.send({ t: 'friends', ids: this.friends });
      this.send({ t: 'status', ...this.status });
      return;
    }
    if (m.t === 'presence' && typeof m.id === 'string' && ID.test(m.id)) { this.ev.presence({ id: m.id, online: !!m.online, status: String(m.status ?? 'offline'), room: (m.room as Presence['room']) ?? null, lastSeen: (m.lastSeen as string) ?? null }); return; }
    if (m.t === 'signal' && typeof m.from === 'string' && ID.test(m.from)) { this.stats.signalsIn++; this.ev.signal(m.from, m.data); return; }
    if ((m.t === 'freq' || m.t === 'facc') && typeof m.from === 'string' && ID.test(m.from) && typeof m.pub === 'string') { this.ev[m.t]({ from: m.from, pub: m.pub, name: String(m.name ?? '').slice(0, 16), at: Number(m.at) || Date.now() }); return; }
    if (m.t === 'freq.sent' && typeof m.to === 'string') { this.ev.freqSent({ to: m.to, name: String(m.name ?? ''), pub: String(m.pub ?? '') }); return; }
    if (m.t === 'error') this.ev.error({ code: String(m.code), to: m.to as string | undefined, ref: (m.ref as string) ?? null });
  }
  setFriends(ids: string[]) { this.friends = [...ids]; this.send({ t: 'friends', ids: this.friends }); }
  setStatus(status: string, room: Presence['room']) { this.status = { status, room }; this.send({ t: 'status', status, room }); }
  signal(to: string, data: unknown) { const ok = this.send({ t: 'signal', to, data }); if (ok) this.stats.signalsOut++; return ok; }
  friendRequest(code: string) { return this.send({ t: 'freq', code }); }
  answer(to: string, accept: boolean) { return this.send({ t: 'fans', to, accept }); }
}
