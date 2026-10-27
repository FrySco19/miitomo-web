/**
 * REBOOT feature flags. Every Reboot feature is behind a flag; children only count when REBOOT_ENABLED is on and the
 * feature is implemented. Data-driven: adding a feature = adding a row here (+ docs/reboot/CLASSIC-VS-REBOOT.md).
 * Classification of everything in this folder: REBOOT (new, not original Nintendo).
 */
export type FlagId =
  | 'REBOOT_ENABLED' | 'MULTI_MII_ENABLED' | 'SOCIAL_LIFE_ENABLED' | 'PUBLIC_ROOMS_ENABLED' | 'HUB_ENABLED' | 'MIINSTAGRAM_ENABLED'
  | 'MINIGAMES_ENABLED' | 'EVENTS_ENABLED' | 'REWARDS_ENABLED' | 'NOTIFICATIONS_ENABLED' | 'MIIFOTO2_ENABLED'
  | 'FRIEND_ROOMS_ENABLED' | 'MIIPHONE_ENABLED';

export interface FlagDef {
  id: FlagId;
  label: string;
  /** Roadmap phase that delivers it (docs/reboot/ROADMAP.md). */
  phase: string;
  /** false = declared, not built yet: never effective, whatever the stored value. */
  implemented: boolean;
  /** Default when the user never touched it. */
  defaultOn: boolean;
}

export const FLAGS: readonly FlagDef[] = [
  { id: 'REBOOT_ENABLED', label: 'Miitomo Reboot', phase: 'R1', implemented: true, defaultOn: false },
  { id: 'MULTI_MII_ENABLED', label: 'Più Mii nella stanza', phase: 'R2', implemented: true, defaultOn: true },
  { id: 'SOCIAL_LIFE_ENABLED', label: 'Vita sociale dei Mii', phase: 'R2b', implemented: true, defaultOn: true },
  { id: 'PUBLIC_ROOMS_ENABLED', label: 'Stanza pubblica', phase: 'R3', implemented: true, defaultOn: true },
  { id: 'HUB_ENABLED', label: 'Piazza (Social Hub)', phase: 'R4', implemented: true, defaultOn: true },
  { id: 'FRIEND_ROOMS_ENABLED', label: 'Stanze degli amici', phase: 'R5', implemented: true, defaultOn: true },
  { id: 'MIIPHONE_ENABLED', label: 'MiiPhone', phase: 'R5', implemented: true, defaultOn: true },
  { id: 'MIINSTAGRAM_ENABLED', label: 'MIInstagram', phase: 'R5', implemented: true, defaultOn: true },
  { id: 'MINIGAMES_ENABLED', label: 'Sala Giochi (Quiz dei Mii)', phase: 'R5 · R6–R7', implemented: true, defaultOn: true },
  { id: 'EVENTS_ENABLED', label: 'Eventi', phase: 'R8', implemented: false, defaultOn: true },
  { id: 'REWARDS_ENABLED', label: 'Ricompense', phase: 'R8', implemented: false, defaultOn: true },
  { id: 'NOTIFICATIONS_ENABLED', label: 'Notifiche', phase: 'R9', implemented: false, defaultOn: true },
  { id: 'MIIFOTO2_ENABLED', label: 'Miifoto 2 (condividi, foto della stanza)', phase: 'R5', implemented: true, defaultOn: true },
];

const KEY = 'mtw.reboot.flags';

/** Persistent flag set (per browser). `master` = the gate (REBOOT_ENABLED) state. */
export class RebootFlags {
  private stored: Partial<Record<FlagId, boolean>> = {};
  constructor(private master: boolean, private storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()) {
    try { this.stored = JSON.parse(this.storage?.getItem(KEY) ?? '{}') ?? {}; } catch { this.stored = {}; }
  }
  /** Effective value: master on, implemented, and (stored ?? default). */
  on(id: FlagId): boolean {
    if (id === 'REBOOT_ENABLED') return this.master;
    const d = FLAGS.find((f) => f.id === id);
    if (!d || !this.master || !d.implemented) return false;
    return this.stored[id] ?? d.defaultOn;
  }
  set(id: Exclude<FlagId, 'REBOOT_ENABLED'>, v: boolean) {
    this.stored[id] = v;
    try { this.storage?.setItem(KEY, JSON.stringify(this.stored)); } catch { /* private mode: in-memory only */ }
  }
  list() { return FLAGS.map((f) => ({ ...f, on: this.on(f.id) })); }
}

function safeStorage(): Storage | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
