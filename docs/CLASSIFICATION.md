# CLASSIFICATION.md — what Miitomo Web is made of (living document, last update 2026-10-26 (M17b))

Every piece of Miitomo Web falls into one of five classes. The game uses only files the user owns (APK 2.4.0 + CDN
zips they downloaded); nothing proprietary is bundled in the repository.

| Class | Meaning |
|---|---|
| **ORIGINAL** | Data or assets from the user's own files, used as they are (models, textures, texts, sounds, animations, tables). |
| **REVERSED** | A format, algorithm or table recovered from the files or from the native code (libcocos2dcpp.so), with addresses. |
| **DEDUCED** | Meaning inferred from the data (consistent across all samples) but not read in code. |
| **APPROXIMATED** | Behaviour rebuilt to look/feel right where the original logic is unknown or impossible on the Web. |
| **MISSING / SERVER DATA MISSING** | Not present in any file the user has (server-side content, or never shipped). Never invented as original; shown as such in the UI where a feature depends on it. |
| **WEB ADAPTATION** | Needed only because this is a Web/PC game (tooltips on icon-only buttons, +/− steppers, local storage limits). |
| **WIKI** | Only an external community source (MiiWiki) says it. Used as a pointer for research, never as original data. |

## By area

### Mii Studio editor (M17)
- ORIGINAL: part icons, colour chips, category buttons (CDN asset_layout_v2-3_miiStudio), segment labels Elementi / Colore / Posizione, Azzera, Maschio / Femmina, Nickname.
- REVERSED: grid order of all parts and colours (.rodata icon-name tables); FFLiCharInfo fields (every edit verified by FFL).
- WEB ADAPTATION: category / position-control names, +/− steppers.

### Camera (M17b)
- **CAMERA PLAY: VERIFIED/REVERSED — fixed camera; no original user-facing camera-switch control found.** The room uses its one original camera (doorAnim `persp`); PLAY stages have no drag / zoom / auto-rotate; user zoom / rotation only in the closet (closet_camera.xml) and, later, the profile (profile_camera.xml); free / debug cameras only in the Lab. **Framing on PC — WEB ADAPTATION (M18b):** the original phone screen is portrait; on a landscape PC window the unmodified camera cut off the front of the floor and the Mii's legs. In PLAY the same camera is moved back along its own view axis (same direction, same FOV, still fixed, no user control) just enough for the back wall top and a Mii's feet at the front of the walkable floor to fit above the bottom bar (and the floor width on narrow windows), then re-centred with a vertical lens shift (projection offset, no rotation) — `room/RoomFraming.ts`, test `tests/unit/framing.test.mts` + m18. The Lab keeps the raw original camera. **Horizontal centring (2026-10-27):** the original camera aims at x ≈ 2.5, not at the room centre, so on a wide PC window the room sat right of centre; PLAY pans camera and aim sideways together (same direction, no rotation) so the aim is on x = 0.

### Personality type order (M17b correction)
- REVERSED: engine type 0 Cool, 1 Dry, 2 Nagomi, 3 Nori (three native paths agree; matches the QR card keys and the characterInfoTitle00 group texts). The earlier Nagomi/Nori/Dry/Cool order was wrong and is fixed.

### Bottom bar, closet (M17)
- REVERSED: bar icon table (RoomMenuRootNode, .rodata 0x1895b19); closet tabs (closet_icon_data.xml); closet camera (closet_camera.xml).
- ORIGINAL: tab labels (tabBtn00/01), bulletTab00/01 bases, Togli / Rimetti, Dentro / Fuori, Preferito, Nuovo / Vecchio, "Vuoto.".
- DEDUCED: bar order, clock tab = recent, topslong inside the tops tab, camera parameter meanings.

### Music (M17)
- ORIGINAL: per-scene BGM table Sound/Action/bgm.msbt and all tracks (sound.zip, sound_BGM_* zips).
- DEDUCED: personality-result jingle = bgm_miiStudioConfirmCharacter<Type>.

### Mii, body, wardrobe
- ORIGINAL: Mii heads (FFL/AFL resource), body and 2,000+ clothing models, colour lists, thumbnails, item names (Wearname), category icons.
- REVERSED: model package format, POD/Anim formats, body scale from height/build, wardrobe structure (M6.1), item-name label scheme.
- DEDUCED: Wearname category digits; icon mapping per category.
- APPROXIMATED: shader lighting details where the original GLSL path differs (Lab compares both).

### Room
- ORIGINAL: room models, walls/floors and their names (WallpaperName), layout sprites, door animation, room camera, objects.
- REVERSED: room XML, door/camera from the .pod, state machine sequences (Greeting, Touch, Base), sound tables.
- DEDUCED: walking speed calibration, grab/drop pairing of sounds, idle-variation quiet time.
- APPROXIMATED: path planning in the room, timings between sequences.

### Talking: texts, gestures, faces, personality
- ORIGINAL: all room/tutorial/menu texts (Italian MSBT), EmotionExpression rules, 89 expressions, 138 gesture clips, faces, Italian word lists (~8,000 entries), personality axis labels and level descriptions.
- REVERSED: MSBT/MSBP attribute decoding; rule struct and personality order (0x1118640); **personality classifier** (0x5be42c/0x5be454 + score/type/preset tables); 8-key curves; emotion faces = FFL expression ids.
- DEDUCED: strongest-rule choice and Inhibitor semantics; word-list matching (longest entry wins, exception list, regex/wildcard notation); face from emotion genre for user text.
- APPROXIMATED: gesture start timing; 8 Hz mouth flap; slider UI instead of the radar chart.
- ORIGINAL (M17 correction — earlier wrongly marked MISSING): personality results, `Layout/common/parts/characterInfo00` / `characterInfoTitle00` (4 groups, 16 types, first impression + description; index = personalityIndex + 1, DEDUCED and checked against the reversed type table).
- MISSING: the screen title "Personalità" (placeholder label).

### Particle effects
- ORIGINAL: effect.ptcl (65 effect sets, 49 textures), descriptor XMLs, effect sounds (Sound/Action/effect.msbt).
- REVERSED: EFTB container; ResEmitter layout; colour/alpha/scale curves; combiners; gravity/air resistance; render state; particle types (exported nw::eft2 runtime).
- VERIFIED (M18b fix): a descriptor XML names the emitter set it plays (`<EmitterSet><Name>`), e.g. arJoy_Dr.xml → set arJoy with its own bone / offset; variant descriptors used to play nothing.
- DEDUCED: emission count/interval, spawn volume, velocity spread formula, UV scale, bone-frame usage.
- APPROXIMATED: 60 fps time base; child emitters without inheritance; some particle types drawn as billboards.

### Voice
- ORIGINAL (kept, not used on the Web): Nuance Vocalizer data (voice_* zips, Italian voice "alice") and the engine in the APK.
- REVERSED: voice parameter labels (Altezza, Velocità, Accento, Energia, Profondità).
- APPROXIMATED / NON-ORIGINAL TTS: the browser's speech synthesis (labelled in the UI, never presented as the Miitomo voice).
- MISSING on the Web: the original voice (native ARM engine) — research goal for a native PC build.

### Questions and answers
- ORIGINAL: question lead-ins (KnowledgeHead, with usage flags), question-related room lines and layouts.
- REVERSED: the question-list attribute set (`kl_`: ids, dates, genres, ages, difficulty…), server endpoints (API.md).
- MISSING: **the question database and all answers** (server-only). No substitute database has been created.

### Miifoto
- ORIGINAL: poses (ArchCameraAnimation), faces, backgrounds, stamps, fonts, templates.
- REVERSED: pose table from MSBT attributes; template format.
- APPROXIMATED: composition placement, PNG export size.

### Saves, assets, performance
- Web-only design (no original equivalent): versioned local save with export/import; two-tier asset store (memory + IndexedDB); launcher import of the user's folder; keep-rule versions.

### Shop (M15 — catalogue only)
- ORIGINAL: shop interior model + lights, shop texts and buttons, top banners (images), item names / thumbnails / models.
- VERIFIED: weekly delivery dates of the items (dated CDN zips). DEDUCED: they are the "Arrivi d/m" groups; try-on uses the closet view.
- APPROXIMATED: Mii spot and camera in the shop; date number format.
- MISSING (server): prices, coins, ownership, stock, sales, rotations, what each banner promoted. Economy provider = disabled; prices shown as "—".

### Friends (M16 — local now, our own server later)
- ORIGINAL: friend list / dialog / telop / greeting texts, friend-room tab labels, friend-room BGM (per personality type).
- REVERSED: visit flow names (GoToFriendRoom, SequenceWatchFriend, SequenceByeFriendIn{Friend,User}Room, RoomTabWindowFriend*), friend API paths.
- DEDUCED: host says welcome (1.2) on arrival and seeing-off (1.3) on leaving; BGM_MIIWATCH_FRIEND_<type>.
- APPROXIMATED: friends are local Mii profiles made on this device (no requests / codes / SNS).
- M18: a friend entering the user's room — ORIGINAL telop / greetings / BGM table, REVERSED clips and sequence names, DEDUCED order of the lines, APPROXIMATED arrival spot, personal distance, wandering and visit schedule.
- MISSING (server): friends' answers, comments, hearts, their friend lists, letters, notifications.
- Architecture: central (our own backend, never Nintendo's); P2P not planned.

## Pointers
STATUS.md (log) · EXPRESSION.md · EFFECTS.md · VOICE.md · QUESTIONS.md · WARDROBE.md · ROOM.md · MIIFOTO.md · SAVE.md · API.md · SHOP.md · SOCIAL.md · NATIVE.md (addresses).

- **Mii head — texture-format adapter (M18c, WEB ADAPTATION).** On GLES2 the game samples FFL's A8 / LA8 textures (alpha in `.a`); FFL.js uploads the same data as R8 / RG8 on WebGL2 (alpha in `.r` / `.g`, `.a` = 1). The original LUT.fsh `AGX_FEATURE_MII_ALPHA / _LUMINANCE_ALPHA / _ALPHA_OPA` branches therefore read alpha = 1: the noseline (XluNoseLine, EnableAlphaTest, mode ALPHA) became an opaque black square. Fix: the albedo fetch of those branches goes through `MTW_FETCH(t)` (R8 → (0,0,0,r), RG8 → (r,r,r,g)); shader logic, blend and alpha test unchanged (mii_model.xml: XluNoseLine/XluGlass IsXlu, alpha test, GL_ONE/GL_ZERO). `agx/LutMaterial.ts miiFetchPatch`, `agx/MiiMaterial.ts miiFetch`; regression in m18.

- **Layout atlases are premultiplied alpha (M18d, VERIFIED data).** No texel of the `.pvr.ccz` layout atlases has a colour channel above its alpha (e.g. bulletTab00's white rim fades as 0x44/0x44/0x44 @ 0x44): cocos2d-x draws them with GL_ONE / GL_ONE_MINUS_SRC_ALPHA. The browser expects straight alpha, so every anti-aliased edge came out grey. `room/LayoutSprites.ts unpremultiply()` converts an atlas once when its data is premultiplied (A8 atlases untouched).
- **Bottom-bar button base = Scale9 (M18d, VERIFIED names + REVERSED default).** tabBtn00.ccbi: CCControlButton with backgroundSpriteFrame bulletTab00 / bulletTab01 and a preferedSize → a CCScale9Sprite with default thirds insets; the 13 px / 19 px frames are now drawn as a 9-slice (CSS border-image) instead of being stretched whole. Display size of the button (40 px) stays APPROXIMATED.

## Miitomo Reboot (from 2026-10-26)

From here on, new features belong to **Miitomo Reboot**. They are NOT original Nintendo content and are documented
separately in `docs/reboot/`, with the master table in `docs/reboot/CLASSIC-VS-REBOOT.md`. Reboot runs only when
opened with `?reboot=1` or the `avvia-miitomo-reboot.bat` launcher. The Classic launcher always opens with
`?reboot=0`.

- **SHARED INFRASTRUCTURE change (R2), with Classic behaviour unchanged.** The M18 single guest became a list of
  guests with `guestCap`, which stays **1 in Classic**. The list brings:
  - a door queue: one Mii through the door at a time;
  - personal distance between every pair of Miis;
  - per-guest seeds (`RoomDirector.reseed`);
  - tap picking per guest;
  - per-guest speaker (`talker`).

  For a single guest the behaviour is identical to M18, as the m18 suite shows. Raising the capacity is REBOOT.
- **SHARED INFRASTRUCTURE hooks for the Reboot social layer (R2b), with Classic behaviour unchanged.**
  - `main.ts` gained a read and command surface over the existing room machinery:
    - events: tick, speech and player;
    - views of every Mii, plus goTo, face, interact, wave and say;
    - `RoomUI` got the `chat` balloon kind and the `openLabel` getter.
  - In Classic nothing subscribes, so these are empty loops.
  - The social behaviour itself (`reboot/social/`) is REBOOT. Its chat lines are NEW text, not Miitomo text. See
    `docs/reboot/SOCIAL.md`.
- **SHARED fix (R3), with Classic behaviour unchanged for one guest.** Guests leaving at the same time now queue their
  original goodbye exchange (`byeQueue`). A watchdog sends a leaving guest to the door if its balloon was replaced.
  Before this, closing a busy public room left guests stuck "leaving".
- **SHARED robustness fixes found during R4 testing, with Classic behaviour unchanged for one guest.**
  - The door queue retries an exit that the state machine refused, for example during a short reaction. Before, the
    guest was dropped from the queue and stayed in the room.
  - A leaving guest that never got to the door goes anyway after 20 s idle.
  - `guestsState().leaving` also reports a pending leave (`leaveWanted`).
  - REBOOT: the social layer keeps its targets out of the door strip (z < −20), where the door passage has no
    personal-distance push. Two Miis could otherwise overlap there.
  - REBOOT: social glances skip Miis that are leaving.
  - Personal distance used to be skipped for every Mii in the whole back strip (z < −24). Now only a Mii passing the
    door (entering or exiting) is exempt. Before, two Miis could stack up near the back wall (reproduced in 1 of 3
    parallel r2 runs).
  - `RoomUI.shown` (balloon history, diagnostics) is now bounded to 300 entries.
