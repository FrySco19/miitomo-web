# UI.md — interface architecture

- Native Cocos2d-x scenes built from **CocosBuilder** `.ccbi` (263 files, folders boot/common/menu/system/tutorial,
  exported "Published-iOS" at a phone resolution). Custom node classes `NACCB*` (buttons, balloons, table views,
  radar chart, physics sprites for Miitomo Drop, tablet-adjust node → there was a tablet layout path, Medium).
- Navigation: `NABaseScene/NABaseLayer`, transitions `NATransition{Next,Back}{Fade,MoveL,MoveR}`, `NATransitionSlideIn{L,R}`,
  `NANavigationBar`, tab windows in the room (`RoomTabWindow*`).
- Some screens are **HTML in WebViews** (`NAWebView`, `DialogWebView`, `WebViewWithCaptureLayer`, `UtilHtmlPreloader`) —
  probably news, help, EULA, My Nintendo. Those pages were server-hosted (support.miitomo.com) → lost unless archived.
- Text: MessageStudio `.msbt` with markup tags (`MiniTagParser`, `AttrbSentence`) and animated letter styles.
- Next: write a CCBI reader and render the boot/launch layout in the browser to measure fidelity.

## Room (M8)
- `asset_layout_v2-0_room/Published-iOS`: body/ (roomTouchBody00-02, talkBalloonBody00, roomWatchBody00, roomBottomBar00-04, roomTabWindow*), parts/layer1-4, texture-room (4 atlases). REVERSED from the CCBI string tables:
  `talkBalloonBody00` = `balloon00` (NACCBBalloon: nameLabel, textLabel, winArrow, appearAnim / disappearAnim / balloonAnimLoop) + `btnRoot` (ok00, onemoreBtn00, knowledgeHearMore, userMiiIn/Out);
  `roomTouchBody00` = roomTouchBtn00-02 + balloonMenu00 (btnIn/btnOut/balloonOut); `roomTouchBody01` = balloonMenuL/C/R (balloonTextBtn02/03), iconTextBtnLRoot, mslbl_title00.
- Atlases: `textureNN.pvr.ccz` = "CCZ!" + zlib → PVR v2 (RGBA4444 for texture00/01, A8 masks for 02/03, tinted at runtime) + TexturePacker plist. Decoded in the browser (`room/LayoutSprites.ts`). texture01 holds 38 speech-balloon shapes, texture00 the menu balloon, arrow buttons (nextBtn*), hand cursor, winArrow.
- Fonts: the CCBI names `HummingStd-B.otf`, which is not in the APK; the APK ships SeuratPro-B/M and nintendoPSeurat. The web build uses SeuratPro-B (DEDUCED substitute).
- Web adaptation (APPROXIMATED, our design): one balloon anchored above the Mii, the touch menu as a column of arrow buttons beside it (docked at the bottom of the stage under 600 px), status chip, pulsing badges on interactive objects, hand cursor over the Mii, Enter/Esc keys. See LOOP.md.
