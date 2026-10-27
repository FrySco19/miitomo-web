# EFFECTS.md — Miitomo particle effects (M14, 2026-10-26)

Source: the user's APK `assets/asset/effect/effect.ptcl` (3,091,744 bytes) + CDN `asset_effect_output.zip` (57 descriptor XMLs). Nothing bundled.
Runtime reference: `nw::eft2` in `lib/armeabi-v7a/libcocos2dcpp.so`, **exported with C++ symbols** (EmitterCalc, ShaderKey, CalcPtclColor0Vec, Calculate8KeyAnim …). Tools: tools/re/eft.py, symdis.py, veneer.py, thumbcallers.py.
Code: `client/web/src/effects/Eft.ts` (decoder), `EftPlayer.ts` (WebGL player), `Effects.ts` (manager).

## Container — REVERSED
`EFTB` v9 header (0x30), then 0x20-byte section headers (magic, size, child, next, attr, binary offset, index, child count):
ESTA (65 ESET effect sets → EMTR emitters, nested) · TEXA (49 TEXR + ORGB RGBA8) · PRMA (12 PRIM) · SHCA (GLSL ES source) · SHDA.

## ResEmitter (0xa44 bytes) — field map
V = read in the named runtime function · D = DEDUCED from the values of all 65 sets · A = APPROXIMATED in the player

| Offset | Field | How |
|---|---|---|
| +0x10 | name | D |
| +0x50 | EmitterStaticUniformBlock (0x700) | V ResEmitter::FlipEndian 0x1670428 |
| block+0x10/14/18/1c/20 | key counts colour0 / alpha0 / colour1 / alpha1 / scale | V CalcPtclColor0Vec 0x166a508, Color1Vec, ScaleVecFromTime 0x166af7c |
| block+0x370/3f0/470/4f0/5b0 | 8-key tables (x,y,z,normalised time), linear, clamped | V Calculate8KeyAnim 0x1668dc0 |
| block+0x360 | colour scale | V |
| block+0x70 | air resistance (velocity × r^step) | V _CalcParticleBehavior_Integrating 0x1669fac |
| block+0x6b0/6c0/6d0/6e0 | rotation initial / random / velocity / velocity random | V CalcRotationMatrix (order D) |
| +0x2e0 | UV scale | D |
| +0x308 | UV division (atlas cols, rows) | V tex0PatternParam upload (MakeDynamicUniformBlock 0x16650a4) |
| +0x118 / +0x120 | pattern count / pattern table | D |
| +0x768 / +0x780 / +0x798 | emitter translate / rotate (rad) / scale | D |
| +0x7e4 / +0x7e8 / +0x7f0 | one-time flag / emission start frame / emission duration | V EmitterCalc::Calc 0x1663eb8 |
| +0x7f4 (float) / +0x7fc / +0x800 | count per emission / interval / interval random | D |
| +0x808 / +0x80c | gravity magnitude / direction | V Integrating |
| +0x82c / +0x850 | volume type / radius | D |
| +0x880 | ResRenderState: blend enable, +1..3 depth, +6 blend type, +7 side | V Rendercontext::SetRenderStateResource (type values D) |
| +0x88e | particle type 0 billboard, 1 complex billboard, 2 Y billboard, 3 polygon XY, 4 polygon XZ, 5 velocity look, 6 velocity look polygon, 7 Y billboard parallel, 8/9 with scale Z | V ShaderKey::SetParticleType |
| +0x89c / +0x8a0 | life (frames) / life random % | D |
| +0x8d4 | colour combiner 0 colour0, 1 tex×c0, 2 mix(c1,c0,tex), 3 tex×c0+c1 | V ShaderKey::Initialize + Generate (#define strings) |
| +0x8d5 | alpha combiner 0 tex.a×a0, 1 ×a1, 2 sub, 3 sub×a1, 4 distance field | V |
| +0x8dc / +0x8df | texture colour input ONE / alpha input (1 red, 2 one) | V |
| +0x93c / +0x940 / +0x944 / +0x950 / +0x954 / +0x964 | omni velocity / directional velocity / direction / spread / diffusion / velocity random % | read in InitializeParticle 0x1665db0; formula D |
| +0x974..977 | colour0 / colour1 / alpha0 / alpha1 mode (2 = 8-key curve, 3 = random from table) | V |
| +0x978 / +0x988 | colour0 / colour1 RGBA | V |
| +0x998 / +0x9a4 | scale / scale random % | D |
| +0x9c4 / +0x9d8 / +0x9ec | texture samplers (index into TEXA, −1 = none) | V FlipEndian + data (all 65 sets match their textures) |

Descriptor XML (`<Particle Name>` / `EmitterSet` / `BoneName Head` / `OffsetPosition`): the Head bone's X axis points up and Y sideways; symmetric `drop_left` (3, 2, 0) / `drop_right` confirm effects use the full bone frame (D).

## Player — APPROXIMATED parts
60 frames per second; child emitters played as independent emitters; spawn volume as a sphere; particle types 1/4/6/8/9 drawn as billboards; blend type 1 = additive (used only by glow textures). Combiners copied from the original fragment shader.

## Where effects play
- Talking gestures: `ex_EffectFileName*` of the chosen expression (Expression.msbt), started with the gesture (D).
- Touch: `arStroke` with `animActionStroked` (SequenceTouch static table, M8).
Test: `tests/e2e/m14-effects.smoke.mjs` (10 sets render with their original textures; gesture → arJoy).
