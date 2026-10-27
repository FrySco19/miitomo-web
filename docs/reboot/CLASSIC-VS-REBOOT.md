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
| Miifoto (original) | CLASSIC | Unchanged. Reboot adds a "Condividi su MIInstagram" button to it (absent in Classic) |
| Miifoto 2 (R5): share a Miifoto on MIInstagram, photo of the room with several Miis | REBOOT | Built on the Classic Miifoto; no second photo system |
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
| Friends' rooms (R5): visit a friend's public room as a visitor | REBOOT; SERVER REQUIRED for rooms of real other users | `reboot/places/`. Local friends only, deterministic fixture. The visited side of R3 |
| Sala Giochi (R5) + game model + Quiz dei Mii | REBOOT | `reboot/games/`. Questions only from the user's own data; other players simulated locally |
| MiiPhone (R5) | REBOOT | `reboot/phone/`. Never changes location |
| MIInstagram feed, typed posts, reactions, comments, autonomous Miis (R5) | REBOOT, SERVER REQUIRED for other users | `reboot/miinstagram/`. Reactions, comment lines and moments are NEW text |
| English + Italiano for Reboot (R5) | REBOOT | `reboot/i18n/`. Classic keeps the original texts of the user's files |
| Guest placed inside without the door, `visitPlace`, object policy, room snapshot, Miifoto share hook (R5) | SHARED INFRASTRUCTURE | Off in Classic (never called / null) |
| Design system, Settings, My page, Friends, MiiPhone shortcuts (R6.0a) | REBOOT | `reboot/ui/`, `reboot/settings/`, `reboot/people/`. Volumes / quality / player name reach the engine through `RebootHost` (Classic never calls them) |
| Coins and the Reboot shop (R6.0b) | REBOOT (new economy, no real money) | `reboot/economy/`, `reboot/shop/`. The Classic shop stays a catalogue: Miitomo's prices were server data |
| Desktop app: local accounts, launcher, peer-to-peer friends (2026-10-27) | NEW (desktop shell) | `desktop/`, `client/web/src/launcher/`, `client/web/src/p2p/`. In Classic, P2P friends join the friends list with their own Mii (the original friends were on Nintendo's server). Off in a plain browser |
| MIInstagram between real P2P friends | REBOOT | `reboot/miinstagram/P2PFeedSync.ts`. The simulated Miis never act in a real friend's name |
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
