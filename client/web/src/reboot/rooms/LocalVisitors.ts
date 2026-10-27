/**
 * REBOOT R3 — simulated OTHER USERS for the local provider (until R10): the user's local friends drop by the open
 * public room, stay a while and go. It only calls the room service (joinAs / leaveAs / attempt), exactly what remote
 * users will do through the server — the scene never sees the difference. Driven by the room simulation clock.
 */
import type { RebootHost } from '../host';
import type { LocalRoomService } from './LocalRoomService';
import type { RoomAction } from './RoomInstance';
import { rng } from '../social/traits';

export interface VisitConfig { gap: [number, number]; stay: [number, number]; /** chance per arrival that a visitor tries a host-only action (refused) */ mischief: number; }

export class LocalVisitors {
  config: VisitConfig;
  private now = 0;
  private nextArrival = 0;
  private leaveAt = new Map<string, number>();
  private unsub: (() => void) | null = null;
  private picking = false;
  private rnd: () => number;
  stats = { tries: 0, joined: 0, refused: 0, left: 0, mischief: 0 };
  constructor(private host: RebootHost, private svc: LocalRoomService, cfg: Partial<VisitConfig> = {}, seed = (Date.now() ^ 0xbeef) >>> 0) {
    this.config = { gap: svc.template.visits.gap, stay: svc.template.visits.stay, mischief: 0.15, ...cfg };
    this.rnd = rng(seed);
  }
  get running() { return !!this.unsub; }
  start() { if (this.unsub) return; this.nextArrival = this.now + this.r(2, 5); this.unsub = this.host.onTick((dt) => this.tick(dt)); }
  stop() { this.unsub?.(); this.unsub = null; this.leaveAt.clear(); }
  /** A visitor who left by other means (kick, close, dismissed) is no longer scheduled. */
  forget(id: string) { this.leaveAt.delete(id); }
  private r(a: number, b: number) { return a + (b - a) * this.rnd(); }
  private tick(dt: number) {
    this.now += dt;
    for (const [id, t] of [...this.leaveAt]) if (this.now >= t) { this.leaveAt.delete(id); if (this.svc.room.has(id) && this.svc.leaveAs(id).ok) this.stats.left++; }
    if (this.now >= this.nextArrival && !this.picking) { this.nextArrival = this.now + this.r(this.config.gap[0], this.config.gap[1]); void this.arrive(); }
  }
  private async arrive() {
    this.picking = true;
    try {
      const present = new Set(this.svc.room.presence().map((p) => p.profileId));
      // mischief: somebody already inside tries a host action — the room must refuse it
      const inside = [...present].filter((id) => id !== this.svc.room.ownerId);
      if (inside.length && this.rnd() < this.config.mischief) {
        const who = inside[Math.floor(this.rnd() * inside.length)];
        const act: RoomAction = (['changeSettings', 'kick', 'close', 'invite'] as RoomAction[])[Math.floor(this.rnd() * 4)];
        if (!this.svc.attempt(who, act)) this.stats.mischief++;
      }
      const fr = await this.host.friends(); this.svc.setFriends(fr.map((f) => f.id));
      const inScene = new Set(this.host.guests().map((g) => g.id));     // somebody still walking out is not back yet
      const cands = fr.filter((f) => !present.has(f.id) && !inScene.has(f.id));
      if (!cands.length || !this.unsub) return;
      const f = cands[Math.floor(this.rnd() * cands.length)];
      this.stats.tries++;
      const res = this.svc.joinAs(f.id);
      if (res.ok) { this.stats.joined++; this.leaveAt.set(f.id, this.now + this.r(this.config.stay[0], this.config.stay[1])); }
      else this.stats.refused++;
    } finally { this.picking = false; }
  }
}
