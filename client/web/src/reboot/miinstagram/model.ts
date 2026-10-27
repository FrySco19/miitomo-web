/**
 * REBOOT R5 — MIInstagram domain model (no DOM, no storage). MIInstagram is the Miis' photo-and-moments app on the
 * MiiPhone: Miifoto shared by the user, moments from the Miis' own life (a visit, a match, a meeting), answers.
 *
 * Posts are TYPED:
 *   photo     a Miifoto (or a photo of the room) + caption
 *   activity  something that happened in the Miis' life, written as data (i18n key + values) so it reads in the
 *             language of the moment
 *   answer    an answer worth sharing (question as data + the answer text)
 * One reaction per person per post (changing it replaces it); comments have an author, text, time and id.
 * Everything read from storage or (later) from the server is untrusted: `sanitizePost` validates and clamps it.
 */
import type { Line, Vars } from '../i18n/i18n';

export const SCHEMA = 1;
export const LIMITS = { caption: 140, comment: 140, posts: 150, commentsPerPost: 40, answer: 200 } as const;
export type ReactionId = 'like' | 'haha' | 'wow' | 'cute';
/** Miitomo-like reactions (NEW set): order = how they are shown. Labels: i18n `react.<id>`. */
export const REACTIONS: readonly { id: ReactionId; order: number }[] = [{ id: 'like', order: 0 }, { id: 'haha', order: 1 }, { id: 'wow', order: 2 }, { id: 'cute', order: 3 }];
export const isReaction = (v: unknown): v is ReactionId => REACTIONS.some((r) => r.id === v);

export interface Comment { id: string; authorId: string; createdAt: string; text?: string; line?: Line; }
interface PostBase {
  id: string; authorId: string; createdAt: string;
  /** who → which reaction (one each). */
  reactions: Record<string, ReactionId>;
  comments: Comment[];
  /** Same key = same moment: never posted twice (autonomous posts). */
  dedup?: string;
}
export interface PhotoPost extends PostBase { kind: 'photo'; photoId: string; caption: string; source: 'miifoto' | 'room'; tagged: string[]; }
export type ActivityKind = 'visit' | 'game' | 'meet' | 'social';
export interface ActivityPost extends PostBase { kind: 'activity'; activity: ActivityKind; line: Line; participants: string[]; }
export interface AnswerPost extends PostBase { kind: 'answer'; question: Line; answer: string; }
export type Post = PhotoPost | ActivityPost | AnswerPost;

export const ID_RE = /^[A-Za-z0-9:_-]{1,64}$/;
const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : '');

export function sanitizeLine(raw: unknown): Line | null {
  const r = raw as Line | null;
  if (!r || typeof r !== 'object' || typeof r.key !== 'string' || !/^[a-z0-9._-]{1,60}$/i.test(r.key)) return null;
  const vars: Vars = {};
  for (const [k, v] of Object.entries(r.vars ?? {})) if (/^\w{1,20}$/.test(k) && (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))) vars[k] = typeof v === 'string' ? v.slice(0, 60) : v;
  return { key: r.key, vars };
}
export function sanitizeComment(raw: unknown): Comment | null {
  const c = raw as Comment | null;
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !ID_RE.test(c.id) || typeof c.authorId !== 'string' || !ID_RE.test(c.authorId)) return null;
  const at = iso(c.createdAt); if (!at) return null;
  const text = str(c.text, LIMITS.comment).trim(), line = c.line ? sanitizeLine(c.line) : null;
  if (!text && !line) return null;
  return { id: c.id, authorId: c.authorId, createdAt: at, ...(text ? { text } : {}), ...(line ? { line } : {}) };
}
/** Validates a post from storage / the network; null = drop it. */
export function sanitizePost(raw: unknown): Post | null {
  const p = raw as Partial<Post> & Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !ID_RE.test(p.id) || typeof p.authorId !== 'string' || !ID_RE.test(p.authorId)) return null;
  const createdAt = iso(p.createdAt); if (!createdAt) return null;
  const reactions: Record<string, ReactionId> = {};
  for (const [who, r] of Object.entries((p.reactions ?? {}) as Record<string, unknown>)) if (ID_RE.test(who) && isReaction(r)) reactions[who] = r;
  const comments = (Array.isArray(p.comments) ? p.comments : []).map(sanitizeComment).filter((c): c is Comment => !!c).slice(-LIMITS.commentsPerPost);
  const base = { id: p.id, authorId: p.authorId, createdAt, reactions, comments, ...(typeof p.dedup === 'string' ? { dedup: p.dedup.slice(0, 80) } : {}) };
  if (p.kind === 'photo') {
    const q = p as Partial<PhotoPost>;
    if (typeof q.photoId !== 'string' || !ID_RE.test(q.photoId)) return null;
    return { ...base, kind: 'photo', photoId: q.photoId, caption: str(q.caption, LIMITS.caption), source: q.source === 'room' ? 'room' : 'miifoto', tagged: (Array.isArray(q.tagged) ? q.tagged : []).filter((x): x is string => typeof x === 'string' && ID_RE.test(x)).slice(0, 8) };
  }
  if (p.kind === 'activity') {
    const q = p as Partial<ActivityPost>; const line = sanitizeLine(q.line);
    if (!line || !['visit', 'game', 'meet', 'social'].includes(q.activity as string)) return null;
    return { ...base, kind: 'activity', activity: q.activity as ActivityKind, line, participants: (Array.isArray(q.participants) ? q.participants : []).filter((x): x is string => typeof x === 'string' && ID_RE.test(x)).slice(0, 8) };
  }
  if (p.kind === 'answer') {
    const q = p as Partial<AnswerPost>; const question = sanitizeLine(q.question); const answer = str(q.answer, LIMITS.answer).trim();
    if (!question || !answer) return null;
    return { ...base, kind: 'answer', question, answer };
  }
  return null;
}
/** Newest first; ties broken by id so the order is stable. */
export const byNewest = (a: Post, b: Post) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1);
export function reactionCounts(p: Post): Record<ReactionId, number> {
  const out = { like: 0, haha: 0, wow: 0, cute: 0 } as Record<ReactionId, number>;
  for (const r of Object.values(p.reactions)) out[r]++;
  return out;
}
