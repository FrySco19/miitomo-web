# EXPRESSION.md — personality, talking gestures and faces (M13, 2026-10-26)

Sources (all from the user's own files):
- `message_Release_Console_JPja_EmotionExpression.zip` (CDN, 436 MSBT): `ExpressionRule/Rule.msbt`, `Expression.msbt`, `Emotion.msbt`, `Face.msbt`, `Wordlist_<lang>/WL<lang>_<Rule>.msbt` (54 lists × 8 languages).
- `message/Release/Arch.msbp` (attribute sets `er_`, `ex_`, `em_`, `fc_`, `wd_`, lists er_*/ex_*/emotions).
- `message_Release_Console_EUit_Client_Layout_miiStudio.zip` (axis labels and level descriptions).
- `libcocos2dcpp.so` (APK, ARMv7) for the personality classifier and the rule struct.

## Personality — REVERSED
Mii Studio stores `characterParam`: five levels 1..8 (0 = unset) at +0x21..+0x25 of the Mii record.
Axis labels (radarChart00): **Movimenti, Modo di parlare, Atteggiamento, Espressione del viso, Originalità**; 8 descriptions each (radarchartBalloon00, e.g. "Super lenti" … "Super rapidi").

| Address | Function |
|---|---|
| 0x5be454 | index = bucket(S0[p0] + S1[p1]) \| bucket(S2[p2] + S3[p3]) << 2; bucket: 51–100 → 1, 101–150 → 2, 151–200 → 3, else 0 |
| 0x18c01d0 | score table u16[4][9]: axes 0/2 = 50,10,20,30,40,60,70,80,90; axes 1/3 = 50,5,15,25,35,65,75,85,95 |
| 0x5be42c | type = int[16] at 0x18c0140 = [0,0,1,1, 0,0,1,1, 2,2,3,3, 2,2,3,3][index] |
| 0x5be5b8 | presets: 16 × 5 bytes at 0x18c0180 ({1,3,5,7} × {1,3,5,7}, fifth = 4) |
| 0x5be538 / 0x5be578 | sum A / sum B getters (other users not traced; candidate: movement speed, ex_Slow/FastRateLimit) |

So: **type = (Movimenti + Modo di parlare high ? 1 : 0) + (Atteggiamento + Espressione high ? 2 : 0)** → 0 Nagomi, 1 Nori, 2 Dry, 3 Cool. Originalità is stored but not used by the type.
Index order 0..3 = order of the four expression strings in the rule struct (0x1118640: name +0, Nagomi +0x0c, Nori +0x18, Dry +0x24, Cool +0x30, genre +0x3c, weight f32 +0x40, inhibition +0x44).
Missing: the result-screen texts (attribute set `mc_Nagomi…mc_Default`, no file with that entry size among the user's files) and the screen title "Personalità" (PLACEHOLDER label in PLAY). The internal type name is shown, marked "tipo interno".

## Gestures — VERIFIED data, APPROXIMATED timing
- `{9.3}` tag (ExpressionRule) in a line, or a word-list match in the user's own text → rule → `er_Expression<type>` → expression `ex_*`: In / loop / Out animation, loop count min–max, effects `ar*`.
- 89 expressions, 138 animation clips (all present in the user's animation zips except `animHandOnMouthRIOut`, a typo in the original data of ex_Hunger_Dr → we use animHandOnMouthROut).
- Several rules in one line: highest `er_Weight` wins; an `Inhibitor` rule (the profanity list WLit_Inhibition) cancels all `Inhibited` rules (DEDUCED from the attribute names and values).
- Start: when the balloon opens; if the Mii is busy, waits ≤ 1.5 s (APPROXIMATED: ex_PrecedingMaxSec / ex_DelayMaxSec lie beyond the stored entry size). Loop count: deterministic pseudo-random in [min, max].

## Faces — VERIFIED
- `em_Face<type>` values are FFL expression ids (= `fc_Default`): Joy 32, Anger 2, Sadness 3, Fear 18, Shame 9, Love/Ease 1, Hate 24, Busy/Surprise 10.
- `Face.msbt` gives default / opened-mouth / closed-mouth ids (e.g. joy 32/32/31, wink_left 12/14/12): the mouth flaps between opened and closed while text types.
- The head is built with the 17 masks these need (fallback to the base set if FFL refuses one).
- Line without an emotion tag but with user text: face of the strongest rule's `er_EmotionGenre` (DEDUCED).

## Word lists — VERIFIED data, DEDUCED matching
- 54 Italian lists (~8,000 entries): stems ("felic"), phrases ("non sono felice"), emoticons (":-)", "\o/"), a few regular expressions ("mest[oiae]\b", "(mi sono|ti sei) spanciat(e|i|o|a)\b") and a custom wildcard "/.*/" ("soffr/.*/ di").
- `WLit_Empty` = exceptions (rule None): "pensione" must not fire Question's "pens"; `WLit_Inhibition` = profanity.
- Matching: scan left to right, at word starts the longest entry of any list wins and consumes its text (so exceptions and longer phrases take precedence). wd_MatchingType / wd_UseRegex are not stored in the Italian files.

## Effects (ar*) — NOT YET
`asset/effect/output/character/ar*.xml` (57, CDN) only name an EmitterSet and bone; the particles are in the APK's `assets/asset/effect/effect.ptcl` (3 MB, magic `EFTB` v9 — Nintendo eft binary: ESTA/ESET/EMTR/…). Decoding it is the next block.

Tests: `tests/e2e/m13-expression.smoke.mjs` 8/8, `tests/unit/personality.test.mts` 9/9.

## Effects (effect.ptcl) — in progress
Format REVERSED so far (APK `assets/asset/effect/effect.ptcl`, 3,091,744 bytes, magic `EFTB` v9 = Nintendo `nw::eft2`, whose runtime is exported with symbols in libcocos2dcpp.so):
- Section header (0x20): magic, size, child offset, next offset, attr offset, binary offset, index/unknown, child count. Tree: `ESTA` (65 `ESET` effect sets → `EMTR` emitters, child emitters nested) · `TEXA` (49 `TEXR` + `ORGB` data) · `PRMA` (12 `PRIM`) · `SHCA` (GLSL ES source: SHDG/SHDT/SHCD/SHDV/SHDF/SHPV/SHPF/SHST) · `SHDA`.
- Textures: `TEXR` u16 width/height + format fields; the `ORGB` child holds uncompressed RGBA8 (49 decoded: smoke, stars, hearts, notes, "?", "!", "OK!", coin, flowers, tears, butterfly…).
- Emitter: fixed 0xa44-byte `ResEmitter` after the binary offset; name at +0x10. Sub-structs from `ResEmitter::FlipEndian` (0x1670428): +0x50 EmitterStaticUniformBlock (0x700), +0x750 ResEmitterFnd, +0x7d0 ResInherit, +0x7e4 ResEmission, +0x82c ResEmitterVolume, +0x88c ResPtclFnd, +0x8e8 ResShader, +0x93c ResPtclVel, +0x96c ResPtclColor, +0x998 ResPtclScale, +0x9c4/+0x9d8 ResTextureSampler (texture index; −1 = none). Texture mapping verified on all 65 sets (heart → 22, "?" → 27, OK → 25, coin → 18 …).
- Next: field semantics from the runtime (`EmitterCalc::Emit`, `InitializeParticle`, `CalcParticle`), then a WebGL particle player. Tools: tools/re/eft.py.
