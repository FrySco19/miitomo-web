# ARCHITECTURE.md

**No definitive architecture decision yet** (per project rules: evidence first). This records the evidence so far.

## Evidence summary (2026-10-25)
1. All game logic is native ARMv7 C++, but RTTI names give a complete map of scenes/sequences/data sources.
2. The native code is tightly bound to Android: JNI callbacks (~64 + Java side), GLES2, OpenSL ES, WebViews, NPF login, Nuance TTS.
3. The server API is REST/JSON-like over HTTPS with a light obfuscation layer (LZ4 + byte transform) — easy to reimplement.
4. Assets use public/documented formats (POD, PVR, CCBI, MSBT, FFL-family .dat) → can be imported in-browser.
5. Mii rendering already has open, browser-capable implementations of the same library family.
6. The biggest constraint is **missing downloadable content**, not code.

## Preliminary direction (to be confirmed by experiments)
- **Strategy C (hybrid), leaning B**: TypeScript web client reimplementing behaviour from RE, with WASM only where an
  existing faithful C/C++ implementation exists (FFL/AFL Mii rendering, possibly LZ4/codec). ARM emulation (Strategy "D")
  is **not chosen**: no benchmark yet, and the Android boundary surface is large. Will be benchmarked only if
  reimplementation of a subsystem proves infeasible.
- **Backend**: central service (accounts, friends, Q&A, inventory, moderation all server-side state in the original). Speaking
  the original REST shape is cheap and keeps the door open to running the real Android client against it (Kaerutomo-style).
  P2P not justified by anything observed so far.
- **Assets**: local importer (user supplies APK and resource files) → converted cache in the browser (IndexedDB/OPFS).
  No proprietary assets hosted by the project.

## Decision records
- ADR-0001 (pending): port strategy — decide after M3 (first authentic render) and CDN survey.
- ADR-0002 (pending): backend stack.
