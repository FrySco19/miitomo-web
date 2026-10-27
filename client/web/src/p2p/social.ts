/**
 * The game's friends in the desktop app = the friends made on this device (LocalProvider, M16) + the real friends
 * connected peer-to-peer. A P2P friend is their own Mii, name, greetings, outfit and room as THEY sent it (sanitized
 * like any untrusted profile); the original friend features (watch their room, invite them as a guest) work with it.
 * Their profile cannot be edited here; removing them ends the friendship on both sides; visits are counted locally.
 */
import { sanitizeFriend, FriendProfile, SocialProvider } from '../social/Social';
import type { P2PClient, P2PFriend } from './client';

const VISITS = 'mtw.p2p.visits';
type Visits = Record<string, { n: number; last: string }>;
const readVisits = (): Visits => { try { return JSON.parse(localStorage.getItem(VISITS) ?? '{}') ?? {}; } catch { return {}; } };

/** A P2P friend as a game friend profile (null = the profile they sent is not valid). */
export function toFriend(f: P2PFriend, visits: Visits = {}): FriendProfile | null {
  const p = f.profile as { profile?: unknown; outfit?: unknown; room?: unknown } | null;
  if (!p || typeof p !== 'object') return null;
  const v = visits[f.id];
  return sanitizeFriend({ id: f.id, created: new Date(0).toISOString(), source: 'p2p', profile: p.profile, outfit: p.outfit ?? {}, room: p.room ?? {}, visits: v?.n ?? 0, lastVisit: v?.last ?? null });
}

export function withP2P(local: SocialProvider, p2p: P2PClient): SocialProvider {
  let first: Promise<void> | null = null;
  /** The first list waits a moment for the engine's state (it may still be starting). */
  const ready = () => (first ??= new Promise<void>((res) => { if (p2p.state) return res(); const t = setTimeout(res, 1500); const un = p2p.onState(() => { clearTimeout(t); un(); res(); }); }));
  const remote = async () => { await ready(); const v = readVisits(); return p2p.friends.map((f) => toFriend(f, v)).filter((f): f is FriendProfile => !!f); };
  return {
    kind: local.kind, get unavailable() { return local.unavailable; },
    async list() { return [...await local.list(), ...await remote()]; },
    async get(id) { return id.startsWith('p2p-') ? (await remote()).find((f) => f.id === id) ?? null : local.get(id); },
    add: (f) => local.add(f),
    async update(f) { if (f.source !== 'p2p') return local.update(f); },
    async remove(id) { if (id.startsWith('p2p-')) { await p2p.request('unfriend', { id }); return; } return local.remove(id); },
    async recordVisit(id) {
      if (!id.startsWith('p2p-')) return local.recordVisit(id);
      const v = readVisits(); v[id] = { n: (v[id]?.n ?? 0) + 1, last: new Date().toISOString() };
      try { localStorage.setItem(VISITS, JSON.stringify(v)); } catch { /* memory only */ }
    },
    recentAnswers: () => local.recentAnswers(),
  };
}
