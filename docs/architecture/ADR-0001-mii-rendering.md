# ADR-0001 — Mii head rendering (M4)

Status: **Accepted for the research client** (2026-10-25). Revisit before any public release.

## Context
- Miitomo's Mii code is AFL, structurally Wii U FFL (NATIVE.md, MII.md).
- The Miitomo resource `AFLResHigh_2_3.dat` is archived (MD5 of the CDN zip matches manifest `d8baf107…`;
  .dat SHA-256 `4a4be71d…7722`, MD5 `c5ca24f4ccbd6f36c3e4da949a5b1385`).
- A community FFL decompilation exists, plus a fork (`ariankordi/ffl`, author changes public domain) that loads AFL
  resources and implements the 51 Miitomo-only expressions, and FFL.js (AGPL-3.0) that compiles it to WASM and binds it to Three.js.
- Reimplementing FFL's faceline/mask texture pipeline ourselves would take weeks and would itself be derived from the same decomp.

## Decision
Strategy C (hybrid) for the Mii subsystem: use FFL in WASM via **FFL.js v2.2.2 (pinned git tag)** with Three.js 0.177.0.
The resource is imported locally by the user (`client/web/src/resource.ts`), verified by SHA-256 and never bundled or uploaded.

## Consequences
- **License:** FFL.js is AGPL-3.0-only, so `client/web` is declared AGPL-3.0-only. Fine for an open preservation project;
  changing it means replacing FFL.js (the boundary is `src/mii.ts`).
- **Legal note:** FFL itself is a decompilation of Nintendo code. That's lawful-RE territory, but a different risk from clean-room code.
  Kept isolated behind `src/mii.ts`.
- **Provenance:** `ffl-emscripten.wasm` is prebuilt by FFL.js upstream, not by us. TODO: rebuild from `ariankordi/ffl`
  with a pinned Emscripten for full reproducibility (emsdk downloads blocked in the current analysis environments).
- **Shader fidelity:** "Miitomo (LUT)" is FFL.js's LUTShaderMaterial, an *adaptation* of the APK's `LUT.vsh/LUT.fsh`
  (diffed: uniforms/modes adapted, lighting code otherwise derived; 92/198 changed lines fsh/vsh incl. comments).
  Binary evidence: `LUT` carries `AGX_FEATURE_MII*` defines → used for in-room Miis (Medium). Status: APPROXIMATE.
  Next: compile the original APK shader source with AGX_FEATURE_* variants and A/B against it.
