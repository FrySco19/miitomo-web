/**
 * Shop interior (M15) from the ORIGINAL files: asset/model/shop/output (CDN asset_model_shop_output.zip) →
 * shop0000.Mdl.pod + shop0000.Mdl_model.xml (agx materials, same as rooms / characters) + shop0000.Mdl_scene.xml
 * (hemi / directional / fill lights).                                                              VERIFIED (data)
 * The shop camera and the Mii's spot are not in the package (they lived in the native shop scene): APPROXIMATED,
 * framed from the model's bounds.
 */
import * as THREE from 'three';
import { vfs, openModelPackage, text } from '../assets/vfs';
import { BodyModel, BodyShading } from '../body/BodyModel';
import { parseSceneXml, AgxLights } from '../agx/xml';

export const SHOP_PATH = 'asset/model/shop/output';
export function shopAvailable() { return vfs.has(SHOP_PATH); }
export interface ShopBuild { model: BodyModel; lights: AgxLights | null; box: THREE.Box3; }

/** Per-mesh bounds from the rigid positions (custom aPosition attribute, like the room meshes). */
export function meshBoxes(model: BodyModel): { name: string; box: THREE.Box3 }[] {
  const out: { name: string; box: THREE.Box3 }[] = [];
  for (const o of model.group.children) {
    const m = o as THREE.Mesh; if (!m.isMesh) continue;
    const a = (m.geometry.getAttribute('aPosition') ?? m.geometry.getAttribute('position')) as THREE.BufferAttribute;
    out.push({ name: m.name, box: new THREE.Box3().setFromBufferAttribute(a) });
  }
  return out;
}
export function buildShop(shading: BodyShading, approxCls: any): ShopBuild {
  const pkg = openModelPackage(SHOP_PATH);
  // package entries are "output/…": strip the folder so the model finds its textures like the room packages
  const files = new Map([...pkg].map(([k, v]) => [k.replace(/^output\//, ''), v]));
  const model = new BodyModel(files, 'shop0000', shading, approxCls, 0, { tolerant: true, skinMask: false });
  const sk = [...files.keys()].find((k) => k.endsWith('shop0000.Mdl_scene.xml'));
  const lights = sk ? parseSceneXml(text(files.get(sk)!), 'shop0000.Mdl_scene.xml') : null;
  model.applyPose(null, 0);
  const box = new THREE.Box3().makeEmpty();
  for (const m of meshBoxes(model)) box.union(m.box);
  return { model, lights, box };
}
