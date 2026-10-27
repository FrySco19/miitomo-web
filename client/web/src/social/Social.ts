/**
 * Friends (M16). User decision 2026-10-26: FRIENDS = LOCAL NOW → OUR CENTRAL SERVER LATER.
 *
 * The gameplay layer talks only to `SocialProvider`; it never knows whether the friends come from this device
 * (LocalProvider) or from our own future backend (ServerProvider). Nintendo servers / Nintendo authentication are never
 * used, and P2P is not the target architecture (the original was a central REST service, see API.md).
 *
 *  ORIGINAL   friend-room texts / dialogs / telops / greetings, the friend-room BGM lines, room tabs (texts + layouts)
 *  REVERSED   the original flow: GoToFriendRoom, SequenceWatchFriend, SequenceByeFriendInFriendRoom /
 *             SequenceByeFriendInUserRoom, RoomTabWindowFriend{Profile,Cloth,Knowledge,FriendList} (RTTI names),
 *             the server resources behind it (/v1/players/@me/friends, friend_requests, friend_code: API.md)
 *  DEDUCED    who says which greeting (from the Saluti labels: "arriva un amico" = the host's welcome, "l'amico va
 *             via" = the host's seeing-off); friend-room BGM = BGM_MIIWATCH_FRIEND_<personality type>
 *  APPROXIMATED (local only) a friend is a Mii profile created on this device: there are no friend requests, codes,
 *             SNS links or face-to-face pairing (all server-side).
 *  MISSING    friends' answers, comments, hearts, their own friend lists, notifications (server data).
 *
 * Every profile read from storage (or later from a server) is untrusted: `sanitizeFriend` validates and clamps it.
 */
import type { Outfit } from '../body/Wardrobe';
import type { SaveData } from '../play/Save';
import { openMtwDb, reqP, txDone } from '../assets/db';

export interface FriendProfile {
  id: string;
  created: string;
  source: 'local' | 'server';
  profile: SaveData['profile'];
  outfit: Outfit;
  room: SaveData['room'];
  /** visits made by the user to this friend's room (local counter; the original kept no such public counter) */
  visits: number;
  lastVisit: string | null;
}

export interface SocialProvider {
  readonly kind: 'local' | 'server';
  /** null = usable; otherwise why not (shown to the user). */
  readonly unavailable: string | null;
  list(): Promise<FriendProfile[]>;
  get(id: string): Promise<FriendProfile | null>;
  add(f: Omit<FriendProfile, 'id' | 'created' | 'source' | 'visits' | 'lastVisit'>): Promise<FriendProfile>;
  update(f: FriendProfile): Promise<void>;
  remove(id: string): Promise<void>;
  recordVisit(id: string): Promise<void>;
  /**
   * Friends' recent answers ("Sai, di recente…", RoomSubDataSourceKnowledgeNew / AlreadyHear / NotHear). They were
   * server data (/v1/knowledge/…, API.md): the local provider has none and says so explicitly.
   */
  recentAnswers(): Promise<{ status: 'ok' | 'server-data-missing'; items: { friendId: string; question: string; answer: string; at: string }[] }>;
}

export const MAX_FRIENDS = 1000;   // "Amici: {3.0 max 1000}" (title00@friend: number tag with limit 0x3e8) — DEDUCED limit

const KEY = 'social.local', FORMAT = 'miitomo-web-social', VERSION = 1;
const clampInt = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const ID = /^[a-z0-9-]{1,40}$/;
const SKIN = /^\d{4}$/;

/** Validates any stored / received friend object (untrusted) and returns a clean copy, or null. */
export function sanitizeFriend(raw: unknown): FriendProfile | null {
  const r = raw as Partial<FriendProfile> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !ID.test(r.id)) return null;
  const p = (r.profile ?? {}) as Partial<SaveData['profile']>;
  if (typeof p.miiData !== 'string' || !/^[A-Za-z0-9+/=]{20,2000}$/.test(p.miiData)) return null;
  const bd = p.birthday && typeof p.birthday === 'object' ? { month: clampInt(p.birthday.month, 1, 12, 1), day: clampInt(p.birthday.day, 1, 31, 1) } : null;
  const pl = p.personality as unknown;
  const g = (p.greetings ?? {}) as Partial<SaveData['profile']['greetings']>;
  const v = (p.voice ?? {}) as Partial<SaveData['profile']['voice']>;
  const outfit: Outfit = {};
  for (const [c, it] of Object.entries((r.outfit ?? {}) as Record<string, unknown>)) {
    const o = it as { id?: unknown; color?: unknown } | null;
    if (/^[a-z]{2,12}$/.test(c) && o && typeof o.id === 'string' && /^\d{4}$/.test(o.id)) (outfit as Record<string, unknown>)[c] = { id: o.id, color: clampInt(o.color, 0, 15, 0) };
  }
  const room = (r.room ?? {}) as Partial<SaveData['room']>;
  return {
    id: r.id, created: str(r.created, 40) || new Date(0).toISOString(), source: r.source === 'server' ? 'server' : 'local',
    profile: {
      miiData: p.miiData, name: str(p.name, 10).trim() || 'Mii', birthday: bd,
      height: p.height == null ? null : clampInt(p.height, 0, 127, 64), build: p.build == null ? null : clampInt(p.build, 0, 127, 64),
      personality: Array.isArray(pl) && pl.length === 5 && pl.every((x) => Number.isInteger(x) && x >= 1 && x <= 8) ? [...(pl as number[])] : null,
      greetings: { welcome: str(g.welcome, 30), goIn: str(g.goIn, 30), seeingOff: str(g.seeingOff, 30), goHome: str(g.goHome, 30) },
      voice: { pitch: clampInt(v.pitch, 0, 100, 50), speed: clampInt(v.speed, 0, 100, 50), accent: clampInt(v.accent, 0, 100, 50), energy: clampInt(v.energy, 0, 100, 50), depth: clampInt(v.depth, 0, 100, 50) }
    },
    outfit,
    room: { wall: typeof room.wall === 'string' && SKIN.test(room.wall) ? room.wall : '0000', floor: typeof room.floor === 'string' && SKIN.test(room.floor) ? room.floor : '0000', variant: clampInt(room.variant, 0, 7, 0) },
    visits: clampInt(r.visits, 0, 1e9, 0), lastVisit: typeof r.lastVisit === 'string' ? r.lastVisit.slice(0, 40) : null
  };
}

/** Friends kept on this device (IndexedDB "save" store, key social.local). */
export class LocalProvider implements SocialProvider {
  readonly kind = 'local' as const;
  readonly unavailable = null;
  private cache: FriendProfile[] | null = null;
  private async load(): Promise<FriendProfile[]> {
    if (this.cache) return this.cache;
    try {
      const db = await openMtwDb();
      const v = await reqP<any>(db.transaction('save').objectStore('save').get(KEY));
      this.cache = v && v.format === FORMAT && Array.isArray(v.friends) ? v.friends.map(sanitizeFriend).filter((f: FriendProfile | null): f is FriendProfile => !!f) : [];
    } catch (e) { console.warn('amici locali non leggibili', e); this.cache = []; }
    return this.cache!;
  }
  private async store() {
    const db = await openMtwDb();
    const tx = db.transaction('save', 'readwrite');
    tx.objectStore('save').put(structuredClone({ format: FORMAT, version: VERSION, friends: this.cache ?? [] }), KEY);
    await txDone(tx);
  }
  async list() { return [...await this.load()]; }
  async get(id: string) { return (await this.load()).find((f) => f.id === id) ?? null; }
  async add(f: Omit<FriendProfile, 'id' | 'created' | 'source' | 'visits' | 'lastVisit'>) {
    const all = await this.load();
    if (all.length >= MAX_FRIENDS) throw new Error('Hai raggiunto il numero massimo di amici.');
    const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const clean = sanitizeFriend({ ...structuredClone(f), id, created: new Date().toISOString(), source: 'local', visits: 0, lastVisit: null });
    if (!clean) throw new Error('Profilo amico non valido.');
    all.push(clean); await this.store();
    return clean;
  }
  async update(f: FriendProfile) {
    const all = await this.load(); const i = all.findIndex((x) => x.id === f.id); const clean = sanitizeFriend(f);
    if (i < 0 || !clean) throw new Error('Amico non trovato.');
    all[i] = clean; await this.store();
  }
  async remove(id: string) { const all = await this.load(); const i = all.findIndex((x) => x.id === id); if (i >= 0) { all.splice(i, 1); await this.store(); } }
  async recordVisit(id: string) { const f = await this.get(id); if (!f) return; f.visits++; f.lastVisit = new Date().toISOString(); await this.store(); }
  async recentAnswers() { return { status: 'server-data-missing' as const, items: [] }; }
  /** Backup / restore (the friends are not part of the main save file). */
  async exportJson() { return { format: FORMAT, version: VERSION, friends: await this.list() }; }
  async importJson(raw: unknown) {
    const r = raw as { format?: unknown; friends?: unknown } | null;
    if (!r || r.format !== FORMAT || !Array.isArray(r.friends)) throw new Error('Non è un elenco di amici di Miitomo Web.');
    this.cache = r.friends.map(sanitizeFriend).filter((f): f is FriendProfile => !!f).slice(0, MAX_FRIENDS);
    await this.store();
    return this.cache.length;
  }
}

/**
 * Our own central server (future). Not implemented: there is no backend yet. It will speak our own API (accounts,
 * friends, visits, answers, comments, hearts, greetings, outfits, rooms, notifications) — never Nintendo's.
 */
export class ServerProvider implements SocialProvider {
  readonly kind = 'server' as const;
  readonly unavailable = 'Il server centrale di Miitomo Web non è ancora disponibile.';
  private no<T>(): Promise<T> { return Promise.reject(new Error(this.unavailable)); }
  list() { return this.no<FriendProfile[]>(); }
  get() { return this.no<FriendProfile | null>(); }
  add() { return this.no<FriendProfile>(); }
  update() { return this.no<void>(); }
  remove() { return this.no<void>(); }
  recordVisit() { return this.no<void>(); }
  recentAnswers() { return this.no<{ status: 'ok' | 'server-data-missing'; items: { friendId: string; question: string; answer: string; at: string }[] }>(); }
}
