/**
 * REBOOT central i18n (R5, extended in R6). Every Reboot text goes through `t(key)`; components never branch on the
 * language. Classic keeps its original MSBT texts and is not touched.
 *
 *   language = stored choice (mtw.reboot.lang) → browser languages (navigator.languages) → English (fallback)
 *   missing key in the chosen language → English → the key itself (visible, so a gap is found in tests, never a crash)
 *
 * R6: locales come from a REGISTRY — a language is offered as soon as strings.ts has a table for it (en and it are
 * complete; es / fr / de / pt / ja have their native names ready and fall back to English key by key until their table
 * is complete). A region (auto from the browser, or chosen in Settings) sets how dates are written.
 *
 * Strings live in strings.ts (one table per language, same keys). `{name}` placeholders are filled from `vars`.
 * Plurals: `tn(key, n)` reads `key.one` / `key.other`. A value written `@other.key` is translated too (a personality
 * name inside a sentence); a value written `#date:M-D` is written as a day + month for the region.
 */
import { STRINGS } from './strings';

export type Lang = string;
/** Native names of the languages the registry knows; only those with a table in strings.ts are offered. */
export const LOCALE_NAMES: Readonly<Record<string, string>> = { en: 'English', it: 'Italiano', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', ja: '日本語' };
/** Languages that can be chosen now (a table exists). */
export const LANGS: readonly Lang[] = Object.keys(STRINGS);
export const FALLBACK: Lang = 'en';
export const LANG_KEY = 'mtw.reboot.lang';
export const REGIONS = ['auto', 'IT', 'GB', 'US', 'ES', 'FR', 'DE', 'PT', 'BR', 'JP', 'CH'] as const;
export type Region = (typeof REGIONS)[number];
export type Vars = Record<string, string | number>;
/** A text kept as data (key + values) so it is rendered in the language of the moment, not the one it was made in. */
export interface Line { key: string; vars?: Vars }

interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void; }

/** Best supported language for a list of browser languages ('it-IT' → 'it'); English when none matches. */
export function detect(langs: readonly string[] | null | undefined): Lang {
  for (const l of langs ?? []) { const base = String(l).toLowerCase().split(/[-_]/)[0]; if (LANGS.includes(base)) return base; }
  return FALLBACK;
}
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && LANGS.includes(v);
/** How much of the English table a language covers (1 = complete). */
export function coverage(lang: Lang): number { const en = Object.keys(STRINGS[FALLBACK]), t = STRINGS[lang] ?? {}; return en.length ? en.filter((k) => k in t).length / en.length : 0; }
/** The languages to offer in Settings, with their native name and coverage. */
export function locales() { return LANGS.map((id) => ({ id, name: LOCALE_NAMES[id] ?? id, coverage: coverage(id) })); }

export class I18n {
  private cur: Lang;
  private region: Region = 'auto';
  private subs = new Set<(l: Lang) => void>();
  /** `lang` forces a language (tests, legacy callers); otherwise stored choice → browser → English. */
  constructor(private opts: { storage?: Kv | null; languages?: readonly string[]; lang?: Lang } = {}) {
    let stored: string | null = null;
    try { stored = opts.storage?.getItem(LANG_KEY) ?? null; } catch { stored = null; }
    this.cur = opts.lang && isLang(opts.lang) ? opts.lang : isLang(stored) ? stored : detect(opts.languages ?? browserLanguages());
  }
  /** A fixed-language instance with no storage (default for models built without one). */
  static fixed(lang: Lang) { return new I18n({ storage: null, lang }); }
  get lang() { return this.cur; }
  /** BCP 47 locale for Intl (dates, numbers): language + region (auto = the browser's region for that language). */
  get locale() {
    if (this.region !== 'auto') return `${this.cur}-${this.region}`;
    const b = (this.opts.languages ?? browserLanguages()).find((l) => String(l).toLowerCase().startsWith(this.cur + '-'));
    return b ?? this.cur;
  }
  get regionSetting() { return this.region; }
  /** Region for dates (Settings). Announced like a language change, since every date on screen may change. */
  setRegion(r: string): boolean {
    if (!(REGIONS as readonly string[]).includes(r)) return false;
    if (r === this.region) return true;
    this.region = r as Region;
    for (const s of this.subs) { try { s(this.cur); } catch (e) { console.warn(e); } }
    return true;
  }
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
  has(key: string, lang: Lang = this.cur) { return key in (STRINGS[lang] ?? {}) || key in STRINGS[FALLBACK]; }
  t(key: string, vars?: Vars): string {
    const raw = STRINGS[this.cur]?.[key] ?? STRINGS[FALLBACK][key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (m: string, k: string) => {
      if (!(k in vars)) return m;
      const v = String(vars[k]);
      if (v.startsWith('@')) return this.t(v.slice(1));
      const d = /^#date:(\d{1,2})-(\d{1,2})$/.exec(v);
      return d ? this.date(Number(d[2]), Number(d[1])) : v;
    });
  }
  tn(key: string, n: number, vars?: Vars) { return this.t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...vars }); }
  line(l: Line) { return this.t(l.key, l.vars); }
  /** Day + month (a Mii's birthday: no year) as the region writes it: 3/1 in Italy, 1/3 in the US. */
  date(day: number, month: number) {
    try { return new Intl.DateTimeFormat(this.locale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2000, month - 1, day)); }
    catch { return `${day}/${month}`; }
  }
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
