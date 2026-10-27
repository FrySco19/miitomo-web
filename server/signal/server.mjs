/**
 * Miitomo Web — presence + signaling server (NEW, not original; the original friends lived on Nintendo's server).
 *
 * What it does, and nothing else:
 *   identity    a client proves it owns its account key (Ed25519 signature over a fresh challenge); its id and personal
 *               code are derived from that key exactly like the desktop app does (desktop/lib/accounts.cjs)
 *   presence    who is online and their status (online / busy / in-room) — shown ONLY to mutual friends (both clients
 *               list each other in `friends`)
 *   friends     a friend request by personal code (MTW-XXXX-XXXX-XXXX) and its answer; kept for an offline user and
 *               delivered at their next connection (30 days)
 *   signaling   WebRTC set-up messages (offer / answer) between mutual friends only; the game data never goes through
 *               here (it flows on the encrypted peer-to-peer channel)
 *   ICE         STUN servers, and TURN credentials made per user for TURN_TTL seconds with the coturn REST scheme
 *               (username "<expiry>:<id>", password base64(HMAC-SHA1(TURN_SECRET, username))) — the secret stays here
 *
 * No game data, no Mii, no posts are stored: only id, public key, display name, code, last seen, pending requests.
 * Config (environment): PORT (8787), HOST (0.0.0.0), DATA_DIR (./data), STUN_URLS ("stun:stun.l.google.com:19302"),
 * TURN_URLS (e.g. "turn:turn.example.org:3478?transport=udp,turns:turn.example.org:5349"), TURN_SECRET, TURN_TTL (86400).
 * Run: node server.mjs   (behind TLS — wss:// — in production; see docs/desktop/MULTIPLAYER.md)
 */
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

export const PROTOCOL = 1;
const MAX_MSG = 64 * 1024, MAX_FRIENDS = 1000, PENDING_DAYS = 30, MAX_PENDING = 100;
const ID = /^p2p-[0-9a-f]{16}$/, PUB = /^[A-Za-z0-9_-]{43}$/, CODE = /^MTW-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;
const STATUS = new Set(['online', 'busy', 'in-room']);

const unb64u = (s) => Buffer.from(String(s), 'base64url');
const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
export const peerIdOf = (pub) => 'p2p-' + crypto.createHash('sha256').update(unb64u(pub)).digest('hex').slice(0, 16);
export const codeOf = (pub) => { const h = crypto.createHash('sha256').update(unb64u(pub)).digest('hex').slice(0, 12).toUpperCase(); return `MTW-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`; };
const verify = (pub, text, sig) => { try { return crypto.verify(null, Buffer.from(text, 'utf8'), crypto.createPublicKey({ key: Buffer.concat([ED_SPKI, unb64u(pub)]), format: 'der', type: 'spki' }), unb64u(sig)); } catch { return false; } };
/** The text a client signs to log in: domain-separated from the peer handshake ("mtw-hs1|…"). */
export const authText = (nonce) => `mtw-signal-auth|v${PROTOCOL}|${nonce}`;
/** coturn "use-auth-secret" credentials (TURN REST API draft). */
export function turnCredentials(secret, id, ttl, now = Date.now()) {
  const username = `${Math.floor(now / 1000) + ttl}:${id}`;
  return { username, credential: crypto.createHmac('sha1', secret).update(username).digest('base64') };
}

export function startSignalServer(opts = {}) {
  const cfg = {
    port: Number(opts.port ?? process.env.PORT ?? 8787), host: opts.host ?? process.env.HOST ?? '0.0.0.0',
    dataDir: opts.dataDir ?? process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'data'),
    stun: (opts.stun ?? process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean),
    turn: (opts.turn ?? process.env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    turnSecret: opts.turnSecret ?? process.env.TURN_SECRET ?? '', turnTtl: Number(opts.turnTtl ?? process.env.TURN_TTL ?? 86400),
    log: opts.log ?? ((m) => console.log(new Date().toISOString(), m)),
  };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const FILE = path.join(cfg.dataDir, 'registry.json');
  /** users: id → { pub, name, code, lastSeen }; pending: id → [{ kind: 'freq' | 'facc', from, pub, name, at }] */
  let db = { v: 1, users: {}, pending: {} };
  try { const r = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (r && r.v === 1) db = { v: 1, users: r.users ?? {}, pending: r.pending ?? {} }; } catch { /* first start */ }
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { cfg.log(`save failed: ${e.message}`); } }, 200); };
  const flush = () => { clearTimeout(saveT); try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); } catch { /* */ } };

  /** id → live connection state */
  const live = new Map();
  const stats = { connections: 0, auths: 0, signals: 0, refused: 0 };
  const mutual = (a, b) => { const x = live.get(a), y = live.get(b); return !!x && !!y && x.friends.has(b) && y.friends.has(a); };
  const send = (c, m) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); };
  const ice = (id) => {
    const out = cfg.stun.length ? [{ urls: cfg.stun }] : [];
    if (cfg.turn.length && cfg.turnSecret) out.push({ urls: cfg.turn, ...turnCredentials(cfg.turnSecret, id, cfg.turnTtl) });
    return out;
  };
  const presenceOf = (id) => { const c = live.get(id); return c ? { id, online: true, status: c.status, room: c.room } : { id, online: false, status: 'offline', room: null, lastSeen: db.users[id]?.lastSeen ?? null }; };
  /** Tells `id`'s mutual friends that its presence changed (and `id` about theirs when `both`). */
  const announce = (id, both = false) => {
    const me = live.get(id);
    for (const c of live.values()) {
      if (c.id === id) continue;
      const knows = c.friends.has(id) && (me ? me.friends.has(c.id) : true);
      if (knows) send(c, { t: 'presence', ...presenceOf(id) });
      if (both && me && mutual(id, c.id)) send(me, { t: 'presence', ...presenceOf(c.id) });
    }
  };
  const deliverPending = (c) => {
    const now = Date.now(), keep = [];
    for (const p of db.pending[c.id] ?? []) { if (now - p.at > PENDING_DAYS * 864e5) continue; send(c, { t: p.kind, from: p.from, pub: p.pub, name: p.name, at: p.at }); if (p.kind === 'freq') keep.push(p); }
    // requests stay until answered (a refresh shows them again); acceptances are delivered once
    if (keep.length) db.pending[c.id] = keep; else delete db.pending[c.id];
    save();
  };
  const queue = (to, item) => {
    const l = (db.pending[to] ??= []).filter((p) => !(p.kind === item.kind && p.from === item.from));
    l.push(item); db.pending[to] = l.slice(-MAX_PENDING); save();
  };

  const http = createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, protocol: PROTOCOL, online: live.size, users: Object.keys(db.users).length })); return; }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server: http, path: '/v1', maxPayload: MAX_MSG });
  wss.on('connection', (ws, req) => {
    stats.connections++;
    const nonce = crypto.randomBytes(18).toString('base64url');
    const c = { ws, id: null, pub: null, name: '', friends: new Set(), status: 'online', room: null, rate: { t: Date.now(), n: 0 }, ip: req.socket.remoteAddress };
    send(c, { t: 'challenge', v: PROTOCOL, nonce });
    const authT = setTimeout(() => { if (!c.id) ws.close(4001, 'auth timeout'); }, 10_000);
    ws.on('message', (buf) => {
      const now = Date.now(); if (now - c.rate.t > 1000) { c.rate.t = now; c.rate.n = 0; }
      if (++c.rate.n > 60) { stats.refused++; return; }                     // 60 messages / s per connection
      let m; try { m = JSON.parse(buf.toString('utf8')); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      if (!c.id) {
        if (m.t !== 'auth' || typeof m.pub !== 'string' || !PUB.test(m.pub) || typeof m.sig !== 'string' || !verify(m.pub, authText(nonce), m.sig)) { send(c, { t: 'error', code: 'AUTH' }); ws.close(4003, 'auth'); return; }
        clearTimeout(authT);
        c.id = peerIdOf(m.pub); c.pub = m.pub; c.name = String(m.name ?? '').slice(0, 16);
        const old = live.get(c.id); if (old) { old.replaced = true; old.ws.close(4000, 'replaced'); }
        live.set(c.id, c); stats.auths++;
        db.users[c.id] = { pub: c.pub, name: c.name, code: codeOf(c.pub), lastSeen: new Date().toISOString() }; save();
        send(c, { t: 'welcome', v: PROTOCOL, id: c.id, code: codeOf(c.pub), ice: ice(c.id) });
        deliverPending(c);
        return;
      }
      switch (m.t) {
        case 'friends': {
          if (!Array.isArray(m.ids)) return;
          c.friends = new Set(m.ids.filter((x) => typeof x === 'string' && ID.test(x) && x !== c.id).slice(0, MAX_FRIENDS));
          announce(c.id, true);
          return;
        }
        case 'status': {
          if (STATUS.has(m.status)) c.status = m.status;
          c.room = m.room && typeof m.room === 'object' ? { host: ID.test(m.room.host) ? m.room.host : null, joinable: !!m.room.joinable } : null;
          announce(c.id);
          return;
        }
        case 'signal': {
          const to = String(m.to ?? '');
          if (!ID.test(to) || !live.has(to)) { send(c, { t: 'error', code: 'OFFLINE', to, ref: m.ref ?? null }); return; }
          if (!mutual(c.id, to)) { stats.refused++; send(c, { t: 'error', code: 'NOT_FRIENDS', to, ref: m.ref ?? null }); return; }
          stats.signals++;
          send(live.get(to), { t: 'signal', from: c.id, data: m.data });
          return;
        }
        case 'freq': {
          const code = String(m.code ?? '').toUpperCase().trim();
          if (!CODE.test(code)) { send(c, { t: 'error', code: 'FORMAT', ref: 'freq' }); return; }
          const to = Object.entries(db.users).find(([, u]) => u.code === code)?.[0];
          if (!to) { send(c, { t: 'error', code: 'NOT_FOUND', ref: 'freq' }); return; }
          if (to === c.id) { send(c, { t: 'error', code: 'SELF', ref: 'freq' }); return; }
          const item = { kind: 'freq', from: c.id, pub: c.pub, name: c.name, at: Date.now() };
          queue(to, item);
          const t = live.get(to); if (t) send(t, { t: 'freq', from: item.from, pub: item.pub, name: item.name, at: item.at });
          send(c, { t: 'freq.sent', to, name: db.users[to].name, pub: db.users[to].pub });
          return;
        }
        case 'fans': {
          const to = String(m.to ?? ''); if (!ID.test(to)) return;
          // only an answer to a request that really exists
          const mine = db.pending[c.id] ?? [], i = mine.findIndex((p) => p.kind === 'freq' && p.from === to);
          if (i < 0) { send(c, { t: 'error', code: 'NOT_FOUND', ref: 'fans' }); return; }
          mine.splice(i, 1); if (!mine.length) delete db.pending[c.id];
          if (m.accept) {
            const item = { kind: 'facc', from: c.id, pub: c.pub, name: c.name, at: Date.now() };
            const t = live.get(to); if (t) send(t, { t: 'facc', from: item.from, pub: item.pub, name: item.name, at: item.at }); else queue(to, item);
          }
          save();
          return;
        }
        case 'ice': send(c, { t: 'ice', ice: ice(c.id) }); return;
        case 'ping': send(c, { t: 'pong', at: m.at ?? null }); return;
        default: return;
      }
    });
    ws.on('close', () => {
      clearTimeout(authT);
      if (c.id && live.get(c.id) === c) {
        live.delete(c.id);
        if (db.users[c.id]) { db.users[c.id].lastSeen = new Date().toISOString(); save(); }
        if (!c.replaced) announce(c.id);
      }
    });
  });
  return new Promise((resolve) => http.listen(cfg.port, cfg.host, () => {
    const port = http.address().port;
    cfg.log(`signal server on :${port} (TURN ${cfg.turn.length && cfg.turnSecret ? 'on' : 'off'})`);
    resolve({ port, stats, live, close: () => new Promise((r) => { flush(); for (const c of live.values()) c.ws.terminate(); wss.close(); http.close(() => r()); }) });
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.TURN_URLS && !process.env.TURN_SECRET) console.warn('TURN_URLS without TURN_SECRET: TURN disabled');
  startSignalServer();
}
