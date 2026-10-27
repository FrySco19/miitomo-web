# Reboot — MIInstagram (R5)

MIInstagram is the Miis' photo-and-moments app. It lives **inside the MiiPhone**; it is not a place of the Piazza.
It should feel like Miitomo grew a gallery out of Miifoto, answers and the Miis' daily life, not like an Instagram clone
with Miis on it. It is REBOOT; other people's posts are SERVER REQUIRED (R10). Today every author is the user or one
of the user's **local** Miis, and the app says so.

## Posts are typed (`miinstagram/model.ts`)

| Kind | Content | Made by |
|---|---|---|
| `photo` | A Miifoto or a photo of the room + caption | The user |
| `activity` | A moment of the Miis' life (a real conversation, a match, a visit), stored as an i18n line | The Miis (simulation) |
| `answer` | A question (as data) + the answer | Model ready; created when answers exist (they were server data in Classic) |

Every post has author, time, reactions (one per person) and comments (author, text or i18n line, time, id).

**Reactions** (NEW, Miitomo-like set): Mi piace · Che ridere · Wow · Che carino. One per person per post: the same
reaction again answers `DUPLICATE_REACTION`, another one replaces it, a second tap takes it back.

## Miifoto 2: what R5 does with Miifoto

Miifoto is not rewritten:

- the Classic Miifoto screen gets **"Condividi su MIInstagram"** (Reboot only): the composed photo becomes the draft
  of a post on the phone;
- the composer can take a **photo of the room as it is now** (`RebootHost.snapshot`): several Miis in it, whatever
  they are doing, in any place (Casa, a friend's room, the Sala Giochi);
- a caption (up to 140 characters), publish, and the post is at the top of the feed at once.

Poses, expressions, backgrounds, stamps and text stay the ones of the Classic Miifoto. Several Miis posed together in
the Miifoto editor are out of scope for R5.

## The Miis on MIInstagram (`miinstagram/FeedSimulator.ts`)

Local friends react and comment like remote users will: through the service.

- **Personality** sets the chance to react and to comment, the delay, the kind of reaction and the tone and length of
  the comment (Espansivo: often, quickly, long and enthusiastic; Riservato: rarely, later, one or two words).
- **Relations** (`miinstagram/relations.ts`): a close friend reacts and comments more. Closeness starts at 0.35 for the
  user's friends and 0.15 between two friends, and grows with conversations, visits, matches, comments, reactions.
  Social life also picks close friends as conversation partners more often.
- **Moments become posts**: a real conversation between two Miis (4 lines or more), the end of a match (by the winner,
  or by a friend the user beat), the user's visit to a friend's room (by that friend).
- **No spam**: probabilities, a global cool-down (3 min), a cool-down per pair (15 min), at most 6 autonomous posts an
  hour, at most 3 Mii comments per post, one reaction per Mii, dedup keys (the same moment is never posted twice), a
  bounded action queue. The user's own moments are posted by the user only.
- Time is the room clock: the simulation pauses with the room and never runs in Classic.

## Service and persistence (`miinstagram/LocalSocialService.ts`, `PhotoStore.ts`)

`SocialFeedService` is the seam: the app, the simulator and the tests use only it. Today `LocalSocialService`; from
R10 a `RemoteSocialService` over the contracts already in `api/contracts.ts` (`feed`, `createPost`, `react`,
`comments`, `comment`, `deletePost`). The domain never knows where the data comes from.

- Posts, comments, reactions and photo references: `mtw.reboot.miinstagram`, schema `{ v: 1, seq, posts }`. Only
  data; no runtime or scene object is stored. A bare array (pre-schema prototype) is read as v0; data written by a
  newer schema is never overwritten (read-only, reported).
- Photos: IndexedDB database `mtw-reboot`, store `photos` (never the Classic save). If the browser refuses IndexedDB,
  memory only, and the app says photos will not survive a reload.
- Every stored post is untrusted on load: validated and clamped (`sanitizePost`).
- Bounded: 150 posts (oldest dropped with their photos), 40 comments per post.
- A failed write keeps the data in memory and reports `PERSISTENCE`.
- The user's comments and posts go through the client rate limits of R1.

| Error | When |
|---|---|
| `INVALID_POST` | Bad caption / comment / author / line |
| `IMAGE_UNAVAILABLE` | Not a JPEG / PNG / WebP data URL, too big, or missing from the photo store |
| `PERSISTENCE` | The browser refused to save |
| `DUPLICATE_REACTION` | Same reaction twice by the same person |
| `NOT_FOUND` | Deleted or missing post |
| `RATE_LIMITED` | Too many comments / posts in a short time |
| `FORBIDDEN` | Deleting someone else's post |
| `DUPLICATE` | An autonomous moment already posted |

## The app (`miinstagram/MIInstagramApp.ts`)

Feed in pages of 8 ("Mostra altri"), cards updated in place on service events, photos loaded lazily, comments folded
to the last two. The draft and the composer survive closing the phone. Avatars are a coloured initial by personality
(the Mii face icon is a later improvement).

## Tests

`tests/unit/miinstagram.test.mts` (typed posts, validation, order, pages, reactions, comments, delete, persistence and
reload, migration, persistence errors, rate limits, bounded history, personality-driven reactions and comments,
relations, activity posts, cool-downs, hourly cap, dedup) · scenarios E, G, I in `tests/e2e/r5-ui.smoke.mjs` and
`tests/e2e/r5-social.smoke.mjs`.
