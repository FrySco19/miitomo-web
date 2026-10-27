/**
 * PowerVR POD reader (format: public PowerVR SDK, PVRTModelPOD).
 *
 * Block stream: [u32 tag][i32 length][payload][u32 tag|0x80000000][i32 0]; container blocks
 * (Scene, Mesh, Node, Material, Texture, Light, Camera and per-attribute data) nest their children
 * between start and end tag. Verified against Miitomo 2.4.0 bodyAll0400.Mdl.pod ("AB.POD.2.0").
 */

export interface PodData {
  type: number;           // EPVRTDataType (1 float, 3 u16, 10 u8, ...)
  components: number;
  stride: number;         // 0 = tightly packed / not interleaved
  offsetOrData: number | Uint8Array; // offset into interleaved buffer, or raw bytes
}

export interface PodMesh {
  numVertices: number;
  numFaces: number;
  numUVW: number;
  interleaved: Uint8Array | null;
  faces: PodData | null;
  position: PodData | null;
  normal: PodData | null;
  tangent: PodData | null;
  binormal: PodData | null;
  uv: PodData | null;
  color: PodData | null;
  boneIndex: PodData | null;
  boneWeight: PodData | null;
  boneBatches: number[];        // concatenated bone node indices
  boneBatchBoneCounts: number[];
  boneBatchOffsets: number[];   // first triangle of each batch
  boneBatchBoneMax: number;
  unpackMatrix: number[] | null;
}

export interface PodNode {
  index: number;      // mesh index for mesh nodes, -1 otherwise
  name: string;
  material: number;
  parent: number;
  animFlags: number;
  position: number[];   // per frame (x,y,z)…
  rotation: number[];   // per frame quaternion (x,y,z,w)…
  scale: number[];      // per frame (x,y,z,+4 stretch)…
  matrix: number[] | null;
  positionIdx: number[] | null;
  rotationIdx: number[] | null;
  scaleIdx: number[] | null;
}

export interface PodMaterial {
  name: string;
  diffuseTexture: number;
  ambient: number[];
  diffuse: number[];
  specular: number[];
  opacity: number;
}

export interface PodCamera { target: number; fov: number; far: number; near: number; animFov: number[] | null; }
export interface PodScene {
  version: string;
  units: number;
  /** Camera blocks (2010); camera nodes follow mesh and light nodes in the node list (PVRTModelPOD order). */
  cameras: PodCamera[];
  numLights: number;
  numMeshNodes: number;
  numFrames: number;
  fps: number;
  flags: number;
  meshes: PodMesh[];
  nodes: PodNode[];
  materials: PodMaterial[];
  textures: string[];
}

const CONTAINERS = new Set([1001, 2010, 2011, 2012, 2013, 2014, 2015, 6003, 6006, 6007, 6008, 6009, 6010, 6011, 6012, 6013]);
type Block = { tag: number; kids?: Block[]; data?: Uint8Array };

function readBlocks(dv: DataView, bytes: Uint8Array, o: number, end: number): [Block[], number] {
  const out: Block[] = [];
  while (o < end) {
    const tag = dv.getUint32(o, true);
    const len = dv.getInt32(o + 4, true);
    o += 8;
    if (tag & 0x80000000) return [out, o];
    if (CONTAINERS.has(tag)) {
      const [kids, next] = readBlocks(dv, bytes, o, end);
      out.push({ tag, kids });
      o = next;
    } else {
      out.push({ tag, data: bytes.subarray(o, o + len) });
      o += len;
      const endTag = dv.getUint32(o, true);
      if (endTag !== ((tag | 0x80000000) >>> 0)) throw new Error(`POD: end tag mismatch for ${tag} at ${o}`);
      o += 8;
    }
  }
  return [out, o];
}

const td = new TextDecoder('latin1');
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const i32 = (b: Uint8Array) => view(b).getInt32(0, true);
const f32s = (b: Uint8Array) => { const v = view(b); return Array.from({ length: b.byteLength >> 2 }, (_, i) => v.getFloat32(i * 4, true)); };
const i32s = (b: Uint8Array) => { const v = view(b); return Array.from({ length: b.byteLength >> 2 }, (_, i) => v.getInt32(i * 4, true)); };
const str = (b: Uint8Array) => { const z = b.indexOf(0); return td.decode(z >= 0 ? b.subarray(0, z) : b); };

function readData(kids: Block[], interleaved: boolean): PodData {
  const d: PodData = { type: 0, components: 0, stride: 0, offsetOrData: 0 };
  for (const k of kids) {
    if (k.tag === 9000) d.type = i32(k.data!);
    else if (k.tag === 9001) d.components = i32(k.data!);
    else if (k.tag === 9002) d.stride = i32(k.data!);
    else if (k.tag === 9003) d.offsetOrData = interleaved && k.data!.byteLength === 4 ? i32(k.data!) : k.data!;
  }
  return d;
}

export function parsePOD(bytes: Uint8Array): PodScene {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const [top] = readBlocks(dv, bytes, 0, bytes.byteLength);
  const version = str(top.find((b) => b.tag === 1000)?.data ?? new Uint8Array());
  const sceneBlock = top.find((b) => b.tag === 1001);
  if (!sceneBlock?.kids) throw new Error('POD: no Scene block');
  const scene: PodScene = { version, units: 1, cameras: [], numLights: 0, numMeshNodes: 0, numFrames: 0, fps: 30, flags: 0, meshes: [], nodes: [], materials: [], textures: [] };

  for (const b of sceneBlock.kids) {
    switch (b.tag) {
      case 2019: scene.units = f32s(b.data!)[0]; break;
      case 2003: scene.numLights = i32(b.data!); break;
      case 2010: {
        const c: PodCamera = { target: -1, fov: 0.7, far: 1000, near: 1, animFov: null };
        for (const k of b.kids!) {
          if (k.tag === 8000) c.target = i32(k.data!);
          else if (k.tag === 8001) c.fov = f32s(k.data!)[0];
          else if (k.tag === 8002) c.far = f32s(k.data!)[0];
          else if (k.tag === 8003) c.near = f32s(k.data!)[0];
          else if (k.tag === 8004) c.animFov = f32s(k.data!);
        }
        scene.cameras.push(c);
        break;
      }
      case 2006: scene.numMeshNodes = i32(b.data!); break;
      case 2009: scene.numFrames = i32(b.data!); break;
      case 2016: scene.flags = i32(b.data!); break;
      case 2017: scene.fps = i32(b.data!); break;
      case 2014: scene.textures.push(str(b.kids!.find((k) => k.tag === 4000)!.data!)); break;
      case 2015: {
        const m: PodMaterial = { name: '', diffuseTexture: -1, ambient: [], diffuse: [], specular: [], opacity: 1 };
        for (const k of b.kids!) {
          if (k.tag === 3000) m.name = str(k.data!);
          else if (k.tag === 3001) m.diffuseTexture = i32(k.data!);
          else if (k.tag === 3002) m.opacity = f32s(k.data!)[0];
          else if (k.tag === 3003) m.ambient = f32s(k.data!);
          else if (k.tag === 3004) m.diffuse = f32s(k.data!);
          else if (k.tag === 3005) m.specular = f32s(k.data!);
        }
        scene.materials.push(m);
        break;
      }
      case 2013: {
        const n: PodNode = { index: -1, name: '', material: -1, parent: -1, animFlags: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], matrix: null, positionIdx: null, rotationIdx: null, scaleIdx: null };
        for (const k of b.kids!) {
          const d = k.data!;
          switch (k.tag) {
            case 5000: n.index = i32(d); break;
            case 5001: n.name = str(d); break;
            case 5002: n.material = i32(d); break;
            case 5003: n.parent = i32(d); break;
            case 5012: n.animFlags = i32(d); break;
            case 5007: n.position = f32s(d); break;
            case 5008: n.rotation = f32s(d); break;
            case 5009: n.scale = f32s(d); break;
            case 5011: n.matrix = f32s(d); break;
            case 5013: n.positionIdx = i32s(d); break;
            case 5014: n.rotationIdx = i32s(d); break;
            case 5015: n.scaleIdx = i32s(d); break;
          }
        }
        scene.nodes.push(n);
        break;
      }
      case 2012: {
        const kids = b.kids!;
        const interleavedBlock = kids.find((k) => k.tag === 6014);
        const isInterleaved = !!interleavedBlock && interleavedBlock.data!.byteLength > 0;
        const m: PodMesh = {
          numVertices: 0, numFaces: 0, numUVW: 0, interleaved: isInterleaved ? interleavedBlock!.data! : null,
          faces: null, position: null, normal: null, tangent: null, binormal: null, uv: null, color: null, boneIndex: null, boneWeight: null,
          boneBatches: [], boneBatchBoneCounts: [], boneBatchOffsets: [], boneBatchBoneMax: 0, unpackMatrix: null
        };
        for (const k of kids) {
          const d = k.data!;
          switch (k.tag) {
            case 6000: m.numVertices = i32(d); break;
            case 6001: m.numFaces = i32(d); break;
            case 6002: m.numUVW = i32(d); break;
            case 6003: m.faces = readData(k.kids!, false); break;
            case 6006: m.position = readData(k.kids!, isInterleaved); break;
            case 6007: m.normal = readData(k.kids!, isInterleaved); break;
            case 6008: m.tangent = readData(k.kids!, isInterleaved); break;
            case 6009: m.binormal = readData(k.kids!, isInterleaved); break;
            case 6010: m.uv = readData(k.kids!, isInterleaved); break;
            case 6011: m.color = readData(k.kids!, isInterleaved); break;
            case 6012: m.boneIndex = readData(k.kids!, isInterleaved); break;
            case 6013: m.boneWeight = readData(k.kids!, isInterleaved); break;
            case 6015: m.boneBatches = i32s(d); break;
            case 6016: m.boneBatchBoneCounts = i32s(d); break;
            case 6017: m.boneBatchOffsets = i32s(d); break;
            case 6018: m.boneBatchBoneMax = i32(d); break;
            case 6020: m.unpackMatrix = f32s(d); break;
          }
        }
        scene.meshes.push(m);
        break;
      }
    }
  }
  return scene;
}

/** Bytes per component of an EPVRTDataType. */
export function dataTypeSize(t: number): number {
  switch (t) {
    case 1: case 2: case 9: case 17: return 4;  // float, int, fixed16.16, uint
    case 3: case 11: case 12: case 16: return 2; // ushort, short, shortnorm, ushortnorm
    case 10: case 13: case 14: case 15: return 1; // ubyte, byte, bytenorm, ubytenorm
    case 4: case 5: case 6: case 7: case 8: case 18: return 1; // packed colours (4 bytes as components)
    default: throw new Error(`POD: unsupported data type ${t}`);
  }
}

/** Reads an attribute into a tightly packed Float32Array (components per vertex = data.components). */
export function readAttribute(mesh: PodMesh, d: PodData | null): Float32Array | null {
  if (!d || d.components === 0) return null;
  const n = mesh.numVertices, c = d.components;
  const out = new Float32Array(n * c);
  let src: Uint8Array, base: number, stride: number;
  if (typeof d.offsetOrData === 'number') {
    if (!mesh.interleaved) throw new Error('POD: offset attribute without interleaved data');
    src = mesh.interleaved; base = d.offsetOrData; stride = d.stride;
  } else {
    src = d.offsetOrData; base = 0; stride = d.stride || c * dataTypeSize(d.type);
  }
  const v = view(src);
  for (let i = 0; i < n; i++) {
    const o = base + i * stride;
    for (let j = 0; j < c; j++) {
      switch (d.type) {
        case 1: out[i * c + j] = v.getFloat32(o + j * 4, true); break;
        case 10: case 15: case 7: out[i * c + j] = v.getUint8(o + j); break;
        case 3: case 16: out[i * c + j] = v.getUint16(o + j * 2, true); break;
        case 11: out[i * c + j] = v.getInt16(o + j * 2, true); break;
        case 13: out[i * c + j] = v.getInt8(o + j); break;
        default: throw new Error(`POD: attribute data type ${d.type} not implemented`);
      }
    }
  }
  return out;
}

export function readIndices(mesh: PodMesh): Uint16Array | Uint32Array {
  const d = mesh.faces!;
  const bytes = d.offsetOrData as Uint8Array;
  const count = mesh.numFaces * 3;
  if (d.type === 3) return new Uint16Array(bytes.slice(0, count * 2).buffer);
  if (d.type === 17) return new Uint32Array(bytes.slice(0, count * 4).buffer);
  throw new Error(`POD: index type ${d.type} not supported`);
}

/**
 * Reads packed vertex colours (EPVRTDataType RGBA=4, ARGB=5, D3DCOLOR=6, ABGR=18; one 32-bit value per vertex)
 * into RGBA floats 0..1. ABGR (0xAABBGGRR) is what the room PODs use (shadow meshes).
 */
export function readColorRGBA(mesh: PodMesh, d: PodData | null): Float32Array | null {
  if (!d || d.components === 0) return null;
  if (d.type === 1) { // already float
    const f = readAttribute(mesh, d)!; if (d.components === 4) return f;
    const out = new Float32Array(mesh.numVertices * 4);
    for (let i = 0; i < mesh.numVertices; i++) for (let j = 0; j < 4; j++) out[i * 4 + j] = j < d.components ? f[i * d.components + j] : 1;
    return out;
  }
  const n = mesh.numVertices, out = new Float32Array(n * 4);
  let src: Uint8Array, base: number, stride: number;
  if (typeof d.offsetOrData === 'number') { src = mesh.interleaved!; base = d.offsetOrData; stride = d.stride; }
  else { src = d.offsetOrData; base = 0; stride = d.stride || 4; }
  // byte positions of R,G,B,A in memory (little endian)
  const order: Record<number, number[]> = { 18: [0, 1, 2, 3], 4: [3, 2, 1, 0], 5: [2, 1, 0, 3], 6: [2, 1, 0, 3] };
  const o = order[d.type];
  if (!o) throw new Error(`POD: colour data type ${d.type} not implemented`);
  for (let i = 0; i < n; i++) { const b = base + i * stride; for (let j = 0; j < 4; j++) out[i * 4 + j] = src[b + o[j]] / 255; }
  return out;
}
