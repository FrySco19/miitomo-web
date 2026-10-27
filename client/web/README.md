# client/web: the Miitomo Web browser client

Vite + TypeScript + three.js. Miis are rendered through [FFL.js](https://github.com/ariankordi/FFL.js)
(WebAssembly), with the original APK shader. Everything the game draws or plays comes from files the user imports
locally; nothing proprietary is bundled.

```
npm ci            # also copies the FFL WebAssembly module into public/ffl (postinstall)
npm run dev       # http://localhost:5173
npm run build     # type check + dist/ (static; serve over http, not file://)
npm run preview   # serves dist/ on http://localhost:4173
```

Query parameters: `?reboot=1` opens Miitomo Reboot, `?reboot=0` forces Classic, `?lab=1` opens the research Lab
(free cameras, A/B shading).

Code map:

| Folder | Contents |
|---|---|
| `src/formats` | POD, PVR/ETC1, TGA, MSBT readers |
| `src/agx` | original shader material and XML |
| `src/assets` | local import, virtual file system, IndexedDB store |
| `src/body` | skeleton, skinning, animation, proportions, wardrobe |
| `src/room` | room scene, director, camera framing, UI, sound, texts |
| `src/play` | the game screens (first run, Mii Studio, closet, shop, Miifoto, save) |
| `src/social`, `src/voice`, `src/effects` | local friends, speech, particle effects |
| `src/reboot` | Miitomo Reboot, loaded only behind the gate |
| `src/main.ts` | engine wiring and the Lab |

See the root [README](../../README.md) for tests and the [documentation index](../../docs/README.md).
Licence: AGPL-3.0-only (see the root LICENSE).
