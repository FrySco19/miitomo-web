/**
 * REBOOT server contracts (v1) — the API between the web client and OUR central backend (never Nintendo).
 *   Web client → Our API (HTTPS, JSON) → Database → Realtime/Event system (WebSocket / SSE)
 * Types only: providers implement them (LocalRebootProvider now, ServerRebootProvider when the backend exists).
 * Rules baked into the contract (docs/reboot/SERVER.md):
 *  - every client input is untrusted: the server validates and owns ids, timestamps, counters, ownership, permissions;
 *  - no secret ever lives in the browser bundle: auth is a server-issued session (HttpOnly cookie), not an API key;
 *  - Mii data travels as the user's own FFL CharInfo (base64), no Nintendo service is contacted;
 *  - every list is paginated; every write can be refused by moderation / rate limiting (ApiError codes).
 */

export const API_VERSION = 1 as const;

// ---------------- common ----------------
export type Id = string;                 // server-assigned, opaque
export type IsoTime = string;            // server time, ISO 8601
export type Visibility = 'private' | 'friends' | 'public';
export interface Page<T> { items: T[]; next: string | null; }
export interface PageReq { cursor?: string | null; limit?: number; }
export type ApiErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID' | 'CONFLICT' | 'RATE_LIMITED'
  | 'BLOCKED' | 'MODERATED' | 'ROOM_FULL' | 'NOT_CONFIGURED' | 'OFFLINE' | 'INTERNAL';
export interface ApiError { code: ApiErrorCode; message: string; retryAfterMs?: number; }
export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

// ---------------- accounts / profiles ----------------
export interface Account { id: Id; createdAt: IsoTime; }
export interface Greetings { welcome: string; goIn: string; seeingOff: string; goHome: string; }
export interface MiiPayload { charInfo: string; /* base64 FFLiCharInfo, user-made */ height: number; build: number; }
export interface Profile {
  id: Id; accountId: Id; nickname: string; bio: string; mii: MiiPayload;
  personality: [number, number, number, number, number]; greetings: Greetings;
  outfit: Record<string, { id: string; color: number } | boolean | null>;
  roomId: Id | null; visibility: Visibility; stats?: { posts: number; friends: number };
}
export interface ProfilePatch { nickname?: string; bio?: string; mii?: MiiPayload; greetings?: Partial<Greetings>; outfit?: Profile['outfit']; visibility?: Visibility; }

// ---------------- friends ----------------
export type FriendState = 'pending_out' | 'pending_in' | 'friends';
export interface Friendship { profileId: Id; state: FriendState; since: IsoTime; }

// ---------------- rooms / presence ----------------
export type RoomKind = 'private' | 'public';
export type RoomRole = 'owner' | 'moderator' | 'visitor';
export interface RoomPermissions { whoCanEnter: Visibility; whoCanInteract: 'everyone' | 'friends' | 'owner'; activitiesOpen: boolean; }
export interface RoomInfo {
  id: Id; ownerId: Id; kind: RoomKind; templateId: string | null; title: string;
  capacity: number; /* Miis incl. owner, 2..8 */ permissions: RoomPermissions;
  skin: { wall: string; floor: string; variant: number }; activityId: string | null;
}
export interface Vec2 { x: number; z: number; }
export interface PresenceState { pos: Vec2; heading: number; state: 'entering' | 'idle' | 'walking' | 'interacting' | 'reacting' | 'exiting'; clip?: string; emote?: string; }
export interface Presence { profileId: Id; roomId: Id; role: RoomRole; joinedAt: IsoTime; state: PresenceState; }
export interface JoinResult { room: RoomInfo; present: Presence[]; you: Presence; }

// ---------------- MIInstagram ----------------
export type ReactionKind = string;      // ids from a server-side, extensible table (ReactionDef)
export interface ReactionDef { id: ReactionKind; label: string; icon: string; order: number; }
export interface Post {
  id: Id; authorId: Id; createdAt: IsoTime; image: { url: string; w: number; h: number };
  caption: string; visibility: Visibility; outfitTags: string[]; taggedProfiles: Id[]; roomId: Id | null;
  reactions: Record<ReactionKind, number>; myReactions: ReactionKind[]; comments: number;
}
export interface NewPost { image: Blob | { dataUrl: string }; caption: string; visibility: Visibility; outfitTags?: string[]; taggedProfiles?: Id[]; roomId?: Id | null; }
export interface Comment { id: Id; postId: Id; authorId: Id; createdAt: IsoTime; text: string; }

// ---------------- minigames ----------------
export interface GameDef { id: string; title: string; minPlayers: number; maxPlayers: number; durationSec: number | null; }
export interface Score { gameId: string; profileId: Id; value: number; at: IsoTime; sessionId: Id; }
export interface ScoreSubmit { gameId: string; sessionId: Id; value: number; /* server re-validates (replay/limits) */ proof?: unknown; }

// ---------------- rewards / events ----------------
export type RewardKind = 'outfit' | 'accessory' | 'decoration' | 'pose' | 'miifotoEffect' | 'title' | 'badge';
export interface RewardDef { id: string; kind: RewardKind; label: string; ref: string; }
export interface RewardGrant { id: Id; rewardId: string; profileId: Id; source: { type: 'game' | 'event' | 'admin'; ref: string }; at: IsoTime; }
export type EventCadence = 'daily' | 'weekly' | 'seasonal' | 'special';
export interface EventDef {
  id: string; title: string; cadence: EventCadence; startsAt: IsoTime; endsAt: IsoTime;
  effects: { activities?: string[]; minigames?: string[]; decorations?: string[]; outfits?: string[]; miifoto?: string[]; publicRooms?: string[] };
  rewards?: string[];
}

// ---------------- notifications ----------------
export type NotificationKind = 'comment' | 'reaction' | 'friendOnline' | 'visit' | 'event' | 'gameResult' | 'reward';
export interface Notification { id: Id; kind: NotificationKind; at: IsoTime; read: boolean; ref: { type: string; id: Id }; actorId?: Id; }

// ---------------- safety / moderation ----------------
export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'impersonation' | 'other';
export interface Report { targetType: 'profile' | 'post' | 'comment' | 'room'; targetId: Id; reason: ReportReason; note?: string; }
export interface PrivacySettings { profile: Visibility; room: Visibility; posts: Visibility; allowFriendRequests: boolean; }

/** The full API surface. Each method maps to one endpoint (docs/reboot/SERVER.md). */
export interface RebootApi {
  // accounts
  me(): Promise<Result<{ account: Account; profile: Profile | null }>>;
  // profiles
  getProfile(id: Id): Promise<Result<Profile>>;
  updateProfile(p: ProfilePatch): Promise<Result<Profile>>;
  // friends
  listFriends(page?: PageReq): Promise<Result<Page<Friendship>>>;
  requestFriend(profileId: Id): Promise<Result<Friendship>>;
  answerFriend(profileId: Id, accept: boolean): Promise<Result<Friendship | null>>;
  removeFriend(profileId: Id): Promise<Result<true>>;
  // rooms + presence
  getRoom(id: Id): Promise<Result<RoomInfo>>;
  listPublicRooms(page?: PageReq): Promise<Result<Page<RoomInfo>>>;
  updateRoom(id: Id, patch: Partial<Pick<RoomInfo, 'kind' | 'title' | 'capacity' | 'permissions' | 'skin' | 'activityId'>>): Promise<Result<RoomInfo>>;
  join(roomId: Id): Promise<Result<JoinResult>>;
  leave(roomId: Id): Promise<Result<true>>;
  move(roomId: Id, state: PresenceState): Promise<Result<true>>;
  // MIInstagram
  feed(page?: PageReq): Promise<Result<Page<Post>>>;
  postsBy(profileId: Id, page?: PageReq): Promise<Result<Page<Post>>>;
  createPost(p: NewPost): Promise<Result<Post>>;
  deletePost(id: Id): Promise<Result<true>>;
  reactionTypes(): Promise<Result<ReactionDef[]>>;
  react(postId: Id, kind: ReactionKind, on: boolean): Promise<Result<Post>>;
  comments(postId: Id, page?: PageReq): Promise<Result<Page<Comment>>>;
  comment(postId: Id, text: string): Promise<Result<Comment>>;
  deleteComment(id: Id): Promise<Result<true>>;
  // games / scores
  games(): Promise<Result<GameDef[]>>;
  submitScore(s: ScoreSubmit): Promise<Result<Score>>;
  leaderboard(gameId: string, page?: PageReq): Promise<Result<Page<Score>>>;
  // rewards / events
  rewards(): Promise<Result<RewardGrant[]>>;
  events(): Promise<Result<EventDef[]>>;
  // notifications
  notifications(page?: PageReq): Promise<Result<Page<Notification>>>;
  markRead(ids: Id[]): Promise<Result<true>>;
  // safety
  report(r: Report): Promise<Result<true>>;
  block(profileId: Id): Promise<Result<true>>;
  unblock(profileId: Id): Promise<Result<true>>;
  mute(profileId: Id, on: boolean): Promise<Result<true>>;
  privacy(p?: Partial<PrivacySettings>): Promise<Result<PrivacySettings>>;
}

/** Realtime channel (server → client); the event system behind the API. */
export type RealtimeEvent =
  | { type: 'presence.join'; roomId: Id; presence: Presence }
  | { type: 'presence.leave'; roomId: Id; profileId: Id }
  | { type: 'presence.move'; roomId: Id; profileId: Id; state: PresenceState }
  | { type: 'notification'; notification: Notification }
  | { type: 'room.updated'; room: RoomInfo };

/** Endpoint table (method, path) — shared by ServerRebootProvider and the future backend. */
export const ENDPOINTS: Record<keyof RebootApi, [string, string]> = {
  me: ['GET', '/v1/me'],
  getProfile: ['GET', '/v1/profiles/:id'], updateProfile: ['PATCH', '/v1/me/profile'],
  listFriends: ['GET', '/v1/friends'], requestFriend: ['POST', '/v1/friends/:id'], answerFriend: ['PUT', '/v1/friends/:id'], removeFriend: ['DELETE', '/v1/friends/:id'],
  getRoom: ['GET', '/v1/rooms/:id'], listPublicRooms: ['GET', '/v1/rooms?kind=public'], updateRoom: ['PATCH', '/v1/rooms/:id'],
  join: ['POST', '/v1/rooms/:id/presence'], leave: ['DELETE', '/v1/rooms/:id/presence'], move: ['PUT', '/v1/rooms/:id/presence'],
  feed: ['GET', '/v1/feed'], postsBy: ['GET', '/v1/profiles/:id/posts'], createPost: ['POST', '/v1/posts'], deletePost: ['DELETE', '/v1/posts/:id'],
  reactionTypes: ['GET', '/v1/reactions'], react: ['PUT', '/v1/posts/:id/reactions'],
  comments: ['GET', '/v1/posts/:id/comments'], comment: ['POST', '/v1/posts/:id/comments'], deleteComment: ['DELETE', '/v1/comments/:id'],
  games: ['GET', '/v1/games'], submitScore: ['POST', '/v1/scores'], leaderboard: ['GET', '/v1/games/:id/leaderboard'],
  rewards: ['GET', '/v1/me/rewards'], events: ['GET', '/v1/events'],
  notifications: ['GET', '/v1/me/notifications'], markRead: ['POST', '/v1/me/notifications/read'],
  report: ['POST', '/v1/reports'], block: ['POST', '/v1/blocks/:id'], unblock: ['DELETE', '/v1/blocks/:id'], mute: ['PUT', '/v1/mutes/:id'], privacy: ['PATCH', '/v1/me/privacy'],
};
