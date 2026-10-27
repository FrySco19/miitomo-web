/**
 * REBOOT R5 — the Sala Giochi game list. New games register here; the room, its view and the sessions do not change.
 */
import type { GameDefinition, GameContext, Availability } from './types';

export class GameRegistry {
  private defs = new Map<string, GameDefinition>();
  register(d: GameDefinition): boolean {
    if (!d || !/^[a-z0-9-]{2,32}$/.test(d.id) || this.defs.has(d.id)) return false;
    if (!(d.players.min >= 1 && d.players.max >= d.players.min && d.players.max <= 8)) return false;
    this.defs.set(d.id, d);
    return true;
  }
  get(id: string) { return this.defs.get(id) ?? null; }
  list() { return [...this.defs.values()]; }
  /** Every game with whether it can be played with what this device knows right now. */
  status(ctx: GameContext): { def: GameDefinition; availability: Availability }[] {
    return this.list().map((def) => { let a: Availability; try { a = def.available(ctx); } catch { a = { ok: false, code: 'NOT_ENOUGH_DATA' }; } return { def, availability: a }; });
  }
}
