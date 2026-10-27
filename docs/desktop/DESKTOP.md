# Desktop app (Windows .exe): accounts, launcher, peer-to-peer friends

**Classification: NEW.** This is a desktop shell around the web client and is not part of the original game. Classic
and Reboot are the same code as in the browser.

The app is a single program, `MiitomoWeb-<version>-portable.exe`. It:

1. **opens with login or sign-up**, using local accounts on this PC;
2. **shows the launcher**: your Mii moves in your room behind the menu while the original music plays, and you
   choose **Miitomo Classic** or **Miitomo Reboot**;
3. **connects you to your friends peer-to-peer**: on the same network automatically, and over the internet with
   invite codes. No server is involved.

The `.exe` contains the app and the web client only. It holds no Miitomo or Nintendo file: no models, textures,
music, fonts or images. The Mii, the room and the music in the launcher come from **your own files**, which the app
reads from a folder you choose (by default, the folder of the `.exe`). The file patterns are the same as for
`tools/serve-local.ps1`:

- `Miitomo_*.apk`;
- `asset_env*.zip`;
- `asset_model_character_*.zip`;
- `local-assets/cdn/*.zip`.

## Use

1. Put `MiitomoWeb-…-portable.exe` in the folder with your files, or choose the folder later from the launcher.
2. Start the `.exe` and create an account (username and password). The account stays on this PC.
3. In the launcher choose **Classic** or **Reboot**. To come back to the launcher use **Ctrl+L**, or the menu
   Miitomo → Launcher. **Esci dall'account** logs you out.
4. Use **Friends** (in the launcher) to add friends.

## Accounts (`desktop/lib/accounts.cjs`)

- **Password.** It is never stored. The app stores `scrypt(password, salt)` and compares it in constant time.
- **Identity key.** Each account has an **Ed25519 key pair**. The public key is your identity towards friends. Your
  peer id is `p2p-` followed by 16 hex characters, and your friend code is `MTW-XXXX-XXXX-XXXX`; both are derived from
  the public key.
- **Private key.** It is encrypted with a key derived from your password (scrypt + AES-256-GCM). It is decrypted only
  in memory, after login. Only the main process signs: the pages never see the key.
- **Separate storage.** Each account has its own browser storage: its own save, Reboot data and P2P friends.
- **Storage file.** Accounts are kept in `%APPDATA%/Miitomo Web/accounts.json`. A damaged file is kept aside, never
  overwritten.
- **Changing the password** keeps the same identity, so your friends still recognise you.

## Launcher (`client/web/src/launcher/`)

- The launcher works with `?launcher=1`, in the app and in a browser.
- The game boots behind it as usual. Under the launcher Reboot is never loaded.
- **Music.** The original title music plays if your files have the `bgm_titleSceneInit` chain (`RoomSound.canPlay`).
  Otherwise the room music plays. In both cases it comes from your own files.
- **Missing files.** If your files are missing, the launcher says so and offers to choose the folder.

## Peer-to-peer (`desktop/lib/lan.cjs`, `client/web/src/p2p/`)

**Where it runs.** The P2P engine runs in a hidden page of the account (`p2p.html`). It keeps your connections when
the game page changes (launcher → Classic → Reboot). The game pages talk to it on a `BroadcastChannel`.

| Part | How |
|---|---|
| Finding players on the LAN | UDP beacons on port 47777 (broadcast). They carry the peer id, public key and name. They are **not trusted**. |
| Connection | WebRTC data channel, encrypted (DTLS). Offer and answer are whole SDPs, sent over UDP on the LAN, or as invite codes. |
| Identity | Handshake on the channel. Each side signs `both nonces + both DTLS fingerprints` with its Ed25519 key. A relayed or replayed handshake fails. The peer id must match the key. The signed message repeats the hello, because the very first message can be lost when the other side's channel is not open yet. |
| Friends | A friend is pinned to their key: the same id with another key is refused. On the LAN: request, then accept or decline. With codes: both people exchanging the codes is the consent. |
| Internet | Invite code (`MTWI1.…`) → reply code (`MTWR1.…`). Codes are compressed and last 15 minutes. A public STUN server (Google) finds the public address. It can be switched off, and no game data passes through it. |
| Large messages | Split into 15 KB parts and rebuilt (a photo post is about 100 KB). |

What travels between friends:

- **The game profile**: their Mii data, name, birthday, personality, greetings, voice, outfit and room. It is
  sanitized like any untrusted profile (`sanitizeFriend`). A P2P friend then appears in the friends list of Classic
  and Reboot **with their own Mii**, so the original friend features work with them: watching their room and inviting
  them as a guest.
- **Reboot MIInstagram** (`reboot/miinstagram/P2PFeedSync.ts`):
  - your posts, with their photo, go to your friends;
  - your reactions and comments go to the post's author, who sends the updated post to everybody;
  - deletes are sent too;
  - when a friend comes online, they receive your 10 latest posts.
  Only real people are carried: the simulated local Miis never act in a real friend's name. A post always counts as
  the **sender's**, so no one can post as someone else.
- **Presence**: online or offline, in the launcher and in Reboot → MiiPhone → Friends.

## Limits (as of today)

- **No TURN relay.** Two players behind strict NATs (symmetric or carrier-grade) may fail to connect over the
  internet. The LAN always works.
- **Invite friends do not reconnect by themselves** after a restart: there is no server to find each other. They
  exchange new codes, and the friendship stays (it is pinned). Friends on the same LAN reconnect by themselves.
- **No live co-presence yet.** You do not see your friend move in your room in real time. Their Mii, room and posts
  are real; how the Miis move in a scene is still simulated on each PC (as in R5). Real-time multiplayer is R11.
- **Invite codes contain IP addresses.** Give them only to your friends.
- **Not code-signed.** Windows SmartScreen may warn the first time.
- **Untested on Windows from this session.** The `.exe` was built and inspected in the cloud, and the same packaged
  app was run on Linux. Running it on Windows is for the maintainer's PC.

## Build

```bash
cd client/web && npm ci && npm run build          # the web client (two pages: index.html, p2p.html)
cd ../../desktop && npm ci
npm start                                          # run from source
npx electron-builder --win portable --x64          # → desktop/release/MiitomoWeb-<version>-portable.exe
```

The `Desktop app` workflow (`.github/workflows/desktop.yml`) runs the end-to-end test on Linux, then builds the
`.exe` on `windows-latest` and attaches it to the run. It starts by hand, or on a `desktop-v*` tag.

## Tests

| Test | What it checks |
|---|---|
| `tests/desktop/accounts.test.cjs` | Accounts (register, login, wrong password, keys, password change, damaged file) and the scan of your files (patterns, no path escapes) |
| `tests/unit/p2p.test.mts` | Wire checks, parts, handshake transcript, peer ids, invite codes (expired, wrong kind, forged), P2P friend → game friend |
| `tests/unit/p2pfeed.test.mts` | MIInstagram between two players: posts with photos, reactions and comments both ways, deletes, catch-up, forged messages refused, no simulated actions in a real friend's name |
| `tests/desktop/desktop.e2e.mjs` | The real Electron app, two instances: sign-up, launcher, LAN discovery, friend request and accept, a 60 KB message, unfriend, invite codes, Classic and Reboot (P2P survives the page change), MIInstagram post between the two over P2P, logout and login, persistence |
| `tests/desktop/packaged.smoke.mjs` | The packaged app (electron-builder output) loads the login and the launcher from its own resources |

## Hotfix 0.1.1 (2026-10-28): silent audio, head too big

The user ran 0.1.0 on Windows and saw two problems: **no sound**, and **the Mii's head enormous compared with its
body**. What follows is what was found in the code, what was changed, and **what was really tested**.

### Causes found

| # | Cause | Effect | Change |
|---|---|---|---|
| 1 | **File discovery too narrow.** The app listed only the names of `serve-local.ps1`: the APK, AFL, `asset_env*` and the animations in the folder itself, plus `local-assets/cdn/*.zip`. Body and clothes packages, `sound*.zip` (all the music and effects), room models and so on, kept anywhere else in the folder, were never offered. In the browser the user had imported them by hand. | No music or effects (the `sound/*.mp3` / `*.wav` files missing). Incomplete body, so no body part carries the `Head` joint (see 3). | `desktop/lib/assets.cjs`: every `.apk`, `.zip` and `.dat` of the folder and its sub-folders (3 levels) is listed. The game keeps the ones it needs (`wantedSource`), the same choice as a hand import. Missing files are imported on the next start. |
| 2 | **One AudioContext per RoomSound, never closed**, and the object was thrown away on every import (`afterAssets`). | Chromium limits the AudioContexts a page can have: past the limit, `new AudioContext()` throws and the error went to the console only. A new import during the music cut the music, and it did not come back. | One shared AudioContext per page. `RoomSound.reload()` reads the tables again and restarts the current music, keeping the context and the gains. |
| 3 | **The head without a skeleton was added unscaled.** In `buildSlot` (and for guests), when no body part had the `Head` joint, the FFL head went onto the root without AFL's S(0.1). In the room the root is in body units. | The head was **10× too big**: 68.7 units against a Head joint at 5–10. | `body/HeadAttach.ts`: one function applies S(0.1) **once**. With a skeleton, under the `Head` anchor; without one, on a stand at the same scale, with the reason recorded. The lab keeps its look. |
| 4 | **System voices arrive asynchronously** on Windows / Chromium: `getVoices()` is `[]` until `voiceschanged`. The game chose its voice at start-up. | The voice was silent for the whole session, with no reason given. With no Italian voice installed, it was silent too. | While the list loads, the line waits (up to 2.5 s). The voice is chosen by the line's language (Italian dialogue; Reboot lines in the Reboot language). A missing voice gives a clear message: *Impostazioni → Ora e lingua → Voce → Aggiungi voci*. The voice is chosen again when the list changes. |
| 5 | **Launcher music.** It used the title music only when `canPlay`, and otherwise relied on the room music. | No reason was given when nothing played. | `startMusic()`: title music → room music → nothing. Each step keeps its reason (`RoomSound.explain`), and the music waits for decoding before reporting. |
| 6 | **Hidden failures.** Missing or undecodable files, files missing from the local store, and a suspended AudioContext were all silent. | No way to see what was wrong. | `RoomSound.status()`, the BGM chain state with its reason, and decoding / storage errors with their messages. |

**Electron.** `autoplay-policy=no-user-gesture-required` is still on, but it is no longer the only safeguard: every
click or key resumes the AudioContext.

**Diagnostics and audio test** are in the launcher, in the footer: *Diagnostica e test audio*.

- The buttons are: ▶ Music, ▶ Effect, ▶ Voice (Italian / English), Mute / Sound back, and *Copy the report*.
- The panel shows, in plain words:
  - the AudioContext state;
  - which sound tables and files were found;
  - the title and room music chains, with the reason when one is missing;
  - the gains;
  - the voices installed and the voice chosen;
  - the files found by kind;
  - the head attachment (Head joint or stand, with the reason);
  - the **measured** ratio between head height and Head joint height.

### What was really tested

| Test | Where | Result |
|---|---|---|
| Unit: `voice.test.mts` (10): voice list empty at start then arriving (as on Windows), Italian and English choice, a clear message when a voice is missing, no voice at all → silent with a reason | Node | pass |
| Unit: `headattach.test.mts` (12): head 6.87 units (68.66 × 0.1, once) with and without a skeleton, headwear at the same conversion, lab unchanged, the old branch measured as out of proportion, height / build kept | Node, real three.js transforms, stand-in body parts | pass |
| Unit: `accounts.test.cjs`: file discovery in sub-folders, sound and body zips in the folder itself, nearest copy wins, `node_modules` skipped | Node | pass |
| E2E `tests/desktop/audio.e2e.mjs` (16), on the **real Electron app** with **synthetic sound files** (the real table chain, our own tones): files found, the 4 tables loaded, AudioContext `running` without a click, title missing → reason shown, room music, MP3 decoded and playing, gains, a WAV effect, the voice (no voices on Linux → the message), mute and sound back, Classic and Reboot pages (music starts by itself after the files are restored), the app closed and reopened | Linux + Xvfb | pass |
| E2E desktop + P2P (`desktop.e2e.mjs`) | Linux + Xvfb, 3 runs | pass |
| Reboot UI smoke (`r5-ui.smoke.mjs`) | Chromium | 61/61 |
| Windows `.exe` 0.1.1 built; the same packaged app started | build only (Linux); packaged app started on Linux | the `.exe` was **not run** |

**Not verified.** These are not claimed as fixed until they are tried on Windows with the user's own files:

- the real Miitomo music and effects;
- Windows voices;
- the Mii's proportions in the launcher, in Classic and in Reboot (with screenshots).

The cloud session has neither Windows nor the Miitomo files: without AFLResHigh no Mii can be rendered, and without
the APK and the CDN zips there is no original audio.

### Checks on Windows (maintainer)

1. Start `MiitomoWeb-0.1.1-portable.exe` in the folder with the files. Use a new account, or the old one: the
   missing files are imported at start.
2. In the launcher, open **Diagnostica e test audio** and press ▶ Musica, ▶ Effetto, ▶ Voce. Each row must be green.
   If not, the row says why. Use *Copia il report* to send the report.
3. Check **Proporzioni del Mii**:
   - "testa agganciata" must say *joint Head di …*;
   - the head / joint Head ratio must say *proporzioni attese* (0.7–1.3).
4. Take screenshots of the same Mii in the launcher, in Classic and in Reboot.
5. Check mute and sound back, Classic → Reboot → launcher (Ctrl+L), then close and reopen the app.

## Hotfix 0.1.2: closet / room thumbnails missing, bottom bar always Italian

Reported after 0.1.1 ("works", but): every thumbnail of the Guardaroba and Arreda stanza menus was missing, and the
bottom bar stayed in Italian with English chosen.

| Problem | Cause (in code) | Fix |
|---|---|---|
| No thumbnails in Guardaroba / Arreda stanza / shop | `WANTED_SOURCE` (`client/web/src/assets/vfs.ts`): the rule for the dated weekly CDN zips (`20161110…webp.zip`, `…-message.zip`) had slipped into the comment of the line above, and `asset_capture2_item.zip` was never listed. The local import (desktop app, serve-local) reads only wanted sources, so the thumbnails were never imported. Picking the files by hand in the browser was not affected. | Rules restored. At the next start the game imports every zip of the folder that was never imported, so a 0.1.1 cache is completed by itself. Diagnostica shows `miniature` (found) and `miniature importate`. |
| Bottom bar in Italian in English | The shared shell (`Play.ts`: bottom bar, friend-room bar, Menu) draws the original Italian texts (`tabBtn00/01`, `menuBtn01/04` msbt) and knew nothing of the Reboot language. | Reboot only: `RebootHost.setShellLabels` + `reboot/i18n/shell.ts`. English (and the other languages) use Reboot strings; Italian keeps the original texts; the labels on screen change at once. Classic (`?reboot=0`) is unchanged. |

Tested (Linux, Xvfb): unit `shell.test.mts` (10, fails on the old filter); desktop E2E `audio.e2e.mjs` (+2: a fake dated
zip in `local-assets/cdn` is imported with its thumbnails; a zip added between two starts is imported at the next start);
`r5-ui.smoke.mjs` scenario K (real built app: bar + Menu switch EN ↔ IT at once; Classic stays Italian); all unit suites;
desktop P2P E2E. Not verified: Windows, the real CDN zips (the fixture holds placeholder bytes, only their import is
tested, not that the pictures draw).
