# Classic vs Reboot

**CLASSIC** reconstructs Miitomo 2.4.0 from evidence. Each element keeps its evidence class, as documented in
`docs/CLASSIFICATION.md`:

- VERIFIED;
- REVERSED;
- DEDUCED;
- APPROXIMATED;
- SERVER DATA MISSING;
- NON PRESENTE;
- WEB ADAPTATION.

**REBOOT** features are new. They are **not original Nintendo content** and must never be presented as such. The UI
labels them "NUOVO · funzioni non presenti in Miitomo originale".

Every feature belongs to exactly one of these classes:

| Class | Meaning |
|---|---|
| CLASSIC | Part of the original game, reconstructed |
| REBOOT | New feature, exists only with the gate open |
| SHARED INFRASTRUCTURE | Technical base used by both. Its behaviour in Classic is the reconstructed one |
| SERVER REQUIRED | Needs our central backend (R10+). Until then it is simulated locally, or unavailable |

## Feature table

| Feature | Class | Notes |
|---|---|---|
| Mii creation, Mii Studio editor, personality, profile | CLASSIC | Original screens and texts |
| Mii renderer (FFL / AFL, LUT shader, head materials) | SHARED INFRASTRUCTURE | |
| Body, wardrobe, outfits, closet | CLASSIC (UI) / SHARED (engine) | Fashion Challenge (R7) will reuse the engine |
| Room engine, RoomDirector, door, furniture, idle actions | SHARED INFRASTRUCTURE | |
| Room camera (fixed, PC framing) | CLASSIC (camera) + WEB ADAPTATION (framing) | |
| Audio, BGM, voice, effects | SHARED INFRASTRUCTURE | |
| Miifoto (original) | CLASSIC | Miifoto 2 (R5) = REBOOT |
| Shop catalogue (no purchases) | CLASSIC | |
| Local friends, visiting a friend's room | CLASSIC (flow) / SHARED (provider) | |
| One friend visiting your room (M18) | CLASSIC (APPROXIMATED schedule) | Capacity 1 |
| Several Miis in the room, capacity 2–8, group invite (R2) | REBOOT | Built on the shared guest machinery |
| Door queue, personal distance between all pairs, per-Mii seeds | SHARED INFRASTRUCTURE | Identical for one guest |
| Social life (R2b): glances, Mii ↔ Mii conversations, priorities, personality-weighted activities, chat lines | REBOOT | `reboot/social/`. The chat lines are NEW text, not Miitomo text |
| RebootHost social hooks (tick, speech, player events; command surface over RoomDirector; `chat` balloon kind) | SHARED INFRASTRUCTURE | No subscribers in Classic, so no behaviour change |
| Reboot gate, feature flags, Reboot panel | REBOOT | |
| Server contracts v1, Local / Server Reboot providers | REBOOT (SERVER REQUIRED for the server side) | Never Nintendo |
| Report / block / mute / privacy / rate limits | REBOOT (local now, SERVER REQUIRED to enforce) | |
| Public Room (R3): RoomInstance, templates, LocalRoomService, simulated visitors, owner panel | REBOOT; SERVER REQUIRED for real other users | `reboot/rooms/`. Visitors are local friends simulated until R10 |
| Social hub "Piazza" (R4): SocialHub model + HubScreen view, navigation Casa / Hub / Public Room, future destinations disabled | REBOOT | `reboot/hub/`. Local only, no networking. It reuses R3 events and R3 cleanup |
| MIInstagram feed, posts, reactions, comments (R5) | REBOOT, SERVER REQUIRED for other users | |
| Minigames, MiniGameEngine (R6–R7) | REBOOT | Miitomo Drop 2.0 = new; original Miitomo Drop stays CLASSIC (prizes SERVER DATA MISSING) |
| Events, rewards (R8) | REBOOT | No currency |
| Notifications (R9) | REBOOT, SERVER REQUIRED for remote ones | |
| Realtime multiplayer (R11) | REBOOT, SERVER REQUIRED | |

## Rules

1. Classic behaviour is never changed to suit Reboot. When shared code is generalised, Classic keeps the original
   values, for example guest capacity 1. A regression suite proves it: every Classic suite, plus `r2` with `?reboot=0`.
2. Original assets are never added to the public distribution. Assets recovered locally stay on the user's machine, as
   in Classic. New Reboot assets are kept apart from the original ones.
3. No Nintendo server or authentication, ever. `createServerProvider` refuses Nintendo hosts.
4. No real-money purchases. No currency until a separate decision is taken (REWARDS.md).
