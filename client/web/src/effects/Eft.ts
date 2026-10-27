/**
 * Miitomo particle effects (M14) — reader for the APK's assets/asset/effect/effect.ptcl ("EFTB" v9, Nintendo nw::eft2;
 * the runtime is exported with symbols in libcocos2dcpp.so). Nothing is bundled: the file comes from the user's APK.
 *
 * Container                                                                                           REVERSED
 *   0x30 sections of 0x20-byte headers: magic, size, child, next, attr, binary offset, index, child count.
 *   ESTA → ESET (effect sets; name at +0x30) → EMTR (emitters, nested children) · TEXA → TEXR (+ORGB RGBA8 child)
 *   · PRMA → PRIM · SHCA (GLSL ES source) · SHDA.
 * ResEmitter (fixed 0xa44 bytes after the EMTR binary offset); "V" = read in the named runtime function,
 * "D" = DEDUCED from the values of all 65 sets (see docs/reverse-engineering/EXPRESSION.md):
 *   +0x10 name (D) · +0x50 EmitterStaticUniformBlock (0x700; FlipEndian 0x1670428) — block+0x10/14/18/1c/20 key counts
 *   colour0/alpha0/colour1/alpha1/scale (V CalcPtclColor0Vec/Color1Vec/ScaleVecFromTime), block+0x70 air resistance
 *   (V _CalcParticleBehavior_Integrating), block+0x360 colour scale, +0x370/+0x3f0/+0x470/+0x4f0 colour/alpha keys,
 *   +0x5b0 scale keys (V), +0x6b0.. rotation init / random / velocity / velocity random (V CalcRotationMatrix, order D)
 *   · +0x2e0 UV scale (D) · +0x308 UV division (V tex0PatternParam) · +0x118/+0x120 pattern count / table (D)
 *   · +0x768 translate, +0x780 rotate, +0x798 scale (D) · +0x7e4 one-time, +0x7e8 start, +0x7f0 duration (V Calc)
 *   · +0x7f4 count per emission, +0x7fc interval, +0x800 interval random (D) · +0x808 gravity, +0x80c direction (V)
 *   · +0x82c volume type, +0x850 radius (D) · +0x880 ResRenderState: blend enable / +0x886 blend type (V
 *   SetRenderStateResource; value meaning D) · +0x88e particle type (V SetParticleType) · +0x89c life, +0x8a0 life
 *   random % (D) · +0x8d4 colour combiner, +0x8d5 alpha combiner, +0x8dc tex colour input, +0x8df tex alpha input
 *   (V ShaderKey::Initialize/Generate) · +0x93c omni velocity, +0x940 directional velocity, +0x944 direction, +0x950
 *   spread, +0x964 velocity random % (read in InitializeParticle; formula D) · +0x974..977 colour/alpha modes,
 *   +0x978 colour0, +0x988 colour1 (V) · +0x998 scale, +0x9a4 scale random % (D) · +0x9c4 texture index (V).
 */
export type V3 = [number, number, number];
export type V4 = [number, number, number, number];
export interface Keys { count: number; keys: V4[] }   // (x, y, z, normalised time) — Calculate8KeyAnim, VERIFIED
export interface EftEmitter {
  name: string; depth: number;
  translate: V3; rotate: V3; scale: V3;
  oneTime: boolean; start: number; duration: number; count: number; interval: number; intervalRandom: number;
  gravity: V3; airResistance: number;
  volumeType: number; radius: V3;
  life: number; lifeRandom: number;
  omniVel: number; dirVel: number; dir: V3; spread: number; velRandom: number;
  color0: V4; color1: V4; colorMode: [number, number, number, number]; colorScale: number;
  color0Keys: Keys; alpha0Keys: Keys; color1Keys: Keys; alpha1Keys: Keys; scaleKeys: Keys;
  baseScale: V3; scaleRandom: number;
  rotInit: V3; rotRandom: V3; rotVel: V3; rotVelRandom: V3;
  texture: number; uvDiv: [number, number]; uvScale: [number, number]; patterns: number[];
  colorProcess: number; alphaProcess: number; texColorOne: boolean; texAlphaInput: number;
  blend: boolean; blendType: number; particleType: number;
}
export interface EftSet { name: string; emitters: EftEmitter[] }
export interface EftTexture { width: number; height: number; rgba: Uint8Array }
export interface Eft { sets: Map<string, EftSet>; textures: EftTexture[] }

export function parseEft(bytes: Uint8Array): Eft {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'EFTB') throw new Error('effect.ptcl: magic non valido');
  const hdr = (o: number) => ({ magic: String.fromCharCode(...bytes.subarray(o, o + 4)), size: dv.getUint32(o + 4, true), child: dv.getUint32(o + 8, true), next: dv.getUint32(o + 12, true), bin: dv.getUint32(o + 20, true), count: dv.getUint16(o + 28, true) });
  const NONE = 0xffffffff;
  const cstr = (o: number, n: number) => { let s = ''; for (let i = 0; i < n && bytes[o + i]; i++) s += String.fromCharCode(bytes[o + i]); return s; };
  const sets = new Map<string, EftSet>(); const textures: EftTexture[] = [];
  for (let o = 0x30; ;) {
    const h = hdr(o);
    if (h.magic === 'ESTA' && h.child !== NONE) {
      for (let s = o + h.child; ;) {
        const sh = hdr(s); const name = cstr(s + 0x30, 0x20);
        const ems: EftEmitter[] = [];
        const walk = (e: number, depth: number) => {
          for (;;) {
            const eh = hdr(e);
            ems.push(readEmitter(dv, bytes, e + eh.bin, depth));
            if (eh.child !== NONE && eh.count) walk(e + eh.child, depth + 1);
            if (eh.next === NONE) break; e += eh.next;
          }
        };
        if (sh.child !== NONE) walk(s + sh.child, 0);
        sets.set(name, { name, emitters: ems });
        if (sh.next === NONE) break; s += sh.next;
      }
    } else if (h.magic === 'TEXA' && h.child !== NONE) {
      for (let t = o + h.child; ;) {
        const th = hdr(t); const w = dv.getUint16(t + 0x20, true), hh = dv.getUint16(t + 0x22, true);
        const c = t + th.child, ch = hdr(c), n = w * hh * 4;
        textures.push({ width: w, height: hh, rgba: bytes.slice(c + ch.bin, c + ch.bin + n) });
        if (th.next === NONE) break; t += th.next;
      }
    }
    if (h.next === NONE) break; o += h.next;
  }
  return { sets, textures };
}

function readEmitter(dv: DataView, b: Uint8Array, o: number, depth: number): EftEmitter {
  const f = (x: number) => dv.getFloat32(o + x, true), i = (x: number) => dv.getInt32(o + x, true), u8 = (x: number) => b[o + x];
  const v3 = (x: number): V3 => [f(x), f(x + 4), f(x + 8)];
  const v4 = (x: number): V4 => [f(x), f(x + 4), f(x + 8), f(x + 12)];
  const B = 0x50;   // EmitterStaticUniformBlock
  const keys = (cntOff: number, keyOff: number): Keys => { const count = Math.max(0, Math.min(8, i(B + cntOff))); return { count, keys: Array.from({ length: 8 }, (_, k) => v4(B + keyOff + k * 16)) }; };
  let name = ''; for (let k = 0; k < 32 && b[o + 0x10 + k]; k++) name += String.fromCharCode(b[o + 0x10 + k]);
  const npat = Math.max(1, Math.min(32, Math.round(f(0x118)) || 1));
  return {
    name, depth,
    translate: v3(0x768), rotate: v3(0x780), scale: v3(0x798),
    oneTime: u8(0x7e4) !== 0, start: i(0x7e8), duration: i(0x7f0), count: Math.max(1, Math.round(f(0x7f4))), interval: Math.max(1, i(0x7fc)), intervalRandom: Math.max(0, i(0x800)),
    gravity: (() => { const g = f(0x808), d = v3(0x80c); return [d[0] * g, d[1] * g, d[2] * g] as V3; })(), airResistance: f(B + 0x70) || 1,
    volumeType: u8(0x82c), radius: v3(0x850),
    life: Math.max(1, i(0x89c)), lifeRandom: Math.max(0, i(0x8a0)),
    omniVel: f(0x93c), dirVel: f(0x940), dir: v3(0x944), spread: f(0x950), velRandom: f(0x964),
    color0: v4(0x978), color1: v4(0x988), colorMode: [u8(0x974), u8(0x976), u8(0x975), u8(0x977)], colorScale: f(B + 0x360) || 1,
    color0Keys: keys(0x10, 0x370), alpha0Keys: keys(0x14, 0x3f0), color1Keys: keys(0x18, 0x470), alpha1Keys: keys(0x1c, 0x4f0), scaleKeys: keys(0x20, 0x5b0),
    baseScale: v3(0x998), scaleRandom: f(0x9a4),
    rotInit: v3(B + 0x6b0), rotRandom: v3(B + 0x6c0), rotVel: v3(B + 0x6d0), rotVelRandom: v3(B + 0x6e0),
    texture: i(0x9c4), uvDiv: [Math.max(1, f(0x308)), Math.max(1, f(0x30c))], uvScale: [f(0x2e0) || 1, f(0x2e4) || 1],
    patterns: Array.from({ length: npat }, (_, k) => i(0x120 + k * 4)),
    colorProcess: u8(0x8d4), alphaProcess: u8(0x8d5), texColorOne: u8(0x8dc) === 1, texAlphaInput: u8(0x8df),
    blend: u8(0x880) !== 0, blendType: u8(0x886), particleType: u8(0x88e)
  };
}

/** 8-key curve (Calculate8KeyAnim, libcocos2dcpp 0x1668dc0): clamp to the first / last key, linear in between. */
export function evalKeys(k: Keys, t: number, fallback: V3): V3 {
  if (k.count <= 0) return fallback;
  const K = k.keys;
  if (k.count === 1 || t <= K[0][3]) return [K[0][0], K[0][1], K[0][2]];
  const last = K[k.count - 1]; if (t >= last[3]) return [last[0], last[1], last[2]];
  for (let n = 0; n < k.count - 1; n++) {
    const a = K[n], c = K[n + 1];
    if (t >= a[3] && t < c[3]) { const u = (t - a[3]) / Math.max(1e-6, c[3] - a[3]); return [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u]; }
  }
  return [last[0], last[1], last[2]];
}
