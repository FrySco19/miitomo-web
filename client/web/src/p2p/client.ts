/**
 * P2P CLIENT — what a game page (launcher, Classic, Reboot) uses to talk to the account's P2P engine (engine.ts, in
 * the hidden p2p.html page) over a BroadcastChannel. Requests get an answer or time out (the engine may still be
 * starting); state and game data arrive as events.
 */
import { P2P_CHANNEL, P2PState, P2PError } from './engine';
import type { MpView, AvState, MpAct } from './session';

export interface P2PFriend { id: string; name: string; profile: unknown; online: boolean }
type Res = { ok: true; value?: unknown } | { ok: false; code: P2PError | 'TIMEOUT' | string };

export class P2PClient {
  private ch: BroadcastChannel;
  private waits = new Map<string, (r: Res) => void>();
  private stateSubs = new Set<(s: P2PState, f: P2PFriend[]) => void>();
  private appSubs = new Map<string, Set<(from: string, data: unknown) => void>>();
  private mpSubs = new Set<(v: MpView) => void>();
  private avSubs = new Set<(id: string, seq: number, s: AvState) => void>();
  private actSubs = new Set<(id: string, seq: number, a: MpAct) => void>();
  state: P2PState | null = null;
  /** The shared-room session as the engine sees it (null until the first answer). */
  mp: MpView | null = null;
  friends: P2PFriend[] = [];
  private n = 0;
  constructor(name = P2P_CHANNEL) {
    this.ch = new BroadcastChannel(name);
    this.ch.addEventListener('message', (e) => this.onMessage(e.data));
    void this.request('state').then((r) => { if (r.ok) { const v = r.value as { state: P2PState; friends: P2PFriend[]; mp?: MpView }; this.set(v.state, v.friends); if (v.mp) this.setMp(v.mp); } });
  }
  private set(s: P2PState, f: P2PFriend[]) {
    this.state = s; this.friends = Array.isArray(f) ? f : [];
    for (const cb of this.stateSubs) { try { cb(s, this.friends); } catch (e) { console.warn(e); } }
  }
  private setMp(v: MpView) { this.mp = v; for (const cb of this.mpSubs) { try { cb(v); } catch (e) { console.warn(e); } } }
  private onMessage(m: unknown) {
    const r = m as { kind?: string; rid?: string; type?: string; state?: P2PState; friends?: P2PFriend[]; from?: string; ch?: string; data?: unknown; view?: MpView; id?: string; seq?: number; s?: AvState; a?: MpAct } | null;
    if (!r) return;
    if (r.kind === 'ev' && r.type === 'mp' && r.view) { this.setMp(r.view); return; }
    if (r.kind === 'ev' && r.type === 'mp.av' && r.id && r.s) { for (const cb of this.avSubs) { try { cb(r.id, r.seq ?? 0, r.s); } catch (e) { console.warn(e); } } return; }
    if (r.kind === 'ev' && r.type === 'mp.act' && r.id && r.a) { for (const cb of this.actSubs) { try { cb(r.id, r.seq ?? 0, r.a); } catch (e) { console.warn(e); } } return; }
    if (r.kind === 'res' && r.rid) { const w = this.waits.get(r.rid); if (w) { this.waits.delete(r.rid); w(r as unknown as Res); } return; }
    if (r.kind === 'ev' && r.type === 'state' && r.state) this.set(r.state, r.friends ?? []);
    if (r.kind === 'ev' && r.type === 'app' && r.ch && r.from) for (const cb of this.appSubs.get(r.ch) ?? []) { try { cb(r.from, r.data); } catch (e) { console.warn(e); } }
  }
  request(op: string, args: Record<string, unknown> = {}, ms = 12_000): Promise<Res> {
    const rid = `${Date.now().toString(36)}-${++this.n}`;
    return new Promise((res) => {
      const t = setTimeout(() => { this.waits.delete(rid); res({ ok: false, code: 'TIMEOUT' }); }, ms);
      this.waits.set(rid, (r) => { clearTimeout(t); res(r); });
      this.ch.postMessage({ kind: 'req', rid, op, args });
    });
  }
  onState(cb: (s: P2PState, f: P2PFriend[]) => void) { this.stateSubs.add(cb); if (this.state) cb(this.state, this.friends); return () => this.stateSubs.delete(cb); }
  /** Game data of one feature from friends (only authenticated friends' data reaches here). */
  on(ch: string, cb: (from: string, data: unknown) => void) { let s = this.appSubs.get(ch); if (!s) this.appSubs.set(ch, (s = new Set())); s.add(cb); return () => s!.delete(cb); }
  send(ch: string, data: unknown, to: string = '*') { return this.request('send', { ch, data, to }); }
  // ---- shared room (engine session.ts)
  onMp(cb: (v: MpView) => void) { this.mpSubs.add(cb); if (this.mp) cb(this.mp); return () => this.mpSubs.delete(cb); }
  onAv(cb: (id: string, seq: number, s: AvState) => void) { this.avSubs.add(cb); return () => this.avSubs.delete(cb); }
  onAct(cb: (id: string, seq: number, a: MpAct) => void) { this.actSubs.add(cb); return () => this.actSubs.delete(cb); }
  /** My own Mii's state / an action: frequent, no answer. */
  castAv(s: AvState) { this.ch.postMessage({ kind: 'cast', op: 'mp.av', s }); }
  castAct(a: MpAct) { this.ch.postMessage({ kind: 'cast', op: 'mp.act', a }); }
  get listenerCount() { return this.stateSubs.size + this.mpSubs.size + this.avSubs.size + this.actSubs.size + [...this.appSubs.values()].reduce((n, s) => n + s.size, 0); }
  close() { this.ch.close(); this.waits.clear(); this.stateSubs.clear(); this.appSubs.clear(); this.mpSubs.clear(); this.avSubs.clear(); this.actSubs.clear(); }
}
