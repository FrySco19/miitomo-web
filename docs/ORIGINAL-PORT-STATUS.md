# Miitomo Web (original port): status

This page records what the **original port** (Classic) covers today, compared with Miitomo 2.4.0 for Android. It
is compiled from the audits in `docs/reverse-engineering/AUDIT-PLAY.md` and `docs/CLASSIFICATION.md` and from the
end-to-end suites in `tests/e2e/`. It gives no completion percentage, because none can be measured honestly.

Miitomo Reboot (the new features) is tracked separately in [`reboot/ROADMAP.md`](reboot/ROADMAP.md).

## Status labels

| Label | Meaning |
|---|---|
| **Complete** | Rebuilt from the user's own original files and covered by an automated end-to-end test |
| **Partial** | Works, but part of the original behaviour is approximated or missing (the note says which) |
| **Missing** | Not built yet, although it could be built from the user's own files |
| **Not verified** | Built, but never compared with the running original game |
| **Out of scope** | Cannot or will not be rebuilt: the content was server-side only, it needs Nintendo services, or it involves real money |

"Approximated" in a note means the behaviour was rebuilt to look right because the original logic is unknown. The
precise class of each item (ORIGINAL, REVERSED, DEDUCED, APPROXIMATED, SERVER DATA MISSING, WEB ADAPTATION) is in
[`CLASSIFICATION.md`](CLASSIFICATION.md).

## Mii and body

| Feature | Status | Notes | Test |
|---|---|---|---|
| Mii head from the original AFL resource (FFL) | Complete | 70 expressions, including the 51 Miitomo-only ones | `mii-lab`, `mii-full` |
| Original APK shader (LUT + AGX variants) | Partial | Some lighting details differ where the GLSL path is not fully reproduced; the Lab compares both paths | `mii-full`, `m18` |
| Body proportions from height and build | Not verified | Reversed from the binary; no in-game reference capture to compare with | `unit/bodyscale`, `m6-wardrobe` |
| Idle animations and gestures | Partial | 138 original gesture clips; frame interpolation and gesture start timing are approximated | `m13-expression` |
| Mii Studio editor | Partial | All parts, colours and positions; QR scan, photo → Mii, voice presets and intonation are missing | `m17-parity` |
| Creating the first Mii (name, birthday, personality) | Complete | Original personality texts (4 groups, 16 types) | `m9-play`, `full` |

## Room

| Feature | Status | Notes | Test |
|---|---|---|---|
| Room models, walls, floors and objects | Complete | Original room data from the user's files | `m7-room`, `m8-loop` |
| Fixed room camera | Partial | Original camera, moved back and re-centred so the room fits a landscape PC window (web adaptation) | `unit/framing`, `m18` |
| Entering, walking, touching, object use | Partial | Original state machine and sequences; path planning and timings between sequences are approximated | `m8-loop` |
| Room texts, balloons and greetings | Complete | Original Italian texts (MSBT) | `m8-loop`, `m9-play` |
| Faces and gestures while talking | Partial | Original rules and word lists; the strongest-rule choice is deduced, the 8 Hz mouth movement is approximated | `m13-expression` |
| Particle effects | Partial | Original effect sets; some particle types are drawn as billboards, child emitters do not inherit | `m14-effects` |
| Sound and music | Complete | Original sound tables and per-scene music | `m8-loop`, `m17-parity` |
| Bottom bar and menu | Partial | Original icons and labels; the order of the bar is deduced. Menu entries for Profilo, QR Code and Altro are missing | `m17-parity` |
| Room status (coins, style, popularity, ranks) | Out of scope | Server data. Only the texts survive | — |
| Birthday sequence | Missing | Buildable locally (birthday, music and lines are in the user's files) | — |
| Posters | Missing | Buildable locally | — |

## Wardrobe, shop and Miifoto

| Feature | Status | Notes | Test |
|---|---|---|---|
| Wardrobe (closet) | Complete | 9 original tabs, tuck in/out, colours, favourites, the closet camera | `m6-wardrobe`, `m17-parity` |
| Outfit layering and exclusions | Partial | Exclusion priority and some base-item occlusion rules are approximated | `m6-wardrobe` |
| Shop catalogue and try-on | Partial | Original items, banners and weekly delivery dates; the Mii spot and the camera in the shop are approximated | `m15-shop` |
| Prices, coins, purchases | Out of scope | Server data; no real-money purchase, by decision | — |
| Miifoto editor and PNG export | Partial | Original poses, faces, backgrounds, stamps and templates; placement and export size are approximated | `m12-miifoto` |
| Local Miifoto album | Missing | Buildable locally | — |

## Talking and voice

| Feature | Status | Notes | Test |
|---|---|---|---|
| Original Mii voice (Nuance Vocalizer) | Missing | The data is in the user's files, but the engine is native ARM code and does not run in a browser | — |
| Browser speech synthesis | Partial | Labelled in the UI as non-original; never presented as the Miitomo voice | `m13-voice` |
| Greetings (Saluti) | Complete | | `m9-play` |
| Questions and answers | Out of scope | The question database was server-only and is missing. No substitute questions were written | — |

## Friends

| Feature | Status | Notes | Test |
|---|---|---|---|
| Local friends (Mii profiles on this device) | Partial | Original lists, dialogs and texts. No friend requests, codes or social networks | `m16-friends` |
| Visiting a friend's room | Complete | Original flow, texts and music | `m16-friends` |
| A friend visiting your room (two Miis) | Partial | Original greetings and music; the arrival spot, personal distance and visit schedule are approximated | `m18-guest` |
| Alter Mii (several own Miis with rooms) | Missing | Buildable locally | — |
| Letters | Missing | The tutorial letters are buildable; letters from friends need a server | — |
| Friends' answers, comments, hearts, notifications | Out of scope | Server data | — |

## Saving and loading

| Feature | Status | Notes | Test |
|---|---|---|---|
| Local save with export and import | Complete | Web-only design; no original equivalent | `m9-play`, `full` |
| Importing the user's files (picker or local launcher) | Complete | Web-only design | `m13-update` |
| Updating the asset set without losing the save | Complete | | `m13-update` |

## Never built

These depend on Nintendo services or real money and will not be rebuilt:

- My Nintendo, the Nintendo Account and the EULA dialogs;
- coin purchases and refunds;
- moderation and admin screens and web views.

## Open decisions

These are not blocking. They are listed in `docs/reverse-engineering/AUDIT-PLAY.md` § 7:

- **Mii QR codes.** Reading or writing them needs the Mii QR data format, which embeds a Nintendo key. The project
  owner decides before any work starts.
- **Miitomo Drop.** The boards could be playable without prizes. The prize tables were server data and are missing.
