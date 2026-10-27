/**
 * AgxLutMaterial: renders with the ORIGINAL Miitomo shader source (assets/shader/LUT.vsh + LUT.fsh, read
 * from the user's APK at runtime), compiled with the same "#define AGX_FEATURE_*" variant system the game
 * uses (feature names, uniform names and texture units verified in libcocos2dcpp.so, see docs/MII.md).
 *
 * Source transformations applied (and nothing else):
 *  1. "#define X" lines prepended for the selected variant (the game does the same: "%s#define %s").
 *  2. WebGL compliance: GLSL ES 1.00 Appendix A forbids `for (; iBone < uBoneCount; ++iBone)` (non-constant
 *     loop bound). It is rewritten to an equivalent constant-bound loop with an early break.
 *  3. Optional attribute renaming via #define for FFL.js geometry (position/normal/uv/tangent).
 */
import * as THREE from 'three';
import type { AgxLights } from './xml';

export interface LutShaderSource { vsh: string; fsh: string; }
let SOURCE: LutShaderSource | null = null;
export function setLutShaderSource(src: LutShaderSource) { SOURCE = src; }
export function hasLutShaderSource() { return !!SOURCE; }

let LIGHTS: AgxLights | null = null;
export function setLights(l: AgxLights) { LIGHTS = l; }
export function getLights() { return LIGHTS; }

const LUT_CACHE = new Map<string, THREE.DataTexture>();
let LUT_PROVIDER: ((name: string) => Uint8Array | null) | null = null;
export function setLutProvider(fn: (name: string) => Uint8Array | null) { LUT_PROVIDER = fn; LUT_CACHE.clear(); }

/** Loads an original LUT (512x1 TGA) from assets/asset/env/lut. */
export function lutTexture(name: string): THREE.DataTexture {
  let t = LUT_CACHE.get(name);
  if (t) return t;
  const px = LUT_PROVIDER?.(name);
  if (!px) throw new Error(`LUT mancante: ${name}`);
  t = new THREE.DataTexture(px, px.length, 1, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  LUT_CACHE.set(name, t);
  return t;
}

const LOOP_RE = /int iBone = 1;\s*for \(; iBone < uBoneCount; \+\+ ?iBone\)\s*\{/;
const LOOP_FIX = 'for (int iBone = 1; iBone < 4; ++iBone)\n        {\n            if (iBone >= uBoneCount) { break; }';

export function buildSources(defines: string[], renameForThree: boolean): { vertexShader: string; fragmentShader: string } {
  if (!SOURCE) throw new Error('Shader LUT originale non importato (serve l\'APK).');
  const vsh = SOURCE.vsh.replace(/\r\n/g, '\n');
  const fsh = SOURCE.fsh.replace(/\r\n/g, '\n');
  const matches = vsh.match(new RegExp(LOOP_RE, 'g'))?.length ?? 0;
  if (matches !== 1) throw new Error(`Patch WebGL del ciclo ossa: attese 1 occorrenza, trovate ${matches}`);
  const head = defines.map((d) => `#define ${d}\n`).join('');
  const rename = renameForThree
    ? '#define aPosition position\n#define aNormal normal\n#define aTexcoord0 uv\n#define aTangent tangent\n'
    : '';
  return { vertexShader: head + rename + vsh.replace(LOOP_RE, LOOP_FIX), fragmentShader: head + (defines.includes('AGX_FEATURE_MII') ? miiFetchPatch(fsh) : fsh) };
}

/**
 * WebGL texture-format adapter for the Mii draw path (WEB ADAPTATION, no change to the shader logic).
 * On GLES2 the game samples FFL's A8 / LA8 textures, where alpha lives in .a (A8 → (0,0,0,a), LA8 → (L,L,L,A)).
 * FFL.js uploads the same data as R8 / RG8 on WebGL2 (alpha in .r / .g, .a = 1), so the original
 * AGX_FEATURE_MII_ALPHA / _LUMINANCE_ALPHA / _ALPHA_OPA branches read alpha = 1: the noseline became an opaque
 * black square and the alpha test (XluNoseLine/XluGlass EnableAlphaTest) never discarded.
 * Every albedo fetch of the Mii branches goes through MTW_FETCH(t), defined per texture format by MiitomoMiiMaterial.
 */
export const MII_FETCH_LINE = 'albedoColor = texture2D(uAlbedoTexture, vTexcoord0);';
export function miiFetchPatch(fsh: string): string {
  const a = fsh.indexOf('defined(AGX_FEATURE_MII_CONSTANT)'), b = fsh.indexOf('#endif', fsh.indexOf('defined(AGX_FEATURE_MII_ALPHA_OPA)'));
  if (a < 0 || b < 0) throw new Error('LUT.fsh: blocco Mii non trovato');
  const mid = fsh.slice(a, b).split(MII_FETCH_LINE).join('albedoColor = MTW_FETCH(texture2D(uAlbedoTexture, vTexcoord0));');
  return '#ifndef MTW_FETCH\n#define MTW_FETCH(t) (t)\n#endif\n' + fsh.slice(0, a) + mid + fsh.slice(b);
}

const _mvp = new THREE.Matrix4(), _nrm = new THREE.Matrix3(), _eye = new THREE.Vector3(), _tgt = new THREE.Vector3();

export interface LutMaterialOptions {
  defines: string[];
  renameForThree?: boolean;
  lutFresnel: string;
  lutSpecular: string;
  lightSetIndex: number;
  boneCount?: number;   // weights per vertex (uBoneCount)
  maxBones?: number;    // palette size (AGX_BONE_MAX = 15)
}

export class AgxLutMaterial extends THREE.RawShaderMaterial {
  lightSetIndex: number;
  constructor(o: LutMaterialOptions) {
    const src = buildSources(o.defines, !!o.renameForThree);
    const maxBones = o.maxBones ?? 15;
    super({
      ...src,
      uniforms: {
        uMVPMatrix: { value: new THREE.Matrix4() },
        uViewMatrix: { value: new THREE.Matrix4() },
        uModelMatrix: { value: new THREE.Matrix4() },
        uNormalMatrix: { value: new THREE.Matrix3() },
        uEyePt: { value: new THREE.Vector3() },
        uBoneCount: { value: o.boneCount ?? 0 },
        uBoneMatrices: { value: Array.from({ length: maxBones }, () => new THREE.Matrix4()) },
        uBoneNormalMatrices: { value: Array.from({ length: maxBones }, () => new THREE.Matrix3()) },
        uDirLightCount: { value: 0 },
        uDirLightDirAndType: { value: [new THREE.Vector4(0, 0, 1, -1), new THREE.Vector4(0, 0, 1, -1)] },
        uDirLightColor: { value: [new THREE.Vector3(), new THREE.Vector3()] },
        uHSLightSkyColor: { value: new THREE.Vector3() },
        uHSLightGroundColor: { value: new THREE.Vector3() },
        uAlpha: { value: 1 },
        uColor0: { value: new THREE.Vector4(1, 1, 1, 1) },
        uColor1: { value: new THREE.Vector4(1, 1, 1, 1) },
        uColor2: { value: new THREE.Vector4(1, 1, 1, 1) },
        uLightColor: { value: new THREE.Vector3() },
        uAlbedoTexture: { value: null },
        uNormalTexture: { value: null },
        uMaskTexture: { value: null },
        uAlphaTexture: { value: null },
        uLUTSpecTexture: { value: lutTexture(o.lutSpecular) },
        uLUTFresTexture: { value: lutTexture(o.lutFresnel) },
        uSphereMapTexture: { value: null }
      }
    });
    this.lightSetIndex = o.lightSetIndex;
    this.name = `AgxLut[${o.defines.join(',')}]`;
  }

  /** Per-draw uniforms, mirroring what the game's draw callback uploads (uMVPMatrix, uModelMatrix, ...). */
  override onBeforeRender(_r: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera, _g: THREE.BufferGeometry, object: THREE.Object3D): void {
    const u = this.uniforms;
    this.uniformsNeedUpdate = true; // values change per draw; force upload even without a material switch
    object.updateMatrixWorld();
    u.uModelMatrix.value.copy(object.matrixWorld);
    u.uViewMatrix.value.copy(camera.matrixWorldInverse);
    _mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(object.matrixWorld);
    u.uMVPMatrix.value.copy(_mvp);
    u.uNormalMatrix.value.copy(_nrm.getNormalMatrix(object.matrixWorld));
    camera.getWorldPosition(_eye);
    u.uEyePt.value.copy(_eye);
    const L = LIGHTS;
    if (!L) return;
    const set = L.lightSets[this.lightSetIndex] ?? [0, 1];
    u.uHSLightSkyColor.value.fromArray(set.includes(0) ? L.hemi.sky : [0, 0, 0]);
    u.uHSLightGroundColor.value.fromArray(set.includes(0) ? L.hemi.ground : [0, 0, 0]);
    let n = 0;
    for (const idx of set) {
      if (idx === 1) {
        u.uDirLightDirAndType.value[n].set(L.directional.dir[0], L.directional.dir[1], L.directional.dir[2], -1);
        u.uDirLightColor.value[n].fromArray(L.directional.color);
        n++;
      } else if (idx === 2 && L.fill) {
        // Fill light: direction = towards the camera + DirectionalOffset (inferred; see MII.md).
        camera.getWorldDirection(_tgt).negate().add(_eye.set(L.fill.offset[0], L.fill.offset[1], L.fill.offset[2])).normalize();
        u.uDirLightDirAndType.value[n].set(_tgt.x, _tgt.y, _tgt.z, -1);
        u.uDirLightColor.value[n].fromArray(L.fill.color);
        n++;
      }
    }
    u.uDirLightCount.value = Math.min(n, 2);
    u.uLightColor.value.fromArray(L.directional.color);
  }
}
