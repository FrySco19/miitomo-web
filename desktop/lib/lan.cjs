/**
 * Peer-to-peer on the local network, with no server: UDP beacons say "I am here" (identity public key, name), and the
 * same socket carries the WebRTC set-up messages (offer / answer) to one peer. The game data itself never goes
 * through UDP: it flows on the WebRTC data channel, encrypted (DTLS), after a signed identity handshake (p2p engine).
 *
 * Beacons are not trusted: anybody on the network can claim a key. Possession of the key is proven later, in the
 * handshake (signature over both nonces and both DTLS fingerprints).
 */
const dgram = require('node:dgram');
const os = require('node:os');
const { EventEmitter } = require('node:events');

const PORT = 47777, BEACON_MS = 2000, EXPIRE_MS = 7000, MAX_MSG = 60_000;
/**
 * 0.2 FIX: two copies of the game on ONE computer (two accounts) both bound 47777 with SO_REUSEADDR: beacons reached
 * both, but a set-up message sent to "that computer:47777" reached only one of the two sockets, often the wrong one,
 * which dropped it (not for me) — so two instances on one PC never connected. Now each instance binds the first free
 * port of a small range and beacons go to every port of the range (broadcast + this computer), so each copy has its
 * own address and replies go to the port the peer really uses.
 */
const SPAN = 6;

/** Broadcast addresses of the IPv4 interfaces (+ the limited broadcast). */
function broadcasts() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) {
    if (i.family !== 'IPv4' || i.internal || !i.netmask) continue;
    const a = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number);
    out.add(a.map((x, k) => (x & m[k]) | (~m[k] & 255)).join('.'));
  }
  return [...out];
}

class Lan extends EventEmitter {
  /** `opts.targets` (tests): send beacons to these host:port instead of broadcasting. */
  constructor(opts = {}) { super(); this.base = opts.port ?? PORT; this.span = opts.span ?? SPAN; this.port = null; this.targets = opts.targets ?? null; this.peers = new Map(); this.routes = new Map(); this.me = null; this.sock = null; this.timer = null; this.rate = new Map(); }
  /** Binds the first free port of base..base+span-1 (exclusive bind: one copy of the game per port). */
  bindFree() {
    return new Promise((resolve) => {
      const tryPort = (k) => {
        if (k >= this.span) { resolve(null); return; }
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: false });
        s.once('error', () => { try { s.close(); } catch { /* */ } tryPort(k + 1); });
        s.bind(this.base + k, () => { s.removeAllListeners('error'); resolve(s); });
      };
      tryPort(0);
    });
  }
  /** Where beacons go: the test targets, or every port of the range on every broadcast address and on this computer. */
  dests() {
    if (this.targets) return this.targets;
    const out = [];
    for (const h of [...broadcasts(), '127.0.0.1']) for (let k = 0; k < this.span; k++) if (h !== '127.0.0.1' || this.base + k !== this.port) out.push({ host: h, port: this.base + k });
    return out;
  }
  /** me = { id, pub, name, code }. */
  start(me) {
    this.me = { id: String(me.id), pub: String(me.pub), name: String(me.name ?? '').slice(0, 16), code: String(me.code ?? '') };
    if (this.sock) return Promise.resolve(true);
    return this.bindFree().then((s) => {
      if (!s) { this.emit('error', `no free UDP port in ${this.base}..${this.base + this.span - 1}`); return false; }
      s.on('error', (e) => { this.emit('error', e.message); });
      s.on('message', (buf, rinfo) => this.onMessage(buf, rinfo));
      try { s.setBroadcast(true); } catch { /* */ }
      this.sock = s; this.port = s.address().port;
      this.beacon(); this.timer = setInterval(() => { this.beacon(); this.expire(); }, BEACON_MS);
      return true;
    });
  }
  stop() {
    clearInterval(this.timer); this.timer = null;
    if (this.sock) { try { this.send(null, { t: 'bye' }); this.sock.close(); } catch { /* */ } }
    this.sock = null; this.peers.clear(); this.emit('peers', []);
  }
  beacon() {
    if (!this.sock || !this.me) return;
    const msg = Buffer.from(JSON.stringify({ v: 1, t: 'hello', ...this.me }));
    for (const d of this.dests()) this.sock.send(msg, d.port, d.host, () => { /* unreachable networks are fine */ });
  }
  expire() {
    const now = Date.now(); let changed = false;
    for (const [id, p] of this.peers) if (now - p.seen > EXPIRE_MS) { this.peers.delete(id); changed = true; }
    if (changed) this.emit('peers', this.list());
  }
  list() { return [...this.peers.values()].map(({ id, pub, name, code }) => ({ id, pub, name, code })); }
  onMessage(buf, rinfo) {
    if (buf.length > MAX_MSG) return;
    // at most 50 messages a second from one address
    const k = rinfo.address + ':' + rinfo.port, now = Date.now(), r = this.rate.get(k) ?? { t: now, n: 0 };
    if (now - r.t > 1000) { r.t = now; r.n = 0; } if (++r.n > 50) return; this.rate.set(k, r);
    let m; try { m = JSON.parse(buf.toString('utf8')); } catch { return; }
    if (!m || m.v !== 1 || typeof m.id !== 'string' || !/^p2p-[0-9a-f]{16}$/.test(m.id) || (this.me && m.id === this.me.id)) return;
    if (m.t === 'hello' && typeof m.pub === 'string' && m.pub.length < 64) {
      const known = this.peers.get(m.id);
      this.peers.set(m.id, { id: m.id, pub: m.pub, name: String(m.name ?? '').slice(0, 16), code: String(m.code ?? '').slice(0, 20), host: rinfo.address, port: rinfo.port, seen: now });
      if (!known || known.name !== m.name) this.emit('peers', this.list());
    } else if (m.t === 'bye') {
      if (this.peers.delete(m.id)) this.emit('peers', this.list());
    } else if (m.t === 'sig' && this.me && m.to === this.me.id && m.data && typeof m.data === 'object') {
      // the reply goes back where the message came from, even before that peer's first beacon arrived here
      this.routes.set(m.id, { host: rinfo.address, port: rinfo.port, seen: now });
      if (this.routes.size > 64) this.routes.delete(this.routes.keys().next().value);
      const p = this.peers.get(m.id);
      if (p) { p.host = rinfo.address; p.port = rinfo.port; }
      this.emit('signal', { from: m.id, data: m.data });
    }
  }
  /** Sends a set-up message to one peer (null = everyone: only for "bye"). */
  send(peerId, payload) {
    if (!this.sock || !this.me) return false;
    const body = Buffer.from(JSON.stringify({ v: 1, id: this.me.id, to: peerId, ...payload }));
    if (body.length > MAX_MSG) return false;
    if (peerId === null) { for (const d of this.dests()) this.sock.send(body, d.port, d.host, () => {}); return true; }
    const p = this.peers.get(peerId) ?? this.routes.get(peerId); if (!p) return false;
    this.sock.send(body, p.port, p.host, () => {});
    return true;
  }
  signal(peerId, data) { return this.send(peerId, { t: 'sig', data }); }
}
module.exports = { Lan, PORT };
