/**
 * REBOOT R6 (desktop app) — MIInstagram between REAL friends connected peer-to-peer. Each player keeps their own posts;
 * friends get a copy:
 *   my new post            → to every friend online ('posts', with the photo)
 *   a friend comes online  → my 10 latest posts ('posts')
 *   I react / comment on a friend's post → to its author ('react' / 'comment'); the author applies it and sends the
 *                            updated post to everybody ('update')
 *   I delete my post       → 'delete'
 * Only real people are carried: reactions and comments of the simulated local Miis stay on the device that made them.
 * Ids on the wire are global (the author's p2p id instead of 'host'); a friend's post is stored here as
 * `<friend id>:<their post id>` with that friend as author. Everything received is sanitized (sanitizePost).
 */
import type { RebootP2P } from '../host';
import type { LocalSocialService } from './LocalSocialService';
import type { Post } from './model';
import { isReaction } from './model';

export const FEED_CH = 'feed';
const REAL = /^p2p-[0-9a-f]{16}$/;
type Msg = { op: 'posts'; items: { post: unknown; photo: string | null }[] } | { op: 'update'; post: unknown } | { op: 'delete'; id: string } | { op: 'react'; id: string; reaction: string | null } | { op: 'comment'; id: string; text: string };

export class P2PFeedSync {
  private unsubs: (() => void)[] = [];
  readonly stats = { sent: 0, received: 0, refused: 0 };
  constructor(private svc: LocalSocialService, private p2p: RebootP2P) {
    this.unsubs.push(svc.subscribe((e) => { void this.onLocal(e); }));
    this.unsubs.push(p2p.on(FEED_CH, (from, data) => { void this.onRemote(from, data); }));
    this.unsubs.push(p2p.onOnline((id) => { void this.sendLatest(id); }));
  }
  dispose() { for (const u of this.unsubs) u(); this.unsubs = []; }

  /** My view of a post → what my friends get (global ids, real people only). */
  private outbound(p: Post): unknown {
    const me = this.p2p.me(); if (!me) return null;
    const g = (id: string) => (id === 'host' ? me : REAL.test(id) ? id : null);
    const c = structuredClone(p) as Post & Record<string, unknown>;
    c.authorId = me;
    c.reactions = Object.fromEntries(Object.entries(c.reactions).map(([k, v]) => [g(k), v]).filter(([k]) => k)) as Post['reactions'];
    c.comments = c.comments.filter((x) => g(x.authorId) && x.text).map((x) => ({ ...x, authorId: g(x.authorId)! }));
    if (c.kind === 'activity') c.participants = c.participants.map(g).filter((x): x is string => !!x);
    if (c.kind === 'photo') { c.photoId = 'remote'; c.tagged = c.tagged.map(g).filter((x): x is string => !!x); }
    delete c.dedup;
    return c;
  }
  /** What a friend sent → my view (their post under their id; my own id becomes 'host'). */
  private inbound(from: string, raw: unknown): unknown {
    const me = this.p2p.me();
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || r.id.length > 40) return null;
    const l = (id: unknown) => (id === me ? 'host' : typeof id === 'string' && REAL.test(id) ? id : null);
    const reactions = r.reactions && typeof r.reactions === 'object' ? Object.fromEntries(Object.entries(r.reactions as Record<string, unknown>).map(([k, v]) => [l(k), v]).filter(([k]) => k)) : {};
    const comments = Array.isArray(r.comments) ? (r.comments as Record<string, unknown>[]).map((x) => ({ ...x, authorId: l(x?.authorId) })).filter((x) => x.authorId && typeof (x as { text?: unknown }).text === 'string') : [];
    return { ...r, id: `${from}:${r.id}`, authorId: from, reactions, comments, ...(Array.isArray(r.participants) ? { participants: (r.participants as unknown[]).map(l).filter(Boolean) } : {}), ...(Array.isArray(r.tagged) ? { tagged: (r.tagged as unknown[]).map(l).filter(Boolean) } : {}) };
  }
  private async pack(p: Post) { return { post: this.outbound(p), photo: p.kind === 'photo' ? await this.svc.photo(p.photoId) : null }; }
  private send(m: Msg, to?: string) { this.stats.sent++; this.p2p.send(FEED_CH, m, to); }
  private async sendLatest(to: string) {
    const mine = this.svc.postsBy('host', 10);
    if (!mine.length) return;
    // one post per message: a photo is ~100 KB
    for (const p of mine.reverse()) this.send({ op: 'posts', items: [await this.pack(p)] }, to);
  }
  private origin(id: string) { const i = id.indexOf(':'); return i > 0 && REAL.test(id.slice(0, i)) ? { author: id.slice(0, i), id: id.slice(i + 1) } : null; }

  private async onLocal(e: Parameters<Parameters<LocalSocialService['subscribe']>[0]>[0]) {
    if (e.type === 'post.created' && e.post.authorId === 'host') { this.send({ op: 'posts', items: [await this.pack(e.post)] }); return; }
    if (e.type === 'post.deleted') { if (!this.origin(e.id)) this.send({ op: 'delete', id: e.id }); return; }
    if (e.type !== 'reaction.changed' && e.type !== 'comment.added') return;
    const o = this.origin(e.post.id);
    if (!o) {
      // my post changed: my friends get the new version (only real people's part of it)
      if (e.post.authorId === 'host' && (e.type === 'reaction.changed' ? e.by === 'host' || REAL.test(e.by) : REAL.test(e.comment.authorId) || e.comment.authorId === 'host')) this.send({ op: 'update', post: this.outbound(e.post) });
      return;
    }
    // a friend's post: what I did goes to its author (they apply it and send the update to everybody)
    if (e.type === 'reaction.changed' && e.by === 'host') this.send({ op: 'react', id: o.id, reaction: e.reaction }, o.author);
    if (e.type === 'comment.added' && e.comment.authorId === 'host' && e.comment.text) this.send({ op: 'comment', id: o.id, text: e.comment.text }, o.author);
  }
  private async onRemote(from: string, data: unknown) {
    const m = data as Msg | null;
    if (!REAL.test(from) || !m || typeof m !== 'object') return;
    this.stats.received++;
    const refuse = () => { this.stats.refused++; };
    if (m.op === 'posts' && Array.isArray(m.items)) {
      for (const it of m.items.slice(0, 10)) { const p = this.inbound(from, it?.post); const r = p ? await this.svc.upsertRemote(p, typeof it.photo === 'string' ? it.photo : null) : null; if (!r?.ok) refuse(); }
    } else if (m.op === 'update') {
      const p = this.inbound(from, m.post); const cur = p ? await this.svc.get((p as { id: string }).id) : null;
      if (!p || !cur?.ok) return refuse();       // updates only for posts I already have
      const r = await this.svc.upsertRemote(p, null); if (!r.ok) refuse();
    } else if (m.op === 'delete' && typeof m.id === 'string') {
      await this.svc.removeRemote(`${from}:${m.id}`);
    } else if (m.op === 'react' && typeof m.id === 'string' && (m.reaction === null || isReaction(m.reaction))) {
      const p = await this.svc.get(m.id); if (!p.ok || p.value.authorId !== 'host') return refuse();   // only on my own posts
      const r = await this.svc.react(m.id, from, m.reaction as never); if (!r.ok) refuse();
    } else if (m.op === 'comment' && typeof m.id === 'string' && typeof m.text === 'string') {
      const p = await this.svc.get(m.id); if (!p.ok || p.value.authorId !== 'host') return refuse();
      const r = await this.svc.comment(m.id, from, { text: m.text }); if (!r.ok) refuse();
    } else refuse();
  }
}
