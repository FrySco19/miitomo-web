/**
 * REBOOT providers: one RebootApi, two implementations.
 *  - LocalRebootProvider: this browser only (simulates the server for single-player development and tests).
 *    Methods are filled in phase by phase; a method not built yet answers NOT_CONFIGURED with the phase that adds it.
 *  - ServerRebootProvider: OUR backend (R10). Plain fetch over ENDPOINTS, session cookie, no secrets in the bundle.
 * Both enforce the same client-side rate limits (the server enforces its own; the client ones only keep a well-behaved
 * client from spamming).
 */
import { ENDPOINTS, RebootApi, Result, ApiError, Report, PrivacySettings, Id } from './contracts';
import { RateLimiter, DEFAULT_LIMITS } from '../safety/rateLimit';

const err = (code: ApiError['code'], message: string, retryAfterMs?: number): { ok: false; error: ApiError } => ({ ok: false, error: { code, message, retryAfterMs } });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/** Which phase delivers each method locally (docs/reboot/ROADMAP.md). */
const PHASE: Partial<Record<keyof RebootApi, string>> = {
  join: 'R3', leave: 'R3', move: 'R3', getRoom: 'R3', listPublicRooms: 'R3', updateRoom: 'R3',
  feed: 'R5', postsBy: 'R5', createPost: 'R5', deletePost: 'R5', reactionTypes: 'R5', react: 'R5', comments: 'R5', comment: 'R5', deleteComment: 'R5',
  games: 'R6', submitScore: 'R6', leaderboard: 'R6', rewards: 'R8', events: 'R8', notifications: 'R9', markRead: 'R9',
  me: 'R4', getProfile: 'R4', updateProfile: 'R4', listFriends: 'R4', requestFriend: 'R10', answerFriend: 'R10', removeFriend: 'R4',
};

interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void; }
const memKv = (): Kv => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };

/** Local safety state (block / mute / reports / privacy) — real now, so later features can rely on it. */
interface SafetyState { blocked: Id[]; muted: Id[]; reports: (Report & { at: string })[]; privacy: PrivacySettings; }
const SAFETY_KEY = 'mtw.reboot.safety';
const DEFAULT_PRIVACY: PrivacySettings = { profile: 'friends', room: 'friends', posts: 'friends', allowFriendRequests: true };

export function createLocalProvider(kv: Kv | null = safeKv(), limiter = new RateLimiter(DEFAULT_LIMITS)): RebootApi & { safety(): SafetyState } {
  const store = kv ?? memKv();
  const load = (): SafetyState => { try { const v = JSON.parse(store.getItem(SAFETY_KEY) ?? 'null'); if (v) return { blocked: [], muted: [], reports: [], privacy: DEFAULT_PRIVACY, ...v }; } catch { /* corrupt → defaults */ } return { blocked: [], muted: [], reports: [], privacy: { ...DEFAULT_PRIVACY } }; };
  const save = (s: SafetyState) => { try { store.setItem(SAFETY_KEY, JSON.stringify(s)); } catch { /* quota / private mode */ } };
  const gate = (op: string): { ok: false; error: ApiError } | null => { const w = limiter.take(op); return w > 0 ? err('RATE_LIMITED', `Troppe richieste (${op})`, w) : null; };
  const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64;
  const impl: Partial<RebootApi> & { safety(): SafetyState } = {
    safety: load,
    async report(r) {
      const g = gate('report'); if (g) return g;
      if (!r || !validId(r.targetId) || !['profile', 'post', 'comment', 'room'].includes(r.targetType)) return err('INVALID', 'Segnalazione non valida');
      if (!['spam', 'harassment', 'inappropriate', 'impersonation', 'other'].includes(r.reason)) return err('INVALID', 'Motivo non valido');
      const s = load(); s.reports.push({ targetType: r.targetType, targetId: r.targetId, reason: r.reason, note: (r.note ?? '').slice(0, 500), at: new Date().toISOString() }); save(s); return ok(true as const);
    },
    async block(id) { if (!validId(id)) return err('INVALID', 'id'); const s = load(); if (!s.blocked.includes(id)) s.blocked.push(id); s.muted = s.muted.filter((x) => x !== id); save(s); return ok(true as const); },
    async unblock(id) { const s = load(); s.blocked = s.blocked.filter((x) => x !== id); save(s); return ok(true as const); },
    async mute(id, on) { if (!validId(id)) return err('INVALID', 'id'); const s = load(); s.muted = s.muted.filter((x) => x !== id); if (on) s.muted.push(id); save(s); return ok(true as const); },
    async privacy(p) {
      const s = load(); const vis = ['private', 'friends', 'public'];
      if (p) {
        for (const k of ['profile', 'room', 'posts'] as const) if (p[k] !== undefined) { if (!vis.includes(p[k]!)) return err('INVALID', k); s.privacy[k] = p[k]!; }
        if (p.allowFriendRequests !== undefined) s.privacy.allowFriendRequests = !!p.allowFriendRequests;
        save(s);
      }
      return ok({ ...s.privacy });
    },
  };
  return new Proxy(impl, {
    get(t, k: string) {
      if (k in t) return (t as Record<string, unknown>)[k];
      if (k in ENDPOINTS) return async () => err('NOT_CONFIGURED', `Funzione Reboot non ancora disponibile in locale (fase ${PHASE[k as keyof RebootApi] ?? '?'})`);
      return undefined;
    },
  }) as RebootApi & { safety(): SafetyState };
}

/**
 * OUR backend. `baseUrl` comes from configuration (never a Nintendo host); null → every call answers NOT_CONFIGURED.
 * Auth = server session cookie (credentials: 'include'); the client never holds an API secret.
 */
export function createServerProvider(baseUrl: string | null, fetchImpl: typeof fetch = (...a) => fetch(...a), limiter = new RateLimiter(DEFAULT_LIMITS)): RebootApi {
  if (baseUrl && /nintendo|nintendowifi|npf|baas\.nintendo/i.test(baseUrl)) throw new Error('ServerRebootProvider: i server Nintendo non sono ammessi.');
  const call = async (name: keyof RebootApi, args: unknown[]): Promise<Result<unknown>> => {
    if (!baseUrl) return err('NOT_CONFIGURED', 'Server Reboot non configurato');
    const w = limiter.take(name); if (w > 0) return err('RATE_LIMITED', `Troppe richieste (${name})`, w);
    const [method, path0] = ENDPOINTS[name];
    let path = path0; const rest = [...args];
    if (path.includes(':id')) path = path.replace(':id', encodeURIComponent(String(rest.shift() ?? '')));
    const body = method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(rest.length === 1 ? rest[0] : rest);
    let url = baseUrl.replace(/\/$/, '') + path;
    if (method === 'GET' && rest[0] && typeof rest[0] === 'object') { const q = new URLSearchParams(Object.entries(rest[0] as Record<string, unknown>).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])); if ([...q].length) url += (url.includes('?') ? '&' : '?') + q; }
    try {
      const r = await fetchImpl(url, { method, body, credentials: 'include', headers: body ? { 'content-type': 'application/json' } : undefined });
      const j = await r.json().catch(() => null);
      if (!r.ok) return err((j?.error?.code as ApiError['code']) ?? (r.status === 401 ? 'UNAUTHENTICATED' : r.status === 403 ? 'FORBIDDEN' : r.status === 404 ? 'NOT_FOUND' : r.status === 429 ? 'RATE_LIMITED' : 'INTERNAL'), j?.error?.message ?? `HTTP ${r.status}`);
      return ok(j);
    } catch { return err('OFFLINE', 'Server non raggiungibile'); }
  };
  return new Proxy({}, { get: (_t, k: string) => (k in ENDPOINTS ? (...a: unknown[]) => call(k as keyof RebootApi, a) : undefined) }) as RebootApi;
}

function safeKv(): Kv | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
