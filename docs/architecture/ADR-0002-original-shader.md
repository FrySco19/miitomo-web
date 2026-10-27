# ADR-0002 — Use the original APK shader at runtime

Status: Accepted (2026-10-25).

Context: FFL.js ships an adapted copy of Miitomo's LUT shader (uniforms/modes changed). Miitomo's own
LUT.vsh/LUT.fsh are in the APK, and the binary reveals their variant system (AGX_FEATURE_* defines), uniform
indices and the AFL draw-callback rules.

Decision: the client compiles the ORIGINAL shader text, read from the user's APK at runtime, with the game's
defines. No Nintendo shader source is stored in the repository. The only source change is a mechanical
WebGL-compliance patch of one loop (GLSL ES 1.00 Appendix A), asserted to apply exactly once. FFL.js's
LUTShaderMaterial is kept only as the "A" side of A/B comparisons.

Consequences: fidelity is limited by the inputs (variant selection, light space, fill direction), which are
documented as VERIFIED/INFERRED in docs/reverse-engineering/MII.md. Without an imported APK the original mode
is unavailable (UI states why).
