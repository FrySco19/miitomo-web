/**
 * The narrow boundary between REBOOT and the shared infrastructure (renderer, room engine, Mii system, friends,
 * persistence) that Classic already built. Reboot never reaches into Classic internals: main.ts builds one RebootHost
 * and passes it to bootReboot(). Adding a capability for Reboot = adding a method here (reviewable in one place).
 */
export interface GuestInfo { id: string; name: string; state: string; leaving: boolean; }
export interface FriendInfo { id: string; name: string; }

export interface RebootHost {
  /** Element the Reboot UI mounts into (above the 3D view). */
  root: HTMLElement;
  /** Current Classic play screen ('room', 'setup', 'create', ...). */
  screen(): string;
  /** true while the user watches a friend's room (visit) instead of their own. */
  visiting(): boolean;
  /** Local friends (social provider). */
  friends(): Promise<FriendInfo[]>;
  /** Room guests (shared multi-Mii machinery). */
  guests(): GuestInfo[];
  invite(id: string): Promise<boolean>;
  dismiss(id: string): boolean;
  capacity(): number;
  setCapacity(n: number): number;
  /** Guest arrivals / departures. Returns an unsubscribe function. */
  onGuest(cb: (e: { type: 'arrive' | 'leave'; id: string; name: string }) => void): () => void;

  // ---- R2b social life: reads + commands over the EXISTING room machinery (movement, turning, clips, balloon) ----
  /** Every Mii in the room: the user's own ('host') and the guests. */
  miis(): MiiView[];
  /** Interactive furniture (original interactables) and the spot a Mii uses it from. */
  objects(): { name: string; x: number; z: number }[];
  /** Walk (RoomDirector.goTo: path, avoidance, stuck guard). false = refused by the state machine. */
  goTo(id: string, x: number, z: number): boolean;
  /** Turn in place toward a point; resolves true when turned, false when refused (not idle). */
  face(id: string, x: number, z: number): Promise<boolean>;
  /** Use an interactive object (original clip). */
  interact(id: string, object: string): boolean;
  /** Original wave reaction. */
  wave(id: string): boolean;
  /** Say a line in the single room balloon (speaker's own voice / face / gesture). */
  say(id: string, text: string, autoCloseSec: number): Promise<'done' | 'interrupted' | 'busy'>;
  /** A balloon is open (player menu, greeting, another Mii talking). */
  balloonBusy(): boolean;
  /** Built-in M18 wandering of the guests (the social layer plans walks itself). */
  setGuestWander(on: boolean): void;
  /** Simulation time step of the room (real frames and test-driven simulation alike). */
  onTick(cb: (dt: number) => void): () => void;
  /** Somebody started talking (id of the Mii, null if unknown). */
  onSpeech(cb: (e: { speaker: string | null }) => void): () => void;
  /** The player acted on the room: tapped a Mii, the floor, an object, the door ('host' = the user's Mii). */
  onPlayer(cb: (e: { id: string; kind: string }) => void): () => void;
}

export interface MiiView {
  id: string; name: string; personality: 0 | 1 | 2 | 3; x: number; z: number; heading: number;
  /** RoomDirector state: outside / entering / idle / walking / interacting / reacting / exiting / held */
  state: string; isHost: boolean; leaving: boolean; waiting: boolean;
}
