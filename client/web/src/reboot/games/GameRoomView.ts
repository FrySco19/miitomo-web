/**
 * REBOOT R5 — Sala Giochi VIEW: the games board while the user is in the Sala Giochi, the match panel during a match,
 * the result afterwards. It renders GameRoomController / GameSession and sends intents (play, answer, back to the
 * room); the room behind it stays visible (the Miis gather, watch and react there).
 */
import type { I18n } from '../i18n/i18n';
import type { GameRoomController, GameRoomEvent } from './GameRoomController';
import type { GameSession } from './GameSession';
import './games.css';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export class GameRoomView {
  readonly el: HTMLElement;
  private unsubs: (() => void)[] = [];
  private timer = 0;
  private msg = '';
  private shown = '';
  constructor(private games: GameRoomController, private i18n: I18n, root: HTMLElement) {
    this.el = document.createElement('section'); this.el.className = 'gr-layer'; this.el.hidden = true;
    this.el.addEventListener('click', (e) => this.onClick(e));
    root.append(this.el);
    this.unsubs.push(games.subscribe((e) => this.onGame(e)));
    this.unsubs.push(games.visit.subscribe(() => void this.render()));
    this.unsubs.push(i18n.subscribe(() => void this.render(true)));
    void this.render();
  }
  private t = (k: string, v?: Record<string, string | number>) => this.i18n.t(k, v);
  private onGame(e: GameRoomEvent) {
    if (e.type === 'started') { this.msg = ''; this.startTimer(); }
    if (e.type === 'session' && (e.e.type === 'finished' || e.e.type === 'aborted')) this.stopTimer();
    if (e.type === 'closed') this.stopTimer();
    void this.render(true);
  }
  private startTimer() { this.stopTimer(); this.timer = window.setInterval(() => this.tickBar(), 200); }
  private stopTimer() { clearInterval(this.timer); this.timer = 0; }
  get timers() { return this.timer ? 1 : 0; }
  private tickBar() {
    const s = this.games.session; const bar = this.el.querySelector<HTMLElement>('[data-time]'); if (!s || !bar) return;
    const v = s.logic.view; bar.style.width = `${Math.round((v.timeLeft / v.timeLimit) * 100)}%`;
  }
  private async onClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-play],[data-answer],[data-a]'); if (!b || b.disabled) return;
    if (b.dataset.play) {
      b.disabled = true;
      const r = await this.games.start(b.dataset.play);
      this.msg = r.ok ? '' : this.t(`game.err.${r.code}${r.detail ? '.' + r.detail : ''}`);
      void this.render(true);
    }
    if (b.dataset.answer !== undefined) { if (this.games.answer(Number(b.dataset.answer))) void this.render(true); }
    if (b.dataset.a === 'back') { this.games.closeResult(); this.msg = ''; void this.render(true); }
  }
  async render(force = false) {
    const here = this.games.here && this.games.visit.mode === 'inside';
    this.el.hidden = !here;
    if (!here) { this.shown = ''; this.el.innerHTML = ''; return; }
    const s = this.games.session;
    const key = s ? `${s.id}:${s.state}:${s.logic.view.round}:${s.logic.view.phase}:${JSON.stringify(s.logic.view.answered)}` : 'board';
    if (!force && key === this.shown) return;
    this.shown = key;
    if (!s) { this.el.innerHTML = await this.board(); return; }
    if (s.state === 'finished' || s.state === 'aborted') { this.el.innerHTML = this.result(s); return; }
    this.el.innerHTML = this.match(s); this.tickBar();
  }
  private async board() {
    const ctx = await this.games.context();
    const st = this.games.stats;
    const rows = this.games.registry.status(ctx).map(({ def, availability }) => `<li class="gr-game"><div><b>${esc(this.t(def.titleKey))}</b><p>${esc(this.t(def.descKey))}</p><small>${esc(this.t('game.meta', { min: def.players.min, max: def.players.max, sec: def.durationSec }))}</small>${availability.ok ? '' : `<em>${esc(this.t(`game.unavailable.${availability.code}`, availability.vars))}</em>`}</div><button type="button" class="gr-play r-btn purple" data-play="${esc(def.id)}" ${availability.ok ? '' : 'disabled'}>${esc(this.t('game.play'))}</button></li>`).join('');
    const free = this.games.freeMiis().length;
    return `<div class="gr-board"><header><b>${esc(this.t('games.board'))}</b><small>${esc(this.t('games.here', { n: free }))}</small></header>
      <ul class="gr-games">${rows}</ul>
      <p class="gr-stats">${esc(this.t('games.stats', { played: st.played, wins: st.wins }))}${st.badges.length ? ` · ${esc(st.badges.map((b) => this.t('reward.' + b)).join(', '))}` : ''}</p>
      <p class="gr-msg" role="status">${esc(this.msg)}</p></div>`;
  }
  private match(s: GameSession) {
    const v = s.logic.view, mine = v.answered.host;
    const opts = v.options.map((o, i) => {
      const cls = v.phase === 'reveal' ? (i === v.correct ? ' right' : i === mine ? ' wrong' : '') : i === mine ? ' picked' : '';
      return `<button type="button" class="gr-opt${cls}" data-answer="${i}" ${v.phase !== 'question' || mine !== null ? 'disabled' : ''}>${esc(o)}</button>`;
    }).join('');
    const board = s.players.map((p) => `<li class="${s.leftIds.includes(p.id) ? 'left' : ''}"><span>${esc(p.isUser ? this.t('game.you') : p.name)}</span><b>${v.scores[p.id] ?? 0}</b>${v.answered[p.id] !== null && v.answered[p.id] !== undefined ? '<i aria-hidden="true">✓</i>' : ''}</li>`).join('');
    return `<div class="gr-match" role="group" aria-label="${esc(this.t(s.def.titleKey))}">
      <header><b>${esc(this.t(s.def.titleKey))}</b><small>${esc(this.t('game.round', { n: v.round, of: v.rounds }))}</small></header>
      <div class="gr-time"><span data-time></span></div>
      <p class="gr-q">${esc(this.i18n.line(v.prompt))}</p>
      <div class="gr-opts">${opts}</div>
      <p class="gr-reveal" role="status">${v.phase === 'reveal' ? esc(mine === v.correct ? this.t('game.right') : mine === null ? this.t('game.timeout') : this.t('game.wrong')) : ''}</p>
      <ul class="gr-score">${board}</ul>
      <p class="gr-sim">${esc(this.t('game.simNote'))}</p></div>`;
  }
  private result(s: GameSession) {
    if (s.state === 'aborted') return `<div class="gr-result"><b>${esc(this.t('game.aborted.' + (s.abortCode ?? 'INTERRUPTED')))}</b><button type="button" class="gr-play r-btn purple" data-a="back">${esc(this.t('game.backToRoom'))}</button></div>`;
    const r = s.result!, reward = this.games.lastReward;
    const won = r.winners.includes('host');
    return `<div class="gr-result"><header><b>${esc(won ? this.t('game.youWon') : r.winners.length ? this.t('game.winnerIs', { name: r.players.find((p) => p.id === r.winners[0])?.name ?? '' }) : this.t('game.noWinner'))}</b></header>
      <ol class="gr-rank">${r.players.map((p) => `<li><span class="gr-pos">${p.rank}</span><span>${esc(p.id === 'host' ? this.t('game.you') : p.name)}${p.left ? ` <em>${esc(this.t('game.left'))}</em>` : ''}</span><b>${p.score}</b></li>`).join('')}</ol>
      ${reward ? `<p class="gr-reward">${esc(this.t('game.reward', { name: this.t(reward.titleKey) }))}</p>` : ''}
      <button type="button" class="gr-play r-btn purple" data-a="back">${esc(this.t('game.backToRoom'))}</button></div>`;
  }
  dispose() { this.stopTimer(); for (const u of this.unsubs) u(); this.unsubs = []; this.el.remove(); }
}
