/**
 * REBOOT R5 — central i18n (English + Italiano). Every NEW Reboot text goes through `t(key)`; components never branch
 * on the language. Classic keeps its original MSBT texts and is not touched.
 *
 *   language = stored choice (mtw.reboot.lang) → browser languages (navigator.languages) → English (fallback)
 *   missing key in the chosen language → English → the key itself (visible, so a gap is found in tests, never a crash)
 *
 * Strings live in strings.ts (one table per language, same keys). `{name}` placeholders are filled from `vars`.
 * Plurals: `tn(key, n)` reads `key.one` / `key.other`. A value
 * written `@other.key` is translated too (a personality name inside a sentence).
 */
import { STRINGS } from './strings';

export type Lang = 'en' | 'it';
export const LANGS: readonly Lang[] = ['en', 'it'];
export const FALLBACK: Lang = 'en';
export const LANG_KEY = 'mtw.reboot.lang';
export type Vars = Record<string, string | number>;
/** A text kept as data (key + values) so it is rendered in the language of the moment, not the one it was made in. */
export interface Line { key: string; vars?: Vars }

interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void; }

/** Best supported language for a list of browser languages ('it-IT' → 'it'); English when none matches. */
export function detect(langs: readonly string[] | null | undefined): Lang {
  for (const l of langs ?? []) { const base = String(l).toLowerCase().split(/[-_]/)[0]; if ((LANGS as readonly string[]).includes(base)) return base as Lang; }
  return FALLBACK;
}
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

export class I18n {
  private cur: Lang;
  private subs = new Set<(l: Lang) => void>();
  /** `lang` forces a language (tests, legacy callers); otherwise stored choice → browser → English. */
  constructor(private opts: { storage?: Kv | null; languages?: readonly string[]; lang?: Lang } = {}) {
    let stored: string | null = null;
    try { stored = opts.storage?.getItem(LANG_KEY) ?? null; } catch { stored = null; }
    this.cur = opts.lang ?? (isLang(stored) ? stored : detect(opts.languages ?? browserLanguages()));
  }
  /** A fixed-language instance with no storage (default for models built without one). */
  static fixed(lang: Lang) { return new I18n({ storage: null, lang }); }
  get lang() { return this.cur; }
  /** Manual choice: applied at once, persisted, announced to subscribers. Unknown languages are refused. */
  set(lang: string): boolean {
    if (!isLang(lang)) return false;
    try { this.opts.storage?.setItem(LANG_KEY, lang); } catch { /* private mode: this session only */ }
    if (lang === this.cur) return true;
    this.cur = lang;
    for (const s of this.subs) { try { s(lang); } catch (e) { console.warn(e); } }
    return true;
  }
  subscribe(cb: (l: Lang) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
  has(key: string, lang: Lang = this.cur) { return key in STRINGS[lang]; }
  t(key: string, vars?: Vars): string {
    const raw = STRINGS[this.cur][key] ?? STRINGS[FALLBACK][key] ?? key;
    // a value written "@some.key" is itself translated (e.g. a personality name inside a question)
    return vars ? raw.replace(/\{(\w+)\}/g, (m: string, k: string) => { if (!(k in vars)) return m; const v = String(vars[k]); return v.startsWith('@') ? this.t(v.slice(1)) : v; }) : raw;
  }
  tn(key: string, n: number, vars?: Vars) { return this.t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...vars }); }
  line(l: Line) { return this.t(l.key, l.vars); }
  /** Relative time for feeds ("2 min fa" / "2 min ago"). */
  ago(iso: string, now = Date.now()) {
    const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
    if (!Number.isFinite(s)) return '';
    if (s < 60) return this.t('time.now');
    if (s < 3600) return this.t('time.min', { n: Math.floor(s / 60) });
    if (s < 86400) return this.t('time.hour', { n: Math.floor(s / 3600) });
    return this.t('time.day', { n: Math.floor(s / 86400) });
  }
}

function browserLanguages(): readonly string[] {
  try { return typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : []; } catch { return []; }
}
export function safeKv(): Kv | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
