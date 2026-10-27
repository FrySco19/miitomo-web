# SOCIAL.md — friends and visits (M16)

User decision (2026-10-26): **FRIENDS = LOCAL NOW → OUR CENTRAL SERVER LATER.** Gameplay talks only to
`SocialProvider` (`client/web/src/social/Social.ts`): `LocalProvider` (this device) now, `ServerProvider` (our own
backend, not built yet) later. Nintendo servers and Nintendo authentication are never used. P2P is not the target: the
original was a central REST service (API.md) and nothing so far needs P2P.

## What the original did (evidence)
| Fact | Class | Evidence |
|---|---|---|
| Friend list, requests, codes, suggestions, star accounts, blocking | REVERSED (paths) | `/v1/players/@me/friends`, `friend_requests/*`, `/v1/friend_code`, `friend_suggestions` (API.md) |
| Visiting a friend's room | REVERSED (names) | `GoToFriendRoom`, `SequenceWatchFriend`, dialog002 `goToMiiRoom` "Vuoi visitare la stanza di {1.0}?" / `backToMyRoom` "Vuoi tornare alla tua stanza?" |
| Leaving | REVERSED (names) | `SequenceByeFriendInFriendRoom` (you leave a friend's room), `SequenceByeFriendInUserRoom` (a friend leaves yours) |
| Friend room tabs | REVERSED + ORIGINAL | `RoomTabWindowFriend{Profile,Cloth,Knowledge,FriendList,StockMiiKnowledge}`; labels cmnSection00 "Profilo", "Articoli", "Risposte", "Lista di amici" |
| Four greetings | ORIGINAL + VERIFIED | Saluti labels (greeting00): welcome "arriva un amico", goIn "fai visita a un amico", seeingOff "l'amico va via", goHome "sei tu che vai via"; tags 1.2 / 1.5 / 1.3 / 1.4 in RoomSceneTalkWords customGreeting*; `MiiGreetingFriendRoomTag`, `MiiGoodByeSeeingOffTag`, `MiiGoodByeGoHomeTag` (messagestudio RTTI); defaults in MiiCommonText |
| Friend room music | ORIGINAL | Action/bgm `BGM_MIIWATCH_FRIEND_{NAGOMI,NORI,DRY,COOL}` |
| Friends' Miis visiting your room, your Mii visiting theirs | ORIGINAL texts | telopWindow00 `comeFriend` "{1.0} è qui!", `absence` "{1.0} è nella stanza di {1.0:01}.", `absenceAndComeFriend`; RoomSceneTalkWords `comeBackFirst` "Ho fatto un salto a casa di {1.0}."; LaunchTips03 |
| Letters, birthdays, answers, comments, hearts, Miifoto log | ORIGINAL texts, server data | RoomSceneTalkWords sendLetter*/receiveLetter*/birthdayLetter*, notification texts (MISSING data) |

## What Miitomo Web does now (LocalProvider)
- **Amici** tab → "Lista di amici" (original title), "Amici: N", rows with "Cancella amico" (original), and
  "Aggiungi/invita amico" (original label). APPROXIMATED: "add" creates a local friend profile on this device through
  the normal creation screens (Mii, name, birthday, personality). Requests, codes, SNS and face-to-face pairing were
  server features and are not imitated.
- **Visit** (GoToFriendRoom): original confirm dialog → the friend's Mii, outfit, room skin, personality (gestures /
  faces), voice settings and greetings are loaded; the entrance plays; the host says its welcome greeting
  (`customGreetingWelcome`, tag 1.2 — who-says-what DEDUCED from the Saluti labels); BGM
  `BGM_MIIWATCH_FRIEND_<type>` from the friend's personality type (DEDUCED).
- Friend room bar: Profilo (name, birthday, internal type, local visit count), Articoli (worn items, original names /
  thumbnails), Risposte and Lista di amici (server data: shown as not preserved), Home → original "back" dialog → the
  host says its seeing-off greeting (`customGreetingSeeingOff`, tag 1.3) → the user's room, the user's Mii comes in.
- The friend's outfit cannot be edited from its room; the user's save is never changed by a visit (test-checked).
- Storage: IndexedDB `save` store, key `social.local` (`{format:"miitomo-web-social", version:1, friends:[…]}`); every
  record is untrusted and passes `sanitizeFriend` (id pattern, Mii data size, name ≤ 10, greetings ≤ 30, personality
  1..8, outfit ids / colours clamped, room skins). `LocalProvider.exportJson/importJson` exist for backup (no UI yet).

## M18 — a friend in the user's room (two Miis)
| Piece | Class | Notes |
|---|---|---|
| Arrival telop "{1.0} è qui!" | ORIGINAL | telopWindow00 text00@comeFriend, name tag 1.0 index 00 |
| Guest enters through the door (opens / closes it), then waves | REVERSED clips (door anims, wave In/loop/Out) | shared door: the director that last moved it drives the door pose |
| Guest greeting = its goIn (customGreeting, tag 1.5), then the host's welcome (customGreetingWelcome, 1.2) | ORIGINAL texts / DEDUCED order | each line in the speaker's balloon, with the speaker's nickname, gestures (own personality), emotion face, talking mouth, voice settings |
| Leaving = guest goHome (customGreetingGoHome, 1.4) → host seeingOff (customGreetingSeeingOff, 1.3) → exit through the door | ORIGINAL texts / REVERSED sequence name SequenceByeFriendInUserRoom / DEDUCED order | |
| Friend BGM while the guest is in the room: bgm_room FRIEND_<guest type> | ORIGINAL table / DEDUCED use | native callers pass type + 2 as the line |
| Tap the guest: SequenceTouch stroke + se_nade01 + arStroke, then its fixedGreeting | REVERSED table / DEDUCED that it applies to the guest | |
| Arrival spot next to the host, personal distance 4.5 units, wandering every 11–21 s | APPROXIMATED | no original data |
| Visit schedule: first visit 25–70 s after entering the room, stay 70–140 s, same friend again after 10 min; off under automation | APPROXIMATED | the original visits were decided by the server |
| The visit ends when the user leaves the room (shop, Miifoto, Mii Studio, a friend's room) | DEDUCED | separate scenes in the original |
Tests: tests/e2e/m18-guest.smoke.mjs (17 checks).

## Not yet (next steps)
1. Tap the guest → its menu (answers / profile: server data in the original).
2. The user's Mii going out ("absence" telop, `comeBackFirst`).
3. Friend editing (outfit / room of a local friend), export / import UI.
4. ServerProvider against our own backend (accounts, friends, visits, answers, comments, hearts, greetings, outfits,
   rooms, notifications) — schema to be designed from the reversed resource list, never Nintendo's service.

## Tests
`tests/e2e/m16-friends.smoke.mjs` (20 checks): original list texts, local add, original dialogs (visit / back /
delete), friend Mii + nickname, welcome and seeing-off greetings, friend BGM per type, original tab labels, profile and
items, closet blocked, user room and save unchanged afterwards, persistence across reload, input validation, delete,
zero console errors.
