# Reboot — social layer

## Where it builds from

The social layer starts from these CLASSIC pieces:

- local friends: `social/Social.ts` `LocalProvider`, with sanitised and untrusted records;
- visiting a friend's room;
- one friend visiting your room (M18).

## R2 — several Miis in the same room (done)

**Machinery.** It is SHARED, in `main.ts`:

- `guests[]` with `guestCap`. Classic uses 1; Reboot sets it from the panel, from 2 to 8 Miis.
- Every guest has its own:
  - head and body (built with the user's renderer);
  - `RoomDirector` (state machine, path, door, touch);
  - faces, blink and talking mouth;
  - voice settings and personality.
- Speech goes to the guest who speaks (`talker`). The balloon is anchored on that guest, and the voice and gestures
  are that guest's own.
- **Door.** One Mii goes through the shared door at a time. Arrivals wait in `waiting` and exits in `exitQueue`;
  `doorTick` releases them.
- **Avoidance.** `linkOthers()` gives every Mii the positions of all the others present. `RoomDirector` keeps the
  personal distance (4.5) between every pair, and wandering avoids crowded spots. A walking Mii that meets another
  one **slides around it** on the personal circle instead of being pushed straight back. A stuck guard skips a
  waypoint after 2.5 s without progress. Without these two, three or more Miis could deadlock in a doorway. Both are
  APPROXIMATED and SHARED; m18, a single guest, stays green.
- **Not in lockstep.** `RoomDirector.reseed(n)` gives each guest its own sequence for idle look-arounds and wandering,
  and its own blink phase. The host keeps the default sequence.
- **Picking.** A tap chooses the nearest guest along the ray (`guestId`), and only that guest reacts.
- **Goodbyes one at a time** (found in R3, when a public room closes with 7 visitors). Several friends leaving
  together queue their original goodbye exchange (1.4 → 1.3) instead of cutting each other's balloon off. A watchdog
  sends a leaving Mii to the door anyway if its goodbye balloon was replaced. This is SHARED; a single guest behaves as
  in M18. R4 hardening:
  - the door queue retries a refused exit;
  - a leaving Mii that never got to the door goes anyway after 20 s;
  - social targets stay out of the door strip (z < −20);
  - glances skip leaving Miis;
  - personal distance holds in the whole room; only a Mii passing the door (entering or exiting) is exempt.
- **BGM.** The original `bgm_room` FRIEND_<type> line plays for the first guest present.

**Reboot side** (`reboot/multimii/MultiMii.ts` + the panel):

- capacity, persisted;
- invite one friend, or invite all until the room is full;
- dismiss one friend (original goodbye 1.4 → 1.3), or dismiss all.

**Classification.** Several Miis = REBOOT (new). The original showed one visiting friend at a time.

## R2b — social life (done)

**Code.** `reboot/social/` holds three files:

| File | Contents |
|---|---|
| `SocialLife.ts` | The layer itself (≈ 330 lines) |
| `traits.ts` | Personality parameters |
| `lines.ts` | Chat lines (NEW text, labelled) |

**Feature flag.** `SOCIAL_LIFE_ENABLED` is on by default when Reboot is on. Classic never loads this code.

**Principle.** The layer **decides**; the existing room machinery **does**. Every action goes through `RebootHost`,
which forwards it to the same `RoomDirector` methods the game already uses:

- `goTo`, `face`, `interact` and `wave`;
- `say`, which uses the single room balloon with the speaker's own voice, face and gesture. The gestures are the
  original ones, picked by the M13 rules from the words of the line.

So pathing, personal distance, sliding around other Miis and the 2.5 s stuck guard are still the only movement code.
Time comes from `onTick`, the room simulation step, so it works for real frames and for test-driven simulation alike.

### Perception (priority 4)

- `onSpeech` is fired by **any** balloon: Reboot chat, original greetings and player taps.
- Idle Miis within 24 units may turn toward the speaker. Each one uses:
  - its own personality chance (`react`);
  - its own delay (0.25–1.6 s);
  - its own cool-down (6–12 s).
- At most half of the candidates turn, with a cap of 3, so the whole room never looks at the same time.
- When somebody comes in, up to 2 Miis turn to the door. An outgoing (Nori) Mii may wave, using the original wave.
- Conversation partners face each other. Bystanders can walk up and **watch** a conversation; this is an activity.

### Conversations (priority 3)

1. A Mii picks a partner. Partners nearby are preferred, outgoing Miis search further, and the partner must be free.
   A partner busy with a walk is interrupted and its walk is resumed later.
2. The mover approaches to about 6.5 units. The user's Mii never walks on its own: guests come to it.
3. Both turn to face each other.
4. They talk in the order **open → reply → (follow-ups) → close → closing reply**. Personality sets the number of
   exchanges, and the less sociable of the two wraps it up.
5. Afterwards the less sociable one often walks away, and both get a cool-down before chatting again.

**One floor.** Only one conversation talks at a time, so there is never more than one balloon and no chaotic overlap.

- With n Miis, up to max(1, ⌊n/3⌋) conversations can be set up at once. With 8 Miis that is 2.
- A conversation that is ready waits for the floor for up to 12 s, then gives up politely.
- A conversation that cannot form ends cleanly: the mover cannot reach the partner after 3 retries, or after 18 s.

### Priorities

| # | Source | Effect |
|---|---|---|
| 1 | Player tap / command on a Mii (`onPlayer`) | 7 s lock. A conversation is **paused**, keeping its line, and resumes when both Miis are free again, or ends after 10 s. A walk is **suspended** and resumed later |
| 2 | Door (entering, leaving, waiting) | The Mii is left alone. A conversation with a Mii that leaves ends |
| 3 | Conversation | Partners are owned by the conversation |
| 4 | Social reaction | Glances, only from idle Miis |
| 5 | Autonomous activity | wander, use an object, watch a conversation |
| 6 | Rest | Idle animation and the original look-arounds |

### Personality

The parameters are in `traits.ts`. They are NEW design values, keyed on the 4 ORIGINAL types.

| Parameter | Effect |
|---|---|
| `chat` | Chance to start a conversation |
| `turns` | Length of a conversation |
| `approach` | Walking up to others, going to watch, staying close after a chat |
| `solo` | Walks to the emptiest spot of the room |
| `react` | Glances and waves |
| `wander` / `inspect` / `rest` | Activity choice |
| `pause` | Natural idle time between decisions |

Nori (Espansivo) chats most and longest. Cool (Riservato) chats least, stays further from the others and reacts less.
`tests/unit/social.test.mts` checks this over many seeds.

**Lines.** `lines.ts` is a small Italian set written for Reboot, labelled NEW. It is not Miitomo text. Cool and Nori
have a few tone variants. Original greetings (MSBT tags 1.2–1.5) stay in the Classic flows.

**Performance.**

- Decisions run on a 0.25 s step. Each Mii decides only when its own timer is due.
- Timers sit in a small queue, and nothing polls per frame.
- With 8 Miis a step reads 8 small views. Classic has no subscriber, so its hooks are empty loops.

### Fixes (2026-10-27)

- A tap on a Mii during the **last** line of a conversation used to end the conversation, because the balloon closed
  by the tap counted as a finished line. A line closed while either partner is under the player lock is now an
  interruption: the conversation pauses and resumes that line.
- An object activity suspended (by a conversation or a tap) before the owner of a public room forbade objects could
  resume afterwards. The room policy is now checked again whenever an object activity starts or resumes.

Both have a regression test in `tests/unit/social.test.mts`.

### Not done yet (documented, intentionally minimal)

- **No head-only look-at.** The skeleton supports it, but there is no head IK; glances turn the whole body.
- **Lines are generic.** They do not yet use the friends' own words (their greetings or "Rispondono tutti"
  answers). That needs the answer data from R5.
- **No three-way conversations.** Bystanders only watch.
- **The user's Mii never walks autonomously.** This is a design choice: only the player moves it.

### Tests

| Test | What it covers |
|---|---|
| `tests/unit/social.test.mts` (fake host, deterministic) | 8 Miis for 10 min: conversations, single floor, movement during talk, no lockstep, no synchronised orders, variety, nobody stuck, the host never walks, limited asynchronous glances; personality effects; tap pauses and resumes from the same line; suspended activities resume; door states respected; 2 Miis; a Mii leaving ends its conversation |
| `tests/e2e/r2b-social.smoke.mjs` (real engine) | The same, with 2 and then 8 real Miis, plus Classic not downloading the Reboot chunk |

## Safety

- Report, block, mute and privacy are local now (`api/provider.ts`) and server-enforced in R10.
- A blocked profile will never be invited, shown in feeds or let into your public room. That rule is enforced from R3
  and R5 onwards.
