# VOICE.md — Mii voice (research, 2026-10-25)

## What the original uses — REVERSED (strings / RTTI of libcocos2dcpp.so)
- The Mii speaks with **Nuance Vocalizer Expressive** (`libNuanceVocalizer.so` in the APK, banner "Vocalizer Expressive %d.%d.%d", MIME `application/x-vocalizer-rettt+text`), driven by Nintendo's wrapper `nttsmiivoice` (`CTTSBufferList`, `CTTSCommandList`, `CTTSWordBuffer`, `CTTSLipsyncBuffer`, `CVoiceTransformer`) and `Vocalizer::{init(eRegion,eLanguage), VocalizerPlayer, VocalizerState::computeSpeakingSchedule}`; output through OpenSL (`NTTSMiiVoicePlayOpenSL`).
- Voice data lives on the CDN, not in the APK: `voice_common.zip`, `voice_languages_<lang>.zip` (iti = Italian), `voice_dict_userdct_<lang>_dcb.zip`, `voice_ruleset_userruleset_<lang>_rst.zip` (all in the m9-full selection).
- Per-Mii voice settings are edited in Mii Studio (`profileVoiceEdit00.ccbi`: radar chart with 5 axes voice00…voice04, 7 presets btn00…btn06, play button; `profileIntonationEdit00.ccbi`: 4 intonation radio buttons). Labels come with the miiStudio message zip.
- Lip sync: `CTTSLipsyncBuffer` → the mouth moves with phonemes; the speaking schedule also drives the balloon typewriter (`computeSpeakingSchedule`).

## murmursound_00…11.raw
16-bit little-endian PCM without header (0.35–1.8 s). The binary references them by name and a debug command `murmursnd` exists; the sample rate is not stored in the files and no rate constant could be tied to them yet (pitch analysis: F0 ≈ 300–370 Hz at 16 kHz, 420–510 Hz at 22.05 kHz — inconclusive). Not played. Their role (voice-off murmur? sub-Mii?) is not traced.

## Status
| Item | Status |
|---|---|
| Engine identity, wrapper classes, data files | REVERSED |
| Running the original engine in a browser | **BLOCKED**: Vocalizer is a proprietary native ARM library; the only faithful route is emulating `libNuanceVocalizer.so` from the user's own APK (e.g. an ARM emulator compiled to WebAssembly) with the user's own voice data. That is a large, separate project and an architectural decision for the owner. |
| Modern TTS substitute | **not used** (would not be the original voice). |
| Balloon timing | APPROXIMATED typewriter (M8) until the speaking schedule is reversed. |

## M13 update (2026-10-26)
- Downloaded and verified: `voice_common.zip` (sysdct, synth_med_fxd_bet3f22, clm, lid), `voice_languages_iti.zip` (Italian voice "alice", ve_pipeline_iti_alice_22_bet3), `voice_dict_userdct_iti_dcb.zip`, `voice_ruleset_userruleset_iti_rst.zip` (+ Japanese). These are data for **Nuance Vocalizer** (`lib/armeabi-v7a/libNuanceVocalizer.so`, proprietary native engine). Running it in a browser would need the native ARM engine → not possible here; no substitute TTS is presented as original.
- Voice parameters (Mii Studio radar, voiceParam): Altezza, Velocità, Accento, Energia, Profondità + "Intonazione" and "Preimpostate" — labels VERIFIED (radarChart00 / profileIntonationEdit00 / profileVoiceEdit00). The values are stored with the Mii (voiceParam) but nothing speaks them yet.
- Decision still the user's: (a) silent Mii (current), (b) a clearly labelled non-original TTS, (c) the original engine on a native/desktop build.

## M13b — voice providers (user decision 2026-10-26: Web = (b), native PC = (c) research goal)
`client/web/src/voice/Voice.ts`: three separate providers, chained by preference (`auto` = original → web TTS → silent):

| Provider | Classification | Web status |
|---|---|---|
| `original-nuance` — Nuance Vocalizer (libNuanceVocalizer.so + CDN voice_* data, Italian voice "alice") | ORIGINAL | **unavailable**: native ARM engine; research goal for a native PC build |
| `web-tts` — the browser's `speechSynthesis` with an Italian system voice | **APPROXIMATED / NON-ORIGINAL TTS** | available when the system has an Italian voice |
| `silent` | SILENT | always (final fallback) |

- Never presented as the Miitomo voice: Settings → "Voce del Mii" labels it "NON originale · approssimata", and the active-voice line says it is not the original voice. Save field `settings.voice` (default `auto`), per-Mii `profile.voice` (5 values 0..100).
- Voice parameters: Mii Studio voice radar labels VERIFIED (Altezza, Velocità, Accento, Energia, Profondità — radarChart00 voice00–04). The original value scale is not known; 0..100 with 50 neutral is APPROXIMATED, and so is the mapping to speechSynthesis pitch / rate / volume (`webTtsSettings`).
- Decoupled: RoomUI only calls `onVoicePage(text)` when a page starts and `onVoiceStop()` on close. Typewriter speed, mouth flap, gestures and faces never wait for the voice.
- Original data kept intact and catalogued: `evidence/m13/voice-files.json` (8 CDN zips with MD5 + entries; engine = APK `lib/armeabi-v7a/libNuanceVocalizer.so`, 3,344,128 bytes). Nothing reads, converts, moves or deletes them.
- Test: `tests/e2e/m13-voice.smoke.mjs` (speechSynthesis mocked: with an Italian voice → web TTS; without → silent).
