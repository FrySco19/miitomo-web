# Reboot — events (R8, planned)

The event system is data-driven. An `EventDef` (in `reboot/api/contracts.ts`) has these fields:

- `id`, `title`;
- `cadence`: daily, weekly, seasonal or special;
- `startsAt` and `endsAt`, in server time;
- `effects`;
- `rewards`.

## What an event can change

An event can turn on or add any of these:

- activities;
- minigames;
- decorations;
- outfits;
- Miifoto items;
- public rooms.

Each is a list of ids. The client never hard-codes an event: it asks `events()` for the list and applies the active
ones.

## Local (before R10)

Before the server exists, there is a bundled JSON of new Reboot events, labelled as such. It contains **no**
recreation of Nintendo's original events, whose data is SERVER DATA MISSING in Classic.

## Time

- The server provides the time in R10.
- Locally, the device clock is used.
- Tests use the existing `testClock`.
