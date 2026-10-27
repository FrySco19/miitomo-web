# CDN survey — download-cdn.miitomo.com (Wayback Machine CDX, captured 2026-10-25)

Raw CDX: `data/download-cdn.miitomo.com.cdx.txt` (7,020 rows, collapsed by urlkey). Captured Android asset list:
`data/cdn-android-v2-captured.txt`.

## Results — High (observed in CDX)
- 5,759 captures with HTTP 200, 1,261 with 403.
- Asset build `native/20180125111639/` (final build, Jan 2018), crawled almost entirely on **2018-05-02**, one week
  before shutdown (2018-05-09).
- `android/v2`: **2,854 captures with 200 = 2,466 unique asset files**; `ios/v2`: 2,769. All 1,238 Android 403s are under `manifests/v2_20180405_3_android/<file>`,
  i.e. crawler-guessed wrong paths, not missing real assets.
- **Both manifests archived (200):** `manifests/v2_20180405_3_android/manifest.json` (135,605 B) and the iOS one.
- Mii resources: `AFLResHigh` and `AFLResHigh_2_3` zips present.

| Category (android/v2, 200) | Count |
|---|---|
| headwear | 467 |
| bodyTops | 410 |
| bodyBottomsA | 273 |
| bodyAcce | 243 |
| bodyTopslong | 228 |
| bodyShoes | 201 |
| bodyAll | 191 |
| bodyBottomsB | 132 |
| roomWall / roomFloor | 117 / 63 |
| character animations (`*.Anim`) | 46 of 61 URLs seen |
| colorlist, mannequin, items, camera stamps/templates/bg, banners, env, shop | small sets |

## Manifest analysis (manifest.json v2.0.1481, engineVersion 2) — High
- Plaintext JSON: `packageUrl`, `remoteVersionUrl`, `remoteManifestUrl`, `assets{id:{md5,path,compressed}}`, `searchPaths`.
- **2,854 assets listed; 2,854 have a 200 capture → 100% URL coverage** (`tools/asset-extraction/cdn_coverage.py`,
  output `data/cdn-coverage.tsv`, `data/cdn-coverage-summary.txt`). (The earlier "2,466 unique" figure was a parsing error.)
- Includes: all clothing/headwear/room models, 23 animation packs, AFLResHigh + AFLResHigh_2_3, v2.0–v2.3 UI layouts,
  extra fonts, BGM/SE, Miitomo Drop stages, camera stamps/templates, colour lists, `xml_other_clothes.xml`,
  `unused-assets.csv`, per-locale message packs, and Nuance voice language data (`voice_languages_*`, user dictionaries).
- Caveat: a 200 capture does not prove intact content. Every downloaded file must be checked against the manifest MD5.

## Not yet known
- Server-side content (questions, themes, masters, shop prices) is API data, not CDN — not covered by this survey.

## Conclusion so far
The complete final downloadable catalogue appears to survive (pending MD5 verification). This makes a high-fidelity reconstruction realistic.
