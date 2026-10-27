/**
 * REBOOT R6.0 — Settings (model, no DOM). One persisted record, validated on load and on every change. `effective()`
 * turns it into what the running game applies (volumes, 3D quality, motion, a calmer world in light mode); confirmations
 * and notifications are read by the views that ask / notify. Language itself is owned by I18n (`mtw.reboot.lang`, R5); the region is
 * stored here and handed to I18n.
 *
 * Every option does something real:
 *   region         how dates are written (birthdays: 3/1 vs 1/3)
 *   volumes        music, effects, Mii voices 0–100 on top of the original switches
 *   motion         system / full / reduced (Reboot animations; the OS "reduce motion" is always respected)
 *   quality        auto / high / balanced / low (3D view resolution); auto = high, or low in light mode
 *   light          light mode for modest devices: lower resolution, reduced motion, a calmer simulated world
 *   confirm        ask before leaving a place and before deleting a post
 *   notifications  badges on the MiiPhone and arrival / departure notices in places
 */
import { REGIONS, Region } from '../i18n/i18n';

export const SETTINGS_KEY = 'mtw.reboot.settings';
export const SETTINGS_SCHEMA = 1;
export type Motion = 'system' | 'full' | 'reduced';
export type Quality = 'auto' | 'high' | 'balanced' | 'low';
export interface RebootSettings {
  v: 1;
  region: Region;
  volumes: { music: number; effects: number; voice: number };
  motion: Motion;
  quality: Quality;
  light: boolean;
  confirm: boolean;
  notifications: boolean;
}
export const DEFAULT_SETTINGS: RebootSettings = { v: 1, region: 'auto', volumes: { music: 80, effects: 90, voice: 100 }, motion: 'system', quality: 'auto', light: false, confirm: true, notifications: true };

interface Kv { getItem(k: string): string | null; setItem(k: string, v: string): void; }
const vol = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : d);
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

/** Validates any stored / received record and returns a complete, clean one. */
export function sanitizeSettings(raw: unknown): RebootSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<RebootSettings>;
  const v = (r.volumes && typeof r.volumes === 'object' ? r.volumes : {}) as Partial<RebootSettings['volumes']>;
  const d = DEFAULT_SETTINGS;
  return {
    v: 1,
    region: pick(r.region, REGIONS, d.region),
    volumes: { music: vol(v.music, d.volumes.music), effects: vol(v.effects, d.volumes.effects), voice: vol(v.voice, d.volumes.voice) },
    motion: pick(r.motion, ['system', 'full', 'reduced'] as const, d.motion),
    quality: pick(r.quality, ['auto', 'high', 'balanced', 'low'] as const, d.quality),
    light: typeof r.light === 'boolean' ? r.light : d.light,
    confirm: typeof r.confirm === 'boolean' ? r.confirm : d.confirm,
    notifications: typeof r.notifications === 'boolean' ? r.notifications : d.notifications,
  };
}

export interface Effective {
  /** 0..1 per channel. */
  volumes: { music: number; effects: number; voice: number };
  quality: 'high' | 'balanced' | 'low';
  reducedMotion: boolean;
  region: Region;
  /** Light mode: slower simulated arrivals and fewer autonomous posts. */
  calmWorld: boolean;
}
/** What a settings record means for the running game (pure). */
export function effective(s: RebootSettings, osReduced: boolean): Effective {
  return {
    volumes: { music: s.volumes.music / 100, effects: s.volumes.effects / 100, voice: s.volumes.voice / 100 },
    quality: s.quality === 'auto' ? (s.light ? 'low' : 'high') : s.quality,
    reducedMotion: s.motion === 'reduced' || s.light || (s.motion === 'system' && osReduced),
    region: s.region,
    calmWorld: s.light,
  };
}

export class SettingsStore {
  private cur: RebootSettings;
  private subs = new Set<(s: RebootSettings) => void>();
  lastError: string | null = null;
  constructor(private kv: Kv | null) {
    let raw: unknown = null;
    try { raw = JSON.parse(kv?.getItem(SETTINGS_KEY) ?? 'null'); } catch { raw = null; }
    this.cur = sanitizeSettings(raw);
  }
  get value(): RebootSettings { return structuredClone(this.cur); }
  effective(osReduced: boolean) { return effective(this.cur, osReduced); }
  update(patch: Partial<Omit<RebootSettings, 'v' | 'volumes'>> & { volumes?: Partial<RebootSettings['volumes']> }) {
    const next = sanitizeSettings({ ...this.cur, ...patch, volumes: { ...this.cur.volumes, ...(patch.volumes ?? {}) } });
    if (JSON.stringify(next) === JSON.stringify(this.cur)) return this.value;
    this.cur = next;
    try { this.kv?.setItem(SETTINGS_KEY, JSON.stringify(next)); this.lastError = null; } catch (e) { this.lastError = (e as Error)?.name ?? 'WRITE_FAILED'; }
    for (const s of this.subs) { try { s(this.value); } catch (err) { console.warn(err); } }
    return this.value;
  }
  reset() { return this.update({ ...DEFAULT_SETTINGS }); }
  subscribe(cb: (s: RebootSettings) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  get listenerCount() { return this.subs.size; }
}
