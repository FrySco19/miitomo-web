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
