# Reboot — Sala Giochi (R5)

The Sala Giochi is a **place**: the user's Mii walks into a room (a look the user's own room does not have, from the
user's files), where other local Miis hang out. From its games board the Miis present can play together. It is REBOOT
and local; the other players are the user's local Miis, simulated on this device and labelled as such.

## Model (`client/web/src/reboot/games/`)

| File | Role |
|---|---|
| `types.ts` | `GameDefinition`, `GameLogic`, `GameView`, `GameResult`, `GameReward` |
| `GameRegistry.ts` | The list of games; a new game is a new definition, nothing else changes |
| `GameSession.ts` | One match: `ready → playing → finished / aborted`, players leaving, result validation |
| `MiiQuiz.ts` | The first game: "Quiz dei Mii" |
| `GameRoomController.ts` | The room: starting a match, Mii reactions, stats, rewards, cleanup |
| `GameRoomView.ts` | Games board, match panel, result |

A game defines id, texts (i18n keys), players (min / max), nominal duration, rules, availability, the logic and an
optional reward. The logic is pure and driven by the room clock (`tick(dt)`), so it pauses with the room and runs
unchanged in tests.

## Quiz dei Mii (roadmap R7, game B)

How well do you know your Miis? Questions are built **only from facts the user entered**: birthdays, personality types
and the greeting each Mii says when coming in ("Who says «Ciao, sono Lucia!» when coming in?", "Whose birthday is on
3/3?", "Whose birthday comes first in the year?"). With fewer than three possible questions the game is unavailable
and says why. Nothing is invented and nothing is presented as Nintendo content.

- Up to 5 rounds, 2–4 names per question, 12 s to answer; 100 points for a right answer plus up to 50 for speed.
- Simulated players answer with a delay and an accuracy set by their personality (Espansivo quick and impulsive,
  Riservato slow and careful) and by how well they know the Mii the question is about (relations).
- Reward: "Stella del Quiz" badge (local, R8 will own rewards) when the user wins with at least 300 points.

## The Miis in the Sala Giochi

- Players are **reserved** from R2b social life (`SocialLife.reserve`): their conversation ends politely, their
  activity is suspended. Social life keeps running for everybody else; there is no second social life.
- During a match the stage is an **attraction**: idle Miis may walk up and watch it; R2b glances follow whoever talks.
- Reactions use the existing commands only: players walk to their spots and face the front, right answers wave, a
  wrong one says "Uffa, ho sbagliato!", the winner waves and celebrates, the others turn to the winner.
- After the result, "Torna alla sala" releases the players: back to their normal activities.

## Errors

| Code | When |
|---|---|
| `GAME_UNAVAILABLE` | Unknown game, or not enough facts / players for it |
| `SESSION_ACTIVE` | A match is already running |
| `NOT_IN_ROOM` | Games are started inside the Sala Giochi |
| `NOT_ENOUGH_PLAYERS` | Fewer free Miis than the game needs |
| aborted `INTERRUPTED` | The user left the Sala Giochi during the match |
| aborted `INVALID_RESULT` | A score was impossible (not an integer, negative, above the maximum, unknown player) |
| aborted `NO_PLAYERS` | Every player left |

A player leaving the room drops out (their score stays, they are released); the match goes on while the user is in it.
The MiiPhone is hidden during a match, so it never covers the answers.

## Persistence

`mtw.reboot.games` (schema v1): matches played, matches won, best score per game, badges. Corrupt data → fresh stats.

## Tests

`tests/unit/gameroom.test.mts` (registry, questions true to the user's data, session lifecycle, invalid result,
interruption, player left, stats, cleanup, reserve / release, affinity) · scenario D in `tests/e2e/r5-ui.smoke.mjs`
and `tests/e2e/r5-social.smoke.mjs`.
