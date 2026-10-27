/**
 * Local accounts of the desktop app (NEW, not a Miitomo / Nintendo account). Nothing leaves this computer.
 *
 *   register  username (3–16 letters, digits, _ . -) + password (≥ 6). The password is never stored: scrypt(password,
 *             salt) is. Each account gets an Ed25519 identity key pair for peer-to-peer: the public key is the
 *             account's identity towards friends, the private key is stored encrypted with a key derived from the
 *             password (scrypt + AES-256-GCM), so only a logged-in session can sign.
 *   login     checks the password (constant-time), decrypts the private key into memory for this session.
 *   sign / verify  Ed25519 over UTF-8 text, keys as base64url (raw 32-byte public key).
 *
 * Each account also has its own storage partition (its own Miitomo save, Reboot data and P2P friends).
 * File: <userData>/accounts.json, schema v1. A corrupt file is kept aside (accounts.json.corrupt-<time>), never lost.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const USER_RE = /^[A-Za-z0-9_.-]{3,16}$/;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');
const scrypt = (pw, salt, len) => crypto.scryptSync(String(pw).normalize('NFKC'), salt, len, SCRYPT);

/** Raw 32-byte Ed25519 public key ↔ KeyObject (SPKI prefix for Ed25519). */
const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const pubFromRaw = (raw) => crypto.createPublicKey({ key: Buffer.concat([ED_SPKI, unb64u(raw)]), format: 'der', type: 'spki' });
const rawFromPub = (key) => b64u(key.export({ format: 'der', type: 'spki' }).subarray(ED_SPKI.length));
/** Short id of an identity (also the friend id in the game): p2p- + 16 hex of sha256(public key). */
const peerId = (pubRaw) => 'p2p-' + crypto.createHash('sha256').update(unb64u(pubRaw)).digest('hex').slice(0, 16);
/** Friend code shown to people: MTW-XXXX-XXXX-XXXX (from the same hash). */
const friendCode = (pubRaw) => { const h = crypto.createHash('sha256').update(unb64u(pubRaw)).digest('hex').slice(0, 12).toUpperCase(); return `MTW-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`; };

class Accounts {
  constructor(dir) {
    this.file = path.join(dir, 'accounts.json');
    this.session = null;   // { id, username, pub, priv: KeyObject }
    this.data = this.load();
  }
  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.v === 1 && Array.isArray(raw.accounts)) return { v: 1, accounts: raw.accounts.filter((a) => a && USER_RE.test(a.username) && a.id && a.pub && a.hash && a.salt && a.key), last: typeof raw.last === 'string' ? raw.last : null };
    } catch (e) {
      if (e.code !== 'ENOENT') { try { fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* read-only: start empty */ } }
    }
    return { v: 1, accounts: [], last: null };
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  /** What the login screen may show: names only. */
  list() { return { accounts: this.data.accounts.map((a) => ({ username: a.username, created: a.created })), last: this.data.last }; }
  find(username) { const u = String(username ?? '').toLowerCase(); return this.data.accounts.find((a) => a.username.toLowerCase() === u) ?? null; }

  register(username, password) {
    username = String(username ?? '').trim();
    if (!USER_RE.test(username)) return { ok: false, code: 'BAD_USERNAME' };
    if (typeof password !== 'string' || password.length < 6 || password.length > 200) return { ok: false, code: 'BAD_PASSWORD' };
    if (this.find(username)) return { ok: false, code: 'TAKEN' };
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const salt = crypto.randomBytes(16), ksalt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const kek = scrypt(password, ksalt, 32);
    const c = crypto.createCipheriv('aes-256-gcm', kek, iv);
    const enc = Buffer.concat([c.update(privateKey.export({ format: 'der', type: 'pkcs8' })), c.final()]);
    const pub = rawFromPub(publicKey);
    const acct = {
      id: crypto.randomBytes(8).toString('hex'), username, created: new Date().toISOString(),
      salt: b64u(salt), hash: b64u(scrypt(password, salt, 32)),
      key: { salt: b64u(ksalt), iv: b64u(iv), tag: b64u(c.getAuthTag()), data: b64u(enc) }, pub,
    };
    this.data.accounts.push(acct); this.data.last = username;
    this.save();
    this.session = { id: acct.id, username, pub, priv: privateKey };
    return { ok: true, account: this.current() };
  }
  login(username, password) {
    const a = this.find(username);
    // same work whether the user exists or not (no timing hint about names)
    const salt = a ? unb64u(a.salt) : crypto.randomBytes(16);
    const got = scrypt(password ?? '', salt, 32);
    if (!a || !crypto.timingSafeEqual(got, unb64u(a.hash))) return { ok: false, code: 'WRONG' };
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', scrypt(password, unb64u(a.key.salt), 32), unb64u(a.key.iv));
      d.setAuthTag(unb64u(a.key.tag));
      const der = Buffer.concat([d.update(unb64u(a.key.data)), d.final()]);
      const priv = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
      if (rawFromPub(crypto.createPublicKey(priv)) !== a.pub) return { ok: false, code: 'CORRUPT' };
      this.session = { id: a.id, username: a.username, pub: a.pub, priv };
    } catch { return { ok: false, code: 'CORRUPT' }; }
    this.data.last = a.username; this.save();
    return { ok: true, account: this.current() };
  }
  logout() { this.session = null; }
  /** Changes the password: the private key is re-encrypted (same identity, friends keep recognising you). */
  changePassword(oldPw, newPw) {
    const s = this.session; if (!s) return { ok: false, code: 'NOT_LOGGED_IN' };
    const a = this.data.accounts.find((x) => x.id === s.id);
    if (!crypto.timingSafeEqual(scrypt(oldPw ?? '', unb64u(a.salt), 32), unb64u(a.hash))) return { ok: false, code: 'WRONG' };
    if (typeof newPw !== 'string' || newPw.length < 6 || newPw.length > 200) return { ok: false, code: 'BAD_PASSWORD' };
    const salt = crypto.randomBytes(16), ksalt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', scrypt(newPw, ksalt, 32), iv);
    const enc = Buffer.concat([c.update(s.priv.export({ format: 'der', type: 'pkcs8' })), c.final()]);
    Object.assign(a, { salt: b64u(salt), hash: b64u(scrypt(newPw, salt, 32)), key: { salt: b64u(ksalt), iv: b64u(iv), tag: b64u(c.getAuthTag()), data: b64u(enc) } });
    this.save();
    return { ok: true };
  }
  current() { const s = this.session; return s ? { id: s.id, username: s.username, pub: s.pub, peerId: peerId(s.pub), code: friendCode(s.pub) } : null; }
  sign(text) { if (!this.session) return null; return b64u(crypto.sign(null, Buffer.from(String(text), 'utf8'), this.session.priv)); }
  static verify(pubRaw, text, sig) {
    try { return crypto.verify(null, Buffer.from(String(text), 'utf8'), pubFromRaw(pubRaw), unb64u(sig)); } catch { return false; }
  }
}

module.exports = { Accounts, peerId, friendCode, USER_RE };
