# Reboot — notifications (R9, planned)

## Kinds

These are the `NotificationKind` values in the contracts:

- `comment`
- `reaction`
- `friendOnline`
- `visit`
- `event`
- `gameResult`
- `reward`

## Delivery

- **Local (before R10).** `LocalRebootProvider` produces notifications from local happenings, such as a friend
  visiting (R2 guest events, already exposed through `RebootHost.onGuest`), a minigame result or a reward.
- **Server (R10/R11).** Notifications arrive through the realtime `notification` event and `GET /v1/me/notifications`.
  `markRead` marks them read.

## UI

- The Miitomo style is kept: a telop at the top, like the original "{name} è qui!" telop, plus a list in the Reboot
  hub.
- Notifications from muted or blocked profiles are dropped.
- Users can turn each notification kind on or off. That setting is persisted in the Reboot keys.
