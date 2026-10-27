/**
 * REBOOT (desktop app) — MIInstagram between REAL friends connected peer-to-peer. Each player keeps their own posts;
 * friends keep a copy. Protocol v2 (0.2), because v1 lost everything that happened while the other player's Reboot
 * page was not open (launcher, Classic, app closed): the engine delivered the message to no page, nothing asked again.
 *
 *   hello {known}        "these are the copies I have of YOUR posts (id → rev)" — sent by a page when it opens, when a
 *                        friend comes online, and every 60 s. The author answers with:
 *   snap {ids, oldest}   the ids of their live posts (window of their 30 latest): a copy not in it is deleted
 *   posts {items}        one post (+ photo when the friend has no copy yet) per message: new, or changed (rev differs)
 *   update / delete      live, while both pages are open (the next hello repairs anything missed)
 *   react / comment {oid} on a friend's post → its author, from a persistent OUTBOX, sent again until the author
 *                        answers ack {oid} (applied once: oids already applied are remembered)
 * Ids on the wire are global (the author's p2p id instead of 'host'); a friend's post is stored here as
 * `<friend id>:<their post id>` with that friend as author — whatever the message claims, the author is the sender's
 * authenticated id. Only real people are carried (the simulated local Miis stay on the device that made them).
 */
import type { RebootP2P } from '../host';
import type { LocalSocialService } from './LocalSocialService';
import type { Post } from './model';
import { isReaction } from './model';

export const FEED_CH = 'feed';
export const FEED_V = 2;
const REAL = /^p2p-[0-9a-f]{16}$/;
const WINDOW = 30, OUTBOX_MAX = 200, APPLIED_MAX = 500, RESEND_MS = 20_000, HELLO_MS = 60_000;
interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void }
type Item = { post: unknown; photo: string | null };
type Msg =
  | { op: 'hello'; known: Record<string, string> }
  | { op: 'snap'; ids: string[]; oldest: string | null }
  | { op: 'posts'; items: Item[] }
  | { op: 'update'; post: unknown }
  | { op: 'delete'; id: string }
  | { op: 'react'; oid: string; id: string; reaction: string | null }
  | { op: 'comment'; oid: string; id: string; text: string }
  | { op: 'ack'; oid: string };
interface OutItem { oid: string; to: string; op: 'react' | 'comment'; id: string; reaction?: string | null; text?: string; at: number; tries: number }

/** Version of a post's changing part (reactions + comments), the same on both sides (computed on the wire form). */
export function revOf(p: unknown): string {
  const q = p as { reactions?: Record<string, string>; comments?: { authorId: string; text?: string }[] } | null;
  const r = Object.entries(q?.reactions ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(',');
  const c = (q?.comments ?? []).map((x) => `${x.authorId}:${x.text ?? ''}`).join('|');
  let h = 2166136261; for (const ch of r + '#' + c) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

export class P2PFeedSync {
  private unsubs: (() => void)[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  /** rev of each friend's post as I last stored it: `${author}:${theirId}` → rev */
  private revs: Record<string, string>;
  private outbox: OutItem[];
  private applied: string[];
  readonly stats = { sent: 0, received: 0, refused: 0, hellos: 0, resent: 0, acked: 0 };
  constructor(private svc: LocalSocialService, private p2p: RebootP2P, private kv: Kv | null = null) {
    this.revs = this.load('mtw.ig.p2p.revs', {});
    this.outbox = this.load<OutItem[]>('mtw.ig.p2p.outbox', []).filter((o) => o && REAL.test(o.to)).slice(-OUTBOX_MAX);
    this.applied = this.load<string[]>('mtw.ig.p2p.applied', []).slice(-APPLIED_MAX);
    this.unsubs.push(svc.subscribe((e) => { void this.onLocal(e); }));
    this.unsubs.push(p2p.on(FEED_CH, (from, data) => { void this.onRemote(from, data); }));
    this.unsubs.push(p2p.onOnline((id) => { this.hello(id); this.flush(id); }));
    // this page just opened: catch up with every friend online now (v1 waited for a friend to come online)
    for (const id of p2p.online()) { this.hello(id); this.flush(id); }
    this.timers.push(setInterval(() => this.flush(), RESEND_MS), setInterval(() => { for (const id of this.p2p.online()) this.hello(id); }, HELLO_MS));
  }
  dispose() { for (const u of this.unsubs) u(); this.unsubs = []; for (const t of this.timers) clearInterval(t); this.timers = []; }
  get pending() { return this.outbox.length; }
  private load<T>(k: string, d: T): T { try { const v = JSON.parse(this.kv?.getItem(k) ?? 'null'); return v ?? d; } catch { return d; } }
  private store(k: string, v: unknown) { try { this.kv?.setItem(k, JSON.stringify(v)); } catch { /* memory only */ } }

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
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || r.id.length > 40 || r.id.includes(':')) return null;
    const l = (id: unknown) => (id === me ? 'host' : typeof id === 'string' && REAL.test(id) ? id : null);
    const reactions = r.reactions && typeof r.reactions === 'object' ? Object.fromEntries(Object.entries(r.reactions as Record<string, unknown>).map(([k, v]) => [l(k), v]).filter(([k]) => k)) : {};
    const comments = Array.isArray(r.comments) ? (r.comments as Record<string, unknown>[]).map((x) => ({ ...x, authorId: l(x?.authorId) })).filter((x) => x.authorId && typeof (x as { text?: unknown }).text === 'string') : [];
    // the author is the sender, whatever the message says
    return { ...r, id: `${from}:${r.id}`, authorId: from, reactions, comments, ...(Array.isArray(r.participants) ? { participants: (r.participants as unknown[]).map(l).filter(Boolean) } : {}), ...(Array.isArray(r.tagged) ? { tagged: (r.tagged as unknown[]).map(l).filter(Boolean) } : {}) };
  }
  private async pack(p: Post, withPhoto: boolean): Promise<Item> { return { post: this.outbound(p), photo: withPhoto && p.kind === 'photo' ? await this.svc.photo(p.photoId) : null }; }
  private send(m: Msg, to?: string) { this.stats.sent++; this.p2p.send(FEED_CH, { v: FEED_V, ...m }, to); }
  private origin(id: string) { const i = id.indexOf(':'); return i > 0 && REAL.test(id.slice(0, i)) ? { author: id.slice(0, i), id: id.slice(i + 1) } : null; }

  /** "Here is what I have of your posts" → the friend sends what changed. */
  private hello(to: string) {
    const known: Record<string, string> = {};
    for (const p of this.svc.postsBy(to, WINDOW * 2)) { const o = this.origin(p.id); if (o) known[o.id] = this.revs[p.id] ?? ''; }
    this.stats.hellos++;
    this.send({ op: 'hello', known }, to);
  }
  /** Outbox: my reactions / comments on friends' posts, until their author confirms. */
  private flush(only?: string) {
    const online = new Set(this.p2p.online());
    for (const o of this.outbox) {
      if ((only && o.to !== only) || !online.has(o.to)) continue;
      o.tries++; if (o.tries > 1) this.stats.resent++;
      if (o.op === 'react') this.send({ op: 'react', oid: o.oid, id: o.id, reaction: o.reaction ?? null }, o.to);
      else this.send({ op: 'comment', oid: o.oid, id: o.id, text: o.text ?? '' }, o.to);
    }
    this.store('mtw.ig.p2p.outbox', this.outbox);
  }
  private queue(o: Omit<OutItem, 'oid' | 'at' | 'tries'>) {
    // a newer reaction to the same post replaces the one still waiting
    if (o.op === 'react') this.outbox = this.outbox.filter((x) => !(x.op === 'react' && x.to === o.to && x.id === o.id));
    const item: OutItem = { ...o, oid: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), tries: 0 };
    this.outbox = [...this.outbox, item].slice(-OUTBOX_MAX);
    this.store('mtw.ig.p2p.outbox', this.outbox);
    this.flush(o.to);
  }

  private async onLocal(e: Parameters<Parameters<LocalSocialService['subscribe']>[0]>[0]) {
    if (e.type === 'post.created' && e.post.authorId === 'host') { this.send({ op: 'posts', items: [await this.pack(e.post, true)] }); return; }
    if (e.type === 'post.deleted') { if (!this.origin(e.id)) this.send({ op: 'delete', id: e.id }); else delete this.revs[e.id]; return; }
    if (e.type !== 'reaction.changed' && e.type !== 'comment.added') return;
    const o = this.origin(e.post.id);
    if (!o) {
      // my post changed: my friends get the new version (only real people's part of it)
      if (e.post.authorId === 'host' && (e.type === 'reaction.changed' ? e.by === 'host' || REAL.test(e.by) : REAL.test(e.comment.authorId) || e.comment.authorId === 'host')) this.send({ op: 'update', post: this.outbound(e.post) });
      return;
    }
    // a friend's post: what I did goes to its author (they apply it and send the update to everybody)
    if (e.type === 'reaction.changed' && e.by === 'host') this.queue({ to: o.author, op: 'react', id: o.id, reaction: e.reaction });
    if (e.type === 'comment.added' && e.comment.authorId === 'host' && e.comment.text) this.queue({ to: o.author, op: 'comment', id: o.id, text: e.comment.text });
  }
  private async storeRemote(from: string, raw: unknown, photo: string | null) {
    const p = this.inbound(from, raw); if (!p) return false;
    const r = await this.svc.upsertRemote(p, photo);
    if (r.ok) { this.revs[(p as { id: string }).id] = revOf(raw); this.store('mtw.ig.p2p.revs', this.revs); }
    return r.ok;
  }
  private async onRemote(from: string, data: unknown) {
    const m = data as (Msg & { v?: number }) | null;
    if (!REAL.test(from) || !m || typeof m !== 'object' || typeof m.op !== 'string') return;
    this.stats.received++;
    const refuse = () => { this.stats.refused++; };
    switch (m.op) {
      case 'hello': {
        // the friend's copies of my posts: send what is new or changed, and the list of what still exists
        const known = m.known && typeof m.known === 'object' ? m.known : {};
        this.flush(from);                         // their page just opened: what I owe them goes now (not in 20 s)
        const mine = this.svc.postsBy('host', WINDOW);
        this.send({ op: 'snap', ids: mine.map((p) => p.id), oldest: mine.length ? mine[mine.length - 1].createdAt : null }, from);
        for (const p of [...mine].reverse()) {
          const wire = this.outbound(p), have = Object.prototype.hasOwnProperty.call(known, p.id);
          if (have && known[p.id] === revOf(wire)) continue;
          this.send({ op: 'posts', items: [await this.pack(p, !have)] }, from);   // one post per message: a photo is ~100 KB
        }
        return;
      }
      case 'snap': {
        if (!Array.isArray(m.ids)) return refuse();
        const live = new Set(m.ids.filter((x) => typeof x === 'string'));
        for (const p of this.svc.postsBy(from, WINDOW * 4)) {
          const o = this.origin(p.id); if (!o || live.has(o.id)) continue;
          if (m.oldest === null || p.createdAt >= m.oldest) { await this.svc.removeRemote(p.id); delete this.revs[p.id]; }
        }
        this.store('mtw.ig.p2p.revs', this.revs);
        return;
      }
      case 'posts': {
        if (!Array.isArray(m.items)) return refuse();
        for (const it of m.items.slice(0, 10)) if (!(await this.storeRemote(from, it?.post, typeof it?.photo === 'string' ? it.photo : null))) refuse();
        return;
      }
      case 'update': {
        const p = this.inbound(from, m.post); const cur = p ? await this.svc.get((p as { id: string }).id) : null;
        if (!p || !cur?.ok) return refuse();       // updates only for posts I already have (the next hello brings the rest)
        if (!(await this.storeRemote(from, m.post, null))) refuse();
        return;
      }
      case 'delete': if (typeof m.id === 'string') { await this.svc.removeRemote(`${from}:${m.id}`); delete this.revs[`${from}:${m.id}`]; } return;
      case 'react': case 'comment': {
        if (typeof m.oid !== 'string' || m.oid.length > 40 || typeof m.id !== 'string') return refuse();
        // already applied (the ack was lost): just confirm again
        if (this.applied.includes(`${from}:${m.oid}`)) { this.send({ op: 'ack', oid: m.oid }, from); return; }
        const p = await this.svc.get(m.id);
        if (!p.ok || p.value.authorId !== 'host') { this.send({ op: 'ack', oid: m.oid }, from); return refuse(); }   // only on my own posts (gone: nothing to do)
        const r = m.op === 'react' ? (m.reaction === null || isReaction(m.reaction) ? await this.svc.react(m.id, from, m.reaction as never) : null) : typeof m.text === 'string' ? await this.svc.comment(m.id, from, { text: m.text }) : null;
        if (!r?.ok) refuse();
        this.applied = [...this.applied, `${from}:${m.oid}`].slice(-APPLIED_MAX); this.store('mtw.ig.p2p.applied', this.applied);
        this.send({ op: 'ack', oid: m.oid }, from);
        return;
      }
      case 'ack': {
        const n = this.outbox.length; this.outbox = this.outbox.filter((o) => !(o.oid === m.oid && o.to === from));
        if (this.outbox.length !== n) { this.stats.acked++; this.store('mtw.ig.p2p.outbox', this.outbox); }
        return;
      }
      default: refuse();
    }
  }
}
