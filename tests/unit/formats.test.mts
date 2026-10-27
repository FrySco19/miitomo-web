// Unit checks for the POD/PVR/TGA readers against reference outputs.
// Run: node --experimental-strip-types tests/unit/formats.test.mts <dir with bodyAll0400 + ref_*.rgba> 
import { readFileSync } from 'node:fs';
import { parsePVR, parseTGA } from '../../client/web/src/formats/pvr.ts';
import { parsePOD, readAttribute, readIndices } from '../../client/web/src/formats/pod.ts';
const dir = process.argv[2];
let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fail++; };
for (const n of ['AL00', 'MSK', 'NRM']) {
  const img = parsePVR(new Uint8Array(readFileSync(`${dir}/body/bodyAll0400/textures/android/bodyAll0400_${n}.pvr`)));
  const ref = new Uint8Array(readFileSync(`${dir}/ref_${n}.rgba`));
  let diff = 0; for (let i = 0; i < ref.length; i++) if (ref[i] !== img.rgba[i]) diff++;
  check(diff === 0 && img.width === 512 && img.orientation?.join() === '0,2,0', `ETC1 ${n}: ${img.width}x${img.height} mips=${img.mipCount} orient=${img.orientation} differing bytes=${diff}`);
}
const pod = parsePOD(new Uint8Array(readFileSync(`${dir}/body/bodyAll0400/bodyAll0400.Mdl.pod`)));
check(pod.version === 'AB.POD.2.0' && pod.meshes.length === 12 && pod.nodes.length === 54 && pod.materials.length === 10, `POD header: ${pod.version}, meshes ${pod.meshes.length}, nodes ${pod.nodes.length}, materials ${pod.materials.length}, frames ${pod.numFrames}`);
let tris = 0, maxIdx = 0, bad = 0;
pod.meshes.forEach((m, i) => {
  const pos = readAttribute(m, m.position)!, idx = readIndices(m);
  tris += idx.length / 3; for (const k of idx) { maxIdx = Math.max(maxIdx, k); if (k >= m.numVertices) bad++; }
  const w = readAttribute(m, m.boneWeight), bi = readAttribute(m, m.boneIndex);
  if (w) for (let v = 0; v < m.numVertices; v++) { let s = 0; for (let c = 0; c < m.boneWeight!.components; c++) s += w[v * m.boneWeight!.components + c]; if (Math.abs(s - 1) > 1e-3) bad++; }
  if (bi) for (const b of bi) if (b >= m.boneBatchBoneCounts[0]) bad++;
  if (i === 0) check(Math.abs(pos[0]) < 100, `mesh0 first vertex ${[...pos.slice(0, 3)].map((x) => x.toFixed(3))}`);
});
check(bad === 0, `indices in range, bone weights sum to 1, bone indices inside batch palette (violations=${bad}); triangles=${tris}`);
const lut = parseTGA(new Uint8Array(readFileSync(`${dir}/asset/env/lut/fresnelDefault02.tga`)));
check(lut.width === 512 && lut.height === 1 && lut.pixels[0] === 76, `LUT TGA fresnelDefault02 ${lut.width}x${lut.height} first=${lut.pixels[0]}`);
process.exit(fail ? 1 : 0);
