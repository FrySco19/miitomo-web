# Miitomo Reboot — roadmap

The phases run in the mandatory order below, one at a time. A phase is marked **done** only when all of these exist:

- implementation;
- tests;
- persistence;
- UI;
- error handling;
- documentation;
- classification;
- regression tests.

Every phase also keeps all Classic suites green.

| Phase | Content | State |
|---|---|---|
| R0 | Classic closed: all Classic suites green (M6.1–M18, Shop, Friends), status docs updated | **done** (2026-10-26) |
| R1 | Classic/Reboot separation, gate, feature flags, server contracts v1, providers, safety primitives, docs/reboot | **done** |
| R2 | Several Miis in the same room: 2 → 4 → 8, capacity configurable | **done** (base); behaviour layer continues in R2b |
| R2b | Social life: perception (who talks, glances, arrivals), Mii ↔ Mii conversations on one floor, 6-level priorities with pause/resume, personality-weighted autonomous activities | **done** (2026-10-26) |
| R3 | Public Room vertical slice: PublicRoomTemplate, RoomInstance (presence, roles, permissions, capacity), LocalRoomService (server stand-in, realtime events), simulated visitors, owner panel | **done** (2026-10-26) |
| R4 | Social hub "Piazza": model over R3 (location, destinations, navigation, errors, events) + view; Casa ↔ Hub ↔ my Public Room; future destinations declared | **done** (2026-10-26) |
| R5 | Social expansion: friends' rooms, Sala Giochi (game model + Quiz dei Mii), MiiPhone + MIInstagram (typed posts, reactions, comments, autonomous Miis), Miifoto 2 sharing, English + Italiano | **done** (2026-10-27) |
| R6 | World expansion (re-planned 2026-10-27, see [R6-AUDIT.md](R6-AUDIT.md)): R6.0 design system, Settings, MiiPhone hub, economy + shop · R6.1 house + editor · R6.2 places · R6.3 social 2.0 · R6.4 MIInstagram 2.0 · R6.5 new games. The old R6 (MiniGameEngine) is part of R6.5 | **in progress**: R6.0a block 1 done ([R6.md](R6.md)) |
| R7 | Events, progression, larger houses, more places and furniture, deeper relationships, seasons (the old R7 minigames moved into R6.5) | planned |
| R8 | Events (data-driven) + rewards (RewardDefinition / Grant / Inventory, no currency yet) | planned |
| R9 | Notifications | planned |
| R10 | Our central backend (API + DB + realtime), ServerRebootProvider live | planned |
| R11 | Realtime multiplayer | planned |
| R12 | Polish, performance, mobile | planned |

## R2 — what was delivered

- The shared guest machinery supports N guests, each with its own body, director, faces, voice and talking. Classic
  keeps capacity 1, so its behaviour is unchanged.
- Personal distance applies between **every** pair of Miis present.
- The door is shared: one Mii goes through it at a time. Arrivals and exits wait in a queue.
- Each Mii gets its own seed for idle look-arounds and wandering, so the Miis are not in lockstep.
- Taps pick the exact guest under the pointer. Balloons, voice and gestures belong to the guest who speaks.
- Reboot panel:
  - capacity 2–8 Miis, persisted;
  - invite one friend, or "Invita tutti" until the room is full;
  - dismiss one friend (original goodbye 1.4 → 1.3), or "Congeda tutti".
- Tests:
  - `tests/e2e/r2-multimii.smoke.mjs`: four Miis, the door queue, distance between all pairs, no violations, no
    lockstep, tapping one guest, dismissing one, capacity 8, reload, and `?reboot=0` falling back to pure Classic;
  - `tests/unit/reboot.test.mts`.

## R2b — what was delivered

All of it is in `docs/reboot/SOCIAL.md` § R2b; the code is in `reboot/social/`.

- Miis notice who talks and some of them turn to look. Glances are limited, asynchronous and personality-driven.
- Miis notice arrivals and turn to the door; an outgoing Mii may wave.
- Mii ↔ Mii conversations run approach → face → open/reply/follow-ups/close → walk away. Only one balloon is open at
  a time, and conversations queue for the floor.
- Priorities: player > door > conversation > reaction > activity > rest. A tap pauses a conversation and keeps its
  line; a conversation suspends a walk, which resumes afterwards.
- Activities: wander (alone or near others), use an object, watch a conversation, rest. Each Mii has its own natural
  pauses.
- Personality, with the 4 original types, sets the chance to chat, the length of a conversation, how readily a Mii
  approaches others, its preference for being alone, its reactions and its activity weights.
- The layer only commands the existing movement and animation API (`RebootHost`). It has no movement code of its own.

Tests: `tests/unit/social.test.mts` and `tests/e2e/r2b-social.smoke.mjs`.

## R3 — what was delivered

All of it is in `docs/reboot/PUBLIC-ROOMS.md`; the code is in `reboot/rooms/`.

- The user's room can be **opened as a public room**: owner, visitors, capacity (2–8), entry and object permissions,
  open / full / closed state.
- Visitors arrive and leave as **realtime events**. They come in through the R2 guest machinery and R2b takes them over
  with no public-room social code. Object use follows the room permissions through a generic social policy.
- Visitors cannot perform host actions; refusals are logged.
- The owner can:
  - kick a visitor, who cannot come back in that session;
  - change the settings;
  - close politely.
- When the owner leaves the room screen, every piece of public state is cleared. The private room is unchanged.
- Only the configuration persists. Presence is live state.

Tests: `tests/unit/rooms.test.mts` and `tests/e2e/r3-public.smoke.mjs`.

## R4 — what was delivered

All of it is in `docs/reboot/SOCIAL-HUB.md`; the code is in `reboot/hub/`.

- The model is separate from the UI. There is a single derived location (home / hub / public). The Public Room status
  is read from R3 on its events.
- Navigation is explicit, one transition at a time:
  - Casa ↔ Hub;
  - Hub → my Public Room, where R3 opens it;
  - Public Room → Hub or Casa, where R3 closes it with R3's own cleanup.
- Errors are explicit and the hub stays usable: busy, already there, unavailable, closing, open refused, not in the
  room, time-out, interrupted.
- Future destinations are shown disabled. Adding a destination is a one-call extension point.

Tests: `tests/unit/hub.test.mts` and `tests/e2e/r4-hub.smoke.mjs` (scenarios A–H plus the soak).

## R5 — what was delivered

One small social world instead of three menus: **Casa → Piazza → friends' rooms · Sala Giochi · my public room**, and
above it, not a place, the **MiiPhone → MIInstagram**.

- **Friends' rooms** (FRIEND-ROOMS.md): the visited side of R3 — same `RoomInstance`, events and `SceneBinding`
  (extracted from R3 with the same behaviour). Visitor role, owner permissions, refusals with nothing changed,
  switching rooms, eviction when the owner closes, complete cleanup. Local friends only, deterministic fixture.
- **Sala Giochi** (GAME-ROOM.md): a real place with a game model (registry, definition, session, result, reward) and
  one real game, Quiz dei Mii, built only from the user's own facts. Players reserved from R2b, spectators watch,
  reactions with the existing commands.
- **MiiPhone** (MIIPHONE.md): a phone on the right edge; never changes location; app registry; responsive.
- **MIInstagram** (MIINSTAGRAM.md): typed posts (photo / activity / answer), Miitomo-like reactions (one per person),
  comments, Miifoto sharing and photos of the room, persistence with schema and migration, a service seam for R10,
  autonomous Miis driven by personality and relations, with cool-downs, caps and dedup.
- **English + Italiano** (I18N.md): one table, browser detection, English fallback, manual choice persisted.
- **R2b additions** (SOCIAL.md): conversation events, reserve / release, a point of interest, affinity.
- **Fixes**: `RebootHost` callbacks bound (a method passed unbound would lose `this`); the R2b "tap on the last line"
  bug, already fixed, re-checked over 14 seeds.

Tests: `tests/unit/{i18n,friendrooms,gameroom,miiphone,miinstagram}.test.mts`, `tests/e2e/r5-ui.smoke.mjs` (runs
without game files) and `tests/e2e/r5-social.smoke.mjs` (real engine, needs the user's files).

## Definition of done of the first big Reboot milestone

The milestone is reached when a user can do all of the following, in order:

1. Create a Mii and enter their own room.
2. Have autonomous Miis.
3. Visit friends.
4. Have several Miis in the same room.
5. Enter a Public Room and see other Miis there.
6. Play a minigame.
7. Make a Miifoto and publish it on MIInstagram.
8. Receive reactions or comments.
9. Go back to their own room.
10. Receive a notification.
11. Find everything still there after a reload.
