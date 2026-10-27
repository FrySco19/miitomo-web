# Reboot — minigames (R6 engine, R7 three games; planned)

## Engine (R6)

The engine is made of five parts:

- `MiniGameDefinition`: id, title, players (min/max), duration, `create(session)`.
- `MiniGameSession`: lifecycle `ready → playing → finished | aborted`, timer, score, players. The input stays local
  for single-player; multiplayer is ready through presence.
- `MiniGameResult`: per player, score and rank.
- `MiniGameReward`: hooks into the reward system of R8 (RewardGrant).
- Leaderboard: `submitScore` and `leaderboard`. The server re-validates every score: duration, maximum points per
  second, replay `proof`.

The engine runs inside the room engine. Miis, camera, audio and effects come from the shared infrastructure.

## The three prototypes (R7)

### A. Miitomo Drop 2.0

- **Classic version.** The original Miitomo Drop ("Sgancia Mii") stays CLASSIC: 37 original stage boards and Chipmunk
  physics, with prizes classified as SERVER DATA MISSING.
- **Reboot version.** Drop 2.0 is a NEW game, built on the same physics idea, with new boards and new rewards.
- **Assets.**
  - It uses only assets we are allowed to use.
  - Original boards recovered on the user's machine may be offered as a local option, kept separate and never
    distributed.

### B. Quiz dei Mii

- A round has a question, answers, a timer, a score and a result.
- **Question sources.** Questions come from a provider, so server-side questions are possible later. They are written
  by us, or drawn from the user's and friends' own answers ("Rispondono tutti"-style).
- **No invented Nintendo content.** The game never invents thousands of questions and never presents generated
  questions as original Nintendo content.

### C. Fashion Challenge

A round runs as follows:

1. A random theme is drawn from a new, labelled theme list.
2. The player picks an outfit with the Classic wardrobe engine.
3. The other Miis vote. Before the server exists, local friends vote with simple personality-weighted heuristics,
   and those votes are clearly marked as simulated.
4. The result is shown.
