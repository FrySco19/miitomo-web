# Reboot economy and shop (R6.0b)

**Classification: REBOOT, a new design.**

- Miitomo's prices, coins and candy were server data and were not preserved. The Classic shop stays a catalogue
  (`play/Shop.ts`, `DISABLED_ECONOMY`).
- The Reboot economy uses no real money, sells nothing for money, and gives no advantage in play.

## Coins (`reboot/economy/Wallet.ts`)

Coins are only earned through these rules:

| Rule | Coins | Limit | When |
|---|---|---|---|
| welcome | 50 | once | First start of Reboot |
| daily | 10 | 1 a day | First Reboot start of the day |
| game.played | 10 | 5 a day | A finished match in the Sala Giochi |
| game.win | 15 | 5 a day | Winning it (on top of `game.played`) |
| game.badge | 30 | once per badge | A new badge |
| post.photo | 5 | 3 a day | A photo posted on MIInstagram |
| visit.friend | 5 | 3 a day, once per friend per day | Entering a friend's room |
| friend.level | 25 | once per friend and level | A friend reaches a new relationship level |

- A refused payment changes nothing. The codes are `CAPPED` (the daily limit is reached) and `ALREADY` (that once-only
  payment was already made).
- Every change is written to the history. The history keeps i18n keys and references, so it follows the language.
- Storage: `localStorage` key `mtw.reboot.wallet`, schema v1. The record is validated on load; a corrupt or negative
  balance starts again at 0.
- From R10, our server validates every grant and spend with the same rule ids.

## Shop (`reboot/shop/`)

| Kind | Effect | Items |
|---|---|---|
| Cover | Colour of the MiiPhone (the dock and the open phone) | Orange (free), Mint 40, Sky 40, Berry 60, Grape 60, Night 120 |
| Card | Background of the card on My page | White (free), Sunset 50, Lagoon 50, Lilac 80 |
| Frame | Frame around the user's own photos on MIInstagram | None (free), Gold 70, Candy 70, Leaf 90 |

- Every look is drawn with CSS: there are no images and no Nintendo assets.
- `Inventory` stores what is owned and which item of each kind is in use (`mtw.reboot.inventory`, v1). Starters are
  always owned. Unknown ids are dropped on load.
- Errors: `UNKNOWN`, `OWNED`, `NOT_OWNED`, `INSUFFICIENT`.
- Covers can be tried on the phone before buying.
- When confirmations are on (Settings), buying needs a second tap.

**Not sold:**

- **Clothes.** The Classic closet lets the user wear every item of their wardrobe files, so selling them would only
  lock what is free.
- **Furniture.** It arrives with the house (R6.1) and is added to this catalogue.

## Tests

- `tests/unit/economy.test.mts`;
- the R6.0b checks in `tests/e2e/r5-ui.smoke.mjs`.
