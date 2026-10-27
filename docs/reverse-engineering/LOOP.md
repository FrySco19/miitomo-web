# LOOP.md — M8: first offline gameplay loop in the room (2026-10-25)

Classification: **VERIFIED** = checked in the browser against data/binary · **REVERSED** = read from binary/data and implemented as found · **DEDUCED** = inferred from strong indirect evidence · **APPROXIMATED** = our own design or best guess · **PLACEHOLDER** = stand-in shown only when an original file is missing.

Loop: page → original room → Mii enters through the door and greets → idle → click floor (walk) → click Mii (reaction + balloon + menu) → menu answer → click object (path → spot → action → nod) → idle → door (goodbye, exit) → door (re-enter). No backend, no network, no login.

## 1. Inputs (user's own files, local only, never in the repo)
| File | Source | MD5 | Used for |
|---|---|---|---|
| message_Release_Console_EUit.zip | CDN | 72b2b132… | Italian MSBT texts (Scene, System, Layout/room) |
| message_Release_Arch_msbp.zip | CDN | 865125da… | MessageStudio project: tag / attribute names (research only, not loaded by the client) |
| sound.zip | CDN | bf7c0133… | 274 audio files (the client keeps `*.wav` + `BGM_MiiWatch_*.mp3`, ~11 MB) |
| asset_layout_v2-0_room_Published-iOS.zip | CDN (M7) | 07d74870… | room CCBI + texture-room atlases |
| APK `assets/message/Release/Console/JPja/Client/Sound/*` | APK | — | sound tables (the APK ships no room texts) |
| APK `assets/sound/*`, `assets/asset/layout/font/SeuratPro-B.otf` | APK | — | UI sound effects, balloon font |

## 2. Findings
| Topic | Status | Evidence |
|---|---|---|
| MSBT format | REVERSED | header `MsgStdBn`, LBL1 hash buckets → index, TXT2 UTF-16LE, 0x0E tag (group, type, size, params), 0x0F close. Parser `formats/msbt.ts`, unit test `tests/unit/msbt.test.mts` 5/5. |
| Tag names | REVERSED | Arch.msbp (TGG2/TAG2/TGP2/TGL2): 0 System {Ruby, Font, Size, Color(r,g,b,a), PageBreak}, 1 Mii {Nickname, Firstname, GreetingMyRoom, GoodByeSeeingOff, GoodByeGoHome, GreetingFriendRoom}, 2 Date, 3 Reference {Number, RankName, Message}, 5 Gender {Mii(male,female), RankName}, 8 Format, 9 EmotionExpression {GlobalEmotion, SentenceEmotion, SentenceBreak, ExpressionRule, Kaomoji, Separate, Language}, 10 Knowledge, 11 Notification. Emotion list em_None…em_Surprise (11), ExpressionRule list er_None…er_Stupefaction (57), colours Arch_Red f05a28 / Arch_Blue 009bbe / Arch_Black 505050. |
| Emotions / expression rules at runtime | not reversed | e.g. `{9.3:01}Ciao{/}` = ExpressionRule er_Greeting around "Ciao". What face / gesture the game plays for each rule is unknown → shown as bold emphasis, rule kept in `data-rule`. APPROXIMATED. |
| Room texts | VERIFIED (data) | RoomSceneTalkWords: fixedGreeting "Ciao!", fixedGreetingNight "Buonasera!", mySubMii0 "Hai bisogno di qualcosa?", noQuestion "Ti sembrerà strano... ma ho finito le domande! …". MiiCommonText: defaultGoodByeGoHome "È ora di andare.". Layout: balloonTextBtn02 "Chiedi qualcosa!" / "Sai, di recente...", balloonTextBtn01 "Cambia abbigliamento", iconTextBtnL00 "Saluti", cmnBtn01 "Interrompi", balloonTextBtn00 "Parla". |
| Which text in which moment | DEDUCED / APPROXIMATED | fixedGreeting(Night) after entering: label name (SequenceGreeting exists). mySubMii0 on touch: the label belongs to the sub-Mii flow; reused for the main Mii = APPROXIMATED. noQuestion for "Chiedi qualcosa!" offline: the label means "no question left", which is the real offline situation = DEDUCED. defaultGoodByeGoHome when the Mii leaves = DEDUCED. Night = 18:00–05:00 = APPROXIMATED. "Interrompi" on the ok button: original label `title00@knowledgeOk` of the same button family = DEDUCED. |
| Touch sequence | REVERSED (assets) | SequenceTouch (vtable 0x1ab3c10) static table: animActionStroked + character/arStroke.xml, animActionPickUp, animActionFall, animActionTouchLanding(FootStep), animActionPress, se_nade01, se_ui_hand_00/01. The flow itself (updateTouchMii) waits for server data (sakasho lambdas) → not reproducible offline. |
| Reaction choice | DEDUCED | Stroked is the only tap reaction the table names; PickUp/Fall/TouchLanding belong to dragging the Mii (not in M8). |
| Interactive furniture | none in the original (as far as the code shows) | Only posters (CustomRoomObject), the door and the Mii are touch targets. M8 object interactions are APPROXIMATED: chest → animActionCheckTheBox, lamp/switch → animActionPress (both clip names referenced by the binary), plants → animSmellHandDown (in the 304-clip pack), then animNodClone. Labels "Baule / Lampada / Pianta" are ours. |
| Sound tables | VERIFIED (data) | Action/anim: animWalkClone:2/:17 → se_walk_nori_00/01, animHandWaveL(In) → se_animation_up, animNodClone:15 → se_animation_down, animActionPress → se_animation_move, animActionAppearFall → se_animActionLanding, animSmellHandDown → se_animSmellHandDown. Action/common: doorAnim/doorAnimOpen → se_door_open01, doorAnim/doorAnimClose → se_door_close01, talkBalloonBody00 balloon appear → se_baloon_in (= test_03.wav), roomTouchBtn decide → se_button_orange_decide, ok00 decide → se_button_bouncy_decide, balloonMenu00 on/off → se_wipe_up/down_button_noclk. Action/bgm: bgm_room → BGM_MIIWATCH_NORMAL_DAY (alternatives NOBODY, FRIEND_*, NORMAL_NIGHT) → WAVE_* → BGM_MiiWatch_*.mp3. Wave/common + Wave/emotion: event → file. |
| Walk sound per personality | DEDUCED | animWalkClone is tied to se_walk_nori_*; other walk clips map to cool/dry/nagomi. Only the `nori` files exist in sound.zip. |
| BGM NOBODY when the room is empty | DEDUCED | from the line name; used while the Mii is outside. |
| Missing audio | VERIFIED absent | `se_wipe_up_button_noclk.wav`, `se_wipe_down_button_noclk.wav` are named by Wave/common but exist neither in sound.zip nor in the APK (only `se_wipe_*_button.wav`). They stay silent; no substitution. |
| Mii voice | not implemented | `murmursound_00…11.raw` = headerless 16-bit PCM (sample range ±15 k). The sample rate and how the game drives it while text types are not reversed, so nothing is played (no guessed rate). |
| Layout sprites | REVERSED | see UI.md § Room. |

## 3. State machine (`client/web/src/room/RoomDirector.ts`, APPROXIMATED design)
| From | Allowed to | Triggered by |
|---|---|---|
| outside | entering, idle | door / E / button (enter); `restore()` after a skin rebuild |
| entering | reacting, idle | door closed → wave; appear landing |
| idle | walking, reacting, exiting, entering | floor/furniture/object/keys; Mii tap / Space; door; appear |
| walking | walking, idle, reacting, interacting, exiting | new target (retarget, no stop); arrival; Mii tap (walk cancelled); object spot reached; door |
| interacting | reacting | object clip ends → nod |
| reacting | idle | Stroked / wave / nod ends |
| exiting | outside | corridor reached, door closed |
Input rules: in entering / exiting / interacting / reacting every click and key is ignored (logged as `ignorato …`); interactions and reactions are atomic. A click elsewhere closes the touch menu; any state change away from idle closes it as well. Every refused transition is stored in `director.violations`.

## 4. Movement and camera
M7 kept unchanged: WalkClone, 6.14 u/s from the stance-foot cycle, 9 rad/s turn, 0.2 s cross-fade, wall + furniture clamp, click-to-walk, WASD/arrows, the 3 cameras (original POD camera, follow, free debug). Added (APPROXIMATED): destination ring on the floor; A* only when the straight line crosses furniture; interaction spot = side of the object's footprint closest to the room centre, facing the object; smooth turn to the viewer before Stroked. No interaction camera: not needed, the original camera frames the whole visible half of the room.

## 5. Tests (`tests/e2e/m8-loop.smoke.mjs`, headless Chromium + SwiftShader)
36/36 checks PASS, 0 console errors, 0 invalid transitions, 0 missing clips, 8/8 sound tables, missing audio = only the 2 documented files. Scenarios: enter (door + greeting), idle, click floor, walking + marker, click Mii while walking (interrupt), reaction (Stroked), click during reaction ignored, balloon + menu, "Chiedi qualcosa!" → noQuestion → OK, click chest → path → spot → CheckTheBox, click during interaction ignored, nod, return idle, plant interaction, burst of 12 mixed clicks + keys, door → goodbye → outside (BGM NOBODY), re-enter, camera follow, camera free, wall/floor change + walk, keyboard walk. Time is driven by `simRoom()` with real-time updates paused (`__mtw.testClock.paused`).
Regression: `m7-room.smoke.mjs` same trajectory as the M7 run (differences ≤ 0.1 u, real-time jitter; state name `react` → `reacting`); `m6-wardrobe.smoke.mjs` same parts / scale / exclusions for all 32 shots (accessory root positions differ ≤ 0.02 u from the idle phase); `bodyscale.test.mts` ALL PASS; `msbt.test.mts` 5/5.
Evidence: `evidence/m8/` (m8-01-enter … m8-12, m8-evidence.png, desktop/mobile, report.json).

## 6. Open
- Emotion / ExpressionRule → face and gesture while talking; Mii voice (murmursound rate); balloon wobble animation (balloonC0xx frames) and the exact NACCBBalloon composition.
- Real SequenceTouch / SequenceGreeting flow (needs the server data it waits for), RoomMainLayer movement and camera code, dragging the Mii (PickUp / Fall / TouchLanding).
- "Sai, di recente...", messages, greetings editor, room decoration: server or later milestones.
