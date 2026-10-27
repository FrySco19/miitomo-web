/**
 * Room overlay (M8): Mii status, speech balloon, touch menu, interactive-object badges.
 *
 * Reference: asset_layout_v2-0_room (CCBI, REVERSED by string tables):
 *   talkBalloonBody00 = balloon00 (NACCBBalloon: nameLabel, textLabel, winArrow, appear/disappear/loop anims)
 *                       + btnRoot (ok00, onemoreBtn00, knowledgeHearMore)
 *   roomTouchBody00/01 = roomTouchBtn00-02 + balloonMenu00 / balloonMenuL/C/R (balloonTextBtn02/03), iconTextBtnL
 * This is a desktop/web adaptation, not a copy of the phone screen: one balloon anchored above the Mii's head, the
 * menu as a column of buttons next to it, keyboard and mouse friendly. Art = original sprites decoded locally
 * (texture00 balloonMenu00 / nextBtnOff01 / winArrow00 / hand); geometry, timing and typewriter speed APPROXIMATED.
 * Texts = original MSBT labels (VERIFIED); a missing file falls back to a visible PLACEHOLDER label.
 */
import { line, label, render, RenderCtx, Page } from './RoomText';
import { sprite, balloonImage, layoutAvailable } from './LayoutSprites';

export interface MenuItem { id: string; text: string; src: string; disabled?: string; action: () => void; }
export interface BalloonSpec {
  kind: 'greeting' | 'touch' | 'answer' | 'goodbye' | 'chat';   // chat: Reboot Mii ↔ Mii talk (new)
  rel: string; label: string; fallback: string;
  text?: string;                // literal text written by the user (answers): no MSBT line
  menu?: MenuItem[];
  ok?: boolean;                 // shows the ok00 button after the last page
  autoClose?: number;           // s after the last page is fully typed
  onClose?: () => void;
  /** M18: which Mii speaks (balloon anchor, talking face, gesture, voice). Default: the host (the user's Mii). */
  speaker?: 'host' | 'guest';
  /** M18: text context of the speaker (nickname, greetings tags 1.2–1.5) when it is not the host. */
  ctx?: RenderCtx;
}
interface Open { spec: BalloonSpec; pages: Page[]; page: number; shown: number; total: number; hold: number; done: boolean; closeIn: number; source: string; emotion: string | null; rules: string[]; voiced?: number; }

const CPS = 38;          // typewriter, characters per second (APPROXIMATED)
const BREAK = 0.22;      // s, pause at a SentenceBreak tag (APPROXIMATED)

export class RoomUI {
  readonly root: HTMLDivElement;
  private status: HTMLDivElement;
  private balloon: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private arrow: HTMLDivElement;
  private actions: HTMLDivElement;
  private menu: HTMLDivElement;
  private badges: HTMLDivElement;
  private hint: HTMLDivElement;
  private open: Open | null = null;
  private bgKey = '';
  ctx: RenderCtx = { nickname: 'Mii', female: false };
  readonly shown: { kind: string; label: string; source: string; text: string; at: number }[] = [];
  onSound: (key: string) => void = () => {};
  /** Voice provider hooks: a page starts / the balloon closes. The typewriter never waits for the voice. */
  onVoicePage: (text: string) => void = () => {};
  onVoiceStop: () => void = () => {};
  /** Called when a balloon starts: emotion / expression-rule tags of the line and the user's own words in it. */
  onSpeak: (info: { kind: string; label: string; emotion: string | null; rules: string[]; userText: string; speaker: 'host' | 'guest' }) => void = () => {};
  anchor = { x: 0, y: 0, visible: false };

  constructor(stage: HTMLElement) {
    this.root = el('div', 'room-overlay');
    this.status = el('div', 'room-status');
    this.balloon = el('div', 'room-balloon'); this.balloon.hidden = true; this.balloon.setAttribute('role', 'dialog'); this.balloon.setAttribute('aria-live', 'polite');
    this.nameEl = el('div', 'rb-name');
    this.textEl = el('div', 'rb-text');
    this.arrow = el('div', 'rb-arrow'); this.arrow.hidden = true;
    this.actions = el('div', 'rb-actions');
    this.balloon.append(this.nameEl, this.textEl, this.arrow, this.actions);
    this.menu = el('div', 'room-menu'); this.menu.hidden = true; this.menu.setAttribute('role', 'menu');
    this.badges = el('div', 'room-badges');
    this.hint = el('div', 'room-hint'); this.hint.hidden = true;
    this.root.append(this.badges, this.status, this.balloon, this.menu, this.hint);
    stage.append(this.root);
    this.balloon.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) return; this.advance(); });
    window.addEventListener('keydown', (e) => {
      if (!this.open || (e.target as HTMLElement).closest('textarea, input, select')) return;
      if (e.key === 'Enter') { e.preventDefault(); this.advance(); }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    this.applySkin();
  }

  /** Original sprites (if the layout zip is imported) as CSS backgrounds; plain CSS shapes otherwise. */
  applySkin() {
    const ok = layoutAvailable();
    this.root.classList.toggle('skin-original', ok);
    if (!ok) return;
    const arrow = sprite('texture00', 'winArrow00.png'); if (arrow) this.arrow.style.backgroundImage = `url(${arrow.url})`;
    const btn = sprite('texture00', 'nextBtnOff01.png'), btnOn = sprite('texture00', 'nextBtnOn01.png');
    if (btn) this.root.style.setProperty('--btn-img', `url(${btn.url})`);
    if (btnOn) this.root.style.setProperty('--btn-img-on', `url(${btnOn.url})`);
    const hand = sprite('texture00', 'hand.png');
    if (hand) {
      const c = document.createElement('canvas'); c.width = 40; c.height = 40; const g = c.getContext('2d')!;
      const k = 40 / Math.max(hand.w, hand.h); g.drawImage(hand.canvas, (40 - hand.w * k) / 2, 0, hand.w * k, hand.h * k);
      this.root.style.setProperty('--hand-cursor', `url(${c.toDataURL()}) 12 2`);
    }
  }
  get handCursor() { return this.root.style.getPropertyValue('--hand-cursor'); }

  setStatus(state: string, label: string, clip: string, extra = '') {
    this.status.dataset.state = state;
    this.status.innerHTML = `<span class="rs-dot" aria-hidden="true"></span><span class="rs-state">${esc(label)}</span><span class="rs-clip">${esc(clip)}</span>${extra ? `<span class="rs-extra">${esc(extra)}</span>` : ''}`;
  }
  setHint(text: string | null, x = 0, y = 0) {
    this.hint.hidden = !text; if (!text) return;
    this.hint.textContent = text; this.hint.style.left = `${x}px`; this.hint.style.top = `${y}px`;
  }
  setBadges(items: { name: string; label: string; x: number; y: number; visible: boolean; active: boolean }[]) {
    const have = new Map([...this.badges.children].map((c) => [(c as HTMLElement).dataset.name!, c as HTMLElement]));
    for (const it of items) {
      let b = have.get(it.name);
      if (!b) { b = el('div', 'room-badge'); b.dataset.name = it.name; b.title = it.label; this.badges.append(b); }
      have.delete(it.name);
      b.hidden = !it.visible; b.classList.toggle('active', it.active);
      b.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px)`;
    }
    for (const b of have.values()) b.remove();
  }

  get isOpen() { return !!this.open; }
  /** True while the typewriter is writing (used for the talking mouth). */
  get isTalking() { const o = this.open; return !!o && o.shown < pageLen(o.pages[o.page]) && o.hold <= 0; }
  get openKind() { return this.open?.spec.kind ?? null; }
  /** Label of the open balloon (lets a caller tell whether its own balloon is still the one shown). */
  get openLabel() { return this.open?.spec.label ?? null; }
  get speaker(): 'host' | 'guest' { return this.open?.spec.speaker ?? 'host'; }

  show(spec: BalloonSpec) {
    this.close(true);
    const l = spec.text !== undefined ? null : line(spec.rel, spec.label);
    const ctx = spec.ctx ?? this.ctx;
    const r = l ? render(l.nodes, ctx) : { pages: [{ spans: [{ text: spec.text ?? spec.fallback, ...(spec.text !== undefined ? { user: true } : {}) }] }], emotion: null, rules: [] as string[] };
    const total = r.pages.reduce((a, p) => Math.max(a, p.spans.reduce((n, s) => n + s.text.length, 0)), 0);
    this.open = { spec, pages: r.pages.length ? r.pages : [{ spans: [{ text: spec.fallback }] }], page: 0, shown: 0, total, hold: 0, done: false, closeIn: spec.autoClose ?? Infinity, source: l ? `${l.lang}:${spec.rel}#${spec.label}` : spec.text !== undefined ? 'USER' : 'PLACEHOLDER', emotion: r.emotion, rules: r.rules };
    this.balloon.hidden = false;
    this.balloon.dataset.kind = spec.kind;
    this.balloon.dataset.source = this.open.source;
    this.balloon.classList.toggle('placeholder', !l && spec.text === undefined);
    this.nameEl.textContent = ctx.nickname;
    this.balloon.dataset.speaker = spec.speaker ?? 'host';
    this.actions.innerHTML = '';
    this.menu.hidden = true; this.menu.innerHTML = '';
    this.balloon.classList.remove('in'); void this.balloon.offsetWidth; this.balloon.classList.add('in');
    this.onSound('appearAnim_asset/layout/room/Published-iOS/body/talkBalloonBody00.ccbi_balloon00');
    this.shown.push({ kind: spec.kind, label: spec.label, source: this.open.source, text: this.open.pages.map((p) => p.spans.map((s) => s.text).join('')).join(' ¶ '), at: performance.now() });
    if (this.shown.length > 300) this.shown.splice(0, this.shown.length - 300);   // diagnostics history, bounded (long sessions)
    this.drawPage();
    const userText = r.pages.flatMap((p) => p.spans.filter((x) => x.user).map((x) => x.text)).join(' ');
    try { this.onSpeak({ kind: spec.kind, label: spec.label, emotion: r.emotion, rules: r.rules, userText, speaker: spec.speaker ?? 'host' }); } catch (e) { console.warn(e); }
  }
  /** Click / Enter: finish typing, next page, or close (when there are no buttons). */
  advance() {
    const o = this.open; if (!o) return;
    const len = pageLen(o.pages[o.page]);
    if (o.shown < len) { o.shown = len; this.drawPage(); return; }
    if (o.page + 1 < o.pages.length) { o.page++; o.shown = 0; o.hold = 0; this.drawPage(); return; }
    if (!o.spec.menu && !o.spec.ok) this.close();
  }
  close(silent = false) {
    const o = this.open; if (!o) return;
    this.open = null;
    this.balloon.hidden = true; this.menu.hidden = true; this.menu.innerHTML = ''; this.actions.innerHTML = '';
    if (!silent && o.spec.menu) this.onSound('decideToOff_asset/layout/room/Published-iOS/body/roomTouchBody00.ccbi_balloonMenu00');
    this.onVoiceStop();
    o.spec.onClose?.();
  }

  private drawPage() {
    const o = this.open!; const pg = o.pages[o.page];
    if (o.voiced !== o.page) { o.voiced = o.page; try { this.onVoicePage(pg.spans.filter((x) => x.rule !== '__break').map((x) => x.text).join('')); } catch (e) { console.warn(e); } }
    let left = Math.floor(o.shown);
    const frag = document.createDocumentFragment();
    for (const s of pg.spans) {
      if (left <= 0) break;
      if (s.rule === '__break') { left -= s.text.length; continue; }
      const t = s.text.slice(0, left); left -= s.text.length;
      const sp = document.createElement('span'); sp.textContent = t;
      if (s.color) sp.style.color = s.color;
      if (s.rule) { sp.className = 'rb-em'; sp.dataset.rule = s.rule; }
      frag.append(sp);
    }
    this.textEl.replaceChildren(frag);
    this.textEl.dataset.full = pg.spans.filter((s) => s.rule !== '__break').map((s) => s.text).join('');
    const typed = o.shown >= pageLen(pg);
    this.arrow.hidden = !(typed && o.page + 1 < o.pages.length);
    if (typed && o.page + 1 >= o.pages.length && !o.done) { o.done = true; this.finish(); }
  }
  private finish() {
    const o = this.open!;
    if (o.spec.ok) {
      const b = document.createElement('button'); b.className = 'rb-btn';
      b.textContent = label('Layout/room/parts/layer1/cmnBtn01.msbt', 'title00@knowledgeOk', 'OK');
      b.addEventListener('click', () => { this.onSound('decide_asset/layout/room/Published-iOS/body/talkBalloonBody00.ccbi_btnRoot_ok00'); this.close(true); });
      this.actions.append(b);
    }
    if (o.spec.menu) {
      this.menu.innerHTML = '';
      for (const m of o.spec.menu) {
        const b = document.createElement('button'); b.className = 'rm-btn'; b.setAttribute('role', 'menuitem'); b.dataset.id = m.id; b.dataset.src = m.src;
        b.textContent = m.text;
        if (m.disabled) { b.disabled = true; b.title = m.disabled; }
        b.addEventListener('click', () => { this.onSound('decide_asset/layout/room/Published-iOS/body/roomTouchBody00.ccbi_roomTouchBtn00'); m.action(); });
        this.menu.append(b);
      }
      this.menu.hidden = false;
      this.onSound('decideToOn_asset/layout/room/Published-iOS/body/roomTouchBody00.ccbi_balloonMenu00');
    }
  }

  /** Per frame: typewriter + auto close + anchor the balloon above the Mii's head (stage pixels). */
  tick(dt: number) {
    const o = this.open;
    if (o) {
      const len = pageLen(o.pages[o.page]);
      if (o.shown < len) {
        if (o.hold > 0) o.hold -= dt;
        else {
          const before = Math.floor(o.shown);
          o.shown = Math.min(len, o.shown + dt * CPS);
          // pause when the typewriter crosses a SentenceBreak marker
          let acc = 0; for (const s of o.pages[o.page].spans) { const end = acc + s.text.length; if (s.rule === '__break' && before < end && o.shown >= acc) { o.hold = BREAK; o.shown = end; break; } acc = end; }
        }
        this.drawPage();
      } else if (o.done && isFinite(o.closeIn)) {
        o.closeIn -= dt; if (o.closeIn <= 0) this.close(true);
      }
    }
    this.place();
  }
  private place() {
    if (this.balloon.hidden) return;
    const st = this.root.getBoundingClientRect();
    const bw = this.balloon.offsetWidth, bh = this.balloon.offsetHeight;
    const x = Math.round(Math.min(Math.max(8, this.anchor.x - bw / 2), st.width - bw - 8));
    const y = Math.round(Math.max(8, this.anchor.y - bh - 10));
    this.balloon.style.transform = `translate(${x}px, ${y}px)`;
    const tailX = Math.min(Math.max(24, this.anchor.x - x), bw - 24);
    this.balloon.style.setProperty('--tail-x', `${tailX}px`);
    const key = `${bw}x${bh}@${Math.round(tailX / 6)}`;
    if (key !== this.bgKey && this.root.classList.contains('skin-original') && bw > 0) {
      this.bgKey = key;
      const url = balloonImage(bw, bh, Math.min(2, window.devicePixelRatio || 1), tailX);
      if (url) this.balloon.style.backgroundImage = `url(${url})`;
    }
    if (!this.menu.hidden) {
      const mw = this.menu.offsetWidth, mh = this.menu.offsetHeight;
      const dock = st.width < 600;                       // phone: menu docked at the bottom of the stage
      this.menu.classList.toggle('dock', dock);
      let mx: number, my: number;
      if (dock) { mx = 8; my = st.height - mh - 34; }
      else if (x + bw + 12 + mw <= st.width - 8) { mx = x + bw + 12; my = Math.min(Math.max(8, y), st.height - mh - 8); }
      else if (x - 12 - mw >= 8) { mx = x - 12 - mw; my = Math.min(Math.max(8, y), st.height - mh - 8); }
      else { mx = Math.max(8, Math.min(st.width - mw - 8, this.anchor.x - mw / 2)); my = Math.min(st.height - mh - 8, y + bh + 8); }
      this.menu.style.transform = `translate(${Math.round(mx)}px, ${Math.round(my)}px)`;
    }
  }
  /** Read-only snapshot for tests / diagnostics. */
  snapshot() {
    const o = this.open;
    return o ? { kind: o.spec.kind, label: o.spec.label, source: o.source, page: o.page, pages: o.pages.length, typed: o.shown >= pageLen(o.pages[o.page]), text: this.textEl.dataset.full ?? '', emotion: o.emotion, rules: o.rules,
      menu: [...this.menu.querySelectorAll('button')].map((b) => ({ id: (b as HTMLElement).dataset.id, text: b.textContent, disabled: (b as HTMLButtonElement).disabled, src: (b as HTMLElement).dataset.src })) } : null;
  }
  clickMenu(id: string) { (this.menu.querySelector(`button[data-id="${id}"]`) as HTMLButtonElement | null)?.click(); }
  clickOk() { (this.actions.querySelector('button') as HTMLButtonElement | null)?.click(); }
  dispose() { this.root.remove(); }
}

function pageLen(p: Page) { return p.spans.reduce((n, s) => n + s.text.length, 0); }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) { const e = document.createElement(tag); e.className = cls; return e as HTMLElementTagNameMap[K] & HTMLDivElement; }
function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
