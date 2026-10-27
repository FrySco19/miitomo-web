# Reboot R6 / R7 — audit and plan (written before any R6 code)

Starting point: R5 (`5ef3775`, PR #1, CI green, real-engine E2E still to run on the maintainer's PC).

## 1. What exists today (R1–R5)

| Area | What is real | Where |
|---|---|---|
| Gate, flags, Classic separation | `?reboot=0/1`, flags, dynamic chunk, boundary tests | `reboot/gate.ts`, `flags.ts`, `index.ts` |
| Several Miis + social life | 2–8 Miis, door queue, conversations, priorities, personality, reserve / attraction / affinity | `multimii/`, `social/` |
| Rooms | The user's room (one original room model: fixed furniture + wall / floor skins); public room R3; visited rooms R5 | `rooms/`, `places/` |
| Piazza | Location model, navigation, errors, eviction | `hub/` |
| Sala Giochi | Game registry / session / result / reward, Quiz dei Mii | `games/` |
| MiiPhone | Phase model, app registry, one app | `phone/` |
| MIInstagram | Typed posts, reactions, comments, persistence, autonomous Miis | `miinstagram/` |
| i18n | English + Italiano for R5 texts | `i18n/` |
| Classic shop | Catalogue only, **economy disabled** (prices were server data) | `play/Shop.ts` |
| Audio | BGM / SE / voice **on-off** switches; gain nodes exist inside `RoomSound` | `room/RoomSound.ts` |

## 2. What is missing (asked for in the R6 / R7 brief)

House with several rooms and progression; furniture catalogue and room editor; Play Room; general object
interactions; outdoor places (park, cinema, café, beach…) with population and schedules; daily life; MIInstagram 2.0
content from places; profile page; friends with relationship levels; messages; Reboot shop + economy; settings
(volumes, quality, motion, region, notifications); more minigames; events; achievements / progression.

## 3. What needs refining

- **Visual consistency.** Six R1–R5 stylesheets each define their own colours, radii, shadows and buttons
  (`reboot.css`, `hub.css`, `places.css`, `games.css`, `phone.css`, `miinstagram.css`): same orange written 20+ times,
  three button styles, three card styles. No shared tokens, no shared focus style.
- **Mixed languages.** The R1–R3 "Reboot" panel and the R2b chat lines are still Italian only.
- **MiiPhone** has one app; the home screen is mostly empty.
- **Audio** has only on/off switches.

## 4. Hard constraints (what decides how R6 is built)

1. **There are no separate furniture models in the original files.** Miitomo had no room decoration: the room is one
   model (`roomBase00`) with fixed furniture (shelf, plants, chest, lamp, cushions); only wall and floor change.
   A furniture catalogue and a room editor therefore need **new 3D models made for Reboot**. Plan: simple, original,
   parametric low-poly furniture (sofa, TV, console, table, bed, lamp, rug, plants, posters…) built in code with the
   room's own lighting, kept apart from the original assets. Quality will be "clean and coherent", not Nintendo art.
2. **No sitting / sleeping / playing animations are known in the files.** The known clips are walk, idle, wave, nod,
   touch reactions, pick up, press, check the box, smell. "Sit on the sofa" or "play the console" need either a clip
   found in the user's full CDN set (the 88 Miifoto poses must be checked on real files) or a pose built for Reboot.
   Until then interactions use what exists (walk there, face, an existing clip, a balloon) and say so.
3. **Outdoor places have no original 3D sets.** Park, cinema, café, beach need new sets (same approach as furniture:
   original low-poly scenes) or the original shop interior / Miifoto backgrounds (user's files, local only).
4. **No real-engine testing in the cloud session.** Every milestone is unit + UI-smoke tested here; the real-engine
   E2E runs on the maintainer's PC. Reports keep the four levels apart: unit tested / UI smoke tested / real-engine
   tested / not verified.
5. **Economy.** Classic prices are unknown server data and stay disabled. A Reboot economy (coins earned by playing,
   no real money, no pay-to-win) is a NEW design and is labelled as such.

## 5. Proposed architecture (extends the current folders; no rewrite)

```
reboot/
  ui/          design tokens + shared components (buttons, cards, chips, tabs, sheets, fields, toggles, toasts)
  settings/    Settings model (persisted) + MiiPhone app; applies volumes, motion, quality, language, region
  i18n/        locale registry (en, it complete; es / fr / de / pt / ja addable without code changes)
  phone/       MiiPhone + app registry (+ apps: Settings, My page, Friends, Places shortcuts, Shop…)
  profile/     My page (overview, posts, friends, rooms, achievements)
  economy/     wallet (coins / tickets), ledger, reward sources — local now, server later
  shop/        Reboot shop over the catalogue + economy
  house/       House (rooms, levels, unlocks) — R6.1
  furniture/   catalogue + parametric models + interaction definitions — R6.1
  editor/      room editor (PLAY / EDIT) — R6.1
  places/      (exists) visited rooms → generalised Place definitions, indoor / outdoor sets — R6.2
  social/      (exists) + daily schedules, object interactions — R6.3
  miinstagram/ (exists) → 2.0 contextual content — R6.4
  games/       (exists) + new games, tournaments — R6.5
  events/      timed events — R7
```

Shared-infrastructure needs (each a narrow `RebootHost` method, Classic unchanged): volume levels (RoomSound gains,
speech volume), render quality, adding Reboot-made 3D objects to the room scene and registering them as furniture
boxes / interactables, building a non-room set for outdoor places.

## 6. Dependencies between milestones

R6.0 (tokens, settings, phone apps) → everything else uses them.
Economy (R6.0b) → Shop → furniture purchases (R6.1) → rewards from games (R6.5) and events (R7).
Furniture models + host scene objects (R6.1) → Play Room, room editor, object interactions (R6.3), places' props (R6.2).
Place definitions (R6.2) → daily life (R6.3) → MIInstagram contextual posts (R6.4).

## 7. Milestones

| Milestone | Content | Done when |
|---|---|---|
| **R6.0a** | Design system (tokens + components), all R1–R5 UI migrated to it; Settings (language, region, player name, volumes, motion, quality, confirmations, notifications); locale registry; Reboot panel + chat lines translated; MiiPhone home as a real hub (Settings, My page, Friends, Piazza / Stanze / Giochi / Casa shortcuts that navigate for real); My page (overview, posts, friends); Friends with relationship levels | tests + UI smoke + docs |
| **R6.0b** | Economy (wallet, ledger, earn rules) + Reboot shop (clothes from the user's wardrobe files, preview, buy, own, equip, favourites, filters) | same |
| R6.1 | House (rooms, levels, unlocks), furniture catalogue (original parametric models), room editor, Play Room | same + real engine on the PC |
| R6.2 | Place definitions; park, cinema, café as first outdoor / indoor sets; Sala Giochi upgraded | same |
| R6.3 | Daily schedules, place population with reasons and durations, object interactions | same |
| R6.4 | MIInstagram 2.0: contextual posts from places / interactions / friendships, profiles | same |
| R6.5 | 2–3 new games (Memory, Reaction, Guess the Mii), rewards, tournaments | same |
| R7 | Events, progression, larger houses, more places / furniture, deeper relationships, seasons | same |

## 8. Risks

| Risk | Mitigation |
|---|---|
| Original-looking furniture / places cannot be made from the files | Original low-poly art, one coherent style, honest docs |
| Missing animation clips for sitting / playing | Check the user's full set; otherwise use existing clips and say so |
| Scope (R6 + R7 is very large) | One milestone at a time, each complete and tested before the next |
| Regressions in R1–R5 / Classic | All existing suites on every milestone; boundary tests; real-engine runs on the PC |
| Performance with more systems | Every system owns its listeners / timers; soak tests count them |

## 9. Tests per milestone

Unit: settings, i18n, economy, shop, profile, friends (R6.0); house, furniture, editor (R6.1); places (R6.2);
schedules, interactions (R6.3); feed (R6.4); games (R6.5). UI smoke (no game files): phone apps, settings, language
switch + reload, profile, shop, navigation shortcuts, responsive 1400×900 / 1024×768 / 390×844, keyboard navigation,
reduced motion, soak. Real engine (PC): the R5 suite plus one R6 suite per milestone, Classic and R2–R4.
