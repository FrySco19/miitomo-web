# Documentation

## Start here

| Document | What it covers |
|---|---|
| [ORIGINAL-PORT-STATUS.md](ORIGINAL-PORT-STATUS.md) | What the original port (Classic) covers today, feature by feature |
| [CLASSIFICATION.md](CLASSIFICATION.md) | The class of every piece: original, reversed, deduced, approximated, missing, web adaptation |
| [reboot/ROADMAP.md](reboot/ROADMAP.md) | Miitomo Reboot phases R0–R12 and what each finished phase delivered |
| [reboot/CLASSIC-VS-REBOOT.md](reboot/CLASSIC-VS-REBOOT.md) | Which features are original and which are new |

## Architecture

| Document | What it covers |
|---|---|
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | Early architecture evidence and the reasoning behind the web client |
| [architecture/ADR-0001-mii-rendering.md](architecture/ADR-0001-mii-rendering.md) | Decision: rendering Miis with FFL.js |
| [architecture/ADR-0002-original-shader.md](architecture/ADR-0002-original-shader.md) | Decision: using the original APK shader |
| [reboot/ARCHITECTURE.md](reboot/ARCHITECTURE.md) | How Reboot is separated from Classic (gate, flags, `RebootHost`) |

## Reverse engineering (original port)

| Document | What it covers |
|---|---|
| [STATUS.md](reverse-engineering/STATUS.md) | Research log of the early sessions (M0–M8). Kept as history; the current state is ORIGINAL-PORT-STATUS.md |
| [AUDIT-PLAY.md](reverse-engineering/AUDIT-PLAY.md) | Audit of the playable game against the original, scene by scene |
| [NATIVE.md](reverse-engineering/NATIVE.md) | Native library, JNI boundary, addresses |
| [NETWORK.md](reverse-engineering/NETWORK.md) · [API.md](reverse-engineering/API.md) | The original server API, documented for research only. The project never contacts Nintendo servers |
| [ASSETS.md](reverse-engineering/ASSETS.md) | Asset formats and where each file comes from |
| [MII.md](reverse-engineering/MII.md) · [WARDROBE.md](reverse-engineering/WARDROBE.md) | Mii, body, proportions, clothing |
| [ROOM.md](reverse-engineering/ROOM.md) · [LOOP.md](reverse-engineering/LOOP.md) | Room scene and the first gameplay loop |
| [EXPRESSION.md](reverse-engineering/EXPRESSION.md) · [EFFECTS.md](reverse-engineering/EFFECTS.md) | Faces and gestures while talking; particle effects |
| [VOICE.md](reverse-engineering/VOICE.md) | The original voice engine and why the Web cannot run it |
| [QUESTIONS.md](reverse-engineering/QUESTIONS.md) | Questions and answers: why the database is missing |
| [MIIFOTO.md](reverse-engineering/MIIFOTO.md) · [SHOP.md](reverse-engineering/SHOP.md) · [SOCIAL.md](reverse-engineering/SOCIAL.md) · [SAVE.md](reverse-engineering/SAVE.md) · [UI.md](reverse-engineering/UI.md) | Other areas |

## Research

| Document | What it covers |
|---|---|
| [research/CDN-SURVEY.md](research/CDN-SURVEY.md) | Survey of the archived Miitomo CDN |
| [research/KAERUTOMO.md](research/KAERUTOMO.md) | Community work around Miitomo (custom servers, related projects) |

## Miitomo Reboot (new features)

| Document | What it covers |
|---|---|
| [reboot/SOCIAL.md](reboot/SOCIAL.md) | R2 several Miis, R2b social life |
| [reboot/PUBLIC-ROOMS.md](reboot/PUBLIC-ROOMS.md) | R3 public room |
| [reboot/SOCIAL-HUB.md](reboot/SOCIAL-HUB.md) | R4 social hub "Piazza" (+ R5 places) |
| [reboot/FRIEND-ROOMS.md](reboot/FRIEND-ROOMS.md) | R5 friends' rooms (the visited side of R3) |
| [reboot/GAME-ROOM.md](reboot/GAME-ROOM.md) | R5 Sala Giochi, game model, Quiz dei Mii |
| [reboot/MIIPHONE.md](reboot/MIIPHONE.md) · [reboot/MIINSTAGRAM.md](reboot/MIINSTAGRAM.md) | R5 MiiPhone and MIInstagram |
| [reboot/I18N.md](reboot/I18N.md) | R5 English + Italiano |
| [reboot/SERVER.md](reboot/SERVER.md) | Planned own backend (R10); contracts already in the client |
| [reboot/MINIGAMES.md](reboot/MINIGAMES.md) · [reboot/EVENTS.md](reboot/EVENTS.md) · [reboot/REWARDS.md](reboot/REWARDS.md) · [reboot/NOTIFICATIONS.md](reboot/NOTIFICATIONS.md) | Planned phases (design notes only) |

## Material that is not published

Some documents mention files that stay on the maintainer's computer and are **not** in this repository, because
they are derived from Nintendo's APK or CDN:

- `reference-metadata/`: hashes, symbol, RTTI and API lists extracted from the APK;
- `docs/reverse-engineering/evidence/`: screenshots taken during research;
- `docs/research/data/`: CDN listings and coverage tables;
- `tools/asset-extraction/cdn-fetch.ps1` and its selection lists.

References to these paths are kept so the research stays traceable, but the files are not available here.
