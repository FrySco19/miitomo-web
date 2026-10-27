/**
 * Thin wrapper around FFL (WASM, via FFL.js) for Miitomo's AFL resource.
 *
 * Provenance (see docs/architecture/ADR-0001-mii-rendering.md):
 *  - FFL core: community decompilation of Nintendo's Face Library (aboood40091/ffl, ariankordi/ffl fork,
 *    which adds AFL/Miitomo resource + expression support), compiled to WASM by FFL.js v2.2.2 (prebuilt).
 *  - Shading "approx": FFL.js LUTShaderMaterial (Three.js adaptation of Miitomo's LUT shader).
 *  - Shading "original": MiitomoMiiMaterial = original APK LUT shader + mii_model.xml + game draw-callback rules.
 *    Faceline/mask TEXTURE passes use FFL.js FFLShaderMaterial (port of the FFL decomp shader, unlit), because in
 *    the game they are drawn by AFL's own internal shader (AFLiShader*), not by LUT.
 */
import * as THREE from 'three';
import { FFL, CharModel, FFLGender, FFLAge, FFLRace, FFLModelFlag, makeExpressionFlag } from 'ffl.js';
import FFLShaderMaterial from 'ffl.js/materials/FFLShaderMaterial.js';
import LUTShaderMaterial from 'ffl.js/materials/LUTShaderMaterial.js';
import { MiitomoMiiMaterial } from './agx/MiiMaterial';

export type ShaderKind = 'original' | 'approx';
export const SHADERS: Record<ShaderKind, { label: string; cls: any; note: string }> = {
  original: { label: 'Originale (APK)', cls: MiitomoMiiMaterial, note: 'shader LUT.vsh/LUT.fsh originale dell\'APK, varianti AGX, luci e LUT originali' },
  approx: { label: 'Approssimato', cls: LUTShaderMaterial, note: 'adattamento FFL.js dello shader LUT (riferimento A/B)' }
};

declare global {
  // eslint-disable-next-line no-var
  var ModuleFFL: (() => Promise<any>) | undefined;
}

/** Expressions built with a head: the chosen one + its open-mouth pair (talking) + blink (idle).
 * Open/closed mouth pairs exist in the game's data (fc_OpenedMouth / fc_ClosedMouth attributes, REVERSED); the pairing
 * 0↔6 … 4↔10 follows FFL's expression table. */
export function openMouth(e: number) { return e >= 0 && e <= 5 ? e + 6 : e; }
function faceSet(e: number, extra: number[] = []) { return [...new Set([e, openMouth(e), 5, 11, ...extra].filter((x) => x >= 0 && x < 70))]; }


export class MiiEngine {
  ffl: any = null;
  private renderer: THREE.WebGLRenderer;
  current: any = null;

  constructor(renderer: THREE.WebGLRenderer) { this.renderer = renderer; }

  async init(resource: Uint8Array): Promise<void> {
    if (!globalThis.ModuleFFL) throw new Error('Modulo FFL (WASM) non caricato.');
    if (this.ffl) this.dispose();
    const t0 = performance.now();
    this.ffl = await FFL.initWithResource(resource, globalThis.ModuleFFL);
    console.info(`[mii] FFL initialised in ${(performance.now() - t0).toFixed(1)} ms`);
  }

  get ready(): boolean { return !!this.ffl; }

  /**
   * Random FFLiCharInfo. FFLiGetRandomCharInfo does not write every field (e.g. around createID, +0x104), so the
   * output depended on stale heap bytes and often failed FFLiVerifyCharInfo (reason 55). We zero the buffer first.
   */
  randomCharInfo(gender = FFLGender.ALL, age = FFLAge.ALL, race = FFLRace.ALL): Uint8Array {
    const mod = this.ffl.module, size = 288;
    const ptr = mod._malloc(size);
    mod.HEAPU8.fill(0, ptr, ptr + size);
    mod._FFLiGetRandomCharInfo(ptr, gender, age, race);
    const out = mod.HEAPU8.slice(ptr, ptr + size);
    mod._free(ptr);
    return out;
  }

  /** FFLiVerifyCharInfoWithReason on a 288-byte FFLiCharInfo: 0 = valid, otherwise FFL's reason code. */
  verifyCharInfo(ci: Uint8Array): number {
    if (ci.length !== 288) return -1;
    const mod = this.ffl.module; const ptr = mod._malloc(288);
    mod.HEAPU8.set(ci, ptr);
    const r = mod._FFLiVerifyCharInfoWithReason(ptr, false);
    mod._free(ptr);
    return r;
  }
    /** Builds a head model. Returns the Three.js group (caller adds it to the scene). */
  build(data: Uint8Array, expression: number, shader: ShaderKind, hat = false, extraFaces: number[] = []) {
    if (!this.ffl) throw new Error('FFL non inizializzato.');
    const t0 = performance.now();
    // hat = FFL "hat" hair variant (FFLModelFlag.HAT), used while a headwear item is worn.
    const desc = { resolution: 512, allExpressionFlag: makeExpressionFlag(faceSet(expression, extraFaces)), modelFlag: hat ? FFLModelFlag.HAT : FFLModelFlag.NORMAL };
    const model = new CharModel(this.ffl, data, desc as any, SHADERS[shader].cls);
    model.initTextures(this.renderer, shader === 'original' ? FFLShaderMaterial : SHADERS[shader].cls);
    this.disposeModel();
    this.current = model;
    let hair = null as THREE.Color | null;
    (model.meshes as THREE.Group).traverse((o: any) => {
      const ud = o.geometry?.userData;
      if (ud?.modulateType === 4 && ud.modulateColor) hair = new THREE.Color(ud.modulateColor[0], ud.modulateColor[1], ud.modulateColor[2]);
    });
    const ci = (model as any).charInfo ?? {};
    return { group: model.meshes as THREE.Group, ms: performance.now() - t0, skin: (model.facelineColor as THREE.Color).clone(), hair: hair as THREE.Color | null,
      height: Number(ci.height ?? 64), build: Number(ci.build ?? 64), gender: Number(ci.gender ?? 0), name: String(ci.name ?? '') };
  }

  disposeModel(): void {
    if (this.current) { try { this.current.dispose(); } catch { /* ignore */ } this.current = null; }
  }

  dispose(): void {
    this.disposeModel();
    try { this.ffl?.dispose(); } catch { /* ignore */ }
    this.ffl = null;
  }
}

/**
 * Accepts hex or Base64 of: 3DS/Wii U FFLStoreData (96 B), Wii RFL data (74/76 B), Switch CharInfo (88 B),
 * Mii Studio code (46 B), obfuscated Mii Studio URL data (47 B) or FFLiCharInfo (288 B).
 */
export function parseMiiInput(text: string): Uint8Array {
  const t = text.trim().replace(/\s+/g, '');
  if (!t) throw new Error('Inserisci dei dati Mii.');
  let bytes: Uint8Array;
  if (/^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0) {
    bytes = Uint8Array.from({ length: t.length / 2 }, (_, i) => parseInt(t.slice(i * 2, i * 2 + 2), 16));
  } else {
    const b64 = t.replace(/-/g, '+').replace(/_/g, '/');
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  if (![46, 47, 74, 76, 88, 96, 288].includes(bytes.length)) {
    throw new Error(`Formato non riconosciuto (${bytes.length} byte).`);
  }
  return bytes;
}

export const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
