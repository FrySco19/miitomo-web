# MII.md — Mii system in Miitomo

- Library: **AFL** inside libcocos2dcpp, structurally the Wii U **FFL** with NX `nn::mii` data code (High: class names
  `AFLiCharModel`, `AFLiFacelineTexture`, `AFLiMaskTexture`-family, `AFLiDatabaseRandom`, `AFLiStoreDataCFL`, `AFLiRFLCreateID`;
  `nn::mii::CharInfo/StoreData/CoreData`).
- Resource: `AFLResHigh_2_3.dat` (2.3.0+), downloaded; FFL-compatible container, 859 shapes / 365 textures per community (Low).
- Shader: `assets/shader/MiiDefaultShader.{vsh,fsh}` bundled (High). Community: derived from FFL shader, rim light absent (Low).
- Expressions: `assets/userData/afl_expression_data.xml` + `ExpressionAccessor`, `ExpressionRuleAccessor`, `EmotionAccessor` (High).
- Mii voice: Nuance Vocalizer TTS (`NTTSMiiVoicePlay`, `nttsmiivoice::*`) + `murmursound_*.raw` (High). The TTS engine is a
  licensed proprietary binary → the web version needs a substitute (Web Speech API / open TTS with pitch/speed mapping).
- Mii creation: `MiiStudio*` editor, `MiiFromCamera*` (mw::mpf face recognition), `MiiFromQRCode*` (QR import from
  3DS/Wii U, `MiiDecrypt` server call `/v1/mii_data_encryption/decrypt`), `nn::mii::VerifyCoreData`.
- Body: separate PowerVR POD bodies (`bodyAll####`) with clothes; Mii head from AFL attached to body (Medium).

## Existing open work to build on (verify before use)
- `aboood40091/ffl` — FFL decompilation (C++). `ariankordi/ffl` — fork that loads AFL resources.
- `ariankordi/FFL.js` — browser Mii renderer (Three.js). Demo exists. License not confirmed.
- `jaames/mii-assets` — extracts AFL/FFL meshes/textures to glb/png.
→ Mii rendering on the web is the **lowest-risk** major subsystem.

## Status 2026-10-25
- Resource verified: AFLResHigh_2_3.dat SHA-256 4a4be71d75162c20b48720ef89cd3d4e6cd4e8e21bcbc2aed63ee08d96de7722, header `FFRA`.
- Rendering RUNNING in browser via FFL WASM (ADR-0001). FFL.js license confirmed **AGPL-3.0-only**; ariankordi/ffl changes public domain.
- Shader in use for Miis in-room: `LUT` (has AGX_FEATURE_MII* variants, Medium). `MiiDefaultShader` = likely icons/fallback (Low).

---

## M5 — full Mii (original body + AFL head), 2026-10-25

Legend: **VERIFIED** = observed in data/binary and reproduced; **INFERRED** = consistent with all evidence, code path not located; **APPROX** = known deviation.

### Body asset `bodyAll0400` (APK `assets/asset/model/character/bodyAll/output/bodyAll0400`, zip without extension)
- `bodyAll0400.Mdl.pod`: PowerVR POD "AB.POD.2.0", units 0.01, 12 meshes / 1,486 tris, 54 nodes (12 mesh nodes + 42 joints), 10 materials, 1 texture name, **0 frames** (bind = T-pose). VERIFIED (`tools/asset-extraction/pod.py`, `client/web/src/formats/pod.ts`, unit test).
- Interleaved vertices (stride 52/56/60): position f32x3, normal f32x3, tangent f32x3, uv f32x2, bone weights f32x1..3, bone indices u8x1..3. One bone batch per mesh (palette ≤ 12, shader max 15). Weights sum to 1; indices within palette. VERIFIED.
- Skeleton: jointRoot > JointScale > Skl_Root (y 6.4, Rz+90°) > Spine_1 > Spine_2 > {Head > z_Head, Arm_1_L/R > Arm_2 > (Dummy_)Wrist > z_Wrist, Acce_Spine_2(_L/_R)}; Skl_Root > Waist > Leg_1 > Leg_2 > Ankle > z_Ankle, Skirt_{F,B,L,R}_1..z. Bind world: Head (0, 10.65, 0), z_Head (0, 12.1, 0). VERIFIED.
- Textures `textures/android/*_AL00|_MSK|_NRM.pvr`: PVR v3, ETC1, 512², 10 mips, orientation (x right, y **up**) → GL convention, upload without flip. Our ETC1 decoder is bit-exact vs texture2ddecoder on all 3. VERIFIED.
- `bodyAll0400.Mdl_model.xml`: every material = LUT shader, lighting on, LutFr `fresnelDefault02.tga`, LutSp `specularDefault02.tga`, LightSetIndex 0, cull Back, opaque, ONE/ZERO, samplers albedo/normal/mask enabled (alpha disabled), wrap MIRRORED_REPEAT, LINEAR/LINEAR (no mips). UserData ColorList (0.008 0.259 0.541), PartRange areaChest..areaFoot. VERIFIED.
- MSK texture: R = specular mask (78k px > 32), G = skin mask (hands/neck), B = max 47, 204 px > 32 scattered → ETC1 noise, no hair mask. → body variant uses `AGX_FEATURE_SKIN_MASK` only. INFERRED from data (variant-selection code not located). Game capture confirms hands take the head/skin colour.

### Animation (CDN `asset_model_character_animation_output*.zip`, 304 clips in the full pack)
- `.Anim.pod`: no meshes; per-node **local** 4x4 matrices, column-major, one per frame for animated joints (anim flag 8), single matrix for static ones. animTstance frame 0 == body bind pose exactly (R(q)·T check). VERIFIED.
- Skin matrix = World_anim(b) · World_bind(b)⁻¹. VERIFIED visually (WaitMale/WaitFemale give natural idle poses, no tearing).
- Header numFrame/FPS: WaitMale 39 frames, field FPS = 61; Tstance 2 frames, FPS = 120. Playback speed uses this field: UNVERIFIED (no interpolation between frames yet: APPROX).

### Head on body
- **Scale 0.1: VERIFIED.** Both callers of exported `AFLSetScale(float)` (PLT 0x2693b0) pass 0x3dcccccd = 0.1 (soft-float, r0) — call sites 0x59f644 and 0x8e0cec.
- FFL head bounding box (AFLResHigh_2_3): y 0.03 … 68.66 → origin at chin; ×0.1 = 6.9 body units. VERIFIED (measured).
- **Attach point = joint `Head`: INFERRED (strong).** Evidence: (a) game code computes "face focus" = translation(World("Head")) + (0, 3.0, 0) (0x7484fc…0x74856c, const 3.0 at 0x1b751f0) = eye height of a 0.1-scaled FFL head with origin at Head; (b) effects/balloons attach to "Head" with offsets (Mii3DNode 0x9582a8, 0x958b8c); (c) headwear0502 geometry in head space spans y 3.19–7.27 = FFL 31.9–72.7 (forehead → above hair top 68.7).
- **Orientation correction Rz(−90°): INFERRED.** The Head joint frame has its X axis along the bone (world +Y in bind); the FFL head is Y-up, so head-local = World(Head)·Rz(−90°)·S(0.1). Visually correct in bind, WaitMale, WaitFemale, side view. Code that sets AFLObject's model matrix not yet located.
- Head object = `agx::AFLObject` (vtable 0x1adb874, ctor 0x558d74, factory 0x5c0988 called from 0x5bf974); mannequin head = `MannequinHead` (factory 0x5c08f0); both stored on the character node (+0x3cc / +0x3d0); headwear attached as named child "headwear"/"headwearClone" (0x568e9c).

### Original shader pipeline (client "Originale (APK)")
- Source: `assets/shader/LUT.vsh` + `LUT.fsh` read from the user's APK at runtime; variants by `#define AGX_FEATURE_*` (game builds them with "%s#define %s"). Only change: GLSL ES 1.00 Appendix A loop fix (`for (; iBone < uBoneCount;)` → constant bound + break), asserted to match exactly once.
- Uniform/texture-unit table (rodata 0x1b75094…): uMVPMatrix 0, uProjectionMatrix 1, uViewMatrix 2, uModelMatrix 3, uNormalMatrix 4, uBoneCount 5, uBoneMatrices 6, uBoneNormalMatrices 7, uDirLightCount 8, uDirLightDirAndType 9, uDirLightColor 10, uHSLightSkyColor 11, uHSLightGroundColor 12, uEyePt 13, uMiiMode 14, uColor0..2 15–17, uLightColor 18, uAlpha 19, uAlbedoTexture 20 (unit 0), uNormalTexture 21, uMaskTexture 22, uAlphaTexture 23, uLUTSpecTexture 24 (unit 4), uLUTFresTexture 25 (unit 5), uSphereMapTexture 26 (unit 6). VERIFIED against the AFL draw callback.
- AFL draw callback `0x55ae60` (VERIFIED): per AFLDrawParam sets uMVP/uModel/uNormal, uMiiMode = modulateMode (note: no shipped shader declares uMiiMode → no-op), uColor0/1/2 from pColorR/G/B with ×(230/255 = 0.901961) for R when modulateType ∈ {1 beard, 4 hair, 9 mustache, 11 eyebrow, 16 face-beard}, G when type 10 (mouth), B when type 12 (eye); FILL (17) colour alpha 0; mask (type 6) → glBlendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA); material (LUTs, sphere map) chosen by modulateType from mii_model.xml.
- `AGX_FEATURE_MII_<mode>` selection: shader has exactly the 6 FFL modulate modes in FFL order → mode m ↦ define m. INFERRED (variant builder not located).
- Head materials `asset/env/mii/mii_model.xml` (CDN asset_env_mii.zip): Faceline/Nose/Forehead LUT Skin01, Beard/Hair/Cap/Mask Default02, NoseLine/Glass None; NoseLine unlit; Xlu (Mask, NoseLine, Glass) alpha-test, depth-write on, blend ONE/ZERO (except mask per callback); all LightSet 1. VERIFIED (file).
- Lights `asset/env/scene/default_scene.xml` (CDN asset_env_scene.zip): hemi sky 0.549,0.522,0.502 ×1.6, ground 0.549,0.451,0.369 ×1.6; directional 0.502,0.463,0.463 ×0.7 dir (−0.2,0.5,0.8); fill same colour ×0.2 offset (0,−0.2,0); LightSet0 = {hemi, dir} (body), LightSet1 = {hemi, dir, fill} (head). VERIFIED (file). FFL.js defaults equal colour×intensity of this file. Fill direction = normalize(toward camera + offset): INFERRED. Light space = world: INFERRED.
- Faceline/mask texture generation passes use FFL.js FFLShaderMaterial (FFL decomp shader, unlit): APPROX of AFL's internal texture shader.

### A/B (same Mii, pose, camera; `docs/reverse-engineering/evidence/m5/`)
- Full Mii, WaitMale: mean |A−B| = 7.0/255 on Mii pixels (p95 20). Main differences: hands (A lacks skin mask → grey), normal-map detail, specular mask, LightSet 0 vs FFL.js head lights on the body.
- Head only: mean 4.8/255 (p95 11): FFL.js's LUT adaptation is close to the original for the head.

## M6 — proportions + original wardrobe, 2026-10-25

### Body scale (height / build) — REVERSED from libcocos2dcpp.so, REIMPLEMENTED in `client/web/src/body/BodyScale.ts`, VERIFIED in browser
| What | Address | Rule |
|---|---|---|
| scaleA | 0x5d07b8 (callers 0x5c1d68, 0x5c3e18, 0x5c4adc, …; multipliers 1.0, 1.0) | x = (h·0.77/128 + 0.5)·0.75 ; y = z = (h·0.23/128 + w·(h·0.47/128 + 0.4)/128 + 0.4)·0.75 |
| scaleB | 0x5d09c0 | uniform 0.6 + w·0.2/128 + h·(w·0.4/128 + 0.4)/128 (=1 at 64/64) |
| h, w | Mii info at AFLObject+0x284, bytes +0xa8 / +0xac (variant 0x5d0724 reads +0xac/+0xb0 = FFLiCharInfo.height/build) | height drives x (bone length axis, POD bones point along local +X) |
| skip | AFLObject+0x560 ≠ 0 → no scale; +0x448/+0x44a → forced 1 | |
| apply | 0x5c49f8 (getJointWorldMatrix) → SkeletalAnimController vtbl+0x5c (0x529d28) → 0x5255fc → world builder 0x5257f0 | |
| per joint | name compares 0x525aac…0x525cd0 | jointRoot, Head, Acce_Spine_2(_R/_L) → 1 · Wrist_R/L, Ankle_R/L, Shadow → uniform A.y · Item_Wrist_R/L, Item_Spine_2 → 1 − 0.5·max(0, 1 − A.y) (0.5 = .data 0x1b75004) · Womb → scaleB · all others → scaleA |
| hierarchy | 0x526634…0x526bd4 | t′ = t·parentScale (Skl_Root keeps t.y); W = U_parent·T(t′)·R·S_j ; U = W with unit axes (scale NOT inherited) |
| root | 0x526978…0x526a24 | Skl_Root Y += Y·(sx−1)/k − (0.2·(1−w/127) − 0.05·(1−h/127)); k = 1 − (a−b), a/b not identified → k = 1 (INFERRED) |

Cross-check: FFL.js `getBodyScale()` has the same polynomial without ×0.75 (unit test `tests/unit/bodyscale.test.mts`, 16/16 PASS).
Effect: the bind skeleton is about the tallest Mii (h=127 → head joint 9.83 vs bind 10.65); fixture "Jasmine" (h 28, b 55) → 5.23.
Shadow joint: the extra rebuild for flag "Shadow" (0x526a34) is not reproduced.

### Wardrobe — data VERIFIED, composition partly INFERRED (`client/web/src/body/Wardrobe.ts`)
- File names (.rodata 0x18a5450): `<cat>%04d%s/<cat>%04d%s%s.Mdl.pod`; suffix table 0x1b75500 = {In, St, Wd, Hi, Lo, M, F}. Tops ship In/St/Wd, bottomsA Hi/Lo, 9999 base tops M/F.
- ArchModelMetadata per variant: Type, Silhouette (slim/wide/boots), State, Gender, PartRange, Exclusion/CategoryList (+AcceptableSilhoette), ItemList.
- Area materials (0x1aa3fc4, 12 entries): mtArChest, Waist, LoWaist, Hip, UpLeg0–2, Knee, LoLeg0–2, Foot. 0x5cb5cc builds a mask over [PartRange.begin..end] (metadata +0x90/+0x94) and calls a per-material method for each area outside → own meshes outside the range are not drawn. REIMPLEMENTED.
- Colours: ColorList entries = number of `_ALnn` albedo textures (40/40 samples) → a colour is an albedo swap. REIMPLEMENTED.
- Base items (xml/other_clothes.xml + render): bodyTops9999M/F = undershirt, bodyBottomsA9999 = shorts, bodyBottomsB9999 = bare legs/feet. VERIFIED in browser (base-only screenshot).
- Headwear: rigid POD (headwearRoot/unite/mesh) attached at the head anchor; authored at head-units/10 → ×10 under AFL's S(0.1) (INFERRED from bounds, visually correct). Hair uses FFL HAT variant (FFLModelFlag.HAT); AFL HeadWear Type 6/8 mapping and ApplyHairMaskWhenSkinhead not reversed.
- INFERRED: exclusion resolution priority (all > topslong > tops > bottomsA > bottomsB > shoes > acce > headwear; the game uses equip order); tuck → tops In + bottomsA Hi, otherwise St (Wd with wide bottoms) + Lo; base items hide areas covered by worn items; "areaX" → "mtArX" name mapping (the parser's area table 0x1881548 lacks Knee/Foot).
- NOT DONE: accessories (RootType → joint table, TranslateScaleWeight/ScaleWeight/Small* formula at 0x5d4528 decoded but not placed/verified); Capture cameras; Emitter.

## M6.1 — wardrobe structure closed, 2026-10-25
Classification: **VERIFIED** = reproduced and checked in the browser against data/binary · **REVERSED** = read from the binary/data, implemented as found · **DEDUCED** = inferred from strong indirect evidence · **APPROXIMATED** = placeholder or best guess.

| Topic | Status | Evidence |
|---|---|---|
| Accessory root joints | REVERSED (table) + DEDUCED (index) | The only 8-entry joint-name pointer table in .data (0x1b7512c) lists exactly the accessory roots: jointRoot, Skl_Root, Shadow, Item_Wrist_R, Head, Acce_Spine_2, Acce_Spine_2_R, Acce_Spine_2_L. The XML parser stores RootType as an int at +0x48 (0x532468). Index = RootType is deduced; the browser render is consistent (rose RootType 3 sits in the right hand; with WaitFemale both hands hold it). |
| Accessory transform | REVERSED (0x5d45dc..0x5d46b0) | Per axis: tf = TranslateScaleWeightOffset + scaleA·TranslateScaleWeight. Scale: s = (1−ScaleWeight) + scaleA.x·ScaleWeight, multiplied by the Small* factor when enabled. Root frame = joint world matrix evaluated with unit scale (0x5d48f8). Applying tf to the mesh translation in the root frame is DEDUCED. |
| Shadow / Item_* joints | REVERSED (data) | These joints exist only in bodyMannequin0000. They are rebuilt from their bind data (Shadow ← JointScale; Item_Wrist_R ← Wrist_R rotated 180° about Y; Item_Wrist_L ← Wrist_L; Item_Spine_2 ← Spine_2; zero offsets). |
| Apple / banana / cherry (RootType 2 = Shadow) | VERIFIED render, DEDUCED meaning | They end up on the floor in front of the feet (the Shadow joint is at the ground origin). In-game placement still to be confirmed. |
| Category order / priority | REVERSED (data + struct) | `assets/userData/cloth_data.xml` lists all, topslong, tops, bottomsA, bottomsB, shoes, accessory, headwear. The outfit struct at AFLObject+0xe0 stores int16 ids in the same order (+0x3e…+0x4a), the colour index as a 4-bit nibble per category (+0x38), and the tuck flag (+0x4e). The composer 0x5cd220 loads in that order. |
| Exclusion resolution | DEDUCED | The higher category in that order wins. The code that drops excluded items has not been traced. |
| Tops / bottomsA variant | REVERSED (0x5cd3c8..0x5cd4ac, 0x5cd8fc..0x5cd9c8) | tops = tuck ? In : St. A male with no tops gets In (the base 9999M ships only In). bottomsA = In ? Hi : Lo. If the requested tops file is missing, In↔St and Hi↔Lo are swapped. Wd is used when the bottoms metadata field +0x8c == 2 (DEDUCED: Silhouette "wide") and the tops field +0x98 != 1. VERIFIED in the browser: tuck → 0003In + 0003Hi; skirt 0002 (wide) → 0000Wd; male base → 9999MIn + 9999Hi. |
| Path builder | REVERSED | 0x10f904c and siblings: state table 0x1b754fc = {"", In, St, Wd, Hi, Lo}; gender table 0x1b75514 = {M, F, ""}. It tries the gendered file first, then the generic one (0x10f8f38). |
| Hats / hair | VERIFIED render, APPROXIMATED hair | Checked with 4 hats: 0000 (Type 8, bear hood), 0001 beret, 0002 bowler, 0003 helmet (Type 6). All sit correctly at ×10 under the head anchor. Hair uses FFL's HAT variant; how AFL handles HeadWear Type 6/8 and ApplyHairMaskWhenSkinhead was not traced (the model is built through AFLObject::initCPUStepImpl → AFLInitCharModelCPUStep; the flag source is not decoded). |
| Skl_Root k term | DEDUCED | k = 1 − (a − b), where b = the animation blend weight (s16, input of 0x5257f0) and a = an axis length of the blended local matrix. With a single (unblended) animation k = 1, which is what we use. It only matters during blends between animations. |

Bug fixed: FFLiGetRandomCharInfo leaves some FFLiCharInfo fields unwritten, so random Miis failed verification (reason 55) depending on stale heap bytes (39/40 failures in one run). `MiiEngine.randomCharInfo` now zeroes the buffer first: 0/30 failures.
