# Miitomo Reboot — architecture

Miitomo Reboot is a **separate phase** built on the technical base that the Classic reconstruction recovered.
**Classic** is preservation: it reproduces Miitomo 2.4.0 from evidence, and every element is classified. **Reboot** is new
features. Nothing in Reboot is original Nintendo content, and Reboot never changes how Classic behaves.

## Layout

```
client/web/src/
  main.ts, play/, room/, body/, agx/, effects/, formats/, assets/, social/, voice/, mii.ts
        CLASSIC + SHARED INFRASTRUCTURE (unchanged location; see CLASSIC-VS-REBOOT.md for which is which)
  reboot/                      REBOOT — everything new lives here
    gate.ts                    the only module Classic imports statically (no dependencies)
    host.ts                    RebootHost: the narrow interface to the shared infrastructure
    index.ts                   bootReboot(host) — loaded with a dynamic import, only when the gate is open
    flags.ts                   feature flags (data-driven)
    api/contracts.ts           server contracts v1 (types + endpoint table)
    api/provider.ts            LocalRebootProvider (now) / ServerRebootProvider (R10)
    safety/rateLimit.ts        client token buckets
    multimii/MultiMii.ts       R2: several Miis in the room (capacity, group invite)
    social/                    R2b: SocialLife (perception, conversations, priorities, activities), traits, lines
    rooms/                     R3: RoomInstance, templates, LocalRoomService (server stand-in), LocalVisitors, PublicRoomController
    hub/                       R4: SocialHub (model: location, destinations, navigation, events) + HubScreen (view)
    i18n/                      R5: I18n (English + Italiano) + the text tables
    places/                    R5: LocalPlacesService (other people's rooms), PlaceVisit (being a visitor), place views
    games/                     R5: game model, GameRegistry, GameSession, MiiQuiz, GameRoomController + view
    phone/                     R5: MiiPhone (model + app registry) + MiiPhoneView
    miinstagram/               R5: model, LocalSocialService, PhotoStore, relations, FeedSimulator, MIInstagramApp
    ui/RebootPanel.ts, ui/reboot.css   Reboot layer above the Classic screens
```

R5 follows the same rule as R3 and R4: **domain → events → controllers → UI**. Every new model is DOM-free and
testable on the fake host; every view renders a model and sends intents back. One owner per piece of state:

| State | Owner |
|---|---|
| Where the user is | `SocialHub.at`, derived from R3 (public), the place visit (friends' room / Sala Giochi) and the hub flag |
| Who is in a room | the room's `RoomInstance` (R3) — own room in `LocalRoomService`, other rooms in `LocalPlacesService` |
| Who is on screen | the R2 guest machinery, bound to presence by `SceneBinding` |
| What a Mii is doing | R2b `SocialLife` (a match only *reserves* players from it) |
| The phone | `MiiPhone` (it never touches the location) |
| Posts, reactions, comments | `SocialFeedService` (local now, remote from R10) |
| Language | `I18n` |

Classic is not moved into a `classic/` folder. Moving it would rewrite every import and every test path for no gain.
Instead the boundary is enforced by tests (`tests/unit/reboot.test.mts`, "boundary" checks):

- Classic code may import, statically, only `reboot/gate` and the `RebootHost` **type**.
- The Reboot runtime is reached only through `import('./reboot/index')`, guarded by the gate.
- Reboot reaches the shared infrastructure only through `RebootHost`. It never imports `play/Play`, `main`, room,
  body or agx internals directly.

## Gate and flags

- `?reboot=1` turns Reboot on in this browser and remembers it. `?reboot=0` turns it off. The Classic launcher
  (`avvia-miitomo-web.bat`) always passes `reboot=0`; `avvia-miitomo-reboot.bat` passes `reboot=1`.
- With the gate closed, the Reboot chunk (≈ 148 KB JS, 46 KB gzipped, + 24 KB CSS after R5) is **never downloaded**,
  and Classic runs exactly as before.
- Flags (`reboot/flags.ts`): `REBOOT_ENABLED` (the gate) plus one flag per feature. A feature flag is effective
  only when all three hold:
  - the gate is open;
  - the feature is marked `implemented`;
  - the user has not switched it off.
- Flags are listed in the Reboot panel. Features that are not implemented yet show "in arrivo · Rx" and cannot be
  switched on.

## Shared infrastructure that Reboot reuses (never duplicated)

The following are used as they are:

- Mii renderer and FFL/AFL;
- body, wardrobe and animations;
- room engine, `RoomDirector` and camera;
- audio, voice, effects and Miifoto;
- UI text system and friend provider;
- persistence.

When Reboot needs more from the shared code, the change has two parts:

1. **A generalisation in shared code that keeps Classic behaviour identical.** Example (R2): the single M18 guest
   became a list of guests. `guestCap` is 1 in Classic and is raised only by Reboot.
2. **A method on `RebootHost`.** It is reviewable in one place.

R5 added, all with Classic behaviour unchanged (Classic never calls them; the defaults are the old behaviour):

| Shared change | Where | Used by |
|---|---|---|
| A guest can be placed **inside** (no door, no greeting): `guestArrive(spec, { inside })` | `main.ts` | Miis already in a visited room |
| `Play.visitPlace(id, skin, friendHost)`: another room look, the user's Mii comes in through the door, screen `place:<id>` | `play/Play.ts` (`startRoom` shares its setup through `wearOwnMii`) | friends' rooms, Sala Giochi |
| Player object taps ask an optional policy first (`objectPolicy`, null in Classic) | `main.ts` `roomClick` | visitor permissions |
| `snapshot(size)`: square JPEG of the room view | `main.ts` | Miifoto 2 "photo of the room" |
| `Play.photoShare`: an extra button on the Miifoto screen (absent when null) | `play/Play.ts` | "Condividi su MIInstagram" |
| `RebootHost.friends()` also returns personality type, room look, birthday, greeting | `main.ts` | places, quiz, MIInstagram |

## Persistence

Reboot keeps its own keys and never writes the Classic save:

- `mtw.reboot.enabled`
- `mtw.reboot.flags`
- `mtw.reboot.multimii`
- `mtw.reboot.safety`
- `mtw.reboot.lang` (R5)
- `mtw.reboot.miinstagram` (R5, schema v1) + IndexedDB `mtw-reboot` / `photos` for the photos
- `mtw.reboot.relations` (R5)
- `mtw.reboot.games` (R5)

Presence, open rooms, sessions and the phone state are live state and are never stored.

Server-side state comes in R10 (see SERVER.md).
