/**
 * REBOOT R5 — MIInstagram, the app (lives inside the MiiPhone, never a place of the Piazza).
 * A view over SocialFeedService: it renders the feed and sends intents (post, react, comment) back; it owns no domain
 * state. Its own view state (feed / composer, the draft photo, how many pages are shown) survives closing the phone.
 *
 * The feed is paginated (a page at a time, "show more"), cards update in place on service events, photos are loaded
 * lazily, every text from people is escaped. Miifoto 2: a post starts from a Miifoto (Classic Miifoto screen + "share
 * on MIInstagram") or from a photo of the room as it is now (several Miis in it, whatever they are doing).
 */
import type { I18n } from '../i18n/i18n';
import type { FeedEvent, SocialFeedService, FeedErrorCode } from './LocalSocialService';
import { LIMITS, Post, REACTIONS, ReactionId, reactionCounts } from './model';
import './miinstagram.css';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const PAGE = 8;
export const MIINSTAGRAM_ICON = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="5" y="9" width="30" height="24" rx="7" fill="#fff"/><circle cx="20" cy="21" r="7.5" fill="#ff7a2f"/><circle cx="20" cy="21" r="4" fill="#fff"/><circle cx="29.5" cy="14" r="2" fill="#ff5e7a"/><path d="M13 9l2.5-3.5h9L27 9" fill="#fff"/></svg>';
const REACT_ICON: Record<ReactionId, string> = {
  like: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.6 12 20 12 20z"/></svg>',
  haha: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path class="i" d="M7.5 13.5h9a4.5 4.5 0 0 1-9 0zM8 9.5l2 1.2-2 1.2M16 9.5l-2 1.2 2 1.2"/></svg>',
  wow: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle class="i" cx="12" cy="15" r="2.3"/><circle class="i" cx="9" cy="9.8" r="1.2"/><circle class="i" cx="15" cy="9.8" r="1.2"/></svg>',
  cute: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path class="i" d="M8 10.5q1-1.4 2 0M14 10.5q1-1.4 2 0M9 14q3 2.6 6 0"/><circle class="b" cx="7.6" cy="13" r="1.3"/><circle class="b" cx="16.4" cy="13" r="1.3"/></svg>',
};
const KIND_ICON: Record<string, string> = {
  visit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5V20h-6v-5H9v5H3z"/></svg>',
  game: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10a5 5 0 0 1 0 10l-2-2H9l-2 2A5 5 0 0 1 7 7zm1 3v1.5H6.5v1.5H8v1.5h1.5V13H11v-1.5H9.5V10zm7.5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>',
  meet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm16 4h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1v2l-3-2h-5v-1h5a3 3 0 0 0 3-3z"/></svg>',
  social: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>',
};

export interface Directory { name(id: string): string | null; personality(id: string): number; }
export interface MIInstagramDeps {
  svc: SocialFeedService & { persistent?: boolean; lastPersistError?: string | null };
  i18n: I18n;
  me: string;
  directory: () => Directory;
  /** Photo of the room as it is now (null = no room on screen). */
  snapshot: () => string | null;
  /** Opens Miifoto (the phone closes; the photo comes back as a draft). */
  openMiifoto: (() => void) | null;
  /** Closes the phone (e.g. before going to Miifoto). */
  closePhone: () => void;
  /** R6 Settings: ask before deleting a post (default: ask). */
  confirm?: () => boolean;
  /** R6.0b: the photo frame in use (Reboot shop) around the user's own photos; null = none. */
  frame?: () => { a: string; b: string } | null;
}

export class MIInstagramApp {
  view: 'feed' | 'compose' = 'feed';
  draft: { photo: string; source: 'miifoto' | 'room'; caption: string } | null = null;
  private shown = PAGE;
  private open = new Set<string>();
  private el: HTMLElement | null = null;
  private unsubs: (() => void)[] = [];
  private posts: Post[] = [];
  private more = false;
  private msg = '';
  private busy = false;
  /** The own post waiting for "delete?" to be confirmed. */
  private asking: string | null = null;
  /** Unseen posts (the phone shows a dot). */
  unseen = 0;
  private notifySubs = new Set<(n: number) => void>();
  constructor(private d: MIInstagramDeps) {
    d.svc.subscribe((e) => { if (e.type === 'post.created' && !this.el && e.post.authorId !== d.me) { this.unseen++; for (const s of this.notifySubs) s(this.unseen); } });
  }
  onUnseen(cb: (n: number) => void) { this.notifySubs.add(cb); return () => this.notifySubs.delete(cb); }
  /** A Miifoto shared from the Miifoto screen becomes the draft of a new post. */
  setDraft(photo: string, source: 'miifoto' | 'room') { this.draft = { photo, source, caption: this.draft?.caption ?? this.captionBuf }; this.view = 'compose'; if (this.el) this.render(); }
  get mounted() { return !!this.el; }
  get renderedCards() { return this.el?.querySelectorAll('.mi-card').length ?? 0; }

  mount(el: HTMLElement) {
    this.el = el; this.unseen = 0; for (const s of this.notifySubs) s(0);
    el.classList.add('mi-app');
    el.addEventListener('click', this.onClick); el.addEventListener('submit', this.onSubmit); el.addEventListener('input', this.onInput);
    this.unsubs.push(this.d.svc.subscribe((e) => this.onFeed(e)));
    this.unsubs.push(this.d.i18n.subscribe(() => this.render()));
    void this.load();
    return () => {
      for (const u of this.unsubs) u(); this.unsubs = [];
      el.removeEventListener('click', this.onClick); el.removeEventListener('submit', this.onSubmit); el.removeEventListener('input', this.onInput);
      el.classList.remove('mi-app'); el.innerHTML = ''; this.el = null; this.posts = [];
    };
  }
  private async load() {
    const r = await this.d.svc.feed({ limit: this.shown });
    if (!this.el) return;
    if (r.ok) { this.posts = r.value.items; this.more = !!r.value.next; } else this.msg = this.err(r.code);
    this.render();
  }
  private err(code: FeedErrorCode) { return this.d.i18n.t(`feed.err.${code}`); }
  private t = (k: string, v?: Record<string, string | number>) => this.d.i18n.t(k, v);

  private onFeed(e: FeedEvent) {
    if (!this.el) return;
    if (e.type === 'persist.failed') { this.msg = this.err('PERSISTENCE'); this.status(); return; }
    if (e.type === 'post.created' || e.type === 'post.deleted') { void this.load(); return; }
    if (e.type === 'post.updated' || e.type === 'comment.added' || e.type === 'reaction.changed') {
      const i = this.posts.findIndex((p) => p.id === e.post.id); if (i < 0) return;
      this.posts[i] = e.post;
      const card = this.el.querySelector(`.mi-card[data-id="${CSS.escape(e.post.id)}"]`);
      if (card && this.view === 'feed') { const fresh = this.card(e.post); card.replaceWith(fresh); this.loadPhotos(fresh); }
    }
  }
  private render() {
    const el = this.el; if (!el) return;
    if (this.view === 'compose') { el.innerHTML = this.composeHtml(); return; }
    const local = this.d.svc.persistent === false ? `<p class="mi-warn">${esc(this.t('feed.memoryOnly'))}</p>` : '';
    el.innerHTML = `<header class="mi-head"><span class="mi-logo">${MIINSTAGRAM_ICON}<small>${esc(this.t('feed.tagline'))}</small></span><button type="button" class="mi-new r-btn primary sm" data-a="new">${esc(this.t('feed.new'))}</button></header>
      ${local}<p class="mi-msg" role="status">${esc(this.msg)}</p>
      <div class="mi-feed">${this.posts.length ? '' : `<div class="mi-emptybox r-empty"><p>${esc(this.t('feed.empty'))}</p><button type="button" class="r-btn primary" data-a="new">${esc(this.t('feed.firstPost'))}</button></div>`}</div>
      ${this.more ? `<button type="button" class="r-btn mi-more" data-a="more">${esc(this.t('feed.more'))}</button>` : ''}
      <p class="mi-foot r-note">${esc(this.t('feed.localNote'))}</p>`;
    const feed = el.querySelector('.mi-feed')!;
    for (const p of this.posts) feed.append(this.card(p));
    this.loadPhotos(el);
  }
  private status() { const m = this.el?.querySelector('.mi-msg'); if (m) m.textContent = this.msg; }
  private author(id: string) {
    const dir = this.d.directory(), name = dir.name(id) ?? this.t('feed.unknownMii'), p = dir.personality(id);
    return { name, p: [0, 1, 2, 3].includes(p) ? p : 2, initial: (name.trim()[0] ?? '?').toUpperCase() };
  }
  private card(p: Post): HTMLElement {
    const a = this.author(p.authorId), mine = p.reactions[this.d.me] ?? null, counts = reactionCounts(p);
    const art = document.createElement('article'); art.className = `mi-card r-card k-${p.kind}`; art.dataset.id = p.id;
    let body = '';
    const fr = p.kind === 'photo' && p.authorId === this.d.me ? this.d.frame?.() ?? null : null;
    if (p.kind === 'photo') body = `<div class="mi-photo${fr ? ' framed' : ''}"${fr ? ` style="--frame-a:${fr.a};--frame-b:${fr.b}"` : ''} data-photo="${esc(p.photoId)}"><span class="mi-ph-wait"></span></div>${p.caption ? `<p class="mi-cap"><b>${esc(a.name)}</b> ${esc(p.caption)}</p>` : ''}`;
    if (p.kind === 'activity') body = `<div class="mi-act a-${p.activity}"><span class="mi-act-ico">${KIND_ICON[p.activity] ?? KIND_ICON.social}</span><p>${esc(this.d.i18n.line(p.line))}</p></div>`;
    if (p.kind === 'answer') body = `<div class="mi-ans"><p class="mi-q">${esc(this.d.i18n.line(p.question))}</p><p class="mi-a">“${esc(p.answer)}”</p></div>`;
    const showAll = this.open.has(p.id), list = showAll ? p.comments : p.comments.slice(-2);
    const comments = list.map((c) => { const ca = this.author(c.authorId); return `<li><b>${esc(ca.name)}</b> ${esc(c.text ?? (c.line ? this.d.i18n.line(c.line) : ''))}</li>`; }).join('');
    const own = p.authorId === this.d.me;
    const del = !own ? '' : this.asking === p.id
      ? `<div class="mi-ask" role="group" aria-label="${esc(this.t('feed.deleteAsk'))}"><span>${esc(this.t('feed.deleteAsk'))}</span><button type="button" class="r-btn danger sm" data-delyes="${esc(p.id)}">${esc(this.t('feed.deleteYes'))}</button><button type="button" class="r-btn ghost sm" data-delno="${esc(p.id)}">${esc(this.t('feed.deleteNo'))}</button></div>`
      : '';
    art.innerHTML = `<header><span class="r-avatar p${a.p}" aria-hidden="true">${esc(a.initial)}</span><span class="mi-who"><b>${esc(a.name)}</b><small>${esc(this.d.i18n.ago(p.createdAt))} · ${esc(this.t('feed.kind.' + p.kind))}</small></span>${own ? `<button type="button" class="mi-del" data-del="${esc(p.id)}" aria-label="${esc(this.t('feed.delete'))}" title="${esc(this.t('feed.delete'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></button>` : ''}</header>
      ${del}${body}
      <div class="mi-reacts" role="group" aria-label="${esc(this.t('feed.reactions'))}">${REACTIONS.map((r) => `<button type="button" class="mi-r r-${r.id}" data-react="${r.id}" aria-pressed="${mine === r.id}" title="${esc(this.t('react.' + r.id))}">${REACT_ICON[r.id]}<span>${counts[r.id] || ''}</span><em class="sr">${esc(this.t('react.' + r.id))}</em></button>`).join('')}</div>
      ${p.comments.length > 2 && !showAll ? `<button type="button" class="mi-link" data-all="${esc(p.id)}">${esc(this.d.i18n.tn('feed.allComments', p.comments.length))}</button>` : ''}
      <ul class="mi-comments">${comments}</ul>
      <form class="mi-cform" data-post="${esc(p.id)}"><input name="c" maxlength="${LIMITS.comment}" autocomplete="off" placeholder="${esc(this.t('feed.commentPh'))}" aria-label="${esc(this.t('feed.commentPh'))}"><button type="submit" class="r-btn sm">${esc(this.t('feed.send'))}</button></form>`;
    return art;
  }
  private loadPhotos(root: ParentNode) {
    root.querySelectorAll<HTMLElement>('.mi-photo[data-photo]').forEach((box) => {
      const id = box.dataset.photo!; box.removeAttribute('data-photo');
      void this.d.svc.photo(id).then((url) => {
        if (!box.isConnected) return;
        if (!url) { box.innerHTML = `<p class="mi-noimg">${esc(this.t('feed.err.IMAGE_UNAVAILABLE'))}</p>`; return; }
        const img = new Image(); img.alt = this.t('feed.photoAlt'); img.decoding = 'async'; img.src = url; box.replaceChildren(img);
      });
    });
  }
  private composeHtml() {
    const d = this.draft;
    return `<header class="mi-head"><span class="mi-logo">${MIINSTAGRAM_ICON}<b>${esc(this.t('compose.title'))}</b></span><button type="button" class="r-btn ghost sm" data-a="cancel">${esc(this.t('compose.cancel'))}</button></header>
      <p class="mi-msg" role="status">${esc(this.msg)}</p>
      <div class="mi-compose">
        ${d ? `<div class="mi-photo big"><img src="${d.photo}" alt="${esc(this.t('feed.photoAlt'))}"></div>` : `<div class="mi-pick"><p>${esc(this.t('compose.pick'))}</p></div>`}
        <div class="mi-sources">
          <button type="button" class="r-btn blue" data-a="snap">${esc(this.t('compose.fromRoom'))}</button>
          ${this.d.openMiifoto ? `<button type="button" class="r-btn purple" data-a="miifoto">${esc(this.t('compose.fromMiifoto'))}</button>` : ''}
        </div>
        <label class="mi-field r-field"><span>${esc(this.t('compose.caption'))}</span><textarea name="caption" rows="3" maxlength="${LIMITS.caption}">${esc(d?.caption ?? this.captionBuf)}</textarea><small data-count>${(d?.caption ?? this.captionBuf).length}/${LIMITS.caption}</small></label>
        <button type="button" class="r-btn primary lg" data-a="publish" ${d && !this.busy ? '' : 'disabled'}>${esc(this.t('compose.publish'))}</button>
        <p class="mi-hint r-note">${esc(this.t('compose.hint'))}</p>
      </div>`;
  }
  private onInput = (e: Event) => {
    const ta = e.target as HTMLTextAreaElement;
    if (ta.name !== 'caption') return;
    this.captionBuf = ta.value; if (this.draft) this.draft.caption = ta.value;
    const c = this.el?.querySelector('[data-count]'); if (c) c.textContent = `${ta.value.length}/${LIMITS.caption}`;
  };
  private captionBuf = '';
  private onSubmit = (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement; const id = f.dataset.post; if (!id) return;
    const inp = f.querySelector<HTMLInputElement>('input[name=c]')!; const text = inp.value.trim(); if (!text) return;
    inp.disabled = true;
    void this.d.svc.comment(id, this.d.me, { text }).then((r) => { inp.disabled = false; if (r.ok) inp.value = ''; else { this.msg = this.err(r.code); this.status(); } });
  };
  private onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a],[data-react],[data-all],[data-del],[data-delyes],[data-delno]'); if (!b || !this.el) return;
    if (b.dataset.del) { if (this.d.confirm?.() ?? true) { this.asking = b.dataset.del; this.refreshCard(b.dataset.del); } else void this.remove(b.dataset.del); return; }
    if (b.dataset.delno) { this.asking = null; this.refreshCard(b.dataset.delno); return; }
    if (b.dataset.delyes) { void this.remove(b.dataset.delyes); return; }
    if (b.dataset.react) { const card = b.closest<HTMLElement>('.mi-card')!; const id = card.dataset.id!; const r = b.dataset.react as ReactionId; const mine = b.getAttribute('aria-pressed') === 'true';
      void this.d.svc.react(id, this.d.me, mine ? null : r).then((res) => { if (!res.ok) { this.msg = this.err(res.code); this.status(); } }); return; }
    if (b.dataset.all) { this.open.add(b.dataset.all); this.refreshCard(b.dataset.all); return; }
    const a = b.dataset.a; this.msg = '';
    if (a === 'new') { this.view = 'compose'; this.render(); }
    if (a === 'cancel') { this.view = 'feed'; this.render(); void this.load(); }
    if (a === 'more') { this.shown += PAGE; void this.load(); }
    if (a === 'snap') { const ph = this.d.snapshot(); if (!ph) { this.msg = this.t('compose.noRoom'); this.status(); return; } this.draft = { photo: ph, source: 'room', caption: this.draft?.caption ?? this.captionBuf }; this.render(); }
    if (a === 'miifoto' && this.d.openMiifoto) { this.d.closePhone(); this.d.openMiifoto(); }
    if (a === 'publish') void this.publish();
  };
  private refreshCard(id: string) {
    const p = this.posts.find((x) => x.id === id), card = this.el?.querySelector(`.mi-card[data-id="${CSS.escape(id)}"]`);
    if (p && card) { const fresh = this.card(p); card.replaceWith(fresh); this.loadPhotos(fresh); }
  }
  /** Deletes an own post (the service refuses other people's posts: FORBIDDEN). */
  private async remove(id: string) {
    this.asking = null;
    const r = await this.d.svc.deletePost(id, this.d.me);
    this.msg = r.ok ? this.t('feed.deleted') : this.err(r.code);
    if (r.ok) await this.load(); else { this.refreshCard(id); this.status(); }
  }
  private async publish() {
    const d = this.draft; if (!d || this.busy) return;
    this.busy = true; this.render();
    const r = await this.d.svc.createPhotoPost(this.d.me, { photo: d.photo, caption: d.caption, source: d.source });
    this.busy = false;
    if (!r.ok) { this.msg = this.err(r.code); this.render(); return; }
    this.draft = null; this.captionBuf = ''; this.view = 'feed'; this.msg = this.t('compose.done');
    this.shown = Math.max(this.shown, PAGE);
    await this.load();
  }
}
