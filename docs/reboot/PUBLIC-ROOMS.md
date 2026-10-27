# Reboot — Public Room (R3, done: vertical slice)

PRIVATE ROOM is the user's own room. It is CLASSIC (one visiting friend) or REBOOT (2–8 Miis plus social life), and
R3 does not change it. PUBLIC ROOM is the same room **opened** to visitors. It is a new configuration of the room,
not a new engine and not `if (publicRoom)` checks scattered through the code. It is REBOOT, and SERVER REQUIRED for
real other users.

## Principle

The room **model** and the room **scene** are separate. The scene only reacts to the realtime events that our server
will send:

```
LocalVisitors (simulated other users, until R10) ─┐
                                                  ▼
                  LocalRoomService  (= the room part of our server; validates with RoomInstance)
                                                  │  presence.join / presence.leave / room.updated / room.denied
                                                  ▼
                  PublicRoomController ──RebootHost──▶ R2 guest machinery (door, body, voice…) ──▶ R2b social life
```

When the backend arrives (R10), `LocalRoomService` and `LocalVisitors` are replaced by the server provider and its
realtime channel. `RoomInstance`, `PublicRoomController`, the scene and the social layer stay unchanged.

## Code (`client/web/src/reboot/rooms/`)

| File | Role |
|---|---|
| `RoomInstance.ts` | Domain object, with no rendering and no timers (see below) |
| `templates.ts` | `PublicRoomTemplate`, data only. One complete template, `lounge` ("Salotto aperto"); see below |
| `LocalRoomService.ts` | Owns the user's room, validates every operation through `RoomInstance`, publishes the server's events and persists **only the configuration** (`mtw.reboot.rooms`). Presence and the open state are live state, never stored: after a reload the room is private |
| `LocalVisitors.ts` | Simulated other users: local friends drop by, stay a while and go. Sometimes one tries a host action, which must be refused. Driven by the room simulation clock |
| `PublicRoomController.ts` | Open, close, kick and settings; binds events to the scene; restores the private room |

**`RoomInstance`** holds:

- the owner;
- presence, with roles owner, moderator and visitor;
- capacity (owner included, 2–8);
- open / closed / full state;
- join rules: closed, blocked, kicked, `whoCanEnter`, `ROOM_FULL`;
- the permission table `can(id, action)`;
- kick and settings, with input validation.

**`lounge` template** ("Salotto aperto"):

- layout: the owner's own room;
- capacity 8;
- interactables: all;
- activity: social (R2b);
- permissions: friends can enter, everyone may use objects.

## Permissions

| Action | Owner | Moderator | Visitor |
|---|---|---|---|
| enter, interact | ✓ | ✓ | ✓ |
| use objects | ✓ | ✓ when `whoCanInteract` allows it | ✓ when `whoCanInteract` allows it |
| kick | ✓ | ✓ | ✗ |
| change settings, close, invite | ✓ | ✗ | ✗ |

- Refused actions publish `room.denied`, which forms a moderation trail.
- Object use is enforced **in the social layer** through a generic policy hook (`SocialLife.setPolicy`). There is no
  public-room code inside R2b.

## Owner panel (Reboot pill → Stanza pubblica)

- **Open / close.** "Apri come stanza pubblica" opens the room. It is refused while private guests are in or while
  visiting someone. "Chiudi stanza pubblica" closes it: visitors say goodbye and leave through the door.
- **State and settings:**
  - state shown as aperta / piena / chiusura and n/capacity;
  - capacity 2–8, which cannot go below the Miis inside;
  - who can enter: friends or everyone;
  - objects: everyone or only the owner.
- **Visitors.** Each visitor is listed with a status and an "Allontana" button. A kicked visitor cannot return in this
  session.
- **Events.** The last events are shown: entered, left, room full, refused action.

## Leaving cleans everything

The public room closes and the private settings come back immediately in either of these cases:

- the owner leaves the room screen (shop, a friend's room…);
- the owner closes the room.

Cleaning means:

- presence is cleared, and kicks are cleared;
- the visitor simulation stops, with no timer or tick subscriber left;
- the social policy is removed and its agents resynced;
- guest capacity goes back to the R2 setting.

## Out of scope for R3 (deliberately)

- real online play, accounts, matchmaking and server;
- remote persistence;
- three-way conversations;
- friends' own words (R5);
- templates with their own decoration.

## Tests

| Test | What it covers |
|---|---|
| `tests/unit/rooms.test.mts` | Roles and permissions, capacity, blocked, kick, settings validation, events, configuration-only persistence; controller and visitors on a fake host (turnover, capacity, refused host actions, presence/scene sync, object policy, kick, polite close, owner leaving → full cleanup) |
| `tests/e2e/r3-public.smoke.mjs` (real engine) | 8 Miis (owner + 7 visitors), `ROOM_FULL`, blocked friend, refused visitor actions, R2b life on visitors, minutes with nobody stuck, "objects: only me" applied, owner kick, polite close, owner leaving → cleanup, private room working afterwards |
