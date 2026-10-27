# AUDIT-PLAY.md — PLAY vs the original Miitomo 2.4.0 (M17 + final audit M17b, 2026-10-26)

Compared against: the APK 2.4.0 (libcocos2dcpp.so RTTI / .rodata, userData XML, layouts), the CDN set (23 layout
families, 20 sound zips), MSBT/MSBP (EUit), animations and UI atlases already recovered. MiiWiki
(miiwiki.org/wiki/Miitomo, Category:Miitomo, Erica, gallery) was read as an **external reference only**: anything only
the wiki says is marked WIKI and is never presented as original data.

Classes: VERIFIED · REVERSED · DEDUCED · APPROXIMATED · SERVER DATA MISSING · WEB ADAPTATION · WIKI.

## 1. Fixed in M17 (each with a regression check in tests/e2e/m17-parity.smoke.mjs)

| Gap reported / found | Cause | Fix | Class |
|---|---|---|---|
| Guardaroba: "only tops" | 8 text tabs overflowed a 460 px panel (Calze, Scarpe, Accessori hidden behind a horizontal scroll) | the original 9 **icon-only** buttons of `userData/closet_icon_data.xml` (Recenti, Preferito, Maglie+lunghe, Completi, Pantaloni/gonne, Cappelli, Calze, Scarpe, Accessori) in one row | VERIFIED (table) / DEDUCED (meaning of 416 = recent, topslong in the tops tab) / WEB ADAPTATION (tooltips) |
| closet functions | not built | Togli / Rimetti, Dentro / Fuori (tuck, flag REVERSED), colour counter n/m, ★ Preferito (favourite outfits, local), "Vuoto.", sort Nuovo / Vecchio | ORIGINAL labels (Layout/shop, cmnSectionBtn00); limit of 50 favourites WEB ADAPTATION |
| closet camera | fixed | pinch / wheel zoom, drag rotate, pan, double tap reset from `closet_camera.xml` (min_scale 0.38 … 1, min/max_lookAt, speeds 4 / 10) | VERIFIED data / DEDUCED mapping |
| T-pose flash after every outfit change | rebuild → director.restore() faded from the bind pose | restore keeps the idle clip and its time, no fade | fix |
| bottom bar: coloured squares | placeholders | RoomMenuRootNode icon table (.rodata 0x1895b19…: icon500 home, 513 my page, 202 friends, 400 shop, 515 menu, 514 profile), tabBtn00 base bulletTab00/01, labels tabBtn00/01, font nintendoPSeurat-M003, selected state | REVERSED / ORIGINAL; order from the table DEDUCED |
| friend-room bar | text buttons | tabBtn01 labels (Risposte, Articoli, Amici, Profilo) + icons | ORIGINAL / DEDUCED (Articoli = shop icon) |
| Modifica Mii: 3 properties | no editor | Mii Studio editor over FFLiCharInfo: face (shape, wrinkles, make-up, skin), hair (type, colour, flip), eyebrows, eyes, nose, mouth, moustache, beard, glasses, mole (type, colour, position: up/down, spacing, size, proportions, rotation), physique (height, build), profile (nickname, gender, birthday, favourite colour, personality, voice); undo / redo / Azzera | icons + chips + category buttons ORIGINAL (CDN miiStudio layout); grid order REVERSED (.rodata string tables); every edit FFL-verified; control names WEB ADAPTATION |
| personality result "MISSING" | **wrong earlier**: the texts are in `Layout/common/parts/characterInfo00` + `characterInfoTitle00` | 4 groups (Riservato, Deciso, Tranquillo, Espansivo), 16 types (Taciturno … Dinamico), first impression + long description; index n = personalityIndex + 1, confirmed by the reversed type table | ORIGINAL texts, DEDUCED index (checked) |
| "Sai, di recente…" did nothing | disabled stub | original flow: loading → provider → original empty state `knowledgeNothing` "Non ci sono ancora risposte di amici." + **SERVER DATA MISSING** label (error path: System/Error 1450) | ORIGINAL texts / SERVER DATA MISSING content |
| friend-room / Mii Studio / shop / closet / Miifoto / decorating music silent | import filter `sound(_x)?.zip` refused `sound_BGM_MiiWatch_Friend_Cool_mp3.zip` etc.; keep rule only kept BGM_MiiWatch_* | filter fixed; all scene BGMs kept (cold, loaded on demand); original per-scene keys of `Sound/Action/bgm.msbt` wired (bgm_closetSceneInit, bgm_shopSceneInit, bgm_cameraAppSceneInit, bgm_miiStudioSceneInit, bgm_miiStudioConfirmCharacter<Type> on the personality result, bgm_CustomRoomScene) | ORIGINAL table; confirm-character = result step DEDUCED |
| Mii Studio layout not imported | not in the source filter | added (KEEP_VERSION 5 re-reads it and sound.zip) | fix |

## 2. CAMERA PLAY: VERIFIED/REVERSED — fixed camera; no original user-facing camera-switch control found

**Framing on PC — WEB ADAPTATION (M18b):** the original phone screen is portrait; on a landscape PC window the unmodified camera cut off the front of the floor and the Mii's legs. In PLAY the same camera is moved back along its own view axis (same direction, same FOV, still fixed, no user control) just enough for the back wall top and a Mii's feet at the front of the walkable floor to fit above the bottom bar (and the floor width on narrow windows), then re-centred with a vertical lens shift (projection offset, no rotation) — `room/RoomFraming.ts`, test `tests/unit/framing.test.mts` + m18. The Lab keeps the raw original camera.
Checked: every room layout (body / parts ccbi), RTTI and .rodata (CameraController = device camera for photo → Mii;
CameraMoveTo / CameraLookAtTo / MiiRotateYAxisBy = Mii Studio scripted actions; CustomRoomCameraController = room
decorating), all EUit texts (no view / zoom wording), userData (camera XMLs exist only for closet, profile, Alter Mii
center screens), the room data (one camera: doorAnim node `persp`). Decision (user, 2026-10-26): the PLAY room is
fixed-camera. Implemented and tested (m17-parity): no camera button, no drag / wheel / pinch camera on any PLAY stage
(room, creation, Mii Studio), no auto-rotation; user zoom / rotation only in the closet (closet_camera.xml; profile
will use profile_camera.xml); free / debug cameras exist only in the Lab (?lab=1).

## 3. Native scenes (38) and their state in PLAY

| Scene (RTTI) | PLAY | Missing / blocked | Class of the gap |
|---|---|---|---|
| LaunchScene, FirstLaunchScene | boot, tips, first run | EULA / Fujiyama account dialogs | not applicable (Nintendo services) |
| RoomScene | room, entrance, touch menu, greetings, gestures, effects, sound | room status (coins, style, popularity, ranks), login bonus, campaigns, posters, Alter Mii buttons, birthday sequence, letters, rank-up | status/bonus/campaign/rank = SERVER DATA MISSING; posters, Alter Mii, birthday (BGM_HAPPY_BIRTHDAY, birthday_1/2 lines) = **buildable locally** |
| ClosetScene | M17 closet | — | — |
| MiiStudioScene | M17 editor + creation | QR Code (scan), photo → Mii, voice presets, "Intonazione", name pronunciation, birth year | QR file import = buildable (decision needed: Mii QR decryption); camera → Mii = unknown native analyser; presets / intonation = buildable from layout |
| ConfigGreetingScene | Saluti | — | — |
| MenuScene | 6 items | Notifiche, Scatola dei regali, My Nintendo Premi, Profilo, QR Code, Altro, Bonus del giorno, Gestione account | My Nintendo / account = never (Nintendo services); gifts / bonus / notifications = SERVER; Profilo / QR / Altro = buildable |
| ProfileScene | — | own profile page (intro text "testo del profilo", completi creati, Miifoto count, ranks) | intro / counts buildable locally; ranks SERVER |
| ShopScene | M15 catalogue | sorting (Alfabetico / Nuovo / Vecchio buildable; Popolare / Caro / Economico SERVER), shop tabs from `shop_icon_data.xml` (icon416, 411, 410 + categories), cart / purchase / coins | economy disabled by decision |
| CoinPurchaseScene, RefundScene | — | real-money purchase | never (decision: no real money) |
| PhysicGameScene (Miitomo Drop, candy, interior) | — | the whole game | layouts + BGMs present; board / prize tables to be checked (prizes = SERVER); WIKI confirms the pachinko format |
| KnowledgeScene, CommentListScene, LikeListScene | — | answers, comments, hearts | SERVER DATA MISSING (question DB); UI + empty states buildable |
| ChSpecificScene, ChCoordeScene, ChMiiScene, ChMiiKnowledgeListScene | — | Centro risposte / stile / Alter Mii | SERVER |
| AddFriendScene, MiiInformationScene | M16 local friends | requests, codes, SNS, face-to-face, block / report | SERVER (our backend later) |
| SendLetterScene, LetterHistoryScene | — | letters (Francesca / Erica letters, friends) | tutorial letters ORIGINAL texts = buildable; friends' letters = backend |
| SubMiiListScene | — | Alter Mii (stock Miis with rooms) | **buildable locally** (multiple own Miis) |
| AlbumImageDisplayScene, FotoLogScene, PosterDisplayScene, PaperCorinthSelectScene | Miifoto export only | local album, poster frames, registro Miifoto | album / posters buildable; registro = SERVER |
| StarAccountListScene, MissionScene | — | star accounts, My Nintendo missions | SERVER / never |
| ReportScene, TouchAdminScene, WebViewWithCaptureScene, Captured/FatalErrorScene, TerminatedScene, ResumeScene | — | moderation, admin, web views | not applicable |

## 4. Other notes
- The 16 MiiWiki personality pages give English names from *Tomodachi Life* (WIKI). Not used: the Italian originals
  are in the files.
- WIKI corroborates: Erica = "Francesca" in the Italian letters (tutorialLetter*), "Rispondono tutti" event
  (bonusQuestion1), Miitomo Drop, QR cross-compatibility with Tomodachi Life (voice + personality), music list.
- Audio still unused: rank-up jingles, birthday, Miitomo Drop set (all in sound.zip; now imported).

## 5. Next (proposed order)
1. Birthday sequence (local data: birthday + BGM + lines), Alter Mii (local), own Profilo page.
2. Shop: original tab set from shop_icon_data.xml + local sorts; Menu: Profilo / QR / Altro entries.
3. Friend visiting the user's room (two Miis) — M16 step 2.
4. Miitomo Drop feasibility study (board assets, physics data; prizes server).

## 6. Final audit (M17b) — the elements asked for, one by one
Classes: VERIFIED · REVERSED · DEDUCED · APPROXIMATED · SERVER DATA MISSING · NON PRESENTE NELLA VERSIONE RECUPERATA ·
WEB ADAPTATION. "Buildable" = can be rebuilt from the user's files without inventing content.

| Element | Evidence (APK / native / CDN / layout / MSBT) | Class | In PLAY | Buildable locally |
|---|---|---|---|---|
| Room top controls | no single "top bar" body in the room layouts; the room UI root is code-built (RoomUIRootOnGameLayerNode, RoomReturnMiiButtonNode, RoomWatchButtonNode, RoomCampaignNode); parts: roomStatusRoot00/01, returnBtnRoot00/01, miiOpenCloseBtn00, campaignBtn00, candyIcon00 | REVERSED (names) / DEDUCED (placement) | — | the parts below, one by one |
| Lock public / private | miiOpenCloseBtn00 (icon545 lock / icon546 open); dialog002 stockMiiChangeToPrivate "Se rendi questo Mii privato, i tuoi amici non lo vedranno quando visitano la tua stanza" | VERIFIED (layout + text) — it applies to **Alter Mii** | — | with Alter Mii (local) |
| "Torna al mio Mii" | returnBtn00 (btnBase04 + dummyMii = the Mii's face); native "[MiiList] sendBack … is absence" — calls your Mii back when it is out visiting | REVERSED / DEDUCED (trigger) | — (Home in the friend room) | with the "your Mii goes out" visits (next phase) |
| Bonus del giorno | menuBtn04 loginBonus00, Layout/loginBonus, LoginBonusCalendar, SubSeqRoomLoginBonus, /v2/login_bonuses | VERIFIED UI / **SERVER DATA MISSING** (rewards, calendar) | — | UI + empty state only |
| Caramelle | profileDataWindow01 "Caramelle:", DropObjectCandy, bannerGameCandy, physicGameCandyUI, models itemCandy / itemBoardCandy, shopCandyTopImageList | VERIFIED assets / **SERVER DATA MISSING** (balance, earning, spending) | — | no (economy) |
| Monete | profileDataWindow01 "Monete Miitomo:", Error 1210, CoinPurchaseScene, /v2/payment, /v1/inventories | **SERVER DATA MISSING**; real-money purchase = never | economy disabled (M15) | no |
| Biglietti | "Biglietti:", gameticket / ConsumedTicketNum (Drop tickets) | **SERVER DATA MISSING** | — | no |
| Stile / Popolarità | roomStatusFashion00 / Popular00 "Liv. {n}" (max 50), profileRankWindow00 (levels + points), System/RankName (50 titles each), rankUp* lines + BGM; points from FashionabilityTakeFashionabilityAction / AffectionTakeAction | VERIFIED texts / **SERVER DATA MISSING** (points, levels) | — | display only with "—"; no invented points |
| Alter Mii | SubMiiListScene, SequenceTalkMyStockMii, selectMiiRoom / miiFaceBtn00, Tips03 "gli Alter Mii hanno una stanza", album "Puoi aggiungere ancora {n} Mii"; Centro Alter Mii (ChMii*) | VERIFIED / REVERSED; Centro = SERVER | — | **yes**: several own Miis with rooms (Centro: no) |
| Profilo | ProfileScene, Layout/profile (stats window, personality chart, rank window, profile text "Scrivi testo del profilo"), profile_camera.xml, bgm_roomMiiProfile | VERIFIED | partial (La mia pagina) | **yes**: stats that are local (completi creati, cambi di vestiario, risposte date = 0), chart, profile text; ranks = SERVER |
| QR Code | QRCodeMenuScene, Layout/qrCode (personality card typeNode00, share buttons), Mii Studio QR scan + history, jp/co/nintendo/naqr | VERIFIED UI / REVERSED (names) | — | QR **card** yes; reading / writing Mii QR data needs the Mii QR format — decision needed (see §7) |
| Scatola dei regali | menuBtn01 presentBox00, MenuPresentBoxLayer, "La scatola dei regali è vuota." | VERIFIED UI / **SERVER DATA MISSING** | — | empty state only |
| Sgancia Mii (Miitomo Drop) | PhysicGameScene, 37 stage zips (stage.ccbi boards: pins, walls, dishes, moving / rotating layers, prize slots gift0..3), 4 layout families, physicGameGimmick, 13 game banners, 10 BGMs, Chipmunk physics (cpSpace) | VERIFIED boards + UI / REVERSED engine name / **SERVER DATA MISSING** (prizes per slot, costs, ticket rules) | — | board + physics play **possible** (APPROXIMATED physics); prizes = never invented |
| Rispondono tutti | RoomSceneTalkWords bonusQuestion1, KnowledgeGetAvailableBonusQuestions, JP event icon (WIKI) | VERIFIED line / **SERVER DATA MISSING** (questions) | — | no |
| Notifiche | menuBtn01 notification00, MenuNotificationLayerWithCapture, KnowledgeWindowNotification00, settings switches notice00..11, push | VERIFIED UI / **SERVER DATA MISSING** | — | empty list + switches (no effect) |
| Eventi / campagne | RoomCampaignNode, SubSeqRoomNewCampaign, campaign00, incentive "Aggiungi amici per ottenere monete" (ended), corinth banners, Everybody-answers | VERIFIED UI / **SERVER DATA MISSING** (schedules = /v1/schedules masters) | — | no |
| Miifoto / condivisione | Miifoto editor (M12, done), album (albumTop / Edit / Import / Get, favourites), registro Miifoto (FotoLogScene), SNS / mail / iMessage share (album + qrCode shareBtn) | VERIFIED; registro + received = SERVER | Miifoto editor + PNG export | local album **yes**; SNS share = WEB ADAPTATION (download / Web Share) |
| Amici / visite | telopWindow00 comeFriend / absence / absenceAndComeFriend / absenceLetter*, comeBackFirst, SequenceByeFriendInUserRoom / InFriendRoom, greetings tags 1.2–1.5, bgm FRIEND_* | VERIFIED / REVERSED | visit to a friend's room (M16); **a friend entering the user's room (M18, two Miis)** | the user's Mii going out (absence telop, "torna al mio Mii") |
| Lettere | SendLetterScene, LetterHistoryScene, sendLetter* / receiveLetter* / tutorialLetter* (Francesca), DecoratedLetterSE, LetterFace | VERIFIED texts | — | tutorial letters + letters between local profiles: buildable; friends' letters = backend |
| Compleanni | SequenceBirthday, birthday_1/2, greetingBirthday, friendBirthday icon541, birthdayLetter*, BGM_HAPPY_BIRTHDAY | VERIFIED | — | **yes** (local birthdays) |
| Suoni: Musica / Effetti / Voce | Layout/menu switchNode00 snd00..02 | VERIFIED | **fixed in M17b** (three switches, saved) | — |
| Saluti: ascolta | greeting00 contains soundBtn01 (play) | VERIFIED (layout) / DEDUCED (plays the greeting) | preview balloon on save | small fix possible |

### Correction found during the audit (fixed): personality type order
Engine type (0x5be42c) = **0 Cool, 1 Dry, 2 Nagomi, 3 Nori** — REVERSED from three native paths (0x95c218/0x95d0b0
table [2,3,4,5] → 0x98b934 ConfirmCharacter switch; bgm_room line type+2; 0x10edd8c face byte switch), confirmed by the
QR card keys and the group texts. The earlier order (Nagomi, Nori, Dry, Cool) was the attribute order of the rule
struct: every personality used another personality's gestures, faces and friend-room music. Fixed in
room/Expression.ts (PERSONALITIES), tests updated to take expected gestures from the rule data.

## 7. Decisions needed later (not blocking the next phase)
- Mii QR codes: reading / writing them means implementing the Mii QR data format (encrypted payload). It is a data
  interchange format, not access control, but it embeds a Nintendo key: to be decided by the user before any work.
- Sgancia Mii: playable boards without prizes (or with prizes from the closet catalogue, clearly marked APPROXIMATED)?
