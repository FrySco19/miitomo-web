# Reboot — friends' rooms (R5)

From the Piazza the user can go **into a friend's public room as a visitor**. It is REBOOT, local only today, and
SERVER REQUIRED for rooms of real other people (R10). Nothing pretends to be online: every room belongs to one of the
user's **local friends** (profiles made on this device), and the UI says so.

## Not a second public room: the visited side of R3

R3 gave the user's own room a public mode. R5 adds the other side, with the same pieces:

| R3 piece | Own public room (R3) | Visited room (R5) |
|---|---|---|
| Domain | `RoomInstance` (owner = the user) | `RoomInstance` (owner = the friend, the user is a **visitor**) |
| Server stand-in | `LocalRoomService` | `LocalPlacesService` (other people's rooms) |
| Events | `presence.join / presence.leave / room.state / room.updated / room.denied` | the same events, plus `room.removed` |
| Scene binding | `SceneBinding` (extracted from `PublicRoomController`, same behaviour) | the same `SceneBinding` |
| Social life | R2b, with a room policy for objects | R2b, with the visited room's policy |

Two R3 changes, both additive: `RoomInstance.open(…, { ownerInside: false })` for a place nobody owns as a Mii (the
Sala Giochi), and an optional `code` on `PublicRoomController.open()` refusals so a translated UI can explain them.

## Code (`client/web/src/reboot/places/`)

| File | Role |
|---|---|
| `LocalPlacesService.ts` | Other people's rooms: fixture, list, join / leave as the user, owner-only operations refused, turnover, server-side events (owner closes, room removed) |
| `PlaceVisit.ts` | The user inside a place: enter → scene → bind → leave / switch / eviction, with full cleanup |
| `PlaceViews.ts` | The "Stanze degli amici" panel in the Piazza and the bar shown inside a place |

## The simulated world (deterministic)

`FRIEND_ROOM_FIXTURE` gives the n-th local friend (ordered by id) one of six rows: open with visitors, closed, almost
full (2/3, objects reserved to the owner), private, full (2/2), closed. Every Mii is in **one** place at a time:

- owners of open rooms are at home;
- friends whose room is closed or private are "out": they fill the full and almost-full rooms first, then the Sala
  Giochi (2), then the other open rooms;
- while the user is inside, the room has turnover: visitors stay a while and leave through the door; a friend who is
  out may come by (and leaves the place they were in), refused with `ROOM_FULL` when the room is full.

The same friends always give the same world; the list is rebuilt only when the friends change.

## Entering, being inside, leaving

1. **Enter.** The room validates the join *before* anything changes: `CLOSED`, `PRIVATE`, `FULL`, `BLOCKED`,
   `NOT_FOUND`, `ALREADY_IN`. A refusal leaves the user exactly where they were (the Piazza) and is published as
   `room.denied`. On success the room engine shows the friend's room look and music (`RebootHost.visitPlace`), the
   user's Mii comes in through the door, and whoever was already inside is placed inside (no door, no greeting).
2. **Inside.** The user is a visitor: kick, settings and close are refused by `RoomInstance` (and logged). Object use
   follows the owner's permission for the player's taps (`RebootHost.setObjectPolicy`) and for social life alike.
   R2b runs on everybody; the owner wanders and chats like any Mii; the user's Mii is still moved only by the player.
3. **Leave.** Presence removed (the others stay in their room), the scene emptied at once, turnover stopped, both
   policies removed, social life resynced, guest capacity restored, back to Casa (or straight into the next room).
   The bar inside the place has **Piazza** and **Casa**; Classic navigation (any other screen) also ends the visit.
4. **Evicted.** If the owner closes the room (or it disappears) while the user is inside, the visit cleans up and the
   user lands in the Piazza with the reason.

Friend room → another friend room goes through the same lifecycle (leave, then enter); no visitor from the previous
room is left on screen.

## Tests

| Test | What it covers |
|---|---|
| `tests/unit/friendrooms.test.mts` | Listing, enter, visitor vs owner, permissions, full / private / closed / blocked / unknown, objects reserved to the owner, switching, room closed or removed while visiting, turnover in sync with the scene, Friend Room → Piazza / Casa, 12-cycle soak |
| `tests/e2e/r5-ui.smoke.mjs` | A, B, C, G on the R5 runtime in Chromium (no game files) |
| `tests/e2e/r5-social.smoke.mjs` | A, B, C, G on the real engine (needs the user's files) |
