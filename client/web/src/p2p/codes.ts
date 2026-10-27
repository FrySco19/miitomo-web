/**
 * P2P invite codes — connecting over the internet with no server: player A makes an INVITE code (a WebRTC offer),
 * sends it to B any way they like (chat, mail); B pastes it and gets a REPLY code (the answer) to send back; A pastes
 * the reply and the two are connected. Codes are compressed and expire after 15 minutes.
 * A code contains network addresses (local and public IP, as WebRTC sees them): share it only with your friend.
 */
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import { PEER_ID, PUB } from './protocol';

export const CODE_PREFIX = { invite: 'MTWI1.', reply: 'MTWR1.' } as const;
export const CODE_TTL_MS = 15 * 60_000;
export interface CodeBody { kind: 'invite' | 'reply'; id: string; pub: string; name: string; sdp: string; at: number; /** reply only: the invite it answers */ ref?: string }

const b64u = (u: Uint8Array) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

export function encodeCode(b: CodeBody): string {
  return CODE_PREFIX[b.kind] + b64u(deflateSync(strToU8(JSON.stringify(b)), { level: 9 }));
}
export type CodeError = 'FORMAT' | 'KIND' | 'EXPIRED';
/** Reads a pasted code (spaces / line breaks from chat apps are ignored). */
export function decodeCode(text: string, want: 'invite' | 'reply', now = Date.now()): { ok: true; body: CodeBody } | { ok: false; code: CodeError } {
  const s = String(text ?? '').replace(/\s+/g, '');
  const kind = s.startsWith(CODE_PREFIX.invite) ? 'invite' : s.startsWith(CODE_PREFIX.reply) ? 'reply' : null;
  if (!kind) return { ok: false, code: 'FORMAT' };
  if (kind !== want) return { ok: false, code: 'KIND' };
  let b: CodeBody;
  try {
    const raw = s.slice(CODE_PREFIX[kind].length);
    if (raw.length > 12_000) return { ok: false, code: 'FORMAT' };
    b = JSON.parse(strFromU8(inflateSync(unb64u(raw))));
  } catch { return { ok: false, code: 'FORMAT' }; }
  if (!b || b.kind !== kind || !PEER_ID.test(b.id) || !PUB.test(b.pub) || typeof b.sdp !== 'string' || b.sdp.length > 20_000 || !/^v=0/.test(b.sdp) || typeof b.at !== 'number') return { ok: false, code: 'FORMAT' };
  if (now - b.at > CODE_TTL_MS || b.at - now > 5 * 60_000) return { ok: false, code: 'EXPIRED' };
  return { ok: true, body: { kind, id: b.id, pub: b.pub, name: String(b.name ?? '').slice(0, 16), sdp: b.sdp, at: b.at, ...(typeof b.ref === 'string' ? { ref: b.ref.slice(0, 40) } : {}) } };
}
