/**
 * REBOOT R5 — MIInstagram service. `SocialFeedService` is the seam: MIInstagram (app, simulator, tests) only talks to
 * it and never knows whether posts come from memory, this browser's storage or our server. Today: LocalSocialService
 * (this device). From R10: a RemoteSocialService over the contracts (feed / createPost / react / comments / comment).
 *
 * Local rules, the same ones the server will enforce:
 *   - every write is validated (caption / comment length, photo format, ids), the service assigns ids and times;
 *   - one reaction per person per post (same reaction again = DUPLICATE_REACTION; another one replaces it);
 *   - the user's comments and posts are rate limited (client token buckets of R1);
 *   - autonomous posts carry a dedup key: the same moment is never posted twice;
 *   - history is bounded (LIMITS.posts, newest kept; their photos are released with them).
 * Persistence: posts in `mtw.reboot.miinstagram` (schema v1, migrated on load), photos in the PhotoStore. Runtime and
 * scene objects are never stored. A failed write keeps the data in memory and reports PERSISTENCE (the UI says so).
 */
import { RateLimiter, DEFAULT_LIMITS } from '../safety/rateLimit';
import type { Line } from '../i18n/i18n';
import { SCHEMA, LIMITS, Post, PhotoPost, ActivityPost, AnswerPost, Comment, ReactionId, isReaction, sanitizePost, sanitizeLine, byNewest, ActivityKind, ID_RE } from './model';
import { PhotoStore, validPhoto } from './PhotoStore';

export type FeedErrorCode = 'INVALID_POST' | 'IMAGE_UNAVAILABLE' | 'PERSISTENCE' | 'DUPLICATE_REACTION' | 'NOT_FOUND' | 'RATE_LIMITED' | 'FORBIDDEN' | 'DUPLICATE';
export type FeedResult<T> = { ok: true; value: T } | { ok: false; code: FeedErrorCode; retryAfterMs?: number };
export type FeedEvent =
  | { type: 'post.created'; post: Post }
  | { type: 'post.updated'; post: Post }
  | { type: 'post.deleted'; id: string }
  | { type: 'comment.added'; post: Post; comment: Comment }
  | { type: 'reaction.changed'; post: Post; by: string; reaction: ReactionId | null }
  | { type: 'persist.failed'; reason: string };

export interface SocialFeedService {
  feed(req?: { cursor?: string | null; limit?: number }): Promise<FeedResult<{ items: Post[]; next: string | null }>>;
  get(id: string): Promise<FeedResult<Post>>;
  createPhotoPost(by: string, input: { photo: string; caption: string; source: 'miifoto' | 'room'; tagged?: string[] }): Promise<FeedResult<PhotoPost>>;
  createActivityPost(by: string, input: { activity: ActivityKind; line: Line; participants: string[]; dedup?: string }): Promise<FeedResult<ActivityPost>>;
  createAnswerPost(by: string, input: { question: Line; answer: string }): Promise<FeedResult<AnswerPost>>;
  react(postId: string, by: string, reaction: ReactionId | null): Promise<FeedResult<Post>>;
  comment(postId: string, by: string, input: { text?: string; line?: Line }): Promise<FeedResult<Comment>>;
  deletePost(id: string, by: string): Promise<FeedResult<true>>;
  photo(photoId: string): Promise<string | null>;
  subscribe(cb: (e: FeedEvent) => void): () => void;
}

const KEY = 'mtw.reboot.miinstagram';
interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void; }
const ok = <T,>(value: T): FeedResult<T> => ({ ok: true, value });
const no = (code: FeedErrorCode, retryAfterMs?: number): { ok: false; code: FeedErrorCode; retryAfterMs?: number } => ({ ok: false, code, retryAfterMs });

/** Stored shapes: v1 = { v: 1, seq, posts }. A bare array (prototype builds before the schema) is read as v0. */
export function migrate(raw: unknown): { posts: Post[]; seq: number; readOnly: boolean } {
  if (Array.isArray(raw)) return { posts: raw.map(sanitizePost).filter((p): p is Post => !!p), seq: raw.length, readOnly: false };
  const r = raw as { v?: unknown; posts?: unknown; seq?: unknown } | null;
  if (!r || typeof r !== 'object') return { posts: [], seq: 0, readOnly: false };
  if (typeof r.v === 'number' && r.v > SCHEMA) return { posts: [], seq: 0, readOnly: true };   // written by a newer build: never overwrite it
  const posts = (Array.isArray(r.posts) ? r.posts : []).map(sanitizePost).filter((p): p is Post => !!p);
  return { posts, seq: Math.max(0, Number(r.seq) | 0, posts.length), readOnly: false };
}

export class LocalSocialService implements SocialFeedService {
  private posts: Post[] = [];
  private seq = 0;
  private readOnly = false;
  private subs = new Set<(e: FeedEvent) => void>();
  lastPersistError: string | null = null;
  constructor(private photos: PhotoStore, private kv: Kv | null, private limiter = new RateLimiter(DEFAULT_LIMITS), private now: () => Date = () => new Date()) {
    let raw: unknown = null;
    try { raw = JSON.parse(kv?.getItem(KEY) ?? 'null'); } catch { raw = null; }
    const m = migrate(raw);
    this.posts = m.posts.sort(byNewest).slice(0, LIMITS.posts); this.seq = m.seq; this.readOnly = m.readOnly;
    if (m.readOnly) this.lastPersistError = 'NEWER_SCHEMA';
  }
  subscribe(cb: (e: FeedEvent) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
  get count() { return this.posts.length; }
  get persistent() { return !!this.kv && this.photos.persistent && !this.readOnly; }
  private emit(e: FeedEvent) { for (const s of this.subs) { try { s(e); } catch (err) { console.warn(err); } } }
  private id(prefix: string) { return `${prefix}-${this.now().getTime().toString(36)}-${(++this.seq).toString(36)}`; }
  private stamp() { return this.now().toISOString(); }
  private save(): boolean {
    if (this.readOnly) { this.lastPersistError = 'NEWER_SCHEMA'; this.emit({ type: 'persist.failed', reason: 'NEWER_SCHEMA' }); return false; }
    try { this.kv?.setItem(KEY, JSON.stringify({ v: SCHEMA, seq: this.seq, posts: this.posts })); this.lastPersistError = null; return true; }
    catch (e) { this.lastPersistError = (e as Error)?.name || 'WRITE_FAILED'; this.emit({ type: 'persist.failed', reason: this.lastPersistError }); return false; }
  }
  private gate(op: string, by: string) { if (by !== 'host') return 0; return this.limiter.take(op); }
  private add(p: Post) {
    this.posts.unshift(p); this.posts.sort(byNewest);
    for (const old of this.posts.splice(LIMITS.posts)) if (old.kind === 'photo') void this.photos.delete(old.photoId);   // bounded history
    this.save();
    this.emit({ type: 'post.created', post: p });
  }

  async feed(req: { cursor?: string | null; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(30, Math.round(req.limit ?? 10)));
    let start = 0;
    if (req.cursor) { const i = this.posts.findIndex((p) => p.id === req.cursor); if (i < 0) return no('NOT_FOUND'); start = i + 1; }
    const items = this.posts.slice(start, start + limit).map((p) => structuredClone(p));
    return ok({ items, next: start + limit < this.posts.length ? items[items.length - 1].id : null });
  }
  /** R6 (My page): the posts of one author, newest first (copies). */
  postsBy(author: string, limit = 30) { return this.posts.filter((p) => p.authorId === author).slice(0, limit).map((p) => structuredClone(p)); }
  async get(id: string) { const p = this.posts.find((x) => x.id === id); return p ? ok(structuredClone(p)) : no('NOT_FOUND'); }
  async photo(photoId: string) { return ID_RE.test(photoId) ? this.photos.get(photoId) : null; }

  async createPhotoPost(by: string, input: { photo: string; caption: string; source: 'miifoto' | 'room'; tagged?: string[] }) {
    if (!ID_RE.test(by) || !input || typeof input.caption !== 'string' || input.caption.length > LIMITS.caption) return no('INVALID_POST');
    if (!validPhoto(input.photo)) return no('IMAGE_UNAVAILABLE');
    const w = this.gate('createPost', by); if (w) return no('RATE_LIMITED', w);
    let photoId: string;
    try { photoId = await this.photos.put(input.photo); } catch { return no('PERSISTENCE'); }
    const p: PhotoPost = { id: this.id('p'), authorId: by, createdAt: this.stamp(), reactions: {}, comments: [], kind: 'photo', photoId, caption: input.caption.trim(), source: input.source === 'room' ? 'room' : 'miifoto', tagged: (input.tagged ?? []).filter((x) => ID_RE.test(x)).slice(0, 8) };
    this.add(p);
    return ok(structuredClone(p));
  }
  async createActivityPost(by: string, input: { activity: ActivityKind; line: Line; participants: string[]; dedup?: string }) {
    const line = sanitizeLine(input?.line);
    if (!ID_RE.test(by) || !line || !['visit', 'game', 'meet', 'social'].includes(input.activity)) return no('INVALID_POST');
    if (input.dedup && this.posts.some((p) => p.dedup === input.dedup)) return no('DUPLICATE');
    const p: ActivityPost = { id: this.id('a'), authorId: by, createdAt: this.stamp(), reactions: {}, comments: [], kind: 'activity', activity: input.activity, line, participants: (input.participants ?? []).filter((x) => ID_RE.test(x)).slice(0, 8), ...(input.dedup ? { dedup: input.dedup.slice(0, 80) } : {}) };
    this.add(p);
    return ok(structuredClone(p));
  }
  async createAnswerPost(by: string, input: { question: Line; answer: string }) {
    const question = sanitizeLine(input?.question), answer = typeof input?.answer === 'string' ? input.answer.trim() : '';
    if (!ID_RE.test(by) || !question || !answer || answer.length > LIMITS.answer) return no('INVALID_POST');
    const p: AnswerPost = { id: this.id('q'), authorId: by, createdAt: this.stamp(), reactions: {}, comments: [], kind: 'answer', question, answer };
    this.add(p);
    return ok(structuredClone(p));
  }
  async react(postId: string, by: string, reaction: ReactionId | null) {
    const p = this.posts.find((x) => x.id === postId); if (!p) return no('NOT_FOUND');
    if (!ID_RE.test(by) || (reaction !== null && !isReaction(reaction))) return no('INVALID_POST');
    if (reaction !== null && p.reactions[by] === reaction) return no('DUPLICATE_REACTION');
    if (reaction === null && !p.reactions[by]) return ok(structuredClone(p));
    const w = this.gate('react', by); if (w) return no('RATE_LIMITED', w);
    if (reaction === null) delete p.reactions[by]; else p.reactions[by] = reaction;
    this.save();
    const copy = structuredClone(p);
    this.emit({ type: 'reaction.changed', post: copy, by, reaction });
    return ok(copy);
  }
  async comment(postId: string, by: string, input: { text?: string; line?: Line }) {
    const p = this.posts.find((x) => x.id === postId); if (!p) return no('NOT_FOUND');
    const text = typeof input?.text === 'string' ? input.text.trim() : '', line = input?.line ? sanitizeLine(input.line) : null;
    if (!ID_RE.test(by) || (!text && !line) || text.length > LIMITS.comment) return no('INVALID_POST');
    const w = this.gate('comment', by); if (w) return no('RATE_LIMITED', w);
    const c: Comment = { id: this.id('c'), authorId: by, createdAt: this.stamp(), ...(text ? { text } : {}), ...(line ? { line } : {}) };
    p.comments.push(c); if (p.comments.length > LIMITS.commentsPerPost) p.comments.splice(0, p.comments.length - LIMITS.commentsPerPost);
    this.save();
    const copy = structuredClone(p);
    this.emit({ type: 'comment.added', post: copy, comment: c });
    return ok(c);
  }
  async deletePost(id: string, by: string) {
    const i = this.posts.findIndex((x) => x.id === id); if (i < 0) return no('NOT_FOUND');
    if (this.posts[i].authorId !== by) return no('FORBIDDEN');
    const [p] = this.posts.splice(i, 1);
    if (p.kind === 'photo') await this.photos.delete(p.photoId);
    this.save();
    this.emit({ type: 'post.deleted', id });
    return ok(true as const);
  }
  /**
   * R6 P2P: a real friend's post as they sent it (P2PFeedSync has already set its id and author). Inserted, or
   * replaced when it is already here (their reactions and comments changed); the photo is kept once.
   */
  async upsertRemote(raw: unknown, photo: string | null) {
    const p = sanitizePost(raw); if (!p) return no('INVALID_POST');
    const i = this.posts.findIndex((x) => x.id === p.id);
    if (p.kind === 'photo') {
      const old = i >= 0 ? this.posts[i] : null;
      if (old && old.kind === 'photo') p.photoId = old.photoId;
      else { if (!validPhoto(photo)) return no('IMAGE_UNAVAILABLE'); try { p.photoId = await this.photos.put(photo); } catch { return no('PERSISTENCE'); } }
    }
    if (i >= 0) { this.posts[i] = p; this.save(); this.emit({ type: 'post.updated', post: structuredClone(p) }); }
    else this.add(p);
    return ok(structuredClone(p));
  }
  /** R6 P2P: the friend deleted their post. */
  async removeRemote(id: string) {
    const i = this.posts.findIndex((x) => x.id === id); if (i < 0) return;
    const [p] = this.posts.splice(i, 1);
    if (p.kind === 'photo') await this.photos.delete(p.photoId);
    this.save(); this.emit({ type: 'post.deleted', id });
  }
  /** Who reacted / commented already (the simulator never repeats itself). */
  reactedBy(postId: string, who: string) { return !!this.posts.find((x) => x.id === postId)?.reactions[who]; }
  commentsBy(postId: string, who: string) { return this.posts.find((x) => x.id === postId)?.comments.filter((c) => c.authorId === who).length ?? 0; }
  hasDedup(key: string) { return this.posts.some((p) => p.dedup === key); }
}
