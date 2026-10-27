# WARDROBE.md — wardrobe in PLAY (M10, 2026-10-25)

| Topic | Status | Source |
|---|---|---|
| Item models, colour lists, exclusions, variants | VERIFIED / REVERSED (M6/M6.1) | CDN asset_model_character_*, colorlist |
| Item names | VERIFIED text, mapping DEDUCED → confirmed visually | System/Clothes/Wearname.msbt (APK; updated copy in 20180405…-message.zip). Label `WNAME<c><id:6>00`, c = 1 all, 2 tops, 3 bottomsA, 4 bottomsB, 5 shoes, 6 acce, 7 headwear, 8 topslong. Counts per digit match the catalogue; tops0002 = "Set alla marinara (giacca)" renders as the sailor jacket. |
| Thumbnails | VERIFIED (data) | asset/capture2/small/character/<dir>/<dir><id>_<colour>.webp in the 47 dated CDN zips + asset_capture2_item.zip |
| Category icons | VERIFIED (data), category ↔ icon DEDUCED from the art | userData/closet_icon_data.xml categoryBtn00..08 → commonResRoot icon00 atlas: 416 clock (recent?), 536 shirt+star (new/favourite?), 403 tops, 409 all-in-one, 404 bottomsA, 405 headwear, 406 bottomsB, 407 shoes, 408 acce |
| Closet screen | APPROXIMATED (web layout) | side panel over the room: category tabs, item grid with names/thumbnails, colour swatches, "Togli" |
| Ownership | PLACEHOLDER | every imported package is available ("preservation mode") until shop/inventory rules are reversed (SHOP.md) |
| Closet camera | not used yet | userData/closet_camera.xml exists (original camera for the closet) |

## Room skins (Arreda stanza)
| Topic | Status | Source |
|---|---|---|
| Names | VERIFIED text, label scheme DEDUCED (confirmed by the blue default wall and the flower wall rmWl0010 "Parete bianca con stampa") | System/WallPaper/WallpaperName.msbt `PNAME<11 wall / 12 floor><id:4><AL:2>` (168 walls, 86 floors) |
| Thumbnails | VERIFIED (data) | asset/capture2/large/room/roomWall/rmWl<id>_AL<vv>.webp, roomFloor/... (dated CDN zips) |
| Variants | walls: every AL listed in Mdl_room.xml; floors: AL00 only for now (the room build applies one variant index to both skins) | |
