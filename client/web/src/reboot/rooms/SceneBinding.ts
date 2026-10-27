/**
 * REBOOT R3 → R5 — presence ↔ scene for a room, shared by the user's own public room (R3) and the rooms the user
 * visits (R5: friends' rooms, Sala Giochi). Extracted from PublicRoomController with the same behaviour:
 *   - presence.join  → the Mii comes in through the R2 guest machinery (door queue), or is already inside (visited
 *                      rooms: whoever was there before the user arrived). If the scene has no free place yet (Miis still
 *                      walking out) the arrival is retried on every check; after 30 checks it gives up (`giveUp`);
 *   - presence.leave → the Mii says goodbye and leaves through the door;
 *   - a guest that left the scene by itself → the caller's presence follows (unless it was still pending).
 * No timers of its own: the owner calls `tick()` (once a second) and `guestLeft()` from its guest listener.
 */
import type { RebootHost } from '../host';

export interface BindingRules {
  /** Does the room still say this Mii is in? */
  present(id: string): boolean;
  /** Is the binding taking arrivals (room open and the user there)? */
  accepting(): boolean;
  /** The Mii could not come in for 30 checks. */
  giveUp(id: string): void;
}

export class SceneBinding {
  private pending = new Map<string, { since: number; inside?: { x: number; z: number } }>();
  private dismissing = new Set<string>();
  private clock = 0;
  constructor(private host: RebootHost, private rules: BindingRules) {}

  /** Admitted Miis whose Mii is not on screen yet (waiting for a free place in the scene). */
  get pendingIds() { return [...this.pending.keys()]; }
  isPending(id: string) { return this.pending.has(id); }

  /** Brings an admitted Mii in; if the scene is momentarily full (Miis still walking out), retry on the next check. */
  bringIn(id: string, inside?: { x: number; z: number }) {
    if (!this.rules.accepting() || !this.rules.present(id)) { this.pending.delete(id); return; }
    const where = inside ?? this.pending.get(id)?.inside;
    void this.host.invite(id, where ? { inside: where } : undefined).then((ok) => {
      if (ok) { this.pending.delete(id); if (!this.rules.present(id) || !this.rules.accepting()) this.host.dismiss(id); return; }   // closed meanwhile
      if (!this.rules.present(id) || !this.rules.accepting()) { this.pending.delete(id); return; }
      if (!this.pending.has(id)) this.pending.set(id, { since: this.clock, inside: where });
      if (this.clock - this.pending.get(id)!.since > 30) { this.pending.delete(id); this.rules.giveUp(id); }
    });
  }
  /** The room says this Mii left: goodbye and out through the door. */
  sendOut(id: string) {
    if (this.host.guests().some((g) => g.id === id && !g.leaving)) { this.dismissing.add(id); this.host.dismiss(id); }
  }
  /**
   * A guest left the scene. Returns true when the room's presence should follow (it was not just waiting to come in);
   * the caller updates the presence, then calls `retry()` (a place freed up in the scene).
   */
  guestLeft(id: string): boolean {
    this.dismissing.delete(id);
    return this.rules.present(id) && !this.pending.has(id);
  }
  /** Once a second: pending arrivals try again. */
  tick() { this.clock++; if (this.rules.accepting()) this.retry(); }
  retry() { for (const p of [...this.pending.keys()]) this.bringIn(p); }
  /** Everybody still in the scene says goodbye (closing). */
  dismissAll() { for (const g of this.host.guests()) if (!g.leaving) this.host.dismiss(g.id); }
  clear() { this.pending.clear(); this.dismissing.clear(); }
}
