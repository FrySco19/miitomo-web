/**
 * P2P — messages between two players (NEW: Miitomo had a central server; Miitomo Web has none, friends connect
 * directly). Everything that arrives from a peer is untrusted and checked here before use.
 *
 * Wire: JSON objects on one reliable WebRTC data channel ('mtw'), encrypted by WebRTC (DTLS). Large messages are
 * split in parts. The first messages are the identity handshake (hs1 / hs2); nothing else is accepted before it.
 *
 *   hs1      { pub, name, nonce }        who I say I am
 *   hs2      { sig, pub, name, nonce }   my signature over the transcript (both nonces + both DTLS fingerprints);
 *                                        it repeats hs1's fields: the very first message can be lost (sent before the
 *                                        other side's channel was open), hs2 alone is then enough
 *   freq     { profile }                 friend request (my game profile: Mii, name, outfit, room…)
 *   facc     { profile }                 request accepted (both are friends now)
 *   fdec     {}                          request declined
 *   unfriend {}                          no longer friends
 *   profile  { profile }                 my profile changed / I am back online
 *   app      { ch, data }                game data for one feature (e.g. 'feed' for MIInstagram)
 *   part     { id, i, n, d }             a piece of a large message
 */
export const MAX_MESSAGE = 2_000_000;      // a whole message (a photo post is ~100 KB)
export const PART = 15_000;                // characters per part (safe for every WebRTC stack)
export const PEER_ID = /^p2p-[0-9a-f]{16}$/;
export const PUB = /^[A-Za-z0-9_-]{43}$/;  // raw Ed25519 key, base64url

export type Wire =
  | { t: 'hs1'; pub: string; name: string; nonce: string }
  | { t: 'hs2'; sig: string; pub?: string; name?: string; nonce?: string }
  | { t: 'freq' | 'facc' | 'profile'; profile: unknown }
  | { t: 'fdec' | 'unfriend' }
  | { t: 'app'; ch: string; data: unknown }
  | { t: 'part'; id: string; i: number; n: number; d: string };

/** Shape check of a decoded message (contents of profile / data are checked by their owners). */
export function parseWire(raw: unknown): Wire | null {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hs1': return typeof m.pub === 'string' && PUB.test(m.pub) && typeof m.nonce === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(m.nonce) ? { t: 'hs1', pub: m.pub, name: String(m.name ?? '').slice(0, 16), nonce: m.nonce } : null;
    case 'hs2': {
      if (typeof m.sig !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(m.sig)) return null;
      const hello = typeof m.pub === 'string' && PUB.test(m.pub) && typeof m.nonce === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(m.nonce);
      return hello ? { t: 'hs2', sig: m.sig, pub: m.pub as string, name: String(m.name ?? '').slice(0, 16), nonce: m.nonce as string } : { t: 'hs2', sig: m.sig };
    }
    case 'freq': case 'facc': case 'profile': return m.profile && typeof m.profile === 'object' ? { t: m.t, profile: m.profile } : null;
    case 'fdec': case 'unfriend': return { t: m.t };
    case 'app': return typeof m.ch === 'string' && /^[a-z0-9.-]{1,24}$/.test(m.ch) ? { t: 'app', ch: m.ch, data: m.data } : null;
    case 'part': return typeof m.id === 'string' && m.id.length <= 24 && Number.isInteger(m.i) && Number.isInteger(m.n) && (m.n as number) > 0 && (m.n as number) <= Math.ceil(MAX_MESSAGE / PART) && (m.i as number) >= 0 && (m.i as number) < (m.n as number) && typeof m.d === 'string' ? { t: 'part', id: m.id, i: m.i as number, n: m.n as number, d: m.d } : null;
    default: return null;
  }
}

/** Splits a serialized message into parts when it is large. */
export function split(json: string, id: string): string[] {
  if (json.length <= PART) return [json];
  const n = Math.ceil(json.length / PART), out: string[] = [];
  for (let i = 0; i < n; i++) out.push(JSON.stringify({ t: 'part', id, i, n, d: json.slice(i * PART, (i + 1) * PART) }));
  return out;
}
/** Re-joins parts; returns the whole message when the last part arrives. Too large / inconsistent → dropped. */
export class Joiner {
  private bufs = new Map<string, { n: number; got: number; parts: string[] }>();
  push(p: { id: string; i: number; n: number; d: string }): string | null {
    let b = this.bufs.get(p.id);
    if (!b) { if (this.bufs.size > 8) this.bufs.delete(this.bufs.keys().next().value!); b = { n: p.n, got: 0, parts: [] }; this.bufs.set(p.id, b); }
    if (b.n !== p.n || b.parts[p.i] !== undefined) return null;
    b.parts[p.i] = p.d; b.got++;
    if (b.got < b.n) return null;
    this.bufs.delete(p.id);
    const all = b.parts.join('');
    return all.length <= MAX_MESSAGE ? all : null;
  }
}

/** The signed transcript: identical on both sides (ordered by peer id), bound to this connection's DTLS keys. */
export function transcript(a: { id: string; nonce: string; fp: string }, b: { id: string; nonce: string; fp: string }) {
  const [x, y] = a.id < b.id ? [a, b] : [b, a];
  return `mtw-hs1|${x.id}|${x.nonce}|${x.fp}|${y.id}|${y.nonce}|${y.fp}`;
}
/** DTLS certificate fingerprint of an SDP (a=fingerprint:sha-256 …). */
export function fingerprint(sdp: string | undefined | null) { return /a=fingerprint:sha-256 ([0-9A-F:]+)/i.exec(sdp ?? '')?.[1]?.toUpperCase() ?? ''; }

/** p2p- + 16 hex of sha256(raw public key): the same id the desktop app computes (desktop/lib/accounts.cjs). */
export async function peerIdOf(pub: string): Promise<string> {
  const raw = Uint8Array.from(atob(pub.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (pub.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  return 'p2p-' + [...h.slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export const randomToken = (n = 18) => { const b = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
