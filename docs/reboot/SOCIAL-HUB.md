# Reboot — Social Hub "Piazza" (R4)

The hub is the central place from which the user moves between their private life (**Casa**) and their social life
(**their Public Room**, and later other spaces). It is REBOOT, local only, and not original Nintendo content.

## Model ≠ UI

| Piece | File | Role |
|---|---|---|
| Model | `reboot/hub/SocialHub.ts` | Location, destinations, navigation, errors, counters and event stream. No DOM |
| View | `reboot/hub/HubScreen.ts`, `hub.css` | The "Piazza" pill on the room screen and the hub screen. It renders the model and sends intents back; it stores nothing |

**One source of truth for "where am I".** `at` is derived, never stored twice:

- `hub` while the hub is the current destination (the only flag the hub owns);
- `public` while R3 says the room is public or closing;
- `home` otherwise.

There is no second presence. The owner's presence in the room is R3's (`RoomInstance`). The scene's guests are R2's.

**Public Room status.** It is read from the R3 domain on every domain event, never cached:

- `Chiusa`;
- `Aperta · n/capacity`;
- `Aperta · piena`;
- `In chiusura…`.

## Events (domain → events → hub → UI)

The hub reuses the existing R3 event streams. It subscribes **once** for its whole life:

- `PublicRoomController.subscribe`: `open`, `closing`, `closed`, `owner-left`, `join`, `leave`, `kick`, `denied`. This
  subscription is additive in R3: `note()` now also notifies subscribers.
- `LocalRoomService.subscribe`: `room.state`, `presence.join`, `presence.leave`, `room.updated`. These are the same
  realtime events our server will send.

The hub publishes its own events:

- `navigation.started`;
- `navigation.completed`;
- `navigation.failed` (with a code);
- `public.changed`;
- `state`.

The hub never polls the scene. Only the view checks the Classic screen, to hide its pill outside the user's own room.

## Navigation

Transitions are explicit, and only one runs at a time:

| From → to | What happens |
|---|---|
| home → hub | The hub screen shows |
| hub → home | The hub screen hides. If the public room is still closing, the navigation waits for R3 to finish first, so the user never reaches "home" while R3 says public |
| hub/home → public | **R3 opens** the room (`controller.open()`), and the R3 management panel is shown. The hub does not duplicate it |
| public → hub | **R3 closes** the room (`controller.close()`: visitors say goodbye and leave, R3 restores the private room). The user is at the hub at once, and the hub follows R3 until "Chiusa" |
| public → home | R3 closes. The navigation completes when R3 reports the room private (time-out 180 s on the room clock) |

**Errors.** Each one leaves the previous state unchanged and the hub usable. It is emitted and stored in
`state.lastError`.

| Code | When |
|---|---|
| `BUSY` | Double request, or a return while a transition is running |
| `ALREADY_THERE` | Going to the current location |
| `UNAVAILABLE` | Unknown or future destination |
| `CLOSING` | Public room still closing |
| `OPEN_REFUSED` | R3's reason, e.g. private guests are still in |
| `NOT_IN_ROOM` | The hub is used from the user's own room screen |
| `TIMEOUT` | Cleanup did not finish |
| `INTERRUPTED` | The user left the room during a transition. R3's own owner-left cleanup still runs |

Cleanup is R3's only. R4 adds none.

## R5: places, texts, eviction

- **Places** are registered destinations with `here()` and `leave()`: friends' rooms (with a panel: the list of
  rooms, inside the hub screen) and the Sala Giochi. `at` is still derived: `hub`, `public`, the place the user is in,
  or `home`. Going anywhere from a place first runs the place's own cleanup; going from the public room into a place
  first lets R3 close it (same wait and time-out as public → home). Friend room → another friend room is
  `go('friends', otherRoom)`.
- A refused place answers `REFUSED` with the place's reason (`FULL`, `PRIVATE`, `CLOSED`…) and leaves the user at the
  hub. When a place sends the user out (owner closed it, it disappeared), the user lands in the Piazza with the reason
  (`EVICTED`).
- Every text comes from i18n (Italian R4 texts kept word for word); the language choice is in the hub header.
- MIInstagram is no longer a destination: it lives in the MiiPhone. The remaining future destination is "Eventi in
  Piazza" (R8).

## Destinations and extension point

- **Casa:** always available.
- **La mia stanza pubblica:** available unless it is closing.
- **Future destinations** are shown disabled with the phase that brings them. There is no fake networking behind them.
  R4 declared Stanze degli amici, Sala giochi and MIInstagram here; R5 made the first two real places and moved
  MIInstagram to the MiiPhone.
- **Adding a destination:** `hub.register({ id, title, subtitle, phase, available(), go(arg?), here?(), leave?(), panel? })`.
  Its `go()` performs the move, using whatever service that space has. The hub model does not change.

## Relation with R2 / R2b / R3

- **R2.** Guests, the door queue and goodbyes are untouched.
- **R2b.** Social life keeps running. The user's Mii is still moved only by the player.
- **R3.** Opening, closing, permissions and cleanup are unchanged. The only R3 change is additive: a `subscribe()` on
  the controller and a `listenerCount` on controller and service.

## Local only / out of scope

The hub runs in this browser only. It has none of the following:

- server or WebSocket;
- accounts, login or matchmaking;
- friend network or chat online;
- remote persistence or remote rooms;
- real multiplayer.

None of these are needed to navigate what exists today. When R10 arrives, a remote destination registers through the
extension point, and the Public Room keeps its R3 provider seam.

## Tests

| Test | What it covers |
|---|---|
| `tests/unit/hub.test.mts` (real R3 controller and service on a fake host) | The 15 required cases, plus time-out, interruption and the extension point |
| `tests/e2e/r4-hub.smoke.mjs` (real engine) | Scenarios A–H, plus a soak of 16 Hub ↔ Room cycles: listeners, Miis, visitors, conversations, timers, DOM, heap after GC, deadlock, end state |
