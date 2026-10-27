# Reverse-engineering STATUS (living log)

Status vocabulary: RESEARCHED · REVERSED · REIMPLEMENTED · RUNNING · VERIFIED · BLOCKED
Confidence: **High** = observed directly in the binary/APK with a reproducible command; **Medium** = strong inference;
**Low** = community claim not yet verified.

## Milestones
| Milestone | Status | Notes |
|---|---|---|
| M0 APK inventoried | **VERIFIED** | 2.4.0 hashed, matches archive.org byte-for-byte; full file list in `reference-metadata/` |
| M1 Native architecture mapped | **RESEARCHED** (partial) | libraries, JNI boundary, engine version, 2,053 RTTI classes, subsystems identified. No function-level RE yet |
| M2 Asset loader | **RUNNING** (Mii resource only) | local import + SHA-256 verification of AFLResHigh_2_3.dat |
| M3 First authentic resource rendered | **VERIFIED** | Mii head parts from the original AFL resource, in browser |
| M4 Mii/avatar rendering | **VERIFIED** (head) | FFL WASM via FFL.js; 70 expressions incl. 51 Miitomo-only; user-accepted vertical slice |
| M5 Mii body + full Mii | **RUNNING** (1 body: bodyAll0400) | original POD/PVR body, GPU skinning in the original APK shader, idle animations, head attached; see MII.md for VERIFIED/INFERRED/APPROX per item |
| M5b Original shader | **RUNNING** | APK LUT.vsh/fsh + AGX variants + original LUT TGAs + default_scene.xml lights + mii_model.xml; A/B vs FFL.js approximation measured |
| M6–M20 | not started | |

---

## 2026-10-25 — Session 1: Phase 0 + Phase 1

### 1. Reference build acquired and verified — High
- Source: user's local copy `Miitomo_2.4.0_APKPure.apk` (archive.org was unreachable from both analysis environments).
- size 36,522,963 · MD5 `904c5a62c42f723f36a619b691ec8067` · SHA1 `3f3c98f3757a5017cd10efc23670248abd88cc64` · CRC32 `8091cf43`
- SHA256 `4b408fcdd2177c6cb8a5c38d622ec5971769cb8cb70dc3907c6476cceecae1de`
- **Evidence:** MD5/SHA1/CRC32/size are identical to `Miitomo_com.nintendo.zaaa_2.4.0.apk` in archive.org item
  `miitomo-android-archive` (metadata API). The APKPure copy is therefore the original archive file, unmodified.
- Package `com.nintendo.zaaa`, versionName 2.4.0, versionCode 108500, minSdk 16, targetSdk 24, built against API 23.
- Signed **v1 (JAR) only**, cert "Nintendo Co., Ltd., Kyoto, JP", RSA-2048/SHA256, valid 2015-12-25 → 2043-05-12,
  cert SHA256 `1bc2c25d008bfd03023c1ba60140dfd2c17f850a4ad5250388e2cf292e02167d`.
- Details: `reference-metadata/miitomo-2.4.0.catalog.json`, `...component-hashes.txt`.

### 2. ABIs — High
- `lib/armeabi-v7a/`: 6 libs. `lib/armeabi/`: only `libmobageemoji.so`. **No arm64-v8a, no x86.**
- `libcocos2dcpp.so` (28.9 MB) is ARMv7-A, Thumb-2, VFPv3 + NEON, soft-float ABI. Confirms the 32-bit-only claim.

### 3. Engine — High
- Cocos2d-x **3.4** (string `cocos2d-x 3.4`), libc++ (`std::__1`), clang 3.6 + GCC 4.8/4.9 objects.
- Bundled third party in libcocos2dcpp: OpenSSL 1.0.2g, libcurl, libpng 1.6.2, CocosBuilder reader (`.ccbi`),
  cocostudio/flatbuffers, Spine, PowerVR SDK (`CPVRTModelPOD`), CocosPlay client.
- Engine is customised: `NAAssetsManagerEx`, `NAManifest`, `NAHttpClient`, ~60 `NACCB*` CocosBuilder node types.

### 4. Where the logic lives — High
- **Game logic is native C++** in `libcocos2dcpp.so`. RTTI type names are intact: **2,053 classes**
  (`reference-metadata/miitomo-2.4.0.rtti-classes.txt`) incl. all scenes/sequences/layers.
- 13,076 defined dynamic exports (mostly engine/libraries); game classes are mostly hidden (RTTI only).
- Java (8,159 smali classes) is ~95% third-party SDKs. First-party Java ≈ `jp.co.nintendo` (114), `org.cocos2dx`(97),
  `jp.dena.sakasho` (67), `com.miitomo.sdk` (45), `com.nintendo.npf` (145): platform glue, auth, billing, webview, camera.
- 64 JNI exports — see NATIVE.md.

### 5. Server endpoints decoded — High
- API base URLs are encrypted inside `libsakasho.so`. Decoded **by executing the original functions in Unicorn**
  (`tools/binary-analysis/emu_call.py libsakasho.so 0x3a4cd <envId>`), not by guessing:
  production game API `https://api.miitomo.com`, support `https://support.miitomo.com/`, plus dev/sandbox hosts and
  local mock `http://0.0.0.0:9292` / `:9293` (Rack default port → Ruby backend, Medium).
- 251 Sakasho API calls and 125 REST path fragments recovered (`/v1/...`, `/v2/...`). See NETWORK.md.
- libsakasho embeds server certificates for `*.miitomo.com` (DigiCert) and `*.sp.test.mbga.jp` → TLS pinning likely (Medium).

### 6. Critical asset finding — High
- The APK ships only **46 MB** of assets: UI layouts (263 `.ccbi`), texts (2,034 `.msbt`, 12 locales), fonts, UI sounds,
  shaders, **one** sample body/headwear/room model each.
- The Mii parts resource (`AFLResHigh_2_3.dat`, `AFLResMiddle*.dat`) and all clothing/room/headwear models were
  **downloaded at first launch** from `download-cdn.miitomo.com` (`StartLayer::stateCommonFileDownload`, manifest system).
- Community reports a 2018 Wayback snapshot of the CDN containing at least the AFL resources (not yet verified by us).

### Unknowns
- Which environment ID the shipping client passes (2007 → api.miitomo.com is the obvious candidate; not yet traced).
- Request obfuscation key derivation (community claim, see NETWORK.md) — not yet verified in the binary.
- Completeness of archived CDN assets (clothes, rooms, posters, themes). **This decides how much of Miitomo can be restored.**
- Whether `.ccbi` layouts reference only bundled textures or also downloaded ones.

### CDN survey done (see docs/research/CDN-SURVEY.md): 2,466 unique Android assets + manifest.json archived on Wayback.

### Next experiments
1. **CDN survey** (blocking question): enumerate Wayback captures of `download-cdn.miitomo.com/*` from a normal browser
   and record which asset IDs exist. Cross-reference with asset IDs referenced in the binary / masters.
2. **First authentic render (M3)**: TypeScript POD + PVR loader rendering the bundled `bodyAll0400` with
   `MiiDefaultShader` in WebGL2 — validates the asset pipeline on 100% authentic, locally imported data.
3. **CCBI → web layout** parser for one screen (boot/launch) to validate the UI reconstruction path.
4. Trace `SakashoSystem` init in smali/native to confirm env ID and the common-key path; verify obfuscation against
   `SakashoObfuscation` with a self-encoded round-trip.
5. Diff 2.3.2 → 2.4.0 native libs (Phase 3) once older APKs are available locally.

---

## 2026-10-25 — Session 1b: CDN manifest + first Mii renderer

### CDN catalogue — High
- `manifest.json` v2.0.1481 (plain JSON) lists 2,854 assets; **all 2,854 have a 200 Wayback capture** (docs/research/CDN-SURVEY.md).
- First integrity check: `asset_model_character_mii_AFLResHigh_2_3_dat.zip` MD5 = manifest MD5 `d8baf10772b58a29df37fdcddc51fb8f` ✓.

### Mii Lab (M4) — RUNNING
- `client/web` (Vite + TypeScript, Three.js 0.177.0, FFL.js v2.2.2). Decision: ADR-0001.
- **Evidence:** headless Chromium (SwiftShader WebGL2) e2e test `tests/e2e/mii-lab.smoke.mjs` imports the real .dat,
  builds random + fixture Miis, Miitomo expressions 0/1/25/49/56, both shaders, desktop 1600×900 + mobile 390×844.
  Screenshots: `docs/reverse-engineering/evidence/m4-*.png`. FFL init ≈30 ms, head build ≈40–90 ms (software GL), 6–7 meshes, 1–2k triangles.
- Build reproducible: identical bundle hashes on the analysis VM and on the user's PC VM (`npm ci && npm run build`).
- Published privately as an Artifact ("Miitomo Mii Lab") for manual testing (not verified inside the artifact frame by us).

### Known gaps
- Shader is an adaptation, not the original APK shader → APPROXIMATE look.
- Lighting/camera/background not yet matched to the in-game room scene.
- WASM is upstream-prebuilt (provenance TODO).
- No Mii body: Miitomo bodies are POD models (bodyAll*, tops, bottoms…) + skeleton animations (`*.Anim.pod`).

### Next experiments
1. M5 body: POD parser (TS) for `bodyAll0400` (in APK) + PVR decode; attach AFL head to body (head bone), compare with Miitomo screenshots.
2. Original-shader material: compile APK `LUT.vsh/fsh` with AGX_FEATURE_MII_* variants; A/B screenshots vs current.
3. CDN fetcher script for the user's PC (Wayback `id_` URLs, MD5-verified against manifest, local only).

---

## 2026-10-25 — Session 2: M5 full Mii

### Verified
- POD reader (TS + Python reference), PVR v3 + ETC1 decoder (bit-exact), TGA LUT reader: `tests/unit/formats.test.mts` 7/7 PASS.
- 7 CDN files downloaded by the user, all MD5 == manifest: asset_env, asset_env_mii, asset_env_scene, animation_output (304 clips), animWaitMale, animWaitFemale, animTstance.
- Head scale 0.1 from both `AFLSetScale` call sites; uniform table + AFL draw callback rules (colour ×230/255 set, mask blending); lights and head materials from original XML.
- e2e `tests/e2e/mii-full.smoke.mjs` (headless Chromium, SwiftShader WebGL2): imports APK-subset + AFL + 6 CDN zips, renders original/approx/A|B, bind/WaitMale/WaitFemale, desktop + mobile; **0 console errors**. Evidence: `evidence/m5/`.
- Reproducible build: identical bundle hashes on both machines.

### Inferred (documented, not yet proven in code)
- Head attached at joint `Head` with Rz(−90°); MII mode→define 1:1; body uses SKIN_MASK only; fill-light direction; lights in world space.

### Approximate / missing
- No frame interpolation; FPS field meaning unverified. Pose of the game's capture2 reference (arms straight) not identified.
- Texture passes (faceline/mask) via FFL.js FFLShaderMaterial, not AFL's internal shader.
- Mii body proportions: game scales joints by Mii height/build ("jointScale" list incl. Spine_1/Spine_2/z_Head/Arm…); NOT implemented → all Miis use default proportions.
- Brightness vs game capture2 differs slightly (capture uses another scene/camera: archCamera_scene.xml) — not resolved.
- Only bodyAll0400 (the one body in the APK); clothing layering (tops/bottoms/shoes/accessories, PartRange/Exclusion) not implemented.

### Next technical block
**Mii body proportions + outfit layering**: reverse the joint-scaling code (Mii height/build → JointScale/Spine/Arm scales; strings at rodata 0x1882c3x "jointScale|Spine_1|Spine_2|z_Head|Arm_1_L…") and the closet composition rules (PartRange areaChest…areaFoot, Exclusion categories, colour lists) so that any combination of tops/bottoms/shoes/accessories/headwear from the 2,854-asset catalogue renders like the game. Needs a CDN downloader script (MD5-verified) run on the user's PC.

## 2026-10-25 — Session 3: M6 proportions + original wardrobe

### Verified (headless Chromium/SwiftShader, `tests/e2e/m6-wardrobe.smoke.mjs`, evidence/m6/, 0 page errors)
- Body scale from Mii height/build, reversed from the binary (MII.md § M6), unit test 16/16 PASS; sweeps h/b 0…127 render without breaks; feet within 0.12 units of ground.
- Outfit composition on the original LUT shader + default_scene lights + animWaitMale: Outfit #1 = headwear0000 + bodyTops0000St (AL08) + bodyBottomsA0001Lo (AL01) + bodyShoes0001 (AL02) + base bodyBottomsB9999.
- Variants (tuck → In/Hi), exclusions (bodyAll0004 removes tops/bottoms/shoes; topslong0001 removes wide bottomsA0002), base-only body, A|B shading, M5 bodyAll0400 with scale.
- All 49 CDN sample files MD5-verified against the manifest (on device, and again in the container for the outfit files).

### Approximate / missing
- Skl_Root correction term k (assumed 1); Shadow joint rebuild; exclusion priority; tuck/variant logic; base-item occlusion; headwear ×10 and hat hair type; accessories not drawn.
- Tops `St` vs `Wd` choice untested against the game; no in-game reference for proportions yet.

## 2026-10-25 — Session 4: M6.1 wardrobe structure (exit criterion met)
- Exit criterion VERIFIED in headless Chromium (`tests/e2e/m6-wardrobe.smoke.mjs`, 32 screenshots, 0 page errors, evidence/m61/): customised Mii (height/build sliders) + all categories (hat, tops, bottomsA, bottomsB, shoes, accessory; full-body outfit and exclusions) + Wait animation over several frames.
- Added: accessories (RootType roots + transform), reversed variant selection, category order from cloth_data.xml, 4 hat types, male base, fixed random-Mii bug.
- Frozen for now: Mii/Wardrobe. Open items are listed in MII.md § M6.1.

## 2026-10-25 — Session 5: M7 first Miitomo room — RUNNING / VERIFIED in headless Chromium
- 6 CDN files MD5 6/6; APK rmWl0000/rmFl0000 identical to the CDN copies. Details in ROOM.md.
- `tests/e2e/m7-room.smoke.mjs`: 17 scene screenshots + desktop/mobile (evidence/m7/), 0 page errors. Covered: entrance through the door, idle, floor click → walk, touch reaction, furniture, exit + re-entry, appear (fall/landing), 3 cameras, 2 skins + a wall variant.
- M6.1 regression: same shading (differences only on outlines, from animation timing).
- Not done: RoomMainLayer movement/camera code, room UI layout (.ccbi), sound, guest Mii.

## 2026-10-25 — Session 6: M8 first offline gameplay loop — VERIFIED in headless Chromium (awaiting acceptance)
- Inputs: 3 more CDN files (EUit messages, Arch.msbp, sound.zip), MD5 3/3; sound tables + effects + font from the APK. Details and classification in **LOOP.md**.
- Implemented: MSBT reader (tag names reversed from Arch.msbp), original Italian room texts, sound driven by the game's own tables (door, footsteps, wave, nod, stroke, balloon, buttons, BGM day/night/empty room), texture-room sprite decoder (CCZ + PVR v2), deterministic state machine (7 states, transition table), touch reaction that interrupts walking, balloon + touch menu, 4 interactive objects (APPROXIMATED), grid pathfinding around furniture, destination marker, object badges, hand cursor, responsive menu.
- `tests/e2e/m8-loop.smoke.mjs`: 36/36 PASS, 0 console errors, 0 invalid transitions (evidence/m8/). M7 and M6.1 tests re-run: no regression.
- Not done: Mii voice (murmursound rate unknown), emotion/expression rules while talking, 2 audio files named by the tables but absent from every source, real server-driven touch / greeting sequences.
