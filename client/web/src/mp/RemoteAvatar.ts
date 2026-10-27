/**
 * SHARED ROOM — the two halves of a player's Mii on the network, on top of the REAL room machinery (RoomDirector:
 * path finding, walking clip, door, objects, reactions). No second simulation: a remote Mii is an ordinary room Mii
 * whose orders come from its owner instead of the mouse.
 *
 *   LocalSampler   my Mii → its state ~8 times a second while it moves (on change), once a second when still
 *   RemoteAvatar   a friend's Mii ← their states and actions:
 *                    walking with a target  → walk there (the director's path + walk cycle = smooth interpolation)
 *                    still somewhere else   → walk to the spot when far (> 1.5), turn to their heading when close
 *                    far off (> 40) / stuck → put it there at once (correction, logged)
 *                    door (entering / exiting / outside), wave, touch reaction, object → the same original sequences
 * Positions are room units (the room is ~68 wide); states are RoomDirector states.
 */
import * as THREE from 'three';
import type { RoomDirector, Interactable } from '../room/RoomDirector';
import type { AvState, MpAct } from '../p2p/session';

export type DirectorLike = Pick<RoomDirector, 'state' | 'pos' | 'heading' | 'target' | 'path' | 'intent' | 'goTo' | 'place' | 'faceToward' | 'waveReaction' | 'touch' | 'interact' | 'enter' | 'exit' | 'clampToRoom'>;

const FAR = 40, NEAR = 1.5, TARGET_EPS = 1.0, TURN_EPS = 0.35, STUCK_S = 5;
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** My own Mii: what to send, and when. */
export class LocalSampler {
  private last: AvState | null = null;
  private since = 0;
  /** `dt` seconds since the last call; returns a state to send, or null (nothing worth sending yet). */
  sample(d: DirectorLike, dt: number, now: number): AvState | null {
    this.since += dt;
    // where it is going: the walk target, or the end of the door path while coming in / going out
    const goal = d.target ?? ((d.state === 'entering' || d.state === 'exiting') && d.path.length ? d.path[d.path.length - 1] : null);
    const s: AvState = { x: round(d.pos.x), z: round(d.pos.z), h: round(d.heading), st: d.state, tx: goal ? round(goal.x) : null, tz: goal ? round(goal.z) : null, t: now };
    const l = this.last;
    const moving = s.st === 'walking' || s.st === 'entering' || s.st === 'exiting' || s.st === 'held';
    const changed = !l || l.st !== s.st || l.tx !== s.tx || l.tz !== s.tz || Math.abs(wrap(l.h - s.h)) > 0.2 || Math.hypot(l.x - s.x, l.z - s.z) > 0.5;
    const due = this.since >= (moving ? 0.12 : 1.0);
    if (!(changed && this.since >= 0.08) && !due) return null;
    this.last = s; this.since = 0;
    return s;
  }
  reset() { this.last = null; this.since = 0; }
}
const round = (v: number) => Math.round(v * 100) / 100;

/** A friend's Mii in my room, driven by their messages. */
export class RemoteAvatar {
  private want: AvState | null = null;
  private pendingActs: { a: MpAct; ttl: number }[] = [];
  private stuck = 0;
  readonly log: string[] = [];
  /** Corrections that had to put the Mii somewhere at once (should stay rare). */
  snaps = 0;
  constructor(readonly id: string, readonly d: DirectorLike, private objects: () => Interactable[]) {}
  private note(m: string) { this.log.push(m); if (this.log.length > 60) this.log.shift(); }

  /** Latest state from the owner. */
  apply(s: AvState) { this.want = s; }
  /** An action from the owner, applied when the Mii can do it (within 4 s). */
  act(a: MpAct) { if (a.k === 'say' || a.k === 'poke') return; this.pendingActs.push({ a, ttl: 4 }); }
  /** Distance between where the owner says the Mii is and where it is drawn here. */
  get error() { const w = this.want; return w ? Math.hypot(w.x - this.d.pos.x, w.z - this.d.pos.z) : 0; }

  tick(dt: number) {
    const d = this.d, w = this.want;
    // actions first (they are what the other player just did)
    for (const p of [...this.pendingActs]) {
      p.ttl -= dt;
      if (this.tryAct(p.a)) { this.pendingActs.splice(this.pendingActs.indexOf(p), 1); continue; }
      if (p.ttl <= 0) { this.pendingActs.splice(this.pendingActs.indexOf(p), 1); this.note(`azione scaduta ${p.a.k} (${d.state})`); }
    }
    if (!w) return;
    // door: the owner's Mii comes in / goes out
    if ((w.st === 'exiting' || w.st === 'outside') && (d.state === 'idle' || d.state === 'walking')) { d.exit(); this.note('esce'); return; }
    if (d.state === 'outside' && w.st !== 'outside' && w.st !== 'exiting') {
      // the owner is still at the door (its path is not known yet): wait for where it will stop
      if (w.st === 'entering' && w.tx === null) return;
      d.enter(new THREE.Vector3(w.tx ?? w.x, 0, w.tz ?? w.z)); this.note('entra'); return;
    }
    if (d.state !== 'idle' && d.state !== 'walking') return;   // entering / reacting / interacting: let it finish
    const err = Math.hypot(w.x - d.pos.x, w.z - d.pos.z);
    if (err > FAR || (this.stuck > STUCK_S && err > NEAR * 2)) {
      d.place(d.clampToRoom(new THREE.Vector3(w.x, 0, w.z)), w.h); this.snaps++; this.stuck = 0; this.note(`corretto (${err.toFixed(1)})`); return;
    }
    if (w.st === 'walking' && w.tx !== null && w.tz !== null) {
      const t = d.target;
      if (!t || Math.hypot(t.x - w.tx, t.z - w.tz) > TARGET_EPS) d.goTo(new THREE.Vector3(w.tx, 0, w.tz));
    } else if (err > NEAR) {
      const t = d.target;
      if (!t || Math.hypot(t.x - w.x, t.z - w.z) > TARGET_EPS) d.goTo(new THREE.Vector3(w.x, 0, w.z));
    } else if (d.state === 'idle' && Math.abs(wrap(w.h - d.heading)) > TURN_EPS) {
      d.faceToward(new THREE.Vector3(d.pos.x + Math.sin(w.h) * 10, 0, d.pos.z + Math.cos(w.h) * 10));
    }
    // a walk that does not bring it closer (blocked path): count, then correct
    this.stuck = d.state === 'walking' || err > NEAR ? this.stuck + dt : 0;
    if (err <= NEAR) this.stuck = 0;
  }
  private tryAct(a: MpAct): boolean {
    const d = this.d;
    if (a.k === 'wave') return d.state === 'idle' ? d.waveReaction() : false;
    if (a.k === 'touch') return d.state === 'idle' || d.state === 'walking' ? d.touch() : false;
    if (a.k === 'interact') {
      const o = this.objects().find((x) => x.name === a.o); if (!o) return true;   // not in this room: nothing to do
      return d.state === 'idle' || d.state === 'walking' ? d.interact(o) : false;
    }
    return true;
  }
}
