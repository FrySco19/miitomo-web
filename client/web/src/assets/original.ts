/** Wires the user-imported original files (vfs) into the renderer components and reports what is present. */
import { vfs, text, openModelPackage } from './vfs';
import { parseTGA } from '../formats/pvr';
import { setLutShaderSource, setLutProvider, setLights } from '../agx/LutMaterial';
import { parseSceneXml, parseModelXml, FALLBACK_LIGHTS, AgxLights } from '../agx/xml';
import { setMiiModelXml } from '../agx/MiiMaterial';
import { parseAnim, AnimClip } from '../body/BodyModel';

export const BODY_ID = 'bodyAll0400';
export const BODY_PATH = `asset/model/character/bodyAll/output/${BODY_ID}`;
const ANIM_DIR = 'asset/model/character/animation/output/';

export interface OriginalStatus {
  shader: boolean; luts: number; scene: string; miiModel: boolean; body: boolean; anims: string[]; reference: boolean;
}

export const state = { lights: FALLBACK_LIGHTS as AgxLights, anims: new Map<string, AnimClip>() };

export function refreshOriginal(): OriginalStatus {
  const vsh = vfs.get('shader/LUT.vsh'), fsh = vfs.get('shader/LUT.fsh');
  if (vsh && fsh) setLutShaderSource({ vsh: text(vsh), fsh: text(fsh) });
  setLutProvider((name) => {
    const b = vfs.get(`asset/env/lut/${name}`);
    if (!b) return null;
    const t = parseTGA(b);
    if (t.channels === 1) return t.pixels.slice();
    const out = new Uint8Array(t.width); for (let i = 0; i < t.width; i++) out[i] = t.pixels[i * t.channels]; return out;
  });
  const scene = vfs.get('asset/env/scene/default_scene.xml');
  state.lights = scene ? parseSceneXml(text(scene), 'default_scene.xml') : FALLBACK_LIGHTS;
  setLights(state.lights);
  const mm = vfs.get('asset/env/mii/mii_model.xml');
  if (mm) setMiiModelXml(parseModelXml(text(mm)));
  for (const k of vfs.keys()) {
    if (k.startsWith(ANIM_DIR) && k.endsWith('.Anim.pod')) {
      const name = k.slice(ANIM_DIR.length).replace('.Anim.pod', '');
      if (!state.anims.has(name)) state.anims.set(name, parseAnim(name, vfs.get(k)!));
    }
  }
  return {
    shader: !!(vsh && fsh),
    luts: [...vfs.keys()].filter((k) => k.startsWith('asset/env/lut/') && k.endsWith('.tga')).length,
    scene: state.lights.source,
    miiModel: !!mm,
    body: vfs.has(BODY_PATH),
    anims: [...state.anims.keys()].sort(),
    reference: vfs.has(`asset/capture2/large/character/bodyAll/${BODY_ID}_00.webp`)
  };
}

export function bodyPackage() { return openModelPackage(BODY_PATH); }
export function referenceImageUrl(): string | null {
  const b = vfs.get(`asset/capture2/large/character/bodyAll/${BODY_ID}_00.webp`);
  return b ? URL.createObjectURL(new Blob([b], { type: 'image/webp' })) : null;
}
