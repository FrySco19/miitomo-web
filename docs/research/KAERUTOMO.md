# Kaerutomo and related community work (researched 2026-10-25)

| Item | Finding | Confidence |
|---|---|---|
| Kaerutomo | Kaeru Team's custom server set for Miitomo, iOS + Android, free, >11,000 users, Discord discord.kaeru.world, beta via Patreon. iOS uses a jailbreak tweak (`world.kaeru.kaerutomo`). Credits: Shutterbug2000, FairPlay137 | Medium (project pages) |
| Kaerutomo source/protocol docs | **Not public.** No repo, no protocol documentation found | Medium |
| SakashoObfuscation (ariankordi) | Public encoder/decoder for Sakasho HTTP bodies, Fusion language, transpiled to C/JS/Python/Go, mitmproxy script, sample response. License not stated | Medium (repo exists); algorithm Low until verified |
| Tomiimo | Another revival mentioned in 2026 by ariankordi; source promised, not public | Low |
| FFL / AFL | FFL decomp (aboood40091), AFL-capable fork (ariankordi/ffl), FFL.js browser renderer, mii-assets extractor | Medium |
| CDN archive | Wayback capture of `download-cdn.miitomo.com/native/20180125111639/android/v2/...` incl. AFLResHigh(_2_3) zips | Medium |

Implications: Kaerutomo compatibility cannot be designed against documentation; we would have to contact the Kaeru Team.
Our own backend speaking the original REST shape is the realistic route.

Sources: https://kaeru.world/projects/kaerutomo · https://apt.kaeru.world/ios/dp/kaerutomo ·
https://github.com/ariankordi/SakashoObfuscation · https://ariankordi.net/posts/2026-mii-rendering-history/ ·
https://ariankordi.net/posts/2026-q2-update/ · https://github.com/jaames/mii-assets · https://tcrf.net/Miitomo
