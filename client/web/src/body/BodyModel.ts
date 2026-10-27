/**
 * Miitomo body / clothing part (bodyAll, bodyTops, bodyBottomsA/B, bodyShoes, headwear, bodyAcce, ...) built from the
 * ORIGINAL files:
 *   asset/model/character/bodyAll/output/bodyAll0400  (zip) -> bodyAll0400.Mdl.pod, .Mdl_model.xml, textures/android/*.pvr
 * Skeleton/pose rules verified on the data (docs/reverse-engineering/MII.md):
 *  - node local = T(pos) * R(quat xyzw) * S ; world = parentWorld * local (bind pose = frame 0)
 *  - .Anim.pod files store per-frame LOCAL matrices (column-major), matched to body nodes by name
 *  - skin matrix (bone b) = World_anim(b) * inverse(World_bind(b)); shader does the blending (uBoneMatrices)
 * Head attach (see MII.md): anchor = World_anim("Head") * Rz(-90deg) * S(0.1)  [scale VERIFIED 0.1, joint and
 *  rotation INFERRED].
 */
import * as THREE from 'three';
import { parsePOD, readAttribute, readIndices, readColorRGBA, PodScene } from '../formats/pod';
import { parsePVR } from '../formats/pvr';
import { parseModelXml, AgxModelXml, AgxMaterial } from '../agx/xml';
import { AgxLutMaterial } from '../agx/LutMaterial';
import { text, FileMap } from '../assets/vfs';
import { BodyScale, jointScale, rootYCorrection } from './BodyScale';

export interface AnimClip { name: string; frames: number; fps: number; byName: Map<string, Float32Array[]>; }

export function parseAnim(name: string, bytes: Uint8Array): AnimClip {
  const pod = parsePOD(bytes);
  const byName = new Map<string, Float32Array[]>();
  for (const n of pod.nodes) {
    if (!n.matrix) continue;
    const count = n.matrix.length / 16;
    const mats: Float32Array[] = [];
    for (let f = 0; f < count; f++) mats.push(Float32Array.from(n.matrix.slice(f * 16, f * 16 + 16)));
    byName.set(n.name, mats);
  }
  return { name, frames: Math.max(1, pod.numFrames), fps: pod.fps, byName };
}

const WRAP: Record<string, THREE.Wrapping> = {
  GL_REPEAT: THREE.RepeatWrapping, GL_CLAMP_TO_EDGE: THREE.ClampToEdgeWrapping, GL_MIRRORED_REPEAT: THREE.MirroredRepeatWrapping
};
const FILTER: Record<string, THREE.TextureFilter> = { GL_LINEAR: THREE.LinearFilter, GL_NEAREST: THREE.NearestFilter,
  GL_LINEAR_MIPMAP_LINEAR: THREE.LinearMipmapLinearFilter, GL_LINEAR_MIPMAP_NEAREST: THREE.LinearMipmapNearestFilter };

interface Batch { mesh: THREE.Mesh; node: number; material: string; palette: number[]; skin: { pos: Float32Array; nrm: Float32Array; idx: Float32Array; w: Float32Array; comps: number } }

export type BodyShading = 'original' | 'approx';

/** Extra options used by non-character models (room). */
export interface ModelOptions {
  /** material name -> sampler name -> replacement texture file (Mdl_room.xml overrides, see room/Room.ts) */
  textureOverride?: Record<string, Record<string, string>>;
  /** keep going when a sampler's texture file is missing (feature disabled for that sampler) */
  tolerant?: boolean;
  /** AGX_FEATURE_SKIN_MASK with mask textures (characters: yes; room: no, DEDUCED) */
  skinMask?: boolean;
}
let WHITE: THREE.DataTexture | null = null;
function white() {
  if (!WHITE) { WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); WHITE.needsUpdate = true; }
  return WHITE;
}

const SYNTH_JOINTS: Record<string, { parent: string; q: [number, number, number, number] }> = {
  Shadow: { parent: 'JointScale', q: [0, 0, 0, 1] },
  Item_Wrist_R: { parent: 'Wrist_R', q: [0, 1, 0, 0] },
  Item_Wrist_L: { parent: 'Wrist_L', q: [0, 0, 0, 1] },
  Item_Spine_2: { parent: 'Spine_2', q: [0, 0, 0, 1] }
};

export class BodyModel {
  readonly group = new THREE.Group();
  readonly headAnchor = new THREE.Group();
  readonly pod: PodScene;
  readonly xml: AgxModelXml;
  private bindWorld: THREE.Matrix4[] = [];
  private bindWorldInv: THREE.Matrix4[] = [];
  private animWorld: THREE.Matrix4[] = [];
  private batches: Batch[] = [];
  private nameToNode = new Map<string, number>();
  textures: Record<string, THREE.DataTexture> = {};
  readonly stats = { meshes: 0, triangles: 0, bones: 0, textures: 0 };
  skinColor = new THREE.Vector4(1, 1, 1, 1);
  hairColor = new THREE.Vector4(1, 1, 1, 1);

  /** Unit-axis world matrices (U_j, see BodyScale.ts) of the current pose: used for attachments (head, headwear). */
  private animUnit: THREE.Matrix4[] = [];
  readonly materialNames = new Set<string>();
  bodyScale: BodyScale | null = null;
  private lastClip: AnimClip | null = null;
  private lastFrame = 0;

  /**
   * @param id     file stem, e.g. "bodyAll0400" or "bodyTops0000St" (package may hold several variants)
   * @param albedo colour variant: index nn of the *_ALnn texture (one texture per UserData/ColorList entry)
   */
  constructor(pkg: FileMap, id: string, readonly shading: BodyShading, approxMaterialClass?: any, albedo = 0, opts: ModelOptions = {}) {
    const find = (re: RegExp) => [...pkg.keys()].find((k) => re.test(k));
    const podPath = find(new RegExp(`${id}\\.Mdl\\.pod$`));
    const xmlPath = find(new RegExp(`${id}\\.Mdl_model\\.xml$`));
    if (!podPath || !xmlPath) throw new Error(`Pacchetto ${id} incompleto`);
    this.pod = parsePOD(pkg.get(podPath)!);
    this.xml = parseModelXml(text(pkg.get(xmlPath)!));
    this.pod.nodes.forEach((n, i) => this.nameToNode.set(n.name, i));
    this.computeBind();
    this.stats.bones = this.pod.nodes.length - this.pod.numMeshNodes;

    // Textures referenced by the XML samplers (".tga" names; Android ships ".pvr")
    const tex = (file: string, s: { wrapS: string; wrapT: string; mag: string; min: string }) => {
      let key = file.replace(/\.tga$/i, '');
      if (albedo > 0 && /_AL\d\d$/.test(key)) {
        const alt = key.replace(/_AL\d\d$/, `_AL${String(albedo).padStart(2, '0')}`);
        if (find(new RegExp(`textures/android/${alt}\\.pvr$`))) key = alt;
      }
      if (this.textures[key]) return this.textures[key];
      const p = find(new RegExp(`(textures/)?android/${key}\\.pvr$`));
      if (!p) { if (opts.tolerant) return null; throw new Error(`Texture mancante: ${key}.pvr`); }
      const img = parsePVR(pkg.get(p)!);
      const t = new THREE.DataTexture(img.rgba, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.wrapS = WRAP[s.wrapS] ?? THREE.RepeatWrapping; t.wrapT = WRAP[s.wrapT] ?? THREE.RepeatWrapping;
      t.magFilter = (FILTER[s.mag] ?? THREE.LinearFilter) as THREE.MagnificationTextureFilter;
      t.minFilter = (FILTER[s.min] ?? THREE.LinearFilter) as THREE.MinificationTextureFilter;
      t.generateMipmaps = t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter;
      t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.needsUpdate = true;
      this.textures[key] = t; this.stats.textures++;
      return t;
    };

    for (let ni = 0; ni < this.pod.numMeshNodes; ni++) {
      const node = this.pod.nodes[ni];
      const m = this.pod.meshes[node.index];
      const podMat = this.pod.materials[node.material];
      const xm: AgxMaterial = this.xml.materials.get(podMat?.name ?? '') ?? this.xml.materials.get('__root_material__')!;
      const pos = readAttribute(m, m.position)!, nrm = readAttribute(m, m.normal)!, uv = readAttribute(m, m.uv)!;
      const tan = readAttribute(m, m.tangent);
      const bi = readAttribute(m, m.boneIndex), bw = readAttribute(m, m.boneWeight);
      const comps = m.boneWeight?.components ?? 0;
      const index = readIndices(m);
      const nb = Math.max(1, m.boneBatchBoneCounts.length);
      for (let b = 0; b < nb; b++) {
        const first = (m.boneBatchOffsets[b] ?? 0) * 3;
        const last = (b + 1 < nb ? m.boneBatchOffsets[b + 1] : m.numFaces) * 3;
        const paletteStart = m.boneBatches.length && m.boneBatchBoneCounts.length ? m.boneBatchBoneCounts.slice(0, b).reduce((a, c) => a + c, 0) : 0;
        // POD stores each batch's palette at a fixed stride of boneBatchBoneMax entries.
        const pStart = b * (m.boneBatchBoneMax || 0);
        const palette = m.boneBatches.slice(pStart, pStart + (m.boneBatchBoneCounts[b] ?? 0));
        void paletteStart;
        const geo = new THREE.BufferGeometry();
        geo.setIndex(new THREE.BufferAttribute(index.slice(first, last), 1));
        let material: THREE.Material;
        if (shading === 'original') {
          geo.setAttribute('aPosition', new THREE.BufferAttribute(pos, 3));
          geo.setAttribute('aNormal', new THREE.BufferAttribute(nrm, 3));
          geo.setAttribute('aTexcoord0', new THREE.BufferAttribute(uv, 2));
          if (tan) geo.setAttribute('aTangent', new THREE.BufferAttribute(tan, 3));
          if (bi && bw) {
            geo.setAttribute('aBoneIndex', new THREE.BufferAttribute(bi, comps));
            geo.setAttribute('aBoneWeight', new THREE.BufferAttribute(bw, comps));
          }
          const defines: string[] = [];
          const S = xm.samplers;
          const ov = opts.textureOverride?.[xm.name] ?? {};
          const T = (name: string) => {
            const smp = S[name]; if (!smp?.enabled) return null;
            const file = ov[name] ?? smp.file;
            return file ? tex(file, smp) : null;
          };
          const tAl = T('uAlbedoTexture'), tNr = T('uNormalTexture'), tMk = T('uMaskTexture');
          const alphaOn = !!S.uAlphaTexture?.enabled;
          const tAa = alphaOn ? (T('uAlphaTexture') ?? white()) : null; // engine default when no file: white (DEDUCED)
          const col = readColorRGBA(m, m.color);
          if (col) { geo.setAttribute('aColor', new THREE.BufferAttribute(col, 4)); defines.push('AGX_FEATURE_VERTEX_COLOR'); }
          if (tAl) defines.push('AGX_FEATURE_ALBEDO_TEXTURE');
          if (tNr && tan) defines.push('AGX_FEATURE_BUMP_TEXTURE');
          if (tMk) defines.push('AGX_FEATURE_MASK_TEXTURE', ...(opts.skinMask === false ? [] : ['AGX_FEATURE_SKIN_MASK']));
          if (tAa) defines.push('AGX_FEATURE_ALPHA_TEXTURE');
          if (xm.alphaTest) defines.push('AGX_FEATURE_ALPHA_TEST');
          if (!xm.enableLighting) defines.push('AGX_FEATURE_DISABLE_LIGHT');
          const mat = new AgxLutMaterial({ defines, lutFresnel: xm.lutFresnel, lutSpecular: xm.lutSpecular, lightSetIndex: xm.lightSetIndex, boneCount: comps });
          if (tAl) mat.uniforms.uAlbedoTexture.value = tAl;
          if (tNr) mat.uniforms.uNormalTexture.value = tNr;
          if (tMk) mat.uniforms.uMaskTexture.value = tMk;
          if (tAa && mat.uniforms.uAlphaTexture) mat.uniforms.uAlphaTexture.value = tAa;
          mat.uniforms.uColor0.value = this.skinColor;
          mat.uniforms.uColor1.value = this.hairColor;
          mat.side = xm.culling === 'None' ? THREE.DoubleSide : xm.culling === 'Front' ? THREE.BackSide : THREE.FrontSide;
          mat.depthWrite = xm.depthMask; mat.depthTest = xm.depthTest;
          if (xm.isXlu || xm.blendSrc === 'GL_SRC_ALPHA') {
            // Xlu pass after opaque; blend func from the XML (GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA).
            mat.transparent = true; mat.blending = THREE.CustomBlending;
            mat.blendSrc = THREE.SrcAlphaFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
            // coplanar decals (shadow quads at floor height): small offset, APPROXIMATED (engine depth func unknown)
            mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -4;
          }
          material = mat;
        } else {
          // Approximation path (A/B "A"): CPU-skinned geometry + FFL.js LUTShaderMaterial (texture direct).
          geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
          geo.setAttribute('normal', new THREE.BufferAttribute(nrm.slice(), 3));
          geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
          const S = xm.samplers;
          material = new approxMaterialClass({ modulateMode: 1, modulateType: 9, lightEnable: true, side: THREE.FrontSide,
            map: S.uAlbedoTexture?.enabled ? tex(S.uAlbedoTexture.file, S.uAlbedoTexture) : null, color: new THREE.Color(1, 1, 1) });
        }
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = node.name;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.userData.material = podMat?.name ?? '';
        this.materialNames.add(podMat?.name ?? '');
        this.group.add(mesh);
        this.batches.push({ mesh, node: ni, material: podMat?.name ?? '', palette, skin: { pos, nrm, idx: bi ?? new Float32Array(), w: bw ?? new Float32Array(), comps } });
        this.stats.meshes++; this.stats.triangles += (last - first) / 3;
      }
    }
    this.group.add(this.headAnchor);
    this.applyPose(null, 0);
  }

  private localBind(i: number): THREE.Matrix4 {
    const n = this.pod.nodes[i];
    const p = new THREE.Vector3(n.position[0] ?? 0, n.position[1] ?? 0, n.position[2] ?? 0);
    const q = new THREE.Quaternion(n.rotation[0] ?? 0, n.rotation[1] ?? 0, n.rotation[2] ?? 0, n.rotation[3] ?? 1);
    const s = new THREE.Vector3(n.scale[0] ?? 1, n.scale[1] ?? 1, n.scale[2] ?? 1);
    return new THREE.Matrix4().compose(p, q, s);
  }

  private computeBind() {
    const N = this.pod.nodes.length;
    const done = new Array<boolean>(N).fill(false);
    this.bindWorld = Array.from({ length: N }, () => new THREE.Matrix4());
    const visit = (i: number) => {
      if (done[i]) return;
      const par = this.pod.nodes[i].parent;
      const L = this.localBind(i);
      if (par >= 0) { visit(par); this.bindWorld[i].multiplyMatrices(this.bindWorld[par], L); } else this.bindWorld[i].copy(L);
      done[i] = true;
    };
    for (let i = 0; i < N; i++) visit(i);
    this.bindWorldInv = this.bindWorld.map((m) => m.clone().invert());
    this.animWorld = this.bindWorld.map((m) => m.clone());
    this.animUnit = this.bindWorld.map((m) => m.clone());
  }

  /**
   * Evaluates pose (null = bind pose) with the Miitomo body-scale rules (BodyScale.ts) and updates bone palettes,
   * rigid meshes and the head anchor. With bodyScale = null the result is the plain FK pose (M5 behaviour).
   */
  applyPose(clip: AnimClip | null, frame: number, blend?: { clip: AnimClip | null; frame: number; weight: number }) {
    this.lastClip = clip; this.lastFrame = frame;
    const bf = blend?.clip ? Math.floor(blend.frame) % blend.clip.frames : 0;
    const bw = blend ? THREE.MathUtils.clamp(blend.weight, 0, 1) : 0;
    const t2 = new THREE.Vector3(), q2 = new THREE.Quaternion(), s2 = new THREE.Vector3(), local2 = new THREE.Matrix4();
    const N = this.pod.nodes.length;
    const done = new Array<boolean>(N).fill(false);
    const f = clip ? Math.floor(frame) % clip.frames : 0;
    const bs = this.bodyScale;
    const local = new THREE.Matrix4(), t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const S = new THREE.Vector3(), lm = new THREE.Matrix4(), ONE = new THREE.Vector3(1, 1, 1);
    const lens: THREE.Vector3[] = Array.from({ length: N }, () => new THREE.Vector3(1, 1, 1));
    const visit = (i: number) => {
      if (done[i]) return;
      const n = this.pod.nodes[i];
      const mats = clip?.byName.get(n.name);
      if (mats && mats.length) local.fromArray(mats[Math.min(f, mats.length - 1)]); else local.copy(this.localBind(i));
      if (bw > 0) {
        // cross-fade towards the previous clip (weight = previous clip's share): lerp T/S, slerp R
        const m2 = blend!.clip?.byName.get(n.name);
        if (m2 && m2.length) local2.fromArray(m2[Math.min(bf, m2.length - 1)]); else local2.copy(this.localBind(i));
        local.decompose(t, q, s); local2.decompose(t2, q2, s2);
        local.compose(t.lerp(t2, bw), q.slerp(q2, bw), s.lerp(s2, bw));
      }
      if (n.parent >= 0) visit(n.parent);
      const U = this.animUnit[i], W = this.animWorld[i];
      if (!bs) {
        if (n.parent >= 0) W.multiplyMatrices(this.animWorld[n.parent], local); else W.copy(local);
        U.copy(W);
      } else {
        local.decompose(t, q, s);
        const pS = n.parent >= 0 ? lens[n.parent] : ONE;
        const isRoot = n.name === 'Skl_Root';
        t.set(t.x * pS.x, isRoot ? t.y : t.y * pS.y, t.z * pS.z);
        jointScale(n.name, bs, S).multiply(s);
        lm.compose(t, q, ONE);
        if (n.parent >= 0) U.multiplyMatrices(this.animUnit[n.parent], lm); else U.copy(lm);
        if (isRoot) U.elements[13] = rootYCorrection(U.elements[13], bs);
        W.copy(U).multiply(lm.makeScale(S.x, S.y, S.z));
        lens[i].copy(S);
      }
      done[i] = true;
    };
    for (let i = 0; i < N; i++) visit(i);

    const skinM = new THREE.Matrix4(), nm = new THREE.Matrix3();
    for (const b of this.batches) {
      if (!b.skin.comps) { b.mesh.matrix.copy(this.animUnit[b.node]); b.mesh.matrixWorldNeedsUpdate = true; continue; }
      const mats = b.palette.map((bone) => skinM.multiplyMatrices(this.animWorld[bone], this.bindWorldInv[bone]).clone());
      const mat = b.mesh.material as any;
      if (this.shading === 'original') {
        mats.forEach((m, k) => {
          mat.uniforms.uBoneMatrices.value[k].copy(m);
          mat.uniforms.uBoneNormalMatrices.value[k].copy(nm.getNormalMatrix(m));
        });
      } else {
        this.cpuSkin(b, mats);
      }
    }
    // Head anchor: World(Head) * Rz(-90deg) * S(0.1)
    const h = this.nameToNode.get('Head');
    if (h !== undefined) {
      const fix = new THREE.Matrix4().makeRotationZ(-Math.PI / 2).multiply(new THREE.Matrix4().makeScale(0.1, 0.1, 0.1));
      this.headAnchor.matrixAutoUpdate = false;
      this.headAnchor.matrix.multiplyMatrices(this.animUnit[h], fix);
      this.headAnchor.matrixWorldNeedsUpdate = true;
    }
  }

  private cpuSkin(b: Batch, mats: THREE.Matrix4[]) {
    const { pos, nrm, idx, w, comps } = b.skin;
    const P = b.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const Nn = b.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const v = new THREE.Vector3(), n = new THREE.Vector3(), accP = new THREE.Vector3(), accN = new THREE.Vector3();
    const count = pos.length / 3;
    for (let i = 0; i < count; i++) {
      if (!comps) break;
      accP.set(0, 0, 0); accN.set(0, 0, 0);
      for (let c = 0; c < comps; c++) {
        const wt = w[i * comps + c]; if (!wt) continue;
        const m = mats[idx[i * comps + c]];
        accP.addScaledVector(v.fromArray(pos, i * 3).applyMatrix4(m), wt);
        accN.addScaledVector(n.fromArray(nrm, i * 3).transformDirection(m), wt);
      }
      P.setXYZ(i, accP.x, accP.y, accP.z); accN.normalize(); Nn.setXYZ(i, accN.x, accN.y, accN.z);
    }
    P.needsUpdate = true; Nn.needsUpdate = true;
  }

  /** World-space position of a joint in the current pose (body units). */
  jointPosition(name: string): THREE.Vector3 | null {
    const i = this.nameToNode.get(name);
    return i === undefined ? null : new THREE.Vector3().setFromMatrixPosition(this.animWorld[i]);
  }

  /** Unit-axis world matrix of a joint (attachment frame), or null. */
  jointFrame(name: string): THREE.Matrix4 | null {
    const i = this.nameToNode.get(name);
    return i === undefined ? null : this.animUnit[i];
  }

  /**
   * Attachment frame for any skeleton joint name. Accessory roots Shadow / Item_* exist only in the full skeleton
   * (bodyMannequin0000: Shadow <- JointScale, Item_Wrist_R <- Wrist_R rot(0,1,0,0), Item_Wrist_L <- Wrist_L,
   * Item_Spine_2 <- Spine_2, all at zero offset). When this part's POD lacks them they are synthesised from that bind
   * data (anim local used when the clip animates the joint).
   */
  attachFrame(name: string): THREE.Matrix4 | null {
    const own = this.jointFrame(name);
    if (own) return own;
    const syn = SYNTH_JOINTS[name];
    if (!syn) return null;
    const parent = this.jointFrame(syn.parent);
    if (!parent) return null;
    const f = this.lastClip ? Math.floor(this.lastFrame) % this.lastClip.frames : 0;
    const anim = this.lastClip?.byName.get(name);
    const local = anim?.length ? new THREE.Matrix4().fromArray(anim[Math.min(f, anim.length - 1)])
      : new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...syn.q));
    const t = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    local.decompose(t, q, sc);
    return parent.clone().multiply(new THREE.Matrix4().compose(t, q, new THREE.Vector3(1, 1, 1)));
  }

  /**
   * Places a rigid accessory (acceRoot/notScalable/mesh) on `root`: mesh = root * T(p * tf) * R * S(s)
   * with p, R the mesh node's bind transform (formula from 0x5d4528, see Wardrobe.ts).
   */
  placeAccessory(root: THREE.Matrix4, tf: THREE.Vector3, s: number) {
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(root);
    this.group.matrixWorldNeedsUpdate = true;
    const t = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (const b of this.batches) {
      this.bindWorld[b.node].decompose(t, q, sc);
      b.mesh.matrix.compose(t.multiply(tf), q, sc.multiplyScalar(s));
      b.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  /** Shows only meshes whose material passes `keep` (area hiding, see Wardrobe.ts). Returns hidden mesh count. */
  setMaterialFilter(keep: (material: string) => boolean): number {
    let hidden = 0;
    for (const b of this.batches) { b.mesh.visible = keep(b.material); if (!b.mesh.visible) hidden++; }
    return hidden;
  }

  /** Lowest world-space Y over visible vertices in the current pose (ground checks in tests). */
  minY(): number {
    let m = Infinity; const v = new THREE.Vector3(), acc = new THREE.Vector3(), skinM = new THREE.Matrix4();
    for (const b of this.batches) {
      if (!b.mesh.visible) continue;
      const { pos, idx, w, comps } = b.skin;
      const mats = b.palette.map((bone) => skinM.multiplyMatrices(this.animWorld[bone], this.bindWorldInv[bone]).clone());
      for (let i = 0; i < pos.length / 3; i += 5) {
        if (!comps) { v.fromArray(pos, i * 3).applyMatrix4(b.mesh.matrix); m = Math.min(m, v.y); continue; }
        acc.set(0, 0, 0);
        for (let c = 0; c < comps; c++) { const wt = w[i * comps + c]; if (wt) acc.addScaledVector(v.fromArray(pos, i * 3).applyMatrix4(mats[idx[i * comps + c]]), wt); }
        m = Math.min(m, acc.y);
      }
    }
    return m;
  }


  dispose() {
    this.group.traverse((o: any) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    Object.values(this.textures).forEach((t) => t.dispose());
  }
}
