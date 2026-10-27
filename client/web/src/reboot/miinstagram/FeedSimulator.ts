/**
 * REBOOT R5 — the Miis' own life on MIInstagram (local simulation until R10; every Mii involved is a LOCAL friend).
 * Only through the SocialFeedService, like a remote user would, so it is replaced by real people later, not rewritten.
 *
 *   reactions / comments  when a post appears, each friend may react (one reaction, never repeated) and some comment.
 *                         Personality sets the chance, the delay, the kind of reaction and the tone / length of the
 *                         comment (Espansivo ≠ Riservato); how close they are to the author (relations) raises it.
 *   activity posts        meaningful moments become posts: a real conversation between two Miis, the end of a match
 *                         in the Sala Giochi, the user's visit to a friend's room.
 *   no spam               probabilities, a cool-down per pair and a global one, an hourly cap, a cap of comments per
 *                         post, dedup keys (the same moment is never posted twice) and a bounded action queue.
 * Time = the room simulation clock (onTick): it pauses with the room, never runs in Classic, is exact in tests.
 */
import type { FriendInfo } from '../host';
import type { SocialFeedService, FeedEvent } from './LocalSocialService';
import type { LocalSocialService } from './LocalSocialService';
import type { Relations } from './relations';
import type { Post, ReactionId } from './model';
import { rng } from '../social/traits';

type P = 0 | 1 | 2 | 3;
/** NEW design values per ORIGINAL personality type (0 Riservato · 1 Deciso · 2 Tranquillo · 3 Espansivo). */
export const FEED_TRAITS: Record<P, { react: number; comment: number; reactions: ReactionId[]; delay: [number, number]; lines: number }> = {
  0: { react: 0.35, comment: 0.10, reactions: ['like'], delay: [60, 300], lines: 3 },
  1: { react: 0.50, comment: 0.22, reactions: ['like', 'wow'], delay: [30, 200], lines: 3 },
  2: { react: 0.70, comment: 0.32, reactions: ['cute', 'like'], delay: [25, 180], lines: 3 },
  3: { react: 0.85, comment: 0.55, reactions: ['haha', 'wow', 'like'], delay: [8, 90], lines: 3 },
};
export interface SimConfig {
  /** Seconds between two autonomous posts (any author). */
  postCooldown: number;
  /** Seconds before the same two Miis can make a post together again. */
  pairCooldown: number;
  maxPostsPerHour: number;
  maxSimCommentsPerPost: number;
  /** Chance that a finished, real conversation becomes a post. */
  meetChance: number;
  gameChance: number;
  visitChance: number;
  /** Pending reactions / comments at most (older ones are dropped, never piled up). */
  maxQueue: number;
}
export const DEFAULT_SIM: SimConfig = { postCooldown: 180, pairCooldown: 900, maxPostsPerHour: 6, maxSimCommentsPerPost: 3, meetChance: 0.25, gameChance: 0.6, visitChance: 0.5, maxQueue: 60 };

/** A friend connected peer-to-peer (desktop app): a real person, never simulated. */
export const isRealPerson = (id: string) => id.startsWith('p2p-');

export class FeedSimulator {
  now = 0;
  private queue: { at: number; fn: () => void }[] = [];
  private lastPost = -Infinity;
  private posted: number[] = [];
  private pairAt = new Map<string, number>();
  private friends: FriendInfo[] = [];
  private unsubs: (() => void)[] = [];
  private rnd: () => number;
  readonly stats = { reactions: 0, comments: 0, posts: 0, skippedCooldown: 0, skippedDedup: 0, dropped: 0 };
  config: SimConfig;
  constructor(private svc: SocialFeedService & Pick<LocalSocialService, 'reactedBy' | 'commentsBy' | 'hasDedup'>, private opts: {
    friends: () => Promise<FriendInfo[]>; relations: Relations; onTick: (cb: (dt: number) => void) => () => void; seed?: number; config?: Partial<SimConfig>; user?: string; userName?: () => string;
  }) {
    this.rnd = rng(opts.seed ?? 4242);
    this.config = { ...DEFAULT_SIM, ...opts.config };
    this.unsubs.push(opts.onTick((dt) => this.tick(dt)));
    this.unsubs.push(svc.subscribe((e) => this.onFeed(e)));
    void this.refresh();
  }
  /** Real friends connected peer-to-peer (id p2p-…) are people: the simulator never acts, posts or comments as them. */
  async refresh() { try { this.friends = (await this.opts.friends()).filter((f) => !isRealPerson(f.id)); } catch { this.friends = []; } }
  dispose() { for (const u of this.unsubs) u(); this.unsubs = []; this.queue = []; }
  get pending() { return this.queue.length; }
  private get user() { return this.opts.user ?? 'host'; }
  private r(a: number, b: number) { return a + (b - a) * this.rnd(); }
  private after(sec: number, fn: () => void) {
    if (this.queue.length >= this.config.maxQueue) { this.queue.shift(); this.stats.dropped++; }
    this.queue.push({ at: this.now + sec, fn });
  }
  tick(dt: number) {
    this.now += dt;
    if (!this.queue.length) return;
    const due = this.queue.filter((q) => q.at <= this.now);
    if (due.length) { this.queue = this.queue.filter((q) => q.at > this.now); for (const q of due) { try { q.fn(); } catch (e) { console.warn(e); } } }
  }
  private personality(id: string): P { return (this.friends.find((f) => f.id === id)?.personality ?? 2) as P; }
  private name(id: string) { return id === this.user ? this.opts.userName?.() ?? '' : this.friends.find((f) => f.id === id)?.name ?? ''; }

  // ---------------------------------------------------------------- reactions and comments
  private onFeed(e: FeedEvent) {
    if (e.type === 'post.created') this.audience(e.post);
    if (e.type === 'comment.added' && e.comment.authorId !== e.post.authorId) this.opts.relations.bump(e.comment.authorId, e.post.authorId, 'comment');
    if (e.type === 'reaction.changed' && e.reaction && e.by !== e.post.authorId) this.opts.relations.bump(e.by, e.post.authorId, 'reaction');
  }
  /** Each friend (not the author) decides whether, when and how to react and comment. */
  private audience(post: Post) {
    let comments = 0;
    for (const f of this.friends) {
      if (f.id === post.authorId) continue;
      const t = FEED_TRAITS[(f.personality ?? 2) as P], close = this.opts.relations.get(f.id, post.authorId);
      const boost = 0.5 + close;                                   // friends react to friends
      if (this.rnd() < Math.min(0.95, t.react * boost)) {
        const kind = t.reactions[Math.floor(this.rnd() * t.reactions.length)];
        this.after(this.r(t.delay[0], t.delay[1]), () => { if (!this.svc.reactedBy(post.id, f.id)) void this.svc.react(post.id, f.id, kind).then((r) => { if (r.ok) this.stats.reactions++; }); });
      }
      if (comments < this.config.maxSimCommentsPerPost && this.rnd() < Math.min(0.9, t.comment * (0.4 + close))) {
        comments++;
        const p = (f.personality ?? 2) as P, n = Math.floor(this.rnd() * t.lines);
        this.after(this.r(t.delay[0] * 1.5, t.delay[1] * 1.5), () => {
          if (this.svc.commentsBy(post.id, f.id)) return;
          void this.svc.comment(post.id, f.id, { line: { key: `cm.${p}.${post.kind}.${n}`, vars: { name: this.name(post.authorId) } } }).then((r) => { if (r.ok) this.stats.comments++; });
        });
      }
    }
  }

  // ---------------------------------------------------------------- activity posts (moments)
  private canPost(pair?: string) {
    if (this.now - this.lastPost < this.config.postCooldown) return false;
    this.posted = this.posted.filter((t) => this.now - t < 3600);
    if (this.posted.length >= this.config.maxPostsPerHour) return false;
    if (pair && this.now - (this.pairAt.get(pair) ?? -Infinity) < this.config.pairCooldown) return false;
    return true;
  }
  private async post(author: string, activity: 'visit' | 'game' | 'meet' | 'social', key: string, vars: Record<string, string | number>, participants: string[], dedup: string, pair?: string) {
    if (this.svc.hasDedup(dedup)) { this.stats.skippedDedup++; return false; }
    if (!this.canPost(pair)) { this.stats.skippedCooldown++; return false; }
    this.lastPost = this.now; this.posted.push(this.now); if (pair) this.pairAt.set(pair, this.now);
    const r = await this.svc.createActivityPost(author, { activity, line: { key, vars }, participants, dedup });
    if (r.ok) this.stats.posts++;
    return r.ok;
  }
  /** Two Miis really talked (R2b conversation finished with a few lines). */
  conversation(a: string, b: string, lines: number, day = new Date().toISOString().slice(0, 10)) {
    if (a === b) return;
    this.opts.relations.bump(a, b, 'conversation');
    if (a === this.user || b === this.user || lines < 4) return;          // the user's own moments are posted by the user
    if (!this.friends.some((f) => f.id === a) || !this.friends.some((f) => f.id === b)) return;
    if (this.rnd() > this.config.meetChance * (0.5 + this.opts.relations.get(a, b))) return;
    const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
    const [author, other] = this.personality(a) >= this.personality(b) ? [a, b] : [b, a];   // the more outgoing one posts
    void this.post(author, 'meet', 'act.meet', { other: this.name(other) }, [author, other], `meet:${pair}:${day}`, pair);
  }
  /** A match ended in the Sala Giochi. */
  game(result: { sessionId: string; winners: string[]; players: { id: string; name: string; score: number }[] }, gameTitle: string) {
    for (const p of result.players) for (const q of result.players) if (p.id < q.id) this.opts.relations.bump(p.id, q.id, 'game');
    if (this.rnd() > this.config.gameChance) return;
    const w = result.winners[0]; if (!w) return;
    if (w !== this.user) { if (!this.friends.some((f) => f.id === w)) return; const s = result.players.find((p) => p.id === w)!; void this.post(w, 'game', 'act.game.win', { game: gameTitle, score: s.score }, result.players.map((p) => p.id), `game:${result.sessionId}`); return; }
    const loser = result.players.find((p) => p.id !== this.user && this.friends.some((f) => f.id === p.id));
    if (loser) void this.post(loser.id, 'game', 'act.game.lost', { game: gameTitle, winner: result.players.find((p) => p.id === w)?.name ?? '' }, result.players.map((p) => p.id), `game:${result.sessionId}`);
  }
  /** The user visited a friend's room: the friend may post about it. */
  visit(ownerId: string, userName: string, day = new Date().toISOString().slice(0, 10)) {
    this.opts.relations.bump(this.user, ownerId, 'visit');
    if (!this.friends.some((f) => f.id === ownerId) || this.rnd() > this.config.visitChance) return;
    void this.post(ownerId, 'visit', 'act.visit', { name: userName }, [ownerId, this.user], `visit:${ownerId}:${day}`);
  }
}
