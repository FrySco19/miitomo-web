/**
 * The narrow boundary between REBOOT and the shared infrastructure (renderer, room engine, Mii system, friends,
 * persistence) that Classic already built. Reboot never reaches into Classic internals: main.ts builds one RebootHost
 * and passes it to bootReboot(). Adding a capability for Reboot = adding a method here (reviewable in one place).
 */
export interface GuestInfo { id: string; name: string; state: string; leaving: boolean; }
/** Local friend. R5 adds what Reboot places need: personality type (0..3), room look, birthday and goIn greeting. */
export interface FriendInfo { id: string; name: string; personality?: 0 | 1 | 2 | 3; room?: RoomSkin; birthday?: { month: number; day: number } | null; greeting?: string; }
export interface RoomSkin { wall: string; floor: string; variant: number; }
/** R5: a Reboot place shown with the room engine (a friend's room, the Sala Giochi). */
export interface PlaceScene { id: string; skin: RoomSkin; /** personality type of the resident (friend-room music), null = none */ friendHost: number | null; }

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
  /** A friend's Mii comes in through the door, or (R5, `inside`) is already in the room at that spot (no door). */
  invite(id: string, opts?: { inside?: { x: number; z: number } }): Promise<boolean>;
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
  /** `lang` (R6): language of `text` for the voice; omitted = Italian (the voice Classic always used). */
  say(id: string, text: string, autoCloseSec: number, lang?: string): Promise<'done' | 'interrupted' | 'busy'>;
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

  // ---- R5: places, photos, the user's profile (each one a thin call into the existing Play / room machinery) ----
  /** The user's own Mii (name, personality type, birthday). */
  profile(): { name: string; personality: 0 | 1 | 2 | 3; birthday: { month: number; day: number } | null; greeting: string };
  /** Goes to a Reboot place: the room engine shows `skin`, the user's Mii comes in through the door. Screen = 'place:<id>'. */
  visitPlace(p: PlaceScene): boolean;
  /** Back to the user's own room (the Mii comes in again). */
  returnHome(): void;
  /** Every guest leaves the scene at once (the user is changing place). */
  clearGuests(): void;
  /** Wall / floor ids available on this device, and the user's own room look. */
  roomSkins(): { walls: string[]; floors: string[]; own: RoomSkin };
  /** Player taps on objects: null = always allowed; otherwise asked first (room permissions of a visited room). */
  setObjectPolicy(p: ((object: string) => boolean) | null): void;
  /** Square JPEG of what the room camera sees right now (Miifoto 2 "photo of the room"); null when no room is shown. */
  snapshot(size: number): string | null;
  /** Adds a "share" action to the Miifoto screen (Classic has none): the composed photo as a JPEG data URL. */
  setPhotoShare(p: { label: () => string; share: (dataUrl: string) => void } | null): void;
  /** Opens the (Classic) Miifoto screen. */
  openMiifoto(): void;

  // ---- R6: Reboot settings applied to the shared infrastructure (Classic never calls them) ----
  /** Channel volumes 0..1 on top of the original switches (BGM, sound effects, the browser voice). */
  setVolumes(v: { music: number; effects: number; voice: number }): void;
  /** Pixel-ratio cap of the 3D view: high = 2 (Classic), balanced = 1.5, low = 1. */
  setRenderQuality(q: 'high' | 'balanced' | 'low'): void;
  /**
   * The short labels of the shared shell (bottom bar, menu) in the Reboot language: `fn(file, label)` returns the text,
   * or null to keep the original Italian one; the labels on screen are redrawn at once. null = originals everywhere.
   */
  setShellLabels(fn: ((file: string, label: string) => string | null) | null): void;
  /** The user's display name (the Mii nickname of the save, max 10). false = refused (empty). */
  setPlayerName(name: string): boolean;
  /** Desktop app: the real friends connected peer-to-peer (null = not the desktop app, or P2P not running). */
  p2p(): RebootP2P | null;
}
/** Peer-to-peer link to real friends (desktop app). Only authenticated friends' data arrives here. */
export interface RebootP2P {
  /** My id as my friends know me (p2p-…). */
  me(): string | null;
  /** Friends connected right now. */
  online(): string[];
  send(ch: string, data: unknown, to?: string): void;
  on(ch: string, cb: (from: string, data: unknown) => void): () => void;
  /** A friend came online. */
  onOnline(cb: (id: string) => void): () => void;
}

export interface MiiView {
  id: string; name: string; personality: 0 | 1 | 2 | 3; x: number; z: number; heading: number;
  /** RoomDirector state: outside / entering / idle / walking / interacting / reacting / exiting / held */
  state: string; isHost: boolean; leaving: boolean; waiting: boolean;
}
