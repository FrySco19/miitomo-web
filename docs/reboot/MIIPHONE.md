# Reboot — MiiPhone (R5)

The MiiPhone is the Miis' **digital layer**. The Piazza is the physical world (Casa, friends' rooms, Sala Giochi);
the MiiPhone sits above it. Opening it **never changes where the user is**: no location, presence or scene change, and
the world keeps running behind it.

## Where it appears

A small orange phone rests on the right edge of the screen in: Casa, the Piazza, the user's own public room, friends'
rooms and the Sala Giochi (not during a match). It is not offered on the other screens (closet, shop, Miifoto, setup),
and never in Classic (`?reboot=0` does not even download the code).

## Behaviour

- Tap → the phone slides in with a short animation; the world behind stays visible, slightly dimmed.
- Close (×, back on the home screen, Escape, a tap on the dimmed world) → the reverse animation, back to exactly the
  same scene.
- Reopening shows the app that was open last.
- Desktop and tablet: a phone beside the world. Narrow screens (≤ 560 px wide or ≤ 520 px high): the phone **is** the
  screen (no tiny phone inside the real phone).
- Reduced motion: the transitions complete at once.

## Code (`client/web/src/reboot/phone/`)

| File | Role |
|---|---|
| `MiiPhone.ts` | Model: `MiiPhone` (phase, app stack, last app, errors) and `MiiPhoneApps` (registry of `AppDefinition`) |
| `MiiPhoneView.ts`, `phone.css` | The phone on the right, the panel, the home screen, the language choice |

`phase` goes `closed → opening → open → closing → closed`, one transition at a time. The view reports the end of an
animation (`settle`); a time-out does it anyway if no animation runs.

| Error | When |
|---|---|
| `ALREADY_OPEN` / `ALREADY_CLOSED` | Duplicate open / close |
| `BUSY` | Any input during a transition |
| `APP_UNAVAILABLE` | Unknown app, or one only declared for the future |
| `HIDDEN` | The phone is not offered here; if it was open, it closes at once and keeps the last app |

## Apps

The home screen shows **implemented apps only**. R5 ships one: MIInstagram (see MIINSTAGRAM.md). Future apps can be
registered as `implemented: false`: they are never shown and never opened. An app is mounted into the phone screen
and unmounted when it leaves it, taking its listeners with it.

## Tests

`tests/unit/miiphone.test.mts` (open, close, duplicate open, input during transitions, app navigation, unavailable
apps, hidden places, state restoration, 20 cycles with the location untouched) · scenarios E, F, G and the responsive
checks in `tests/e2e/r5-ui.smoke.mjs`.
