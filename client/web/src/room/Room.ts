/**
 * Miitomo room built from the ORIGINAL files (M7). Evidence is classified in docs/reverse-engineering/ROOM.md.
 *
 *  geometry  asset/model/room/roomBaseComponents (CDN zip) -> roomBaseComponents/output/roomBase00/roomBase00.Mdl.pod
 *            60 rigid meshes under roomRoot: ZMinus (wall, door, doorFrame, shadow), XPlus/ZPlus/XMinus walls,
 *            YPlus ceiling, YMinus floor, dec (entrance corridor), furniture (shelf+books, photostand, plants, chest,
 *            lamp, cushions). One room = a 68 x 34 x 68 box (units = body units, POD Units 0.01).      VERIFIED (data)
 *  materials roomBase00.Mdl_model.xml (LUT shader, same agx XML as the characters).                  VERIFIED (data)
 *  skin      roomWall/output/rmWlNNNN + roomFloor/output/rmFlNNNN (APK or CDN): Mdl_room.xml lists, per material
 *            "Wall", "Ceiling", "Door", "Floor", the albedo textures (several = selectable variants) and Door MSK/NRM.
 *            Name mapping Wall->mtRmWl00, Ceiling->mtRmCl00, Door->mtRmDr00, Floor->mtRmFl00 is DEDUCED (names).
 *  lights    roomBase00.Mdl_scene.xml ("room0006.Mdl": hemi/directional/fill + 2 light sets)        VERIFIED (data)
 *  door      roomBaseComponents/output/doorAnim/doorAnim{Open,Close}.Anim.pod (21 frames, node "doorAnim").
 *  camera    the same doorAnim PODs carry a camera block (CamFOV 0.6606, near 0.1, far 1e4) on node "persp" at
 *            (2.706, 30.781, 60.583); axes: forward = -Y column, up = -Z column (DEDUCED from the matrix: this is
 *            the only orientation that looks into the room). FOV treated as vertical (cocos2d fovY) - DEDUCED.
 */
import * as THREE from 'three';
import { vfs, openModelPackage, text, FileMap } from '../assets/vfs';
import { BodyModel, BodyShading, parseAnim, AnimClip } from '../body/BodyModel';
import { parsePOD } from '../formats/pod';
import { parseSceneXml, AgxLights } from '../agx/xml';

export const ROOM_BASE_PATH = 'asset/model/room/roomBaseComponents';
const WALL_DIR = 'asset/model/room/roomWall/output/';
const FLOOR_DIR = 'asset/model/room/roomFloor/output/';
const ROOM_MATERIAL: Record<string, string> = { Wall: 'mtRmWl00', Ceiling: 'mtRmCl00', Door: 'mtRmDr00', Floor: 'mtRmFl00' };

export interface RoomCamera { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fovRad: number; near: number; far: number; source: string; }
export interface RoomSkinXml { name: string; target: number | null; materials: Map<string, Record<string, string[]>>; }

export function roomAvailable() { return vfs.has(ROOM_BASE_PATH); }
export function roomSkins(): { walls: string[]; floors: string[] } {
  const ids = (dir: string, re: RegExp) => [...vfs.keys()].filter((k) => k.startsWith(dir)).map((k) => re.exec(k)?.[1]).filter((x): x is string => !!x).sort();
  return { walls: ids(WALL_DIR, /rmWl(\d{4})$/), floors: ids(FLOOR_DIR, /rmFl(\d{4})$/) };
}

export function parseRoomXml(src: string): RoomSkinXml {
  const doc = new DOMParser().parseFromString(src, 'application/xml');
  const materials = new Map<string, Record<string, string[]>>();
  for (const m of doc.querySelectorAll('Materials > Material')) {
    const rec: Record<string, string[]> = {};
    for (const s of m.querySelectorAll(':scope > Sampler2D')) {
      const n = s.getAttribute('Name')!; const f = s.querySelector(':scope > FileName')?.textContent?.trim();
      if (f) (rec[n] ??= []).push(f);
    }
    materials.set(m.getAttribute('Name')!, rec);
  }
  const t = doc.querySelector('Room > RoomTarget')?.textContent;
  return { name: doc.documentElement.getAttribute('Name') ?? '', target: t ? Number(t) : null, materials };
}

/** Camera from a POD that holds a camera node (doorAnim PODs). */
export function podCamera(bytes: Uint8Array, source: string): RoomCamera | null {
  const pod = parsePOD(bytes);
  if (!pod.cameras.length) return null;
  const camNode = pod.nodes[pod.numMeshNodes + pod.numLights]; // first camera node (PVRTModelPOD node order)
  const m = camNode?.matrix; if (!m) return null;
  const M = new THREE.Matrix4().fromArray(m.slice(0, 16));
  const e = M.elements;
  const position = new THREE.Vector3(e[12], e[13], e[14]);
  const fwd = new THREE.Vector3(-e[4], -e[5], -e[6]).normalize();
  const up = new THREE.Vector3(-e[8], -e[9], -e[10]).normalize();
  // aim: where the view ray meets the room's centre plane z = 0
  const t = Math.abs(fwd.z) > 1e-4 ? -position.z / fwd.z : 60;
  const c = pod.cameras[0];
  return { position, target: position.clone().addScaledVector(fwd, t), up, fovRad: c.fov, near: c.near, far: c.far, source };
}

export interface RoomBuild { model: BodyModel; lights: AgxLights | null; camera: RoomCamera | null; doorOpen: AnimClip | null; doorClose: AnimClip | null; skin: { wall: string; floor: string; variant: number }; notes: string[]; }

/** Builds the room (base + wall/floor skin). `variant` picks the n-th albedo listed in Mdl_room.xml. */
export function buildRoom(shading: BodyShading, approxCls: any, wallId = '0000', floorId = '0000', variant = 0, base = 'roomBase00'): RoomBuild {
  const notes: string[] = [];
  const basePkg = openModelPackage(ROOM_BASE_PATH);
  const merged: FileMap = new Map(basePkg);
  const override: Record<string, Record<string, string>> = {};
  for (const [dir, prefix, id] of [[WALL_DIR, 'rmWl', wallId], [FLOOR_DIR, 'rmFl', floorId]] as const) {
    const path = `${dir}${prefix}${id}`;
    if (!vfs.has(path)) { notes.push(`${prefix}${id} non importato: texture di base del modello`); continue; }
    const pkg = openModelPackage(path);
    for (const [k, v] of pkg) merged.set(`skin/${k}`, v);
    const xk = [...pkg.keys()].find((k) => k.endsWith('.Mdl_room.xml'));
    if (!xk) continue;
    const rx = parseRoomXml(text(pkg.get(xk)!));
    for (const [mname, samplers] of rx.materials) {
      const target = ROOM_MATERIAL[mname];
      if (!target) { notes.push(`materiale stanza sconosciuto: ${mname}`); continue; }
      const rec: Record<string, string> = {};
      for (const [sn, files] of Object.entries(samplers)) rec[sn] = files[Math.min(variant, files.length - 1)];
      override[target] = { ...(override[target] ?? {}), ...rec };
    }
  }
  const find = (re: RegExp) => [...basePkg.keys()].find((k) => re.test(k));
  // Prefer textures from the skin package: put "skin/" copies first in lookup order.
  const ordered: FileMap = new Map([...[...merged].filter(([k]) => k.startsWith('skin/')), ...[...merged].filter(([k]) => !k.startsWith('skin/'))]);
  const model = new BodyModel(ordered, base, shading, approxCls, 0, { textureOverride: override, tolerant: true, skinMask: false });
  const sceneKey = find(new RegExp(`${base}\\.Mdl_scene\\.xml$`));
  const lights = sceneKey ? parseSceneXml(text(basePkg.get(sceneKey)!), `${base}.Mdl_scene.xml`) : null;
  const openKey = find(/doorAnimOpen\.Anim\.pod$/), closeKey = find(/doorAnimClose\.Anim\.pod$/);
  const doorOpen = openKey ? parseAnim('doorAnimOpen', basePkg.get(openKey)!) : null;
  const doorClose = closeKey ? parseAnim('doorAnimClose', basePkg.get(closeKey)!) : null;
  const camera = openKey ? podCamera(basePkg.get(openKey)!, 'doorAnimOpen.Anim.pod / persp') : null;
  return { model, lights, camera, doorOpen, doorClose, skin: { wall: wallId, floor: floorId, variant }, notes };
}

/** Furniture group of a room mesh name (plants split by side of the room), null for walls / floor / door. */
export function furnitureGroup(name: string, minX: number): string | null {
  if (!/^(shelf|book|stand|photoframe|leaf|planter|chest|switch|light|cushion|wood)/.test(name)) return null;
  const g = name.startsWith('book') ? 'shelf' : name.replace(/(_ncl\d+_\d+|\d+)$/, '');
  return g === 'leaf' || g === 'planter' || g === 'wood' ? (minX > 0 ? 'plant1' : 'plant2') : g === 'stand' || g === 'photoframe' ? 'shelf' : g === 'switch' ? 'light' : g;
}

/** Axis-aligned boxes (room units, XZ) of furniture groups, used to keep the Mii out of them. */
export function furnitureBoxes(model: BodyModel): { name: string; min: THREE.Vector2; max: THREE.Vector2; top: number }[] {
  const out: { name: string; min: THREE.Vector2; max: THREE.Vector2; top: number }[] = [];
  const groups = new Map<string, THREE.Box3>();
  model.group.updateMatrixWorld(true);
  for (const o of model.group.children) {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh) continue;
    const a = mesh.geometry.getAttribute('aPosition') ?? mesh.geometry.getAttribute('position');
    const b = new THREE.Box3().setFromBufferAttribute(a as THREE.BufferAttribute);
    const key = furnitureGroup(mesh.name, b.min.x); if (!key) continue;
    groups.set(key, (groups.get(key) ?? new THREE.Box3().makeEmpty()).union(b));
  }
  for (const [name, b] of groups) out.push({ name, min: new THREE.Vector2(b.min.x, b.min.z), max: new THREE.Vector2(b.max.x, b.max.z), top: b.max.y });
  return out;
}

/** Nearest triangle hit of a ray on a rigid room mesh (custom aPosition attribute, so no THREE raycast). */
export function rayMesh(ray: THREE.Ray, mesh: THREE.Mesh): number | null {
  const a = (mesh.geometry.getAttribute('aPosition') ?? mesh.geometry.getAttribute('position')) as THREE.BufferAttribute | undefined;
  if (!a) return null;
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const r = ray.clone().applyMatrix4(inv);
  const idx = mesh.geometry.getIndex();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), hit = new THREE.Vector3();
  const n = idx ? idx.count : a.count;
  let best = Infinity;
  for (let i = 0; i + 2 < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    A.fromBufferAttribute(a, i0); B.fromBufferAttribute(a, i1); C.fromBufferAttribute(a, i2);
    if (r.intersectTriangle(A, B, C, false, hit)) { const w = hit.applyMatrix4(mesh.matrixWorld); const d = w.distanceTo(ray.origin); if (d < best) best = d; }
  }
  return isFinite(best) ? best : null;
}
