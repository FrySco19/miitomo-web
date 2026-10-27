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
    ui/RebootPanel.ts, ui/reboot.css   Reboot layer above the Classic screens
```

Classic is not moved into a `classic/` folder. Moving it would rewrite every import and every test path for no gain.
Instead the boundary is enforced by tests (`tests/unit/reboot.test.mts`, "boundary" checks):

- Classic code may import, statically, only `reboot/gate` and the `RebootHost` **type**.
- The Reboot runtime is reached only through `import('./reboot/index')`, guarded by the gate.
- Reboot reaches the shared infrastructure only through `RebootHost`. It never imports `play/Play`, `main`, room,
  body or agx internals directly.

## Gate and flags

- `?reboot=1` turns Reboot on in this browser and remembers it. `?reboot=0` turns it off. The Classic launcher
  (`avvia-miitomo-web.bat`) always passes `reboot=0`; `avvia-miitomo-reboot.bat` passes `reboot=1`.
- With the gate closed, the Reboot chunk (≈ 13 KB JS + 3 KB CSS) is **never downloaded**, and Classic runs exactly
  as before.
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

## Persistence

Reboot keeps its own keys and never writes the Classic save:

- `mtw.reboot.enabled`
- `mtw.reboot.flags`
- `mtw.reboot.multimii`
- `mtw.reboot.safety`

Server-side state comes in R10 (see SERVER.md).
