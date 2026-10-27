/**
 * Playable Miitomo room: drives the Mii and the door with original animation clips.
 * M7 (FROZEN): enter / walk / door / touch / wave / appear, walk speed from the WalkClone cycle, wall + furniture clamp.
 * M8: explicit deterministic state machine, touch reaction that interrupts walking, object interactions with an
 *     interaction spot + grid path around furniture, animation events for the sound tables.
 *
 * Clips (asset_model_character_animation_output, 304 clips):
 *   idle      animWaitMale / animWaitFemale                   (loop)
 *   walk      animWalkClone                                   (loop, in place: no root motion -> movement in code)
 *   enter     animActionAppearFall -> animActionAppearLanding (REVERSED: the binary names these two for appearing)
 *   wave      animHandWaveLIn -> animHandWaveL (x2) -> animHandWaveLOut   (In / loop / Out naming of the pack)
 *   touch     animActionStroked                               (REVERSED: SequenceTouch static table, with se_nade01)
 *   objects   animActionCheckTheBox / animActionPress (names referenced by the binary), animSmellHandDown (pack);
 *             which object uses which clip is APPROXIMATED - the original furniture is not interactive as far as
 *             the code shows (only posters through CustomRoomObject, the door and the Mii).
 *   nod       animNodClone (REVERSED name, binary) used as the closing reaction of an object interaction (APPROXIMATED)
 * Door: doorAnimOpen / doorAnimClose (roomBaseComponents), node "doorAnim".
 *
 * DEDUCED / APPROXIMATED (see docs/reverse-engineering/ROOM.md, LOOP.md): walking speed; cross-fade 0.2 s; turn
 * rate; spawn point; door / corridor path; grid pathfinding (RoomMainLayer mGoToTouch*MiiPosition not reversed);
 * the input rules of the state machine (what a click does in each state).
 */
import * as THREE from 'three';
import type { AnimClip, BodyModel } from '../body/BodyModel';

export interface TalkGesture { name: string; inAnim: string | null; anim: string; outAnim: string | null; min: number; max: number; }
export type MiiState = 'outside' | 'entering' | 'idle' | 'walking' | 'interacting' | 'reacting' | 'exiting' | 'held';
/** Every legal transition. Anything else is refused and recorded in `violations` (tests require it to stay empty). */
export const TRANSITIONS: Record<MiiState, readonly MiiState[]> = {
  outside: ['entering', 'idle' /* restore() after a room rebuild only */],
  entering: ['reacting', 'idle'],
  idle: ['walking', 'reacting', 'exiting', 'entering' /* appear() */, 'held'],
  walking: ['walking', 'idle', 'reacting', 'interacting', 'exiting', 'held'],
  held: ['reacting'],
  interacting: ['reacting'],
  reacting: ['idle'],
  exiting: ['outside']
};
export type DirectorEvent =
  | { type: 'state'; from: MiiState; to: MiiState }
  | { type: 'clip'; name: string }
  | { type: 'frame'; name: string; frame: number }
  | { type: 'door'; name: 'doorAnimOpen' | 'doorAnimClose' }
  | { type: 'touch' }
  | { type: 'wave' }
  | { type: 'reactionEnd'; kind: 'touch' | 'wave' | 'object' | 'greeting' | 'drop' | 'idleAction' | 'gesture' }
  | { type: 'gesture'; name: string }
  | { type: 'grab' } | { type: 'release' }
  | { type: 'interact'; object: string; clip: string }
  | { type: 'ignored'; input: string; state: MiiState };

interface Track { clip: AnimClip | null; t: number; loop: boolean; onEnd?: () => void; }
export interface Box { name: string; min: THREE.Vector2; max: THREE.Vector2; top?: number; }
export interface Interactable { name: string; label: string; clip: string; spot: THREE.Vector3; face: number; box: Box; }

const FADE = 0.2;          // s, APPROXIMATED
const TURN = 9;            // rad/s, APPROXIMATED
const ROOM_HALF = 34;
const MARGIN = 3;
export const SPAWN = new THREE.Vector3(0, 0, -6);
const DOOR_IN = new THREE.Vector3(0, 0, -27);     // in front of the door, inside
const CORRIDOR = new THREE.Vector3(0, 0, -47);    // entrance mesh spans z -34 .. -50.7

/** Object -> clip. Only the names come from the game (see header); the pairing and labels are APPROXIMATED. */
export const OBJECT_ACTIONS: Record<string, { clip: string; label: string }> = {
  chest: { clip: 'animActionCheckTheBox', label: 'Baule' },
  light: { clip: 'animActionPress', label: 'Lampada' },
  plant1: { clip: 'animSmellHandDown', label: 'Pianta' },
  plant2: { clip: 'animSmellHandDown', label: 'Pianta' }
};

export class RoomDirector {
  state: MiiState = 'outside';
  readonly pos = new THREE.Vector3().copy(CORRIDOR);
  heading = 0;                      // rad, 0 = facing +Z (camera)
  private cur: Track = { clip: null, t: 0, loop: true };
  private prev: Track | null = null;
  private fade = 0;
  path: THREE.Vector3[] = [];
  private afterPath: (() => void) | null = null;
  private faceTo: { heading: number; then: () => void } | null = null;
  door = { clip: null as AnimClip | null, t: 0, open: false, playing: false };
  walkSpeed = 10;                    // units/s, recomputed from the clip
  readonly log: string[] = [];
  readonly violations: string[] = [];
  readonly history: string[] = [];
  boxes: Box[] = [];
  target: THREE.Vector3 | null = null;  // destination of the current walk (marker)
  intent: Interactable | null = null;   // object the Mii is walking to / using
  onEvent: ((e: DirectorEvent) => void) | null = null;
  /** PLAY: occasional idle action after a quiet period (clip from the sound tables, timing APPROXIMATED). */
  idleVariations = false;
  private quiet = 0;
  private gestureSeed = 3;
  private pendingGesture: { g: TalkGesture; ttl: number } | null = null;
  private idleSeed = 1;
  private fallV = 0;
  private dropping = false;
  static readonly LIFT = 5;          // held height, room units (APPROXIMATED)

  constructor(private anims: Map<string, AnimClip>, private female: boolean, private doorOpen: AnimClip | null, private doorClose: AnimClip | null) {}

  clip(name: string) { return this.anims.get(name) ?? null; }
  get idleName() { return this.female ? 'animWaitFemale' : 'animWaitMale'; }
  get currentClip() { return this.cur.clip?.name ?? ''; }
  private fps(c: AnimClip | null) { return c && c.fps > 0 && c.fps <= 120 ? c.fps : 30; }
  private emit(e: DirectorEvent) { try { this.onEvent?.(e); } catch (err) { console.error(err); } }

  private setState(to: MiiState): boolean {
    const from = this.state;
    if (!TRANSITIONS[from].includes(to)) { this.violations.push(`${from} -> ${to}`); return false; }
    this.state = to;
    if (from !== to) { this.history.push(`${from}>${to}`); if (this.history.length > 200) this.history.shift(); this.emit({ type: 'state', from, to }); }
    return true;
  }
  private ignore(input: string) { this.log.push(`ignorato ${input} (${this.state})`); this.emit({ type: 'ignored', input, state: this.state }); return false; }

  play(name: string, loop: boolean, onEnd?: () => void) {
    const c = this.clip(name);
    if (!c) { this.log.push(`clip mancante: ${name}`); onEnd?.(); return; }
    this.prev = { ...this.cur }; this.fade = FADE;
    this.cur = { clip: c, t: 0, loop, onEnd };
    this.log.push(`▶ ${name}`);
    this.emit({ type: 'clip', name });
  }

  /** Measures walking speed from the walk cycle on the scaled skeleton (stance foot travel, DEDUCED). */
  calibrate(body: BodyModel) {
    const c = this.clip('animWalkClone'); if (!c) return;
    let mn = Infinity, mx = -Infinity;
    for (let f = 0; f < c.frames; f++) { body.applyPose(c, f); const p = body.jointPosition('Ankle_L'); if (p) { mn = Math.min(mn, p.z); mx = Math.max(mx, p.z); } }
    const cycle = c.frames / this.fps(c);
    if (isFinite(mn) && mx > mn) this.walkSpeed = (2 * (mx - mn)) / cycle;
  }

  // ---- high level actions (each one checks the state machine) ----
  /**
   * Entrance through the door. M18: `spot` = where to stop (a visiting friend stops next to the host: APPROXIMATED);
   * the path goes around furniture from the door.
   */
  enter(spot: THREE.Vector3 = SPAWN) {
    if (this.state !== 'outside') return this.ignore('enter');
    this.setState('entering');
    this.pos.copy(CORRIDOR); this.heading = 0;
    const dest = this.clampToRoom(spot.clone());
    this.openDoor(() => this.walkTo([DOOR_IN, ...this.planPath(DOOR_IN, dest)], () => {
      this.closeDoor();
      this.setState('reacting');
      this.emit({ type: 'reactionEnd', kind: 'greeting' });  // greeting starts with the wave
      this.wave(() => this.setState('idle'));
    }));
    return true;
  }
  /** M18: turn in place toward a room point (another Mii), then `then`. Only from idle (otherwise ignored). */
  faceToward(p: THREE.Vector3, then: () => void = () => {}) {
    if (this.state !== 'idle') { then(); return false; }
    this.faceTo = { heading: Math.atan2(p.x - this.pos.x, p.z - this.pos.z), then };
    return true;
  }
  /** M18: other Miis in the room (positions), kept at PERSONAL distance (APPROXIMATED: no original collision data). */
  others: () => THREE.Vector3[] = () => [];
  static readonly PERSONAL = 4.5;
  private stuckT = 0;
  private bestLeft = Infinity;
  /** M18: occasional walk to a free spot of the room while idle (visiting friends). APPROXIMATED (no original data). */
  wander = false;
  private wanderSeed = 5;
  /**
   * Per-Mii seeds for the idle look-around and the wander timer, so several Miis in one room do not act in lockstep
   * (M18 / Reboot multi-Mii). Seed 0 = the default sequence (the host, unchanged).
   */
  reseed(n: number) { this.idleSeed = (this.idleSeed + n * 7919) % 233280; this.wanderSeed = (5 + n * 104729) % 233280; this.quiet = -(n % 5) * 1.7; }
  private wanderT = 0;
  /** Alternative entrance used by the game when the Mii appears: fall + landing (REVERSED clip pair). */
  appear() {
    if (this.state !== 'outside' && this.state !== 'idle') return this.ignore('appear');
    if (this.state === 'outside') this.closeDoor();
    this.setState('entering'); this.clearMove(); this.pos.copy(SPAWN); this.heading = 0;
    this.play('animActionAppearFall', false, () => this.play('animActionAppearLanding', false, () => { this.setState('idle'); this.play(this.idleName, true); }));
    return true;
  }
  /** After a room rebuild (wall/floor change): keep position, resume idle. */
  /** After a rebuild (outfit / skin change): idle again with no fade from the bind pose (M17 fix: no T-pose flash), same clip time. */
  restore(pos: THREE.Vector3, heading: number, t = 0) {
    this.pos.copy(pos); this.heading = heading; this.setState('idle'); this.play(this.idleName, true);
    this.fade = 0; this.cur.t = t;
  }
  /**
   * SHARED ROOM (0.2): puts an idle / walking Mii somewhere at once (network correction of a friend's Mii), through
   * legal transitions only (walking → idle; idle stays idle), unlike restore() which is for a fresh director.
   */
  place(pos: THREE.Vector3, heading: number) {
    if (this.state !== 'idle' && this.state !== 'walking') return this.ignore('place');
    this.clearMove();
    if (this.state === 'walking') this.setState('idle');
    this.pos.copy(pos); this.heading = heading;
    if (this.currentClip !== this.idleName) this.play(this.idleName, true);
    return true;
  }
  /** Time in the current clip (used to carry the idle phase over a rebuild). */
  get clipTime() { return this.cur.t; }
  exit() {
    if (this.state !== 'idle' && this.state !== 'walking') return this.ignore('exit');
    this.clearMove();
    this.setState('exiting');
    this.walkTo(this.planPath(this.pos, DOOR_IN), () => this.openDoor(() => this.walkTo([CORRIDOR], () => { this.closeDoor(); this.setState('outside'); })));
    return true;
  }
  /** Click-to-walk / keyboard. While walking the destination is replaced (no stop in between). */
  goTo(p: THREE.Vector3) {
    if (this.state !== 'idle' && this.state !== 'walking') return this.ignore('goTo');
    const q = this.clampToRoom(p);
    this.intent = null; this.faceTo = null;
    this.setState('walking');
    this.target = q.clone();
    this.walkTo(this.planPath(this.pos, q), () => { this.target = null; this.setState('idle'); });
    return true;
  }
  /** Tap on the Mii: interrupts walking, turns to the viewer, plays the original stroke reaction, back to idle. */
  touch() {
    if (this.state !== 'idle' && this.state !== 'walking') return this.ignore('touch');
    const wasWalking = this.state === 'walking';
    this.clearMove();
    this.setState('reacting');
    if (wasWalking) this.play(this.idleName, true);
    this.faceTo = { heading: 0, then: () => {                // face the viewer (camera at +Z), APPROXIMATED
      this.emit({ type: 'touch' });
      this.play('animActionStroked', false, () => { this.setState('idle'); this.play(this.idleName, true); this.emit({ type: 'reactionEnd', kind: 'touch' }); });
    } };
    return true;
  }
  wave(done?: () => void) {
    this.play('animHandWaveLIn', false, () => this.play('animHandWaveL', false, () => this.play('animHandWaveL', false, () => this.play('animHandWaveLOut', false, () => { this.play(this.idleName, true); done?.(); }))));
  }
  /** Space / button: wave as a standalone reaction. */
  waveReaction() {
    if (this.state !== 'idle') return this.ignore('wave');
    this.setState('reacting');
    this.emit({ type: 'wave' });
    this.wave(() => { this.setState('idle'); this.emit({ type: 'reactionEnd', kind: 'wave' }); });
    return true;
  }
  /** Object: walk to its interaction spot, face it, play its clip, nod, idle. */
  interact(obj: Interactable) {
    if (this.state !== 'idle' && this.state !== 'walking') return this.ignore(`interact:${obj.name}`);
    if (!this.clip(obj.clip)) { this.log.push(`clip mancante: ${obj.clip}`); return this.goTo(obj.spot); }
    this.faceTo = null;
    this.setState('walking');
    this.intent = obj; this.target = obj.spot.clone();
    this.walkTo(this.planPath(this.pos, obj.spot), () => {
      this.target = null;
      this.setState('interacting');
      this.faceTo = { heading: obj.face, then: () => {
        this.emit({ type: 'interact', object: obj.name, clip: obj.clip });
        this.play(obj.clip, false, () => {
          this.setState('reacting');
          this.play('animNodClone', false, () => { this.intent = null; this.setState('idle'); this.play(this.idleName, true); this.emit({ type: 'reactionEnd', kind: 'object' }); });
        });
      } };
    });
    return true;
  }

  /**
   * Drag the Mii (SequenceTouch table: animActionPickUp / animActionFall / animActionTouchLanding, se_ui_hand_00/01;
   * the clip names are REVERSED, the dangle loop, lift height and fall speed are APPROXIMATED).
   */
  grab() {
    if (this.state !== 'idle' && this.state !== 'walking') return this.ignore('grab');
    this.clearMove();
    this.setState('held');
    this.pos.y = RoomDirector.LIFT;
    this.play('animActionPickUp', true);
    this.emit({ type: 'grab' });
    return true;
  }
  holdAt(x: number, z: number) {
    if (this.state !== 'held') return;
    const q = this.clampToRoom(new THREE.Vector3(x, 0, z));
    this.pos.set(q.x, RoomDirector.LIFT, q.z);
  }
  release() {
    if (this.state !== 'held') return this.ignore('release');
    this.setState('reacting');
    this.emit({ type: 'release' });
    this.dropping = true; this.fallV = 0;
    this.play('animActionFall', true);
    return true;
  }
  private landed() {
    this.dropping = false; this.pos.y = 0;
    const land = this.clip('animActionTouchLandingFootStep') ? 'animActionTouchLandingFootStep' : 'animActionTouchLanding';
    this.play(land, false, () => { this.setState('idle'); this.play(this.idleName, true); this.emit({ type: 'reactionEnd', kind: 'drop' }); });
  }
  /** Turn to the viewer in place (closet / profile views). */
  faceViewer() { if (this.state === 'idle') this.faceTo = { heading: 0, then: () => {} }; }
  /** Any user input resets the quiet timer of the idle variations. */
  poke() { this.quiet = 0; }

  private clearMove() { this.path = []; this.afterPath = null; this.target = null; this.intent = null; this.faceTo = null; }
  private walkTo(points: THREE.Vector3[], done: () => void) {
    this.path = points.map((p) => p.clone()); this.bestLeft = Infinity; this.stuckT = 0;
    this.afterPath = done;
    if (this.currentClip !== 'animWalkClone') this.play('animWalkClone', true);
  }
  private openDoor(done: () => void) {
    if (!this.doorOpen) { done(); return; }
    this.door = { clip: this.doorOpen, t: 0, open: true, playing: true };
    this.doorDone = done;
    this.emit({ type: 'door', name: 'doorAnimOpen' });
    if (this.currentClip !== this.idleName && this.state !== 'entering') this.play(this.idleName, true);
  }
  private closeDoor() {
    if (!this.doorClose || !this.door.open) return;
    this.door = { clip: this.doorClose, t: 0, open: false, playing: true };
    this.doorDone = null;
    this.emit({ type: 'door', name: 'doorAnimClose' });
  }
  private doorDone: (() => void) | null = null;

  private inBox(x: number, z: number, m = MARGIN) { return this.boxes.some((b) => x > b.min.x - m && x < b.max.x + m && z > b.min.y - m && z < b.max.y + m); }

  /** Keeps a target on the walkable floor: inside the walls and outside furniture footprints (+ margin). M7, unchanged. */
  clampToRoom(p: THREE.Vector3): THREE.Vector3 {
    const m = MARGIN, q = new THREE.Vector3(THREE.MathUtils.clamp(p.x, -ROOM_HALF + m, ROOM_HALF - m), 0, THREE.MathUtils.clamp(p.z, -ROOM_HALF + m, ROOM_HALF - m));
    for (const b of this.boxes) {
      const x0 = b.min.x - m, x1 = b.max.x + m, z0 = b.min.y - m, z1 = b.max.y + m;
      if (q.x > x0 && q.x < x1 && q.z > z0 && q.z < z1) {
        const opts = [[q.x - x0, x0, q.z], [x1 - q.x, x1, q.z], [q.z - z0, q.x, z0], [z1 - q.z, q.x, z1]].sort((a, c) => a[0] - c[0]);
        q.set(opts[0][1], 0, opts[0][2]);
      }
    }
    // a footprint push can leave the walls: clamp again; if that lands back inside a footprint, stay put
    q.x = THREE.MathUtils.clamp(q.x, -ROOM_HALF + m, ROOM_HALF - m); q.z = THREE.MathUtils.clamp(q.z, -ROOM_HALF + m, ROOM_HALF - m);
    if (this.inBox(q.x, q.z)) {
      // nearest free point along the straight line from the Mii to the target
      const from = this.pos.clone();
      for (let k = 1; k >= 0; k -= 0.05) { const c = from.clone().lerp(q, k); if (!this.inBox(c.x, c.z)) return c; }
      return from;
    }
    return q;
  }

  /** True when the straight segment stays off every furniture footprint (+ margin - 0.5 tolerance). */
  segmentClear(a: THREE.Vector3, b: THREE.Vector3) {
    const n = Math.max(2, Math.ceil(a.distanceTo(b) / 0.5));
    for (let i = 1; i <= n; i++) { const t = i / n; if (this.inBox(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, MARGIN - 0.5)) return false; }
    return true;
  }
  /**
   * Waypoints from a to b. A clear straight line keeps the M7 behaviour (single target). Otherwise: A* on a 1-unit
   * grid of the floor (8-neighbour, furniture + margin blocked), then string-pulling. APPROXIMATED (original not reversed).
   */
  planPath(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] {
    const goal = b.clone(); goal.y = 0;
    if (this.segmentClear(a, goal)) return [goal];
    const lim = ROOM_HALF - MARGIN, S = 1, N = Math.floor((2 * lim) / S) + 1;
    const toI = (v: number) => THREE.MathUtils.clamp(Math.round((v + lim) / S), 0, N - 1);
    const toW = (i: number) => -lim + i * S;
    const blocked = (i: number, j: number) => this.inBox(toW(i), toW(j), MARGIN - 0.25);
    const si = toI(a.x), sj = toI(a.z), gi = toI(goal.x), gj = toI(goal.z);
    const idx = (i: number, j: number) => j * N + i;
    const g = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1), closed = new Uint8Array(N * N);
    const open: number[] = [idx(si, sj)]; g[idx(si, sj)] = 0;
    const h = (i: number, j: number) => Math.hypot(i - gi, j - gj);
    let found = -1;
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) { const A = open[k], B = open[bi]; if (g[A] + h(A % N, (A / N) | 0) < g[B] + h(B % N, (B / N) | 0)) bi = k; }
      const c = open.splice(bi, 1)[0]; if (closed[c]) continue; closed[c] = 1;
      const ci = c % N, cj = (c / N) | 0;
      if (ci === gi && cj === gj) { found = c; break; }
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const ni2 = idx(ni, nj); if (closed[ni2]) continue;
        if (blocked(ni, nj) && !(ni === gi && nj === gj)) continue;
        if (di && dj && (blocked(ci + di, cj) || blocked(ci, cj + dj))) continue; // no corner cutting
        const ng = g[c] + (di && dj ? Math.SQRT2 : 1);
        if (ng < g[ni2]) { g[ni2] = ng; from[ni2] = c; open.push(ni2); }
      }
    }
    if (found < 0) return [goal]; // unreachable on the grid: M7 straight line
    const cells: THREE.Vector3[] = [];
    for (let c = found; c >= 0; c = from[c]) cells.unshift(new THREE.Vector3(toW(c % N), 0, toW((c / N) | 0)));
    cells[cells.length - 1] = goal;
    // string pulling
    const out: THREE.Vector3[] = []; let anchor = a.clone(), k = 0;
    while (k < cells.length - 1) {
      let far = k; for (let m = cells.length - 1; m > k; m--) if (this.segmentClear(anchor, cells[m])) { far = m; break; }
      if (far === k) far = k + 1;
      out.push(cells[far]); anchor = cells[far]; k = far;
    }
    if (!out.length || !out[out.length - 1].equals(goal)) out.push(goal);
    return out;
  }

  /** Interaction spot of a furniture box: side facing the room centre (free of other boxes), facing the object. */
  interactable(box: Box): Interactable | null {
    const def = OBJECT_ACTIONS[box.name]; if (!def) return null;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.y + box.max.y) / 2, off = MARGIN + 1.2;
    const cands = [
      new THREE.Vector3(cx, 0, box.max.y + off), new THREE.Vector3(cx, 0, box.min.y - off),
      new THREE.Vector3(box.max.x + off, 0, cz), new THREE.Vector3(box.min.x - off, 0, cz)
    ].filter((p) => Math.abs(p.x) < ROOM_HALF - MARGIN && Math.abs(p.z) < ROOM_HALF - MARGIN && !this.inBox(p.x, p.z, MARGIN - 0.5));
    if (!cands.length) return null;
    cands.sort((p, q) => p.lengthSq() - q.lengthSq());
    const spot = cands[0];
    return { name: box.name, label: def.label, clip: def.clip, spot, face: Math.atan2(cx - spot.x, cz - spot.z), box };
  }

  /**
   * Talking gesture (EmotionExpression: In → loop × [min..max] → Out, then idle). Played only from idle; while the Mii
   * is busy (entering, reacting) it waits up to 1.5 s and is then dropped (APPROXIMATED: the original timing fields
   * ex_PrecedingMaxSec / ex_DelayMaxSec are not in the files). Loop count: deterministic pseudo-random in the range.
   */
  gesture(g: TalkGesture) {
    if (this.state !== 'idle') { this.pendingGesture = { g, ttl: 1.5 }; return false; }
    this.pendingGesture = null;
    const span = Math.max(0, g.max - g.min);
    this.gestureSeed = (this.gestureSeed * 9301 + 49297) % 233280;
    let loops = g.min + Math.floor((this.gestureSeed / 233280) * (span + 1));
    if (!this.clip(g.anim)) { this.log.push(`clip mancante: ${g.anim}`); return false; }
    this.emit({ type: 'gesture', name: g.name });   // before the state change: listeners know it is a talking gesture
    this.setState('reacting');
    const end = () => { this.setState('idle'); this.play(this.idleName, true); this.emit({ type: 'reactionEnd', kind: 'gesture' }); };
    const out = () => (g.outAnim ? this.play(g.outAnim, false, end) : end());
    const loop = () => { if (loops-- <= 0) return out(); this.play(g.anim, false, loop); };
    if (g.inAnim) this.play(g.inAnim, false, loop); else loop();
    return true;
  }

  /** Advances time; returns the pose to apply. */
  update(dt: number): { clip: AnimClip | null; frame: number; blend?: { clip: AnimClip | null; frame: number; weight: number } } {
    if (this.dropping) {
      this.fallV += 60 * dt;                                   // gravity, APPROXIMATED
      this.pos.y = Math.max(0, this.pos.y - this.fallV * dt);
      if (this.pos.y <= 0) this.landed();
    }
    if (this.pendingGesture) {
      if (this.state === 'idle') this.gesture(this.pendingGesture.g);
      else if ((this.pendingGesture.ttl -= dt) <= 0) this.pendingGesture = null;
    }
    if (this.idleVariations && this.state === 'idle' && this.currentClip === this.idleName) {
      this.quiet += dt;
      // deterministic pseudo-random wait 14..26 s
      const wait = 14 + ((this.idleSeed * 9301 + 49297) % 233280) / 233280 * 12;
      if (this.quiet > wait && this.clip('animActionLookAroundRestlessly')) {
        this.quiet = 0; this.idleSeed++;
        this.setState('reacting');
        this.play('animActionLookAroundRestlessly', false, () => { this.setState('idle'); this.play(this.idleName, true); this.emit({ type: 'reactionEnd', kind: 'idleAction' }); });
      }
    } else if (this.state !== 'idle') this.quiet = 0;
    if (this.wander && this.state === 'idle' && this.currentClip === this.idleName && !this.faceTo) {
      this.wanderT += dt;
      this.wanderSeed = (this.wanderSeed * 9301 + 49297) % 233280;
      const r = this.wanderSeed / 233280;
      if (this.wanderT > 11 + r * 10) {
        this.wanderT = 0;
        const ang = r * Math.PI * 2, rad = 6 + r * 12;
        const q = this.clampToRoom(new THREE.Vector3(Math.sin(ang) * rad, 0, 4 + Math.cos(ang) * rad * 0.6));
        if (this.others().every((o) => o.distanceTo(q) > RoomDirector.PERSONAL * 1.6)) this.goTo(q);
      }
    } else this.wanderT = 0;
    // movement along the path (walk clip has no root motion)
    if (this.path.length) {
      const target = this.path[0];
      const d = new THREE.Vector3().subVectors(target, this.pos); d.y = 0;
      const dist = d.length();
      if (dist < 0.3) {
        this.path.shift(); this.bestLeft = Infinity; this.stuckT = 0;
        if (!this.path.length) { const cb = this.afterPath; this.afterPath = null; this.play(this.idleName, true); cb?.(); }
      } else {
        const want = Math.atan2(d.x, d.z);
        let dh = want - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        this.heading += Math.sign(dh) * Math.min(Math.abs(dh), TURN * dt);
        const step = Math.min(dist, this.walkSpeed * dt * Math.max(0, Math.cos(dh)));
        this.pos.addScaledVector(d.normalize(), step);
        // M18: personal distance to the other Miis while walking. Only a Mii passing the door (entering / exiting in the corridor
        // strip z < −24) is exempt, so it can get through; the rest of the back strip is avoided like the room (R4 fix: two
        // Miis could stack up near the back wall)
        if (this.pos.z > -24 || (this.state !== 'entering' && this.state !== 'exiting')) for (const o of this.others()) {
          const v = new THREE.Vector3(this.pos.x - o.x, 0, this.pos.z - o.z), dd = v.length();
          if (dd < RoomDirector.PERSONAL && dd > 1e-4) {
            // the last waypoint inside the personal space: stop here instead of pushing into the other Mii
            if (this.path.length === 1 && this.path[0].distanceTo(o) < RoomDirector.PERSONAL) {
              const n0 = v.clone().normalize(); this.pos.set(o.x + n0.x * RoomDirector.PERSONAL, this.pos.y, o.z + n0.z * RoomDirector.PERSONAL); this.path[0].copy(this.pos);
            }
            else {
              // back onto the personal circle, then slide along it toward the waypoint (walks AROUND the other Mii
              // instead of being pushed straight back forever — needed with several Miis, R2; APPROXIMATED)
              const n = v.normalize();
              this.pos.set(o.x + n.x * RoomDirector.PERSONAL, this.pos.y, o.z + n.z * RoomDirector.PERSONAL);
              const tg = new THREE.Vector3(-n.z, 0, n.x), to = new THREE.Vector3().subVectors(this.path[0], this.pos);
              if (tg.dot(to) < 0) tg.negate();
              this.pos.addScaledVector(tg, step);
            }
          }
        }
        // several Miis: a correction against one may push into another — relax (radial push-out only) a few times
        if (this.pos.z > -24 || (this.state !== 'entering' && this.state !== 'exiting')) for (let it = 0; it < 3; it++) {
          let moved = false;
          for (const o of this.others()) {
            const v = new THREE.Vector3(this.pos.x - o.x, 0, this.pos.z - o.z), dd = v.length();
            if (dd < RoomDirector.PERSONAL - 1e-3 && dd > 1e-4) { this.pos.addScaledVector(v.normalize(), RoomDirector.PERSONAL - dd); moved = true; }
          }
          if (!moved) break;
        }
        // stuck guard: no progress toward the waypoint for 2.5 s → skip it (last one: stop where we are)
        const left = this.path.length ? this.path[0].distanceTo(this.pos) : 0;
        if (left < this.bestLeft - 0.05) { this.bestLeft = left; this.stuckT = 0; }
        else if ((this.stuckT += dt) > 2.5) {
          this.stuckT = 0; this.bestLeft = Infinity;
          if (this.path.length > 1) this.path.shift(); else if (this.path.length) this.path[0].copy(this.pos);
        }
      }
    } else if (this.faceTo) {
      let dh = this.faceTo.heading - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += Math.sign(dh) * Math.min(Math.abs(dh), TURN * dt);
      if (Math.abs(dh) < 0.05) { const f = this.faceTo; this.faceTo = null; this.heading = f.heading; f.then(); }
    }
    // door
    if (this.door.playing && this.door.clip) {
      this.door.t += dt * this.fps(this.door.clip);
      if (this.door.t >= this.door.clip.frames - 1) { this.door.t = this.door.clip.frames - 1; this.door.playing = false; const cb = this.doorDone; this.doorDone = null; cb?.(); }
    }
    // clips
    const adv = (tr: Track, events: boolean) => {
      if (!tr.clip) return;
      const t0 = tr.t, last = Math.max(1, tr.clip.frames - 1);
      tr.t += dt * this.fps(tr.clip);
      if (events) for (let k = Math.floor(t0) + 1; k <= Math.floor(tr.t); k++) this.emit({ type: 'frame', name: tr.clip.name, frame: tr.loop ? k % last : Math.min(k, last) });
      if (tr.t >= tr.clip.frames - 1) {
        if (tr.loop) tr.t %= last;
        else { tr.t = tr.clip.frames - 1; const cb = tr.onEnd; tr.onEnd = undefined; if (tr === this.cur) cb?.(); }
      }
    };
    adv(this.cur, true);
    if (this.prev && this.fade > 0) { adv(this.prev, false); this.fade -= dt; }
    const w = this.prev && this.fade > 0 ? this.fade / FADE : 0;
    return { clip: this.cur.clip, frame: this.cur.t, blend: w > 0 ? { clip: this.prev!.clip, frame: this.prev!.t, weight: w } : undefined };
  }
}
