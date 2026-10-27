# NATIVE.md — native libraries of Miitomo 2.4.0 (armeabi-v7a)

| Library | Size | Role | Confidence |
|---|---|---|---|
| `libcocos2dcpp.so` | 28.9 MB | Engine + **all game logic**, AFL Mii library, effects, Mii-from-photo | High |
| `libsakasho.so` | 1.0 MB | DeNA **Sakasho** client SDK: API URLs, request signing, body obfuscation (LZ4), 251 API calls | High |
| `libNuanceVocalizer.so` | 3.3 MB | Nuance Vocalizer TTS engine (Mii voices; `nttsmiivoice`, `NTTSMiiVoicePlayOpenSL`) — ARMv5TE | High |
| `libmobageemoji.so` | 13 KB | Mobage emoji mapping | Medium |
| `libcrashlytics*.so` | 180 KB | crash reporting (irrelevant to port) | High |

All ELF32 ARM, stripped of `.symtab`, but **dynamic symbols and C++ RTTI are present**.

## libcocos2dcpp.so dependencies
`libNuanceVocalizer libsakasho libjnigraphics libOpenSLES libGLESv2 libGLESv1_CM libEGL libandroid liblog libz libdl libc libm libstdc++`
→ rendering GLES2, audio OpenSL ES, bitmaps via jnigraphics. Every one of these is an Android-only boundary that an
in-browser ARM emulator would have to re-implement.

## Subsystems identified (from exports + RTTI)
| Namespace / prefix | Meaning | Evidence |
|---|---|---|
| `AFL*` (`AFLiCharModel`, `AFLiFacelineTexture`, `AFLiDatabaseRandom`, `AFLiRFLCreateID`, `AFLiStoreDataCFL`, `AFLiShader*`, `AFLiResourceLoader`) | Miitomo's Mii face library — 1:1 naming with Wii U **FFL** | exports |
| `nn::mii::*` (`CharInfo`, `StoreData`, `CoreData`, `Nickname`, colour getters, `VerifyCoreData`) | Nintendo SDK Mii data API (NX-style) | exports |
| `mw::mpf::*` (`MPFRecognition`, `MPFNigaoe`, `MPFPartsSelect`, `CharInfoForAFL8`) | Mii-from-camera face recognition ("nigaoe" = likeness) | exports |
| `nw::eft2::*` | NintendoWare particle effects v2, data `assets/asset/effect/effect.ptcl` | exports |
| `CPVRT*` | PowerVR SDK: POD models, PVR textures | exports |
| `messagestudio::*` | MessageStudio runtime for `.msbt`/`.msbp` text | RTTI |
| `sakashoHelper::*` (404 RTTI) | game-side wrapper around Sakasho API + caches | RTTI |
| `agx::*`, `CameraApp`, `Album`, `CustomRoom`, `closet` | camera/Miifoto, rooms, closet | RTTI |
| `NACCB*`, `NA*` | custom CocosBuilder nodes, transitions, webview, pickers | RTTI |

## Game-level classes (selection, full list in reference-metadata)
- Boot: `AppDelegate`, `LaunchScene`, `StartLayer` (`stateCommonFileDownload`, `stateStageFileDownload`), `LaunchDownloadLayer`, `FirstLaunch*` (EULA, age, country, language, login).
- Room: `RoomScene`, `RoomMainLayer`, `RoomTabWindow*`, `RoomWatch*Controller`, `Sequence*` (`SequenceTalkKnowledge`, `SequenceGreeting`, `SequenceBirthday`, `SequenceWatchFriend`…), `SubSeq*`.
- Q&A ("Knowledge"): `KnowledgeScene`, `SubSeqAskKnowledge`, `ListContentKnowledge*`, `CommentList*`.
- Channels: `ChMii*`, `ChCoorde*` (outfit sharing), `ChSpecific*` (interviews/themes).
- Friends: `AddFriend*` (face-to-face, contact list, SNS, GPS), `StarAccountList*`.
- Mii: `MiiStudioScene`, `MiiStudioEditSequence`, `MiiFromCamera*`, `MiiFromQRCode*`, `Mii3DNode`.
- Economy: `ShopScene`, `ShopSeq*`, `ClosetScene`, `CoinPurchaseScene`, `LoginBonusCalendar`, `MissionScene`, `Poster*`.
- Miifoto / photos: `FotoLog*`, `CameraApp`, `Album*`, `PaperCorinth*` (photo templates — Medium).
- Mini-game: `PhysicGameScene`, `NACCBPhysic*`, `DropObject*` = **Miitomo Drop** (Medium).
- Letters: `SendLetter*`, `LetterHistory*`, `LetterForwarding*` (text animation styles: Karaoke, PoyoPoyo, FuwaFuwa…).

## JNI boundary (64 exports, `reference-metadata/miitomo-2.4.0.jni-exports.txt`)
- `org.cocos2dx.lib.Cocos2dxRenderer.native*` — render loop, touches, text input (stock cocos).
- `jp.co.nintendo.AULActivity.native*` — URL intents, push notifications, image picker, share, permissions, memory warning.
- `jp.co.nintendo.NAWebViewAccessor/NAWebViewHelper` — embedded WebViews with JS callbacks (some UI is HTML).
- `CameraAccessor`, `NAGyroscope`, `NADatePickerAccessor`, `NAPickerViewAccessor`, `NAManagedDataActivity`.
- `NativeSystem.nativeNotifyRooted / nativeIsProductAndOver / nativeAbort` — root detection.
- `AppActivity.isDownloadAssetModeEnabled / isPassCodeMode / isWebInspectorEnabled / isLoggingEnabled` — debug flags.
- libsakasho: `SakashoSystem.getApiBaseURL/setCommonKey/getBuildId`, `CookedRequestBody.cookRequest`,
  `CookedResponseDelegate.cookResponse`, `SakashoRequest.generateRequestSignature`, NPF/BaaS auth callbacks.

## libsakasho function map (named so far)
| Address (Thumb) | Name (ours) | Status | Notes |
|---|---|---|---|
| `0x39631` | `Java_..._getApiBaseURL` | REVERSED | calls `0x3a4cc`, `NewStringUTF` |
| `0x3a4cd` | `sks_getApiBaseUrlForEnv(int)` | REVERSED + emulated | envs 2003–2011, 10000 |
| `0x3a769` | `sks_getEmojiMapForEnv(int)` | RESEARCHED | used by getEmojiMap |
| `0x3a9bd` | `sks_getSupportUrlForEnv(int)` | REVERSED + emulated | |
| `0x3a685` | `sks_decodeObfString(src,len,key,dst)` | RESEARCHED | step 1 = per-byte bit reversal, then two transforms (`0x3e664`, `0x3e6fc`), strncmp check |

## Tools
- `tools/binary-analysis/disfunc.py` — Capstone disassembly with literal-pool annotation.
- `tools/binary-analysis/emu_call.py` — Unicorn emulation of a function with libc import stubs.
- `tools/binary-analysis/xrefs.py` — direct-branch xrefs.

## Port implication
ARM32-in-browser emulation would need: JNI + ~60 Java callbacks, GLES2→WebGL, OpenSL→WebAudio, jnigraphics,
WebView-in-canvas, libcurl networking, NPF auth, Nuance TTS (ARMv5). Not ruled out formally, but no evidence yet that it
beats reimplementation. To be benchmarked before any decision (see ARCHITECTURE.md).

## libcocos2dcpp function map (session 2, 2.4.0 SHA256 b76c844d…)
| Address | Name (ours) | Mode | Status | Notes |
|---|---|---|---|---|
| PLT 0x2693b0 | `AFLSetScale` stub | ARM | VERIFIED | callers 0x59f644, 0x8e0cec pass 0.1 |
| PLT 0x268f3c / 0x268f48 | `AFLDrawXluWithCallback` / `AFLDrawOpaWithCallback` | ARM | VERIFIED | via `tools/binary-analysis/pltmap.py` |
| 0x55ace4 / 0x55ada8 | `AFLObject::drawOpa/Xlu` | ARM | REVERSED | builds AFLShaderCallback, calls AFLDraw*WithCallback, then cull state |
| 0x55ae60 | `AFLObject::onDrawParam` (shader callback) | ARM | REVERSED | uniforms, colour ×230/255 rule, material by modulateType, mask blend |
| 0x558d74 | `agx::AFLObject::AFLObject()` | ARM | REVERSED | vtable 0x1adb874 via GOTOFF literal 0xfff6e9c8 |
| 0x5c0988 / 0x5c08f0 | make_shared AFLObject / MannequinHead | ARM | REVERSED | |
| 0x5bf644 | `Character::setupHead` (ours) | ARM | RESEARCHED | stores head at +0x3cc/+0x3d0, attaches "headwear"/"headwearClone" |
| 0x5c49f8 | `getJointWorldMatrix(out, node, name)` | ARM | REVERSED | parent matrix × skeleton query (vtable+0x5c) |
| 0x10e8c9c | `Mat4::getTranslation` (ours) | ARM | RESEARCHED | |
| 0x7484fc | face focus = T(Head)+(0,3,0) | ARM | REVERSED | const 3.0 @0x1b751f0 |
| 0x309dc4 | static init of a TU's std::string globals | ARM | RESEARCHED | base GOT+0x448ec = 0x1bb1790 ("Head" at +0xf0) |
| rodata 0x1b75038… | AGX feature-define name table | data | VERIFIED | |
| rodata 0x1b75094… | attribute/uniform name table | data | VERIFIED | indices used by callback |
GOT base (DT_PLTGOT) 0x1b6cea4. Most game code is ARM mode and uses GOT-relative (GOTOFF) literals.
New tools: `pltmap.py`, `callers.py` (ARM+Thumb BL/BLX), `armscan.py`, `armdataxrefs.py`, `vtables.py`.

## M6 additions (2026-10-25)
| Address | Role |
|---|---|
| 0x5d07b8 / 0x5d0724 / 0x5d0698 | body scaleA (height/build) — struct +0xa8/+0xac, +0xac/+0xb0, raw args |
| 0x5d09c0 / 0x5d0954 / 0x5d08f0 | body scaleB (uniform) |
| 0x5d084c / 0x5d0880 / 0x5d08b8 | height-only scale (no callers found) |
| 0x5c1c80, 0x5c49f8 | AFLObject update / getJointWorldMatrix: compute scaleA/B, pass to anim controller |
| 0x5d0534 | push scaleA/B to 8 clothing parts (container +0xdc…+0xf4, +0x118; part fields +0x1fc / +0x208) |
| 0x529d28 / 0x5255fc / 0x5257f0 | SkeletalAnimController vtbl+0x5c → blended joint world with per-joint scale rules |
| 0x5d4528 | accessory transform (table part+0x24c: TSW, SW, offset, Small*; defaults 0, 0.8, 0.1, 1.5, 0.6) |
| 0x5cb5cc | hide area materials outside PartRange (mask over table 0x1aa3fc4) |
| 0x5cb71c | set per-part colour vec4 on 7 clothing slots |
| 0x5c75b4 | clothing metadata ctor (Type/Silhouette/State/Gender = -1, PartRange @+0x88) |
| 0x577098 | PVRObject vtbl+0xa8: material index by name |

## M6.1 additions
| Address | Role |
|---|---|
| 0x1b7512c | accessory RootType → joint name table (8 entries) |
| 0x532404..0x532620 | Accessory/Emitter/Capture XML parser (RootType at +0x48, TSW +0x4c, …) |
| 0x5cd220 | outfit composer (struct AFLObject+0xe0: ids +0x3e..+0x4a, colours +0x38 nibbles, tuck +0x4e) |
| 0x10f8c58 / 0x10f8e4c / 0x10f904c / 0x10f9264 / 0x10f9470 / 0x10f9664 / 0x10f9858 | path builders: bodyAll / topslong / tops / bottomsA / bottomsB / shoes / acce |
| 0x10f9b38, 0x10f9ca8, 0x10fa080, 0x10fa1f8, 0x10fa370, 0x10fa4e0, 0x10fa650 | gendered-then-generic file lookup per category |
| 0x1b754fc / 0x1b75514 | state suffix table {"",In,St,Wd,Hi,Lo} / gender table {M,F,""} |
| 0x5bf4b4..0x5bf530 | capture path: tuck forced to St when there is no bottomsA |
| 0x55d320 / 0x55d42c | AFLObject::initCPUStepImpl lambdas → AFLInitCharModelCPUStep |

## M7 additions
| Address | Role |
|---|---|
| 0x1b7503c | AGX feature-define table (bit i → AGX_FEATURE_*), expanded by 0x58fce4 (caller 0x590a04) |
| 0x45f6bc… | static keys RoomMainLayer_mCameraEyePt / mCameraLookAt / mCameraDirInTouchScene / mGoToTouch{Owner,Guest}MiiPosition |
| 0x512924 / 0x512934 | strings animActionAppearFall / animActionAppearLanding (static clip-name table) |

## M8 additions (room loop)
| Address | Role |
|---|---|
| 0x1ab3c10 | SequenceTouch vtable (11 methods 0xaf4ce4…; lambdas updateTouchMii / setupFriendStockMii / saveAccountInfo use sakasho = server results) |
| 0xaf93d0 / 0xaf9a8c | SequenceTouch literals animActionTouchLandingFootStep / se_nade01 (static table: animActionStroked + character/arStroke.xml, PickUp, Fall, TouchLanding, Press, se_ui_hand_00/01) |
| 0x1b224e0 | SequenceGreeting vtable; 0x1ab36b4 SequenceBaseRoom; 0x1b22660 SequenceTalkKnowledge |
| 0x47ca34… / 0x47f290 / 0x480df8 | static std::string tables of RoomSceneTalkWords labels (fixedGreeting, fixedGreetingNight, customGreeting, noQuestion, mySubMii0) |
| 0x3574b8… | MiiCommonText labels (defaultGreetingWelcome / GoIn / GoodByeSeeingOff / GoodByeGoHome) |
Which sequence shows which label at runtime was not traced (the literals sit in static initialiser tables, not inside the sequence methods).
