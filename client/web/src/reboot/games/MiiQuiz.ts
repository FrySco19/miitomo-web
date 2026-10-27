/**
 * REBOOT R5 — "Quiz dei Mii" (roadmap R7 game B, first playable version). How well do you know your Miis?
 *
 * Every question is built ONLY from facts the user entered on this device about their own Mii and their local
 * friends: birthdays, personality types and the greeting each one says when entering a room. Nothing is invented and
 * nothing is presented as Nintendo content; with too few facts the game says so (NOT_ENOUGH_DATA) instead of padding.
 *
 * A match: up to 5 rounds; a question with up to 4 names; 12 s to answer; 100 points for a right answer plus up to 50
 * for speed. The other Miis in the Sala Giochi play too (simulated locally, clearly so): how fast and how well they
 * answer depends on their personality and on how well they know the Mii the question is about (relations).
 */
import type { GameDefinition, GameContext, GameLogic, GamePlayer, GameStep, GameView, Availability, GameResult } from './types';
import type { Line } from '../i18n/i18n';

const ROUNDS = 5, LIMIT = 12, REVEAL = 2.6;
/** Simulated players: answer delay factor and base accuracy per personality (NEW design values). */
const SIM: Record<0 | 1 | 2 | 3, { speed: number; acc: number }> = {
  0: { speed: 1.15, acc: 0.62 },   // Riservato: slow, careful
  1: { speed: 0.9, acc: 0.6 },     // Deciso
  2: { speed: 1.05, acc: 0.55 },   // Tranquillo
  3: { speed: 0.7, acc: 0.48 },    // Espansivo: quick, impulsive
};

interface Person { id: string; name: string; personality: 0 | 1 | 2 | 3; birthday: { month: number; day: number } | null; greeting: string; }
export interface Question { prompt: Line; options: string[]; ids: string[]; correct: number; about: string; }

function people(ctx: GameContext): Person[] {
  const me: Person = { id: ctx.me.id, name: ctx.me.name, personality: ctx.me.personality, birthday: ctx.me.birthday, greeting: (ctx.me.greeting ?? '').trim() };
  const fr = ctx.friends.map((f) => ({ id: f.id, name: f.name, personality: (f.personality ?? 2) as 0 | 1 | 2 | 3, birthday: f.birthday ?? null, greeting: (f.greeting ?? '').trim() }));
  const seen = new Set<string>();
  return [me, ...fr].filter((p) => p.name && !seen.has(p.id) && (seen.add(p.id), true));
}
const shuffle = <T,>(a: T[], rnd: () => number) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

/** Every question the facts allow (each with 2–4 distinct names and exactly one right answer). */
export function questionBank(ctx: GameContext, rnd: () => number): Question[] {
  const ps = people(ctx), out: Question[] = [];
  const ask = (prompt: Line, right: Person, others: Person[], about = right.id) => {
    const opts = shuffle([right, ...shuffle(others, rnd).slice(0, 3)], rnd);
    if (opts.length >= 2) out.push({ prompt, options: opts.map((p) => p.name), ids: opts.map((p) => p.id), correct: opts.indexOf(right), about });
  };
  const key = (b: { month: number; day: number }) => `${b.month}/${b.day}`;
  for (const p of ps) {
    if (p.birthday) {
      const others = ps.filter((o) => o !== p && (!o.birthday || key(o.birthday) !== key(p.birthday!)));
      ask({ key: 'quiz.q.birthday', vars: { day: p.birthday.day, month: p.birthday.month } }, p, others);
    }
    if (p.greeting) {
      const others = ps.filter((o) => o !== p && o.greeting.toLowerCase() !== p.greeting.toLowerCase());
      ask({ key: 'quiz.q.greeting', vars: { text: p.greeting.slice(0, 40) } }, p, others);
    }
    const sameType = ps.filter((o) => o.personality === p.personality);
    if (sameType.length === 1) ask({ key: 'quiz.q.personality', vars: { type: `@personality.${p.personality}` } }, p, ps.filter((o) => o !== p));
  }
  // who has their birthday first in the year (two names)
  const bd = ps.filter((p) => p.birthday);
  for (let i = 0; i + 1 < bd.length; i += 2) {
    const a = bd[i], b = bd[i + 1], ka = a.birthday!.month * 40 + a.birthday!.day, kb = b.birthday!.month * 40 + b.birthday!.day;
    if (ka !== kb) ask({ key: 'quiz.q.first' }, ka < kb ? a : b, [ka < kb ? b : a], ka < kb ? a.id : b.id);
  }
  return out;
}

class QuizLogic implements GameLogic {
  private qs: Question[];
  private i = 0;
  private phase: GameView['phase'] = 'question';
  private t = 0;
  private answers = new Map<string, { idx: number; at: number }>();
  private plan = new Map<string, { at: number; idx: number }>();
  private score: Record<string, number> = {};
  private gone = new Set<string>();
  readonly maxScore: number;
  constructor(private ctx: GameContext, private players: GamePlayer[], private rnd: () => number) {
    this.qs = shuffle(questionBank(ctx, rnd), rnd).slice(0, ROUNDS);
    this.maxScore = this.qs.length * 150;
    for (const p of players) this.score[p.id] = 0;
    this.planSims();
  }
  get done() { return this.phase === 'done'; }
  private get q() { return this.qs[Math.min(this.i, this.qs.length - 1)]; }
  get view(): GameView {
    const q = this.q;
    return {
      round: this.i + 1, rounds: this.qs.length, phase: this.phase, prompt: q.prompt, options: q.options,
      timeLeft: Math.max(0, LIMIT - this.t), timeLimit: LIMIT,
      answered: Object.fromEntries(this.players.map((p) => [p.id, this.answers.get(p.id)?.idx ?? null])),
      correct: this.phase === 'question' ? null : q.correct, scores: { ...this.score },
    };
  }
  /** Simulated players decide when they will answer and what (personality × how well they know the subject). */
  private planSims() {
    this.plan.clear();
    const q = this.q; if (!q) return;
    for (const p of this.players) {
      if (p.isUser || this.gone.has(p.id)) continue;
      const s = SIM[p.personality] ?? SIM[2];
      const knows = p.id === q.about ? 0.95 : Math.min(0.95, s.acc + 0.3 * (this.ctx.affinity?.(p.id, q.about) ?? 0.3));
      const right = this.rnd() < knows;
      const wrong = q.options.map((_, k) => k).filter((k) => k !== q.correct);
      const idx = right || !wrong.length ? q.correct : wrong[Math.floor(this.rnd() * wrong.length)];
      this.plan.set(p.id, { at: Math.min(LIMIT - 0.5, (2 + this.rnd() * 6) * s.speed), idx });
    }
  }
  tick(dt: number): GameStep[] {
    if (this.phase === 'done') return [];
    const steps: GameStep[] = [];
    this.t += dt;
    if (this.phase === 'question') {
      for (const [id, p] of [...this.plan]) if (this.t >= p.at) { this.plan.delete(id); this.answer(id, p.idx, steps); }
      const active = this.players.filter((p) => !this.gone.has(p.id));
      if (this.t >= LIMIT || active.every((p) => this.answers.has(p.id))) {
        const q = this.q; const right: string[] = [], wrong: string[] = [];
        for (const p of active) { const a = this.answers.get(p.id); if (a && a.idx === q.correct) right.push(p.id); else wrong.push(p.id); }
        this.phase = 'reveal'; this.t = 0;
        steps.push({ type: 'reveal', round: this.i + 1, correct: q.correct, right, wrong });
      }
    } else if (this.phase === 'reveal' && this.t >= REVEAL) {
      this.i++; this.t = 0; this.answers.clear();
      if (this.i >= this.qs.length) { this.phase = 'done'; this.i = this.qs.length - 1; steps.push({ type: 'done' }); }
      else { this.phase = 'question'; this.planSims(); steps.push({ type: 'round', round: this.i + 1 }); }
    }
    return steps;
  }
  private answer(id: string, idx: number, steps: GameStep[]) {
    if (this.answers.has(id) || this.gone.has(id)) return false;
    this.answers.set(id, { idx, at: this.t });
    const ok = idx === this.q.correct;
    if (ok) this.score[id] += 100 + Math.round(50 * Math.max(0, LIMIT - this.t) / LIMIT);
    steps.push({ type: 'answer', player: id, correct: null });   // right / wrong is only told at the reveal
    return true;
  }
  input(player: string, value: number): boolean {
    if (this.phase !== 'question' || !this.players.some((p) => p.id === player) || !Number.isInteger(value) || value < 0 || value >= this.q.options.length) return false;
    const steps: GameStep[] = [];
    return this.answer(player, value, steps);
  }
  drop(player: string) { this.gone.add(player); this.plan.delete(player); }
  scores() { return { ...this.score }; }
}

export const MII_QUIZ: GameDefinition = {
  id: 'mii-quiz',
  titleKey: 'game.quiz.title', descKey: 'game.quiz.desc', rulesKey: 'game.quiz.rules',
  players: { min: 1, max: 4 },
  durationSec: ROUNDS * (LIMIT + REVEAL),
  available(ctx): Availability {
    const n = questionBank(ctx, () => 0.5).length;
    return n >= 3 ? { ok: true } : { ok: false, code: 'NOT_ENOUGH_DATA', vars: { n } };
  },
  create(ctx: GameContext, players: GamePlayer[], rnd: () => number) { return new QuizLogic(ctx, players, rnd); },
  reward(result: GameResult, me: string) {
    const mine = result.players.find((p) => p.id === me);
    return mine && mine.rank === 1 && mine.score >= 300 ? { id: 'quiz-star', kind: 'badge', titleKey: 'reward.quiz-star' } : null;
  },
};
