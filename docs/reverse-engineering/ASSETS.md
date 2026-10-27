# ASSETS.md — Miitomo 2.4.0 resources

## Bundled in the APK (46 MB, 2,479 files under `assets/`) — High
| Dir | Files | Content / format |
|---|---|---|
| `assets/message/Release/Console/<locale>/Client/` | 2,034 `.msbt` + `.msbp` | MessageStudio text, 12 locales: JPja USen USes USfr USpt EUen EUde EUes EUfr EUit EUnl EUru (EUit: 177 files) |
| `assets/asset/layout/*/Published-iOS/` | 263 `.ccbi`, `.plist`, `.pvr.ccz`, png/webp | CocosBuilder UI layouts + sprite sheets (boot, common, menu, system, tutorial) |
| `assets/asset/layout/font/` | ttf/otf | Nintendo "Seurat" fonts (proprietary) |
| `assets/asset/model/` | 4 zips | **samples only**: `bodyAll0400`, `headwear0502`, `rmWl0000`, `rmFl0000`; inside: PowerVR `.Mdl.pod`, `.pvr` textures (AL00 albedo / MSK mask / NRM normal), `*_model.xml`/`*_room.xml` |
| `assets/asset/effect/effect.ptcl` | 3 MB | NintendoWare eft2 particle binary |
| `assets/asset/env/lut/` | tga + xml | fresnel/lighting LUTs |
| `assets/asset/capture2/` | | capture (photo) presets |
| `assets/shader/` | 8 | GLSL ES: `MiiDefaultShader`, `LUT`, camera YUV shaders |
| `assets/sound/` | 30 | UI SE (wav), `murmursound_*.raw` (Mii murmur voice), BGM_First_Sequence.mp3 |
| `assets/userData/` | 9 xml | camera presets, `cloth_data.xml`, `closet_icon_data.xml`, `shop_icon_data.xml`, `afl_expression_data.xml` |
| `assets/npf.json` | | NPF SDK config (contains credentials — do not redistribute) |

## Downloaded at runtime (NOT in APK) — High
Referenced by name in libcocos2dcpp: `AFLResHigh_2_3.dat`, `AFLResHighLG.dat`, `AFLResMiddle.dat`, `AFLResMiddleLG.dat`,
`.Anim.pod` animation packs, all other `bodyAll*/headwear*/rm*` models, theme/channel images, posters, unused-assets.csv.
Mechanism: `NAAssetsManagerEx` + `NAManifest` (encrypted local manifest), `StartLayer::stateCommonFileDownload` /
`stateStageFileDownload`, URLs from `/v1/assets/manifest_urls`.

**Preservation status:** community says `AFLResHigh.dat` and `AFLResHigh_2_3.dat` survive in a 2018 Wayback capture of
`download-cdn.miitomo.com` (Medium, unverified by us). Coverage of clothes/rooms/animations is UNKNOWN → top research item.

## Format support plan for the web
| Format | Web path | Status |
|---|---|---|
| POD (PowerVR) | `client/web/src/formats/pod.ts` (+ Python ref `tools/asset-extraction/pod.py`) | RUNNING (bodies, .Anim.pod) |
| PVR v3 (+ .ccz zlib) | `formats/pvr.ts`: ETC1 → RGBA (bit-exact). Other pixel formats + .ccz: TODO | RUNNING (ETC1) |
| CCBI | port a CCBI reader (cocos2d-x 3.4 source is MIT) → web scene graph | RESEARCHED |
| MSBT/MSBP | well documented; parse in importer | RESEARCHED |
| AFLRes*.dat | FFL-family resource; loaders exist (`ariankordi/ffl`, `jaames/mii-assets`) | RESEARCHED |
| eft2 `.ptcl` | complex; defer, approximate later if needed | RESEARCHED |

## Files the client needs for M5 (all user-supplied, never bundled)
| Source | Entries | Purpose |
|---|---|---|
| APK | shader/LUT.vsh, LUT.fsh; asset/env/lut/*.tga; asset/model/character/bodyAll/output/bodyAll0400; asset/capture2/large/character/bodyAll/bodyAll0400_00.webp | original shader, LUTs, body, reference image |
| CDN asset_model_character_mii_AFLResHigh_2_3_dat.zip | AFLResHigh_2_3.dat | Mii parts |
| CDN asset_env_mii.zip | asset/env/mii/mii_model.xml | head materials |
| CDN asset_env_scene.zip | asset/env/scene/{default,archCamera,miiStudio}_scene.xml | lights |
| CDN asset_env.zip | asset/env/lut (same as APK) + sphereEnvMap/*.tga | sphere maps (not used yet) |
| CDN animation zips | asset/model/character/animation/output/*.Anim.pod | poses |

## Clothing (M6) — counts
| Category | CDN zips (manifest) | archived on Wayback | ColorList files | in APK |
|---|---|---|---|---|
| headwear | 467 | 467 | 481 | headwear0502 |
| bodyTops | 410 | 410 | 445 | — |
| bodyTopslong | 228 | 228 | 235 | — |
| bodyBottomsA | 273 | 273 | 281 | — |
| bodyBottomsB | 132 | 132 | 139 | — |
| bodyShoes | 201 | 201 | 207 | — |
| bodyAcce | 243 | 243 | 257 | — |
| bodyAll | 191 | 191 | 192 | bodyAll0400 |
| bodyMannequin | 6 | 6 | — | — |
Total: 2,151 clothing packages + 8 colorlist zips + xml/other_clothes.xml, all archived. Downloaded so far: 49-file sample (`tools/asset-extraction/selections/m6-sample.txt`), MD5 49/49. Stored in `local-assets/` (gitignored), imported into the browser by the user; never bundled.
Package layout: extensionless zip → `<stem>.Mdl.pod`, `<stem>.Mdl_model.xml`, `textures/android/<id>_ALnn|MSK|NRM.pvr` (ETC1).
