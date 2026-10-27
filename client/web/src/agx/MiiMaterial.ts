/**
 * Material class for FFL.js CharModel shapes that reproduces Miitomo's AFL draw path:
 *  - shader: original LUT.vsh/LUT.fsh with AGX_FEATURE_MII + AGX_FEATURE_MII_<modulateMode>
 *  - per-shape render state from asset/env/mii/mii_model.xml (OpaFaceline .. XluGlass, same order as the
 *    AFL getters AFLiGetDrawParam{OpaFaceline,OpaBeard,OpaNose,OpaForehead,OpaHair,OpaCap,XluMask,XluNoseLine,XluGlass})
 *  - colour rule from the draw callback at libcocos2dcpp.so 0x55ae60 (2.4.0):
 *      uColor0 *= 230/255 for modulateType in {1,4,9,11,16}; uColor1 *= 230/255 for type 10; uColor2 for type 12
 *  - mask (type 6): glBlendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA) (same callback, 0x55b5a0)
 */
import * as THREE from 'three';
import { AgxLutMaterial } from './LutMaterial';
import type { AgxModelXml } from './xml';

const MODE_DEFINES = ['AGX_FEATURE_MII_CONSTANT', 'AGX_FEATURE_MII_TEXTURE_DIRECT', 'AGX_FEATURE_MII_RGB_LAYERED',
  'AGX_FEATURE_MII_ALPHA', 'AGX_FEATURE_MII_LUMINANCE_ALPHA', 'AGX_FEATURE_MII_ALPHA_OPA'];
const SHAPE_MATERIALS = ['OpaFaceline', 'OpaBeard', 'OpaNose', 'OpaForehead', 'OpaHair', 'OpaCap', 'XluMask', 'XluNoseLine', 'XluGlass'];
/**
 * Texture-format adapter (see LutMaterial.miiFetchPatch): FFL.js R8 → GLES A8 (0,0,0,r); RG8 → GLES LA8 (r,r,r,g).
 * RGBA (TEXTURE_DIRECT / RGB_LAYERED, render targets) unchanged. WEB ADAPTATION.
 */
export function miiFetch(format: THREE.PixelFormat | number | undefined): string {
  if (format === THREE.RedFormat || format === 1024 /* LuminanceFormat */) return 'vec4(0.0, 0.0, 0.0, (t).r)';
  if (format === THREE.RGFormat) return 'vec4((t).rrr, (t).g)';
  return '(t)';
}
export const DARKEN = 230 / 255; // 0x3f66e6e7 = 0.901961 in the binary
const DARKEN_R = new Set([1, 4, 9, 11, 16]);

let MII_MODEL: AgxModelXml | null = null;
export function setMiiModelXml(x: AgxModelXml) { MII_MODEL = x; }

interface FFLMatParams {
  side?: THREE.Side; map?: THREE.Texture | null; lightEnable?: boolean;
  modulateMode?: number; modulateType?: number;
  color?: THREE.Color | null; colorG?: THREE.Color; colorB?: THREE.Color;
}

export class MiitomoMiiMaterial extends AgxLutMaterial {
  private _mode: number; private _type: number; private _lightEnable: boolean;
  /**
   * FFL.js hook: expose FFL geometry under the attribute names the ORIGINAL shader declares
   * (aPosition/aNormal/aTexcoord0/aTangent) instead of editing the shader source.
   */
  static modifyBufferGeometry(_drawParam: unknown, g: THREE.BufferGeometry) {
    const alias: [string, string][] = [['position', 'aPosition'], ['normal', 'aNormal'], ['uv', 'aTexcoord0'], ['tangent', 'aTangent']];
    for (const [from, to] of alias) { const a = g.getAttribute(from); if (a) g.setAttribute(to, a); }
  }
  constructor(p: FFLMatParams = {}) {
    if (!MII_MODEL) throw new Error('mii_model.xml non importato (asset_env_mii.zip).');
    const mode = p.modulateMode ?? 0, type = p.modulateType ?? 0;
    const xmlMat = MII_MODEL.materials.get(SHAPE_MATERIALS[type] ?? 'OpaFaceline')!;
    const defines = ['AGX_FEATURE_MII', MODE_DEFINES[mode] ?? MODE_DEFINES[0]];
    if (mode !== 0) defines.push('AGX_FEATURE_ALBEDO_TEXTURE');
    if (xmlMat.alphaTest) defines.push('AGX_FEATURE_ALPHA_TEST');
    if (!xmlMat.enableLighting || p.lightEnable === false) defines.push('AGX_FEATURE_DISABLE_LIGHT');
    super({ defines, renameForThree: false, lutFresnel: xmlMat.lutFresnel, lutSpecular: xmlMat.lutSpecular, lightSetIndex: xmlMat.lightSetIndex });
    this._mode = mode; this._type = type; this._lightEnable = p.lightEnable !== false;
    this.side = p.side ?? THREE.FrontSide;
    this.depthTest = xmlMat.depthTest;
    this.depthWrite = xmlMat.depthMask;
    if (type === 6) { this.transparent = true; this.blending = THREE.NormalBlending; }
    else if (xmlMat.isXlu) { this.transparent = true; this.blending = THREE.NoBlending; }
    else { this.transparent = false; this.blending = THREE.NoBlending; }
    if (p.map !== undefined) this.map = p.map;
    if (p.color) this.color = p.color;
    if (p.colorG) this.colorG = p.colorG;
    if (p.colorB) this.colorB = p.colorB;
    this.userData.miitomoMaterial = SHAPE_MATERIALS[type];
  }
  get modulateMode() { return this._mode; }
  set modulateMode(_v: number) { /* variant fixed at construction, like the game's per-material program */ }
  get modulateType() { return this._type; }
  set modulateType(_v: number) { /* fixed */ }
  get lightEnable() { return this._lightEnable; }
  set lightEnable(v: boolean) { this._lightEnable = v; }
  get map(): THREE.Texture | null { return this.uniforms?.uAlbedoTexture?.value ?? null; }
  set map(t: THREE.Texture | null) {
    if (!this.uniforms) return;
    this.uniforms.uAlbedoTexture.value = t;
    const fetch = this._mode >= 3 && this._mode <= 5 ? miiFetch(t?.format) : '(t)';
    if (this.defines['MTW_FETCH(t)'] !== fetch) { this.defines['MTW_FETCH(t)'] = fetch; this.needsUpdate = true; }
  }
  private setColor(u: string, c: THREE.Color, darken: boolean) {
    const k = darken ? DARKEN : 1;
    (this.uniforms[u].value as THREE.Vector4).set(c.r * k, c.g * k, c.b * k, 1);
  }
  get color(): THREE.Color { const v = this.uniforms.uColor0.value; return new THREE.Color(v.x, v.y, v.z); }
  set color(c: THREE.Color) { if (c && this.uniforms) this.setColor('uColor0', c, DARKEN_R.has(this._type)); }
  get colorG(): THREE.Color { const v = this.uniforms.uColor1.value; return new THREE.Color(v.x, v.y, v.z); }
  set colorG(c: THREE.Color) { if (c && this.uniforms) this.setColor('uColor1', c, this._type === 10); }
  get colorB(): THREE.Color { const v = this.uniforms.uColor2.value; return new THREE.Color(v.x, v.y, v.z); }
  set colorB(c: THREE.Color) { if (c && this.uniforms) this.setColor('uColor2', c, this._type === 12); }
}
