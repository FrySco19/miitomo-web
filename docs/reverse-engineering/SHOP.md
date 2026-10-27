# SHOP.md — Negozio Miitomo (M15, catalogue only)

User decision (2026-10-26): **SHOP = CATALOGUE ONLY** — catalogue enabled, economy disabled. No invented prices, no fake
coins, no fake rotation. Unknown / server-only data is marked as such in code (`play/Shop.ts`) and in the UI.

## Flow
Negozio tab → **shop top** (`Layout/room/parts/layer3/shopTopImageListText00`: "Negozio Miitomo", "Nuovi articoli di
vestiario disponibili!", "Negozio"; banners `asset/shopBanner2/*.webp`) → **shop** (the shop interior, categories,
weekly arrivals "Arrivi d/m", try-on) → "Al negozio" back to the top / "Chiudi" → back to the room with the original
goodbye line (`Layout/shop/parts/layer2/shopPromotionText00` text00 "Arrivederci a presto!").

| Piece | Class | Evidence |
|---|---|---|
| Shop interior | ORIGINAL | CDN `asset_model_shop_output.zip`: shop0000.Mdl.pod + _model.xml + _scene.xml (lights) |
| Texts, buttons, category labels | ORIGINAL | Layout/shop/*, Layout/room shopTopImageList*, categoryTextBtn00 |
| Banners | ORIGINAL (images) | asset/shopBanner2 webp; which items each banner promoted = server (MISSING) |
| Item names, thumbnails, models | ORIGINAL | Wearname, capture2 thumbnails, character packages |
| Weekly arrival dates | VERIFIED | dated CDN zips (Thursdays 2016-11-10 … 2018-04-05) recorded at import in `meta/item-dates.json` |
| "Arrivi {2.2}/{2.1}" = day / month of those deliveries | DEDUCED | categoryTextBtn00 title00@categoryBtn01; tags 2.2 = day, 2.1 = month; numbers without leading zero (format APPROXIMATED) |
| Try-on in the shop with the closet camera | DEDUCED + APPROXIMATED | shop layout contains body/closet00.ccbi; Mii spot (0,0,−6) and camera framing APPROXIMATED |
| Prices, coins, ownership, stock, sales, rotations | **MISSING (server)** | `/v2/payment`, `/v1/inventories`, masters (API.md). Shown as "—"; `DISABLED_ECONOMY` |
| 9xxx ids (base / naked bodies) not sold | DEDUCED | ids |

## Architecture
`ShopItem { price: null, owned: null }` and the `ShopEconomy` interface (`enabled`, `currency`, `price()`, `owned()`,
`note`). Only `DISABLED_ECONOMY` exists. A future economy (our own server, or recovered master data) implements the same
interface; the screens already render a price slot. Leaving the shop restores the saved outfit: nothing is bought,
owned or saved. The save keeps `inventory.coins = 0`, `items = []`.

## Tests
`tests/e2e/m15-shop.smoke.mjs` (10 checks): original top texts and banners, shop venue, arrivals from the dated zips,
every price "—", try-on, category names, leaving restores the outfit and plays the goodbye line, no coins / purchases
in the save, zero console errors.
