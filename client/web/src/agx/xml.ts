/**
 * Parsers for Miitomo "agx" XML data (XmlVersion 5):
 *  - *.Mdl_model.xml / env/mii/mii_model.xml  -> per-material render state
 *  - env/scene/*_scene.xml                     -> lights and light sets
 * Field names are the game's own (also present as strings in libcocos2dcpp.so).
 */

export interface AgxSampler { enabled: boolean; file: string; wrapS: string; wrapT: string; mag: string; min: string; }
export interface AgxMaterial {
  name: string;
  shader: string;            // "LUT"
  enableLighting: boolean;
  lutFresnel: string;        // e.g. fresnelDefault02.tga
  lutSpecular: string;
  lightSetIndex: number;
  sphereMap: string;
  culling: string;           // Back | Front | None
  isXlu: boolean;
  alphaTest: boolean;
  depthTest: boolean;
  depthMask: boolean;
  blendSrc: string;
  blendDst: string;
  samplers: Record<string, AgxSampler>; // uAlbedoTexture, uNormalTexture, uMaskTexture, uAlphaTexture
}
/** ArchModelMetadata of clothing models (field names as in the files and in libcocos2dcpp.so). */
export interface ClothingMeta {
  type: string;        // tops | topslong | bottomsA | bottomsB | shoes | acce | all | mannequin | '' (headwear)
  silhouette: string;  // slim | wide | boots | ''
  state: string;       // st | wd | in | hi | lo | ''
  gender: string;      // m | f | ''
  exclusion: { type: string; acceptable: string[] }[]; // Exclusion/CategoryList
  excludedItems: string[];                              // Exclusion/ItemList
}
export interface HeadWearData { type: number; applyHairMaskWhenSkinhead: boolean; translate: number[] | null; rotate: number[] | null; }
export interface AccessoryData {
  rootType: number; translateScaleWeight: number; translateScaleWeightOffset: number; scaleWeight: number;
  smallEnabled: boolean; smallRatio: number; smallStartValue: number;
}
export interface AgxModelXml {
  materials: Map<string, AgxMaterial>;
  colorList: number[][];  // UserData/ColorList
  partRange: [string, string] | null;
  meta: ClothingMeta | null;
  headWear: HeadWearData | null;
  accessory: AccessoryData | null;
}

const childText = (el: Element, tag: string) => el.querySelector(`:scope > ${tag}`)?.textContent?.trim() ?? '';
const bool = (s: string) => s === 'true';

export function parseModelXml(src: string): AgxModelXml {
  const doc = new DOMParser().parseFromString(src, 'application/xml');
  const materials = new Map<string, AgxMaterial>();
  for (const m of doc.querySelectorAll('Materials > Material')) {
    const samplers: Record<string, AgxSampler> = {};
    for (const s of m.querySelectorAll(':scope > Sampler2D')) {
      samplers[s.getAttribute('Name')!] = {
        enabled: bool(childText(s, 'IsEnable')), file: childText(s, 'FileName'),
        wrapS: childText(s, 'GL_TEXTURE_WRAP_S'), wrapT: childText(s, 'GL_TEXTURE_WRAP_T'),
        mag: childText(s, 'GL_TEXTURE_MAG_FILTER'), min: childText(s, 'GL_TEXTURE_MIN_FILTER')
      };
    }
    materials.set(m.getAttribute('Name')!, {
      name: m.getAttribute('Name')!,
      shader: childText(m, 'Shader'),
      enableLighting: bool(childText(m, 'EnableLighting')),
      lutFresnel: childText(m, 'LutFr'), lutSpecular: childText(m, 'LutSp'),
      lightSetIndex: Number(childText(m, 'LightSetIndex') || 0),
      sphereMap: childText(m, 'SphereMap'),
      culling: childText(m, 'Culling') || 'Back',
      isXlu: bool(childText(m, 'IsXlu')),
      alphaTest: bool(childText(m, 'EnableAlphaTest')),
      depthTest: childText(m, 'EnableDepthTest') !== 'false',
      depthMask: childText(m, 'EnableDepthMask') !== 'false',
      blendSrc: m.querySelector(':scope > BlendFunc > Src')?.textContent?.trim() ?? 'GL_ONE',
      blendDst: m.querySelector(':scope > BlendFunc > Dst')?.textContent?.trim() ?? 'GL_ZERO',
      samplers
    });
  }
  const colorList = [...doc.querySelectorAll('UserData > ColorList > Color')].map((c) => c.textContent!.trim().split(/\s+/).map(Number));
  const pr = doc.querySelector('ArchModelMetadata > PartRange');
  const partRange = pr ? [childText(pr, 'Begin'), childText(pr, 'End')] as [string, string] : null;
  const am = doc.querySelector('ArchModelMetadata');
  const meta: ClothingMeta | null = am ? {
    type: childText(am, 'Type'), silhouette: childText(am, 'Silhouette'), state: childText(am, 'State'), gender: childText(am, 'Gender'),
    exclusion: [...am.querySelectorAll(':scope > Exclusion > CategoryList > Category')].map((c) => ({
      type: childText(c, 'Type'),
      acceptable: [...c.querySelectorAll(':scope > AcceptableSilhoette')].map((x) => x.textContent?.trim() ?? '').filter(Boolean)
    })),
    excludedItems: [...am.querySelectorAll(':scope > Exclusion > ItemList > *')].map((x) => x.textContent?.trim() ?? '').filter(Boolean)
  } : null;
  const num = (el: Element | null, tag: string, d = 0) => { const t = el ? childText(el, tag) : ''; return t === '' ? d : Number(t); };
  const hw = doc.querySelector('UserData > HeadWear');
  const v3 = (s: string) => (s ? s.split(/\s+/).map(Number) : null);
  const headWear: HeadWearData | null = hw ? {
    type: num(hw, 'Type', -1), applyHairMaskWhenSkinhead: bool(childText(hw, 'ApplyHairMaskWhenSkinhead')),
    translate: v3(hw.querySelector(':scope > Transform > Translate')?.textContent?.trim() ?? ''),
    rotate: v3(hw.querySelector(':scope > Transform > Rotate')?.textContent?.trim() ?? '')
  } : null;
  const ac = doc.querySelector('UserData > Accessory');
  const accessory: AccessoryData | null = ac ? {
    rootType: num(ac, 'RootType', 0), translateScaleWeight: num(ac, 'TranslateScaleWeight', 0),
    translateScaleWeightOffset: num(ac, 'TranslateScaleWeightOffset', 0.1), scaleWeight: num(ac, 'ScaleWeight', 0.8),
    smallEnabled: bool(childText(ac, 'SmallEnabled')), smallRatio: num(ac, 'SmallRatio', 1.5), smallStartValue: num(ac, 'SmallStartValue', 0.6)
  } : null;
  return { materials, colorList, partRange, meta, headWear, accessory };
}

export interface AgxLights {
  hemi: { sky: number[]; ground: number[] };           // colour * intensity
  directional: { color: number[]; dir: number[] };     // colour * intensity, direction (as authored)
  fill: { color: number[]; offset: number[] } | null;
  lightSets: number[][];                                // light indices per set (0 hemi, 1 dir, 2 fill)
  source: string;
}

const vec = (s: string) => s.split(/\s+/).map(Number);
const mul = (v: number[], k: number) => v.map((x) => x * k);

export function parseSceneXml(src: string, source: string): AgxLights {
  const doc = new DOMParser().parseFromString(src, 'application/xml');
  const h = doc.querySelector('HemiSphereLight')!, d = doc.querySelector('DirectionalLight')!, f = doc.querySelector('FillLight');
  return {
    hemi: {
      sky: mul(vec(childText(h, 'SkyColor')), Number(childText(h, 'SkyIntensity'))),
      ground: mul(vec(childText(h, 'GroundColor')), Number(childText(h, 'GroundIntensity')))
    },
    directional: { color: mul(vec(childText(d, 'Color')), Number(childText(d, 'Intensity'))), dir: vec(childText(d, 'Direction')) },
    fill: f ? { color: mul(vec(childText(f, 'Color')), Number(childText(f, 'Intensity'))), offset: vec(childText(f, 'DirectionalOffset')) } : null,
    lightSets: [...doc.querySelectorAll('LightSetList > LightSet')].map((ls) => [...ls.querySelectorAll('LightIndex')].map((x) => Number(x.textContent))),
    source
  };
}

/**
 * Fallback when env/scene/default_scene.xml has not been imported: the same numbers, as published by
 * FFL.js (LUTShaderMaterial defaults), which match default_scene.xml (colour * intensity).
 */
export const FALLBACK_LIGHTS: AgxLights = {
  hemi: { sky: [0.87843, 0.83451, 0.80314], ground: [0.87843, 0.72157, 0.5898] },
  directional: { color: [0.35137, 0.32392, 0.32392], dir: [-0.2, 0.5, 0.8] },
  fill: { color: [0.10039, 0.09255, 0.09255], offset: [0, -0.2, 0] },
  lightSets: [[0, 1], [0, 1, 2]],
  source: 'fallback (valori FFL.js)'
};
