/**
 * P2P — one connection to one other player: a WebRTC data channel and the identity handshake on it.
 *
 * Set-up messages (offer / answer) travel by LAN UDP or by invite codes; they are whole SDPs (ICE gathering is
 * awaited, no trickle), so one message each way is enough. Once the channel opens, each side proves it owns its key:
 * it signs a transcript holding both random nonces and both DTLS certificate fingerprints, so a relayed or replayed
 * handshake fails. Only then is the peer `ready` and its id (derived from its key) trusted.
 */
import { parseWire, split, Joiner, transcript, fingerprint, peerIdOf, randomToken, Wire } from './protocol';

export interface Identity {
  id: string; pub: string; name: string;
  sign(text: string): Promise<string | null>;
  verify(pub: string, text: string, sig: string): Promise<boolean>;
}
export type PeerState = 'new' | 'connecting' | 'handshake' | 'ready' | 'closed';
export type CloseReason = 'BYE' | 'TIMEOUT' | 'BAD_HANDSHAKE' | 'MISMATCH' | 'NETWORK' | 'PROTOCOL' | 'REPLACED' | 'LIMIT';
export interface PeerOpts {
  iceServers: RTCIceServer[];
  /** 'relay' = TURN only (diagnostics / tests of the TURN path). */
  policy?: RTCIceTransportPolicy;
  /** When known (a friend, an invite): the peer must turn out to be exactly this identity. */
  expectId?: string; expectPub?: string;
  onReady(p: Peer): void;
  onMessage(p: Peer, m: Wire): void;
  onClose(p: Peer, why: CloseReason): void;
  handshakeMs?: number;
}

const GATHER_MS = 5000;

export class Peer {
  readonly pc: RTCPeerConnection;
  private ch: RTCDataChannel | null = null;
  state: PeerState = 'new';
  remote: { id: string; pub: string; name: string } | null = null;
  private claimed: { id: string; pub: string; name: string; nonce: string } | null = null;
  private nonce = randomToken();
  private joiner = new Joiner();
  private seq = 0;
  private timer = 0;
  private queue: Promise<void> = Promise.resolve();
  /** Free data for the engine (how this connection started, etc.). */
  meta: Record<string, unknown> = {};
  readonly stats = { sent: 0, received: 0 };
  /** What went wrong last (for the engine's log). */
  problem = '';
  /** Last protocol steps (kept short; for the engine's log when something goes wrong). */
  readonly trace: string[] = [];
  private tr(m: string) { this.trace.push(`${(performance.now() / 1000).toFixed(2)} ${m}`); if (this.trace.length > 20) this.trace.shift(); }

  constructor(private me: Identity, private o: PeerOpts) {
    this.pc = new RTCPeerConnection({ iceServers: o.iceServers, iceTransportPolicy: o.policy ?? 'all' });
    this.pc.addEventListener('connectionstatechange', () => { const s = this.pc.connectionState; if (s === 'failed' || s === 'closed') this.close('NETWORK'); });
    this.pc.addEventListener('datachannel', (e) => this.bind(e.channel));
  }
  private async gathered() {
    if (this.pc.iceGatheringState === 'complete') return;
    await new Promise<void>((res) => { const t = setTimeout(res, GATHER_MS); this.pc.addEventListener('icegatheringstatechange', () => { if (this.pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
  }
  /** Caller side: the whole offer SDP. */
  async offer(): Promise<string> {
    this.state = 'connecting';
    this.bind(this.pc.createDataChannel('mtw', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.gathered();
    this.arm();
    return this.pc.localDescription!.sdp;
  }
  /** Callee side: answers a received offer. */
  async answer(offerSdp: string): Promise<string> {
    this.state = 'connecting';
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this.gathered();
    this.arm();
    return this.pc.localDescription!.sdp;
  }
  /** The caller learns who answered (invite reply): from now on only that identity is accepted. */
  expect(id: string, pub: string) { this.o.expectId = id; this.o.expectPub = pub; }
  /** Caller side: the answer arrived. */
  async accept(answerSdp: string) { if (this.state === 'closed') return; await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp }); }
  /** No connection + handshake within the time limit → closed (TIMEOUT). */
  private arm() { clearTimeout(this.timer); this.timer = window.setTimeout(() => { if (this.state !== 'ready') this.close('TIMEOUT'); }, this.o.handshakeMs ?? 30_000); }

  private bind(ch: RTCDataChannel) {
    this.tr(`bind ${ch.readyState} have=${!!this.ch}`);
    if (this.ch && this.ch !== ch) { try { ch.close(); } catch { /* */ } return; }
    this.ch = ch;
    ch.addEventListener('open', () => this.hello());
    ch.addEventListener('close', () => this.close('BYE'));
    // one message at a time: the handshake awaits signatures, and order matters (hs1 before hs2)
    ch.addEventListener('message', (e) => { this.queue = this.queue.then(() => this.onData(e.data)).catch((err) => { this.problem = `error ${(err as Error)?.message}`; this.close('PROTOCOL'); }); });
  }
  private helloSent = false;
  /** Starts the handshake once: when the channel opens, or when the other side's hs1 arrives first (it can). */
  private hello() {
    this.tr(`hello sent=${this.helloSent} state=${this.state} ch=${this.ch?.readyState}`);
    if (this.helloSent || this.state === 'closed') return;
    this.helloSent = true; this.state = 'handshake';
    this.raw({ t: 'hs1', pub: this.me.pub, name: this.me.name, nonce: this.nonce });
  }
  private raw(w: Wire) {
    if (!this.ch || this.ch.readyState !== 'open') return false;
    this.tr(`send ${w.t} ch=${this.ch?.readyState}`);
    const json = JSON.stringify(w);
    try { for (const part of split(json, `${++this.seq}`)) this.ch.send(part); } catch { return false; }
    this.stats.sent++;
    return true;
  }
  /** Sends a message once the peer is authenticated. */
  send(w: Wire) { return this.state === 'ready' && this.raw(w); }

  private async onData(data: unknown) {
    if (typeof data !== 'string' || data.length > 40_000) { this.problem = `data ${typeof data}`; return this.close('PROTOCOL'); }
    let w: Wire | null; try { w = parseWire(JSON.parse(data)); } catch { w = null; }
    if (!w) { this.problem = `unparsable ${data.slice(0, 60)}`; return this.close('PROTOCOL'); }
    if (w.t === 'part') { const whole = this.joiner.push(w); if (!whole) return; try { w = parseWire(JSON.parse(whole)); } catch { w = null; } if (!w || w.t === 'part') return this.close('PROTOCOL'); }
    this.stats.received++;
    this.tr(`recv ${w.t} state=${this.state} claimed=${!!this.claimed}`);
    if ((this.state === 'connecting' || this.state === 'new') && w.t === 'hs1') this.hello();
    if (this.state === 'handshake') return this.handshake(w);
    if (this.state === 'ready' && w.t !== 'hs1' && w.t !== 'hs2') this.o.onMessage(this, w);
  }
  private async handshake(w: Wire) {
    // the other side's hs1 was lost: its hs2 carries the same fields — take them as its hs1 first (this also sends mine)
    if (w.t === 'hs2' && !this.claimed && w.pub && w.nonce) {
      await this.handshake({ t: 'hs1', pub: w.pub, name: w.name ?? '', nonce: w.nonce });
      if (this.state !== 'handshake' || !this.claimed) return;
    }
    if (w.t === 'hs1' && !this.claimed) {
      const id = await peerIdOf(w.pub);
      if (id === this.me.id || (this.o.expectId && id !== this.o.expectId) || (this.o.expectPub && w.pub !== this.o.expectPub)) return this.close('MISMATCH');
      this.claimed = { id, pub: w.pub, name: w.name, nonce: w.nonce };
      const sig = await this.me.sign(this.text());
      if (!sig) return this.close('BAD_HANDSHAKE');
      this.raw({ t: 'hs2', sig, pub: this.me.pub, name: this.me.name, nonce: this.nonce });
      return;
    }
    if (w.t === 'hs2' && this.claimed) {
      if (!(await this.me.verify(this.claimed.pub, this.text(), w.sig))) return this.close('BAD_HANDSHAKE');
      clearTimeout(this.timer);
      this.remote = { id: this.claimed.id, pub: this.claimed.pub, name: this.claimed.name };
      this.state = 'ready';
      this.o.onReady(this);
      return;
    }
    this.problem = `unexpected ${w.t} in ${this.state} (claimed: ${!!this.claimed})`;
    this.close('PROTOCOL');
  }
  private text() {
    const c = this.claimed!;
    return transcript({ id: this.me.id, nonce: this.nonce, fp: fingerprint(this.pc.localDescription?.sdp) }, { id: c.id, nonce: c.nonce, fp: fingerprint(this.pc.remoteDescription?.sdp) });
  }
  close(why: CloseReason = 'BYE') {
    if (this.state === 'closed') return;
    this.state = 'closed'; clearTimeout(this.timer);
    try { this.ch?.close(); } catch { /* */ }
    try { this.pc.close(); } catch { /* */ }
    this.o.onClose(this, why);
  }
}
