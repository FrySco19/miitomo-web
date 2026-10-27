// REBOOT R5 test double: a RebootHost with the same contracts as main.ts (guests through a door that takes time,
// "already inside" guests, places that change the screen and bring the user's Mii in through the door, one balloon,
// room clock ticks). No DOM. Shared by the R5 unit suites.
import type { RebootHost, FriendInfo, PlaceScene } from '../../client/web/src/reboot/host';

export type St = 'idle' | 'walking' | 'interacting' | 'reacting' | 'entering' | 'exiting' | 'outside';
export interface FM { id: string; name: string; personality: 0 | 1 | 2 | 3; x: number; z: number; heading: number; state: St; isHost: boolean; leaving: boolean; waiting: boolean; t?: number; tx?: number; tz?: number; busy?: number }

export const kv = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
export const flush = () => new Promise((r) => setTimeout(r, 0));

export function makeFriends(n: number): FriendInfo[] {
  const names = ['Lucia', 'Marco', 'Sara', 'Gino', 'Ada', 'Teo', 'Bea', 'Ugo', 'Ines', 'Rino'];
  return Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: names[i % names.length], personality: (i % 4) as 0 | 1 | 2 | 3, room: { wall: '000' + (i % 3), floor: '000' + (i % 2), variant: 0 }, birthday: { month: 1 + (i % 12), day: 3 + i }, greeting: `Ciao da ${names[i % names.length]}!` }));
}

export class FakeHost implements RebootHost {
  root = null as unknown as HTMLElement;
  scr = 'room';
  t = 0;
  cap = 3;
  ms: FM[] = [{ id: 'host', name: 'Kelly', personality: 3, x: 0, z: 0, heading: 0, state: 'idle', isHost: true, leaving: false, waiting: false }];
  ticks = new Set<(dt: number) => void>(); speech = new Set<(e: { speaker: string | null }) => void>(); player = new Set<(e: { id: string; kind: string }) => void>(); guestL = new Set<(e: { type: 'arrive' | 'leave'; id: string; name: string }) => void>();
  objectPolicy: ((o: string) => boolean) | null = null;
  photoShare: { label: () => string; share: (u: string) => void } | null = null;
  places: string[] = []; homes = 0; balloon: string | null = null; says: string[] = []; waves: string[] = [];
  inviteFail = new Set<string>();
  constructor(public fr: FriendInfo[]) {}
  screen = () => this.scr;
  visiting = () => false;
  friends = async () => this.fr.map((f) => ({ ...f }));
  guests = () => this.ms.filter((m) => !m.isHost).map((m) => ({ id: m.id, name: m.name, state: m.state, leaving: m.leaving }));
  async invite(id: string, opts?: { inside?: { x: number; z: number } }) {
    await Promise.resolve();
    const f = this.fr.find((x) => x.id === id);
    if (!f || this.inviteFail.has(id) || this.ms.some((m) => m.id === id) || this.guests().length >= this.cap) return false;
    const m: FM = { id, name: f.name, personality: f.personality ?? 2, x: opts?.inside?.x ?? 0, z: opts?.inside?.z ?? -27, heading: 0, state: opts?.inside ? 'idle' : 'entering', isHost: false, leaving: false, waiting: false, t: opts?.inside ? undefined : 2 };
    this.ms.push(m);
    for (const l of this.guestL) l({ type: 'arrive', id, name: f.name });
    return true;
  }
  dismiss = (id: string) => { const m = this.ms.find((x) => x.id === id && !x.isHost); if (!m || m.leaving) return false; m.leaving = true; m.state = 'exiting'; m.t = 3; return true; };
  capacity = () => this.cap;
  setCapacity = (n: number) => (this.cap = Math.max(1, Math.min(7, Math.floor(n))));
  onGuest(cb: (e: { type: 'arrive' | 'leave'; id: string; name: string }) => void) { this.guestL.add(cb); return () => this.guestL.delete(cb); }
  miis() { return this.ms.map((m) => ({ id: m.id, name: m.name, personality: m.personality, x: m.x, z: m.z, heading: m.heading, state: m.state, isHost: m.isHost, leaving: m.leaving, waiting: m.waiting })); }
  objects() { return [{ name: 'shelf', x: -20, z: -18 }, { name: 'chest', x: 20, z: -16 }]; }
  private m(id: string) { return this.ms.find((x) => x.id === id); }
  goTo(id: string, x: number, z: number) { const m = this.m(id); if (!m || (m.state !== 'idle' && m.state !== 'walking')) return false; m.tx = x; m.tz = z; m.state = 'walking'; return true; }
  face(id: string, x: number, z: number) { const m = this.m(id); if (!m || m.state !== 'idle') return Promise.resolve(false); m.heading = Math.atan2(x - m.x, z - m.z); return Promise.resolve(true); }
  interact(id: string, o: string) { const m = this.m(id); if (!m || m.state !== 'idle') return false; m.state = 'interacting'; m.busy = 3; void o; return true; }
  wave(id: string) { const m = this.m(id); if (!m || m.state !== 'idle') return false; m.state = 'reacting'; m.busy = 1.5; this.waves.push(id); return true; }
  say(id: string, text: string) { if (this.balloon) return Promise.resolve('busy' as const); this.balloon = id; this.says.push(`${id}:${text}`); for (const l of this.speech) l({ speaker: id }); return new Promise<'done'>((res) => setTimeout(() => { this.balloon = null; res('done'); }, 0)); }
  balloonBusy() { return !!this.balloon; }
  setGuestWander() { /* social life plans the walks */ }
  onTick(cb: (dt: number) => void) { this.ticks.add(cb); return () => this.ticks.delete(cb); }
  onSpeech(cb: (e: { speaker: string | null }) => void) { this.speech.add(cb); return () => this.speech.delete(cb); }
  onPlayer(cb: (e: { id: string; kind: string }) => void) { this.player.add(cb); return () => this.player.delete(cb); }
  profile() { return { name: 'Kelly', personality: 3 as const, birthday: { month: 5, day: 2 }, greeting: 'Eccomi!' }; }
  visitPlace(p: PlaceScene) {
    if (this.scr !== 'room' && !this.scr.startsWith('place:')) return false;
    this.places.push(p.id); this.clearGuests(); this.scr = 'place:' + p.id;
    const h = this.ms[0]; h.state = 'entering'; h.t = 1.5; h.x = 0; h.z = -27;
    return true;
  }
  returnHome() { this.homes++; this.clearGuests(); this.scr = 'room'; const h = this.ms[0]; h.state = 'entering'; h.t = 1.5; }
  clearGuests() { this.ms = this.ms.filter((m) => m.isHost); }
  roomSkins() { return { walls: ['0000', '0001', '0002'], floors: ['0000', '0001'], own: { wall: '0000', floor: '0000', variant: 0 } }; }
  setObjectPolicy(p: ((o: string) => boolean) | null) { this.objectPolicy = p; }
  snapshot() { return this.scr === 'room' || this.scr.startsWith('place:') ? 'data:image/jpeg;base64,/9j/AAAA' : null; }
  setPhotoShare(p: { label: () => string; share: (u: string) => void } | null) { this.photoShare = p; }
  openMiifoto() { this.scr = 'miifoto'; }
  /** The player taps an object in the room (main.ts roomClick: asks the object policy first). */
  tapObject(name: string) { return !this.objectPolicy || this.objectPolicy(name) ? this.interact('host', name) : false; }
  /** One room step: walks, doors, reactions, then the tick listeners (like main.ts socialTick). */
  step(dt = 0.25) {
    this.t += dt;
    for (const m of [...this.ms]) {
      if (m.t !== undefined) { m.t -= dt; if (m.t <= 0) { m.t = undefined; if (m.state === 'entering') { m.state = 'idle'; m.x = m.isHost ? 0 : 6; m.z = 0; } else if (m.state === 'exiting') { this.ms.splice(this.ms.indexOf(m), 1); for (const l of this.guestL) l({ type: 'leave', id: m.id, name: m.name }); } } }
      if (m.state === 'walking' && m.tx !== undefined) { const dx = m.tx - m.x, dz = m.tz! - m.z, d = Math.hypot(dx, dz); if (d < 0.5) { m.state = 'idle'; m.tx = undefined; } else { const s = Math.min(d, 10 * dt); m.x += (dx / d) * s; m.z += (dz / d) * s; } }
      if ((m.state === 'reacting' || m.state === 'interacting') && m.busy !== undefined) { m.busy -= dt; if (m.busy <= 0) { m.busy = undefined; m.state = 'idle'; } }
    }
    for (const l of [...this.ticks]) l(dt);
  }
  async run(sec: number, dt = 0.25) { for (let t = 0; t < sec; t += dt) { this.step(dt); if (Math.round(this.t / dt) % 4 === 0) await flush(); } await flush(); }
  listeners() { return { tick: this.ticks.size, speech: this.speech.size, player: this.player.size, guest: this.guestL.size }; }
}
/** window.setInterval / clearInterval for code that watches once a second (PlaceVisit, R3 controller). */
export function installWindow() { (globalThis as any).window = globalThis; }
