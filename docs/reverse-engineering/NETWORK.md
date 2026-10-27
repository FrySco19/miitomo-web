# NETWORK.md — Miitomo 2.4.0 client ↔ server

## Stack — High
`game C++ (sakashoHelper)` → `libsakasho.so` (DeNA Sakasho C API, 251 calls) → JNI → `jp.dena.sakasho.core.*` Java
(HTTP via `com.dena.android.httpclient`) → HTTPS. Identity via **NPF SDK** (`com.nintendo.npf.sdk`, Nintendo Account,
BaaS host `*.baas.nintendo.com`), with "Fujiyama" = Nintendo Account linking (Sakasho `FujiyamaAuthorize/IsLinked`, Medium).

## Hosts
| Env id | Game API | Support | Source |
|---|---|---|---|
| 2003/2004/2005 | `https://{3,4,5}-dev-game.miitomo.com` | `https://{n}-dev-support.miitomo.com/` | emulated, High |
| 2006,2008–2011 | `https://{n}-sb-live-game.miitomo.com` | `https://{n}-sb-live-support.miitomo.com/` | emulated, High |
| **2007** | **`https://api.miitomo.com`** | **`https://support.miitomo.com/`** | emulated, High (prod = Medium until init traced) |
| 10000 | `http://0.0.0.0:9292` | `http://0.0.0.0:9293/` | emulated, High |
- Assets CDN: `http://download-cdn.miitomo.com/native/<buildstamp>/android/v2/asset_<path_with_underscores>.zip`
  (community, via Wayback URLs, Medium). Manifests: `AssetGetAssetManifestUrls` → `/v1/assets/manifest_urls`, local
  manifest encrypted on disk (`encryptManifestFile/decryptManifestFile`).
- Nintendo: `accounts.nintendo.com`, `api.accounts.nintendo.com`, `my.nintendo.com` (My Nintendo "Members" missions).
- Third party: Facebook, Twitter, Adjust, Crashlytics, Google Analytics/GCM.

## REST surface — High (paths), Medium (path ↔ call mapping)
125 path fragments in `reference-metadata/miitomo-2.4.0.rest-paths.txt`, 251 calls in `...sakasho-api.txt`. Groups:
- Session/player: `/v1/session`, `/v1/player`, `/v1/players/@me`, `/v2/players`, `/v1/version`, `/v1/masters`, `/v1/schedules`
- Knowledge (Q&A): `/v1/knowledge/players/@me/{knowns,unknowns,unknowns_random,liked_knowns,pending_questions,counts,owners,...}`,
  `/v2/knowledge/players/@me/{questions,available_questions,available_bonus_questions,current_bonus_questions}`
- Sub-Mii knowledge: `/v1/sub_mii_knowledges[/liked|/sub_miis|/unread|/unread/random|/update_summaries]`
- Channel: `/v1/channel/{channels,themes,answers,answers/search,popular_answers,comments,likes,sub_resources,read_answers,post_like_gauge,...}`
- Friends: `/v1/players/@me/{friends,friend_requests,blocked_players,mute_players,star_accounts}`, `/v1/friend_code`, `/v2/players/@me/friend_suggestions[/pickup]`
- Messages (letters): `/v1/players/@me/{messages,received_messages,messages_and_player_data}`
- Mii: `/v1/miis`, `/v2/miis`, `/v1/miis/lock_someone`, `/v1/players/@me/shared_miis`, `/v1/mii_data_encryption/{encrypt,decrypt}`
- Economy: `/v1/inventories`, `/v2/payment/`, `/v2/virtual_currency/purchase_limit_status`, `/v2/login_bonuses`, `/v2/players/@me/login_bonuses`
- Progression: `/v2/achievements`, `/v2/fashionabilities`, `/v1/affections`, `/v1/mission_rewards`, `/v2/players/@me/missions/progress`
- Social: `/v1/timeline`, `/v1/timeline_player`, `/v1/emotional_tags`, `/v1/sns/{connected,facebook/link,twitter/link}`
- Moderation: `/v1/inspections/violation_report/*` (9 report types), profanity check
- Album/Poster/Image: Sakasho `Album*`, `Poster*`, `ImageUploadImage` (paths not all recovered yet)

## Body obfuscation
Native functions `CookedRequestBody.cookRequest`, `CookedResponseDelegate.cookResponse`, `SakashoRequest.generateRequestSignature`,
`SakashoSystem.setCommonKey(String)` (key passed from Java parameter, not a literal) — High.
`LZ4_compress` / `LZ4_decompress_safe` exported from libsakasho — High.
Community description (`ariankordi/SakashoObfuscation`) — **Low until verified**: varint(decompressed size) + raw LZ4 block,
whole buffer transformed per byte with key table `k=table[(i+1)%L]`: XOR if `k&7==0`, else rotate by `k&7`; table = 32-byte
common key optionally + `player_session_id` cookie. Separately, requests carry a signature (`generateRequestSignature`) not
covered by that description.
**Verification plan:** emulate `cookResponse`/`cookRequest` core with Unicorn on a known plaintext and compare.

## Security notes for the replacement backend
- The original trusted the client heavily (inventory, currency via NPF). The rebuild must validate everything server-side.
- `assets/npf.json` contains Nintendo client IDs and a basic-auth password for the My Nintendo webview. **Never reuse.**
- The client pins `*.miitomo.com` certificates; a Kaerutomo-style redirect needs patching — irrelevant for a web client
  that talks to our own backend.
