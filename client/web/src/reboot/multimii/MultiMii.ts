/**
 * REBOOT R2 — several Miis in the same room (2 → 4 → 8, configurable). NEW, not original Nintendo: Miitomo showed one
 * visiting friend at a time.
 * Runs on the shared guest machinery (main.ts: per-guest body, director, faces, voice; personal distance between ALL
 * present Miis; one Mii through the shared door at a time; per-Mii seeds so idle actions / wandering are not in lockstep).
 * This module only owns the Reboot side: the capacity setting (persisted), inviting a group, and the roster.
 */
import type { RebootHost } from '../host';

export const MIN_MIIS = 2, MAX_MIIS = 8;          // Miis in the room including the host
const KEY = 'mtw.reboot.multimii';

export interface MultiMiiSettings { miis: number; }

export function clampMiis(n: number) { return Math.max(MIN_MIIS, Math.min(MAX_MIIS, Math.round(Number.isFinite(n) ? n : 4))); }

export function loadSettings(kv: Pick<Storage, 'getItem'> | null = safe()): MultiMiiSettings {
  try { const v = JSON.parse(kv?.getItem(KEY) ?? 'null'); if (v && typeof v.miis === 'number') return { miis: clampMiis(v.miis) }; } catch { /* defaults */ }
  return { miis: 4 };
}
export function saveSettings(s: MultiMiiSettings, kv: Pick<Storage, 'setItem'> | null = safe()) {
  try { kv?.setItem(KEY, JSON.stringify({ miis: clampMiis(s.miis) })); } catch { /* private mode */ }
}

export class MultiMii {
  settings: MultiMiiSettings;
  constructor(private host: RebootHost, kv: (Pick<Storage, 'getItem' | 'setItem'>) | null = safe()) {
    this.kv = kv;
    this.settings = loadSettings(kv);
    host.setCapacity(this.settings.miis - 1);
  }
  private kv: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Miis allowed in the room (host included). Lowering it does not send anyone away; it only limits new arrivals. */
  setMiis(n: number) { this.settings = { miis: clampMiis(n) }; saveSettings(this.settings, this.kv); this.host.setCapacity(this.settings.miis - 1); return this.settings.miis; }
  freeSlots() { return Math.max(0, this.host.capacity() - this.host.guests().length); }
  /** Invites friends not already in the room until the room is full; resolves with the ids that were accepted. */
  async inviteMany(ids: string[]): Promise<string[]> {
    const done: string[] = [];
    const present = new Set(this.host.guests().map((g) => g.id));
    for (const id of ids) {
      if (present.has(id)) continue;
      if (this.freeSlots() <= 0) break;
      if (await this.host.invite(id)) { done.push(id); present.add(id); }
    }
    return done;
  }
  dismissAll() { let n = 0; for (const g of this.host.guests()) if (!g.leaving && this.host.dismiss(g.id)) n++; return n; }
}

function safe(): Storage | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
