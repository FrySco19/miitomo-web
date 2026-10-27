/**
 * SHARED ROOM — the session (engine) drawn in this game page's room. Same code for Classic and Reboot: the page gives
 * a SceneHost (main.ts) over its real room machinery.
 *
 *   my Mii            sampled every frame (LocalSampler) → engine → the others; my actions (wave, object, touch
 *                     reaction, my lines) → engine → the others
 *   the others' Miis  one ordinary room Mii each (guest machinery: own body, head, outfit, voice), spawned from the
 *                     profile THEY sent; moved only by RemoteAvatar from their states. My own Mii, save, outfit and
 *                     name are never touched by the session.
 *   the room          host: my room as it is; guest: the host's room look (wall / floor / variant) with MY Mii
 *                     coming in through the door; leaving / session over → back home.
 * Simulated visitors (Classic schedule, Reboot social life) are paused while a session is on: they would exist on
 * one screen only.
 */
import type { P2PClient } from '../p2p/client';
import type { MpView, MpAct, RoomSkin, AvState } from '../p2p/session';
import type { Interactable } from '../room/RoomDirector';
import { LocalSampler, RemoteAvatar, DirectorLike } from './RemoteAvatar';

export interface SceneHost {
  /** The room and my Mii exist (room files loaded, room scene shown). */
  roomReady(): boolean;
  local(): DirectorLike | null;
  objects(): Interactable[];
  remote(id: string): DirectorLike | null;
  /** A friend's Mii from the profile they sent; `inside` = already in the room there (no door). */
  spawn(id: string, payload: unknown, inside: { x: number; z: number; h: number } | null): Promise<boolean>;
  /** The friend's Mii goes (through the door, or at once). */
  despawn(id: string, viaDoor: boolean): void;
  /** A line said by a friend's Mii (their balloon, their voice). */
  say(id: string, text: string, lang: string): void;
  /** Guest: show the host's room look (null = back to my own room). Host: my room stays. */
  showShared(room: RoomSkin | null, info: { role: 'host' | 'guest'; hostName: string } | null): void;
  /** A friend tapped MY Mii: my Mii reacts (and that reaction goes to everybody as mine). */
  pokeLocal(): void;
  /** Session on/off (simulated visitors paused; enough guest seats). */
  setActive(on: boolean, seats: number): void;
  onTick(cb: (dt: number) => void): () => void;
  onLocalAct(cb: (a: MpAct) => void): () => void;
}

export class SceneSync {
  private avatars = new Map<string, RemoteAvatar>();
  private spawning = new Set<string>();
  private latest = new Map<string, AvState>();
  private sampler = new LocalSampler();
  private shownRoom = '';
  private role: 'host' | 'guest' | null = null;
  private unsubs: (() => void)[] = [];
  readonly log: string[] = [];
  constructor(private p2p: P2PClient, private host: SceneHost) {
    this.unsubs.push(
      p2p.onMp((v) => this.reconcile(v)),
      p2p.onAv((id, _seq, s) => { this.latest.set(id, s); this.avatars.get(id)?.apply(s); }),
      p2p.onAct((id, _seq, a) => this.onAct(id, a)),
      host.onTick((dt) => this.tick(dt)),
      host.onLocalAct((a) => { if (this.p2p.mp?.session) this.p2p.castAct(a); }),
    );
  }
  private note(m: string) { this.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`); if (this.log.length > 100) this.log.shift(); }
  dispose() { for (const u of this.unsubs) u(); this.unsubs = []; }
  get remotes() { return [...this.avatars.values()]; }

  private onAct(id: string, a: MpAct) {
    const me = this.p2p.mp?.me;
    if (a.k === 'poke') { if (a.o === me) this.host.pokeLocal(); return; }
    if (a.k === 'say' && a.text) { this.host.say(id, a.text, a.lang ?? 'it'); return; }
    this.avatars.get(id)?.act(a);
  }
  /** Session (engine) → this page's room. */
  private reconcile(v: MpView) {
    const s = v.session;
    if (!s) {
      if (this.role) {
        this.note('fine sessione');
        for (const id of [...this.avatars.keys(), ...this.spawning]) this.host.despawn(id, false);
        this.avatars.clear(); this.spawning.clear(); this.latest.clear();
        if (this.role === 'guest') this.host.showShared(null, null);
        else this.host.showShared(null, null);
        this.host.setActive(false, 0);
        this.role = null; this.shownRoom = '';
      }
      return;
    }
    const others = s.members.filter((m) => m.id !== v.me);
    if (!this.role) this.note(`sessione ${s.sid} (${s.role})`);
    this.host.setActive(true, Math.max(1, others.length));
    const hostName = s.members.find((m) => m.id === s.host)?.name ?? '';
    const roomKey = `${s.role}:${s.room.wall}/${s.room.floor}/${s.room.variant}`;
    if (this.role !== s.role || this.shownRoom !== roomKey) {
      // a new room look rebuilds the room: the friends' Miis are put back after it
      for (const id of [...this.avatars.keys()]) this.host.despawn(id, false);
      this.avatars.clear(); this.spawning.clear();
      this.host.showShared(s.role === 'guest' ? s.room : null, { role: s.role, hostName });
      this.shownRoom = roomKey; this.role = s.role; this.sampler.reset();
    }
    for (const m of others) {
      if (m.av) { const l = this.latest.get(m.id); if (!l || l.t <= m.av.t) this.latest.set(m.id, m.av); }
    }
    for (const id of [...this.avatars.keys()]) if (!others.some((m) => m.id === id)) { this.host.despawn(id, true); this.avatars.delete(id); this.note(`esce ${id}`); }
    this.pendingSpawn = others.filter((m) => !this.avatars.has(m.id)).map((m) => ({ id: m.id, profile: m.profile }));
  }
  private pendingSpawn: { id: string; profile: unknown }[] = [];
  private trySpawn() {
    if (!this.pendingSpawn.length || !this.host.roomReady() || !this.host.local()) return;
    const list = this.pendingSpawn; this.pendingSpawn = [];
    for (const m of list) {
      if (this.avatars.has(m.id) || this.spawning.has(m.id)) continue;
      if (!m.profile) { this.note(`${m.id}: profilo non ancora arrivato`); this.pendingSpawn.push(m); continue; }
      const av = this.latest.get(m.id);
      // already inside (they were there before this page drew the room) → no door; else they come in through it
      const inside = av && av.st !== 'outside' && av.st !== 'entering' ? { x: av.x, z: av.z, h: av.h } : null;
      this.spawning.add(m.id);
      void this.host.spawn(m.id, m.profile, inside).then((ok) => {
        this.spawning.delete(m.id);
        const d = ok ? this.host.remote(m.id) : null;
        if (!d) { this.note(`${m.id}: Mii non creato`); return; }
        const r = new RemoteAvatar(m.id, d, () => this.host.objects());
        const l = this.latest.get(m.id); if (l) r.apply(l);
        this.avatars.set(m.id, r); this.note(`entra ${m.id}${inside ? ' (già dentro)' : ''}`);
      });
    }
  }
  private tick(dt: number) {
    if (!this.role) return;
    this.trySpawn();
    const d = this.host.local();
    if (d && this.host.roomReady()) { const s = this.sampler.sample(d, dt, Date.now()); if (s) this.p2p.castAv(s); }
    for (const r of this.avatars.values()) r.tick(dt);
  }
}
