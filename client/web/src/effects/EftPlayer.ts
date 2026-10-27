/**
 * Particle player for the decoded nw::eft2 emitters (M14). Simulation per the runtime where it was read
 * (Eft.ts: 8-key curves, colour/alpha modes, combiners, gravity × direction, air resistance, rotation, pattern
 * division), the rest DEDUCED or APPROXIMATED:
 *  - time base 60 frames per second (APPROXIMATED: the game's System::Calc frame rate argument was not traced);
 *  - emission: `count` particles at start, then every `interval` (+ random) frames until start + duration (DEDUCED);
 *  - initial velocity: direction (spread cone) × directional speed + random unit vector × omni speed, both reduced by
 *    up to velRandom % (DEDUCED); spawn volume: point, or a sphere of `radius` for volume types ≥ 1 (APPROXIMATED);
 *  - child emitters are played as independent emitters at the same origin (APPROXIMATED: no inheritance);
 *  - particle types: billboard / Y-billboard / velocity-look (quad aligned to the screen-space velocity) / polygon
 *    XY in emitter space; others fall back to billboard (APPROXIMATED);
 *  - blend type 0 = alpha blending, 1 = additive (DEDUCED: type 1 is used only by glow textures).
 * The effect's origin is the joint named in asset/effect/output/character/<set>.xml (BoneName, OffsetPosition);
 * without the XML: Head (all 57 XMLs use Head).
 */
import * as THREE from 'three';
import type { Eft, EftEmitter, EftSet, V3 } from './Eft';
import { evalKeys } from './Eft';

const FPS = 60;
const MAX = 96;

interface P { alive: boolean; age: number; life: number; pos: THREE.Vector3; vel: THREE.Vector3; scale: number; rot: number; rotVel: number; c0: V3; c1: V3; pat: number; rnd: number; }
class EmitterRun {
  readonly mesh: THREE.Mesh;
  private ps: P[] = [];
  private t = 0; private nextEmit: number; private seed: number;
  private iOff: THREE.InstancedBufferAttribute; private iSc: THREE.InstancedBufferAttribute; private iC0: THREE.InstancedBufferAttribute; private iC1: THREE.InstancedBufferAttribute; private iUv: THREE.InstancedBufferAttribute;
  private local = new THREE.Matrix4();
  constructor(readonly e: EftEmitter, tex: THREE.Texture | null, seed: number) {
    this.seed = seed; this.nextEmit = e.start;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iOff = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);   // xyz + rotation
    this.iSc = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);    // scale xy + velocity dir (screen-space look uses world vel)
    this.iC0 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.iC1 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.iUv = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);    // uv offset xy, uv size xy
    for (const [n, a] of [['iOff', this.iOff], ['iSc', this.iSc], ['iC0', this.iC0], ['iC1', this.iC1], ['iUv', this.iUv]] as const) { a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); }
    this.iVel = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3); this.iVel.setUsage(THREE.DynamicDrawUsage); g.setAttribute('iVel', this.iVel);
    g.instanceCount = 0;
    const type = e.particleType;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, hasMap: { value: tex ? 1 : 0 } },
      defines: { COLOR_PROCESS: e.colorProcess, ALPHA_PROCESS: e.alphaProcess, TEX_COLOR_ONE: e.texColorOne ? 1 : 0, TEX_ALPHA_INPUT: e.texAlphaInput, PTYPE: type === 5 || type === 6 ? 2 : type === 2 || type === 7 ? 1 : type === 3 ? 3 : 0 },
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: e.blend && e.blendType === 1 ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 10;
    this.local.compose(new THREE.Vector3(...e.translate), new THREE.Quaternion().setFromEuler(new THREE.Euler(...e.rotate, 'XYZ')), new THREE.Vector3(...e.scale));
    this.mesh.matrixAutoUpdate = false;
  }
  private iVel: THREE.InstancedBufferAttribute;
  private rand() { this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff; return this.seed / 0x7fffffff; }
  private emit() {
    const e = this.e;
    for (let n = 0; n < e.count; n++) {
      let p = this.ps.find((x) => !x.alive);
      if (!p) { if (this.ps.length >= MAX) return; p = { alive: false, age: 0, life: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), scale: 1, rot: 0, rotVel: 0, c0: [1, 1, 1], c1: [1, 1, 1], pat: 0, rnd: 0 }; this.ps.push(p); }
      const R = () => this.rand();
      p.alive = true; p.age = 0; p.rnd = R();
      p.life = Math.max(1, e.life * (1 - R() * e.lifeRandom / 100));
      const unit = () => { const z = R() * 2 - 1, a = R() * Math.PI * 2, r = Math.sqrt(1 - z * z); return new THREE.Vector3(r * Math.cos(a), z, r * Math.sin(a)); };
      p.pos.set(0, 0, 0);
      if (e.volumeType >= 1) { const u = unit().multiplyScalar(Math.cbrt(R())); p.pos.set(u.x * e.radius[0], u.y * e.radius[1], u.z * e.radius[2]); }
      const dir = new THREE.Vector3(...e.dir); if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0); dir.normalize();
      if (e.spread > 0) {   // cone around dir
        const ang = (e.spread * Math.PI / 180) * Math.sqrt(R()), az = R() * Math.PI * 2;
        const ortho = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const a1 = new THREE.Vector3().crossVectors(dir, ortho).normalize(), a2 = new THREE.Vector3().crossVectors(dir, a1);
        dir.multiplyScalar(Math.cos(ang)).addScaledVector(a1, Math.sin(ang) * Math.cos(az)).addScaledVector(a2, Math.sin(ang) * Math.sin(az)).normalize();
      }
      const vr = 1 - R() * e.velRandom / 100;
      p.vel.copy(dir).multiplyScalar(e.dirVel * vr);
      if (e.omniVel) p.vel.addScaledVector(p.pos.lengthSq() > 1e-8 ? p.pos.clone().normalize() : unit(), e.omniVel * vr);
      p.scale = 1 - R() * e.scaleRandom / 100;
      p.rot = e.rotInit[2] + (R() * 2 - 1) * e.rotRandom[2] * 0.5 + (e.rotRandom[2] >= 6.28 ? R() * 6.2831 : 0);
      p.rotVel = e.rotVel[2] + (R() * 2 - 1) * e.rotVelRandom[2];
      // colour mode 3 = random pick from the key table (CalcPtclColor0Vec), else base colour
      const pick = (mode: number, k: EftEmitter['color0Keys'], base: V3): V3 => mode === 3 && k.count > 0 ? (() => { const q = k.keys[Math.min(k.count - 1, Math.floor(R() * k.count))]; return [q[0], q[1], q[2]] as V3; })() : base;
      p.c0 = pick(e.colorMode[0], e.color0Keys, [e.color0[0], e.color0[1], e.color0[2]]);
      p.c1 = pick(e.colorMode[2], e.color1Keys, [e.color1[0], e.color1[1], e.color1[2]]);
      p.pat = e.patterns.length > 1 ? e.patterns[Math.floor(R() * e.patterns.length)] : e.patterns[0] ?? 0;
    }
  }
  /** Advance by dt seconds. `origin` = joint frame (object space of the Mii root). Returns true while anything is alive or pending. */
  update(dt: number, origin: THREE.Matrix4): boolean {
    const e = this.e, frames = dt * FPS;
    this.mesh.matrix.multiplyMatrices(origin, this.local);
    const end = e.start + Math.max(1, e.duration);
    for (let f = 0; f < frames; f += 1) {
      const step = Math.min(1, frames - f);
      while (this.t >= this.nextEmit && this.nextEmit < end) { this.emit(); this.nextEmit += e.interval + Math.floor(this.rand() * e.intervalRandom); }
      const air = Math.pow(e.airResistance, step);
      for (const p of this.ps) {
        if (!p.alive) continue;
        p.vel.x = (p.vel.x + e.gravity[0] * step) * air; p.vel.y = (p.vel.y + e.gravity[1] * step) * air; p.vel.z = (p.vel.z + e.gravity[2] * step) * air;
        p.pos.addScaledVector(p.vel, step);
        p.rot += p.rotVel * step; p.age += step;
        if (p.age >= p.life) p.alive = false;
      }
      this.t += step;
    }
    let n = 0;
    for (const p of this.ps) {
      if (!p.alive) continue;
      const tn = p.age / p.life;
      const sk = evalKeys(e.scaleKeys, tn, [1, 1, 1]);
      const c0 = e.colorMode[0] === 2 ? evalKeys(e.color0Keys, tn, p.c0) : p.c0;
      const a0 = e.colorMode[1] === 2 ? evalKeys(e.alpha0Keys, tn, [e.color0[3], 0, 0])[0] : e.color0[3];
      const c1 = e.colorMode[2] === 2 ? evalKeys(e.color1Keys, tn, p.c1) : p.c1;
      const a1 = e.colorMode[3] === 2 ? evalKeys(e.alpha1Keys, tn, [e.color1[3], 0, 0])[0] : e.color1[3];
      const cs = e.colorScale;
      this.iOff.setXYZW(n, p.pos.x, p.pos.y, p.pos.z, p.rot);
      this.iSc.setXYZW(n, e.baseScale[0] * p.scale * sk[0], e.baseScale[1] * p.scale * sk[1], 0, 0);
      this.iVel.setXYZ(n, p.vel.x, p.vel.y, p.vel.z);
      this.iC0.setXYZW(n, c0[0] * cs, c0[1] * cs, c0[2] * cs, a0);
      this.iC1.setXYZW(n, c1[0] * cs, c1[1] * cs, c1[2] * cs, a1);
      const [dx, dy] = e.uvDiv, ix = p.pat % dx, iy = Math.floor(p.pat / dx) % dy;
      this.iUv.setXYZW(n, ix / dx, iy / dy, e.uvScale[0] / dx, e.uvScale[1] / dy);
      if (++n >= MAX) break;
    }
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry; g.instanceCount = n;
    for (const a of [this.iOff, this.iSc, this.iC0, this.iC1, this.iUv, this.iVel]) a.needsUpdate = true;
    return n > 0 || this.nextEmit < end;
  }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.removeFromParent(); }
}

export class EffectInstance {
  readonly group = new THREE.Group();
  private runs: EmitterRun[] = [];
  constructor(readonly set: EftSet, textures: (THREE.Texture | null)[], readonly bone: string, readonly offset: V3, seed = 1) {
    set.emitters.forEach((e, i) => { const r = new EmitterRun(e, textures[e.texture] ?? null, seed * 31 + i * 7 + 1); this.runs.push(r); this.group.add(r.mesh); });
  }
  /** False when finished. */
  update(dt: number, jointFrame: THREE.Matrix4 | null): boolean {
    const o = new THREE.Matrix4();
    if (jointFrame) { const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); jointFrame.decompose(t, q, s); o.compose(t, q, new THREE.Vector3(1, 1, 1)); }
    o.multiply(new THREE.Matrix4().makeTranslation(...this.offset));
    let alive = false;
    for (const r of this.runs) alive = r.update(dt, o) || alive;
    return alive;
  }
  dispose() { this.runs.forEach((r) => r.dispose()); this.group.removeFromParent(); }
}

/** Textures of the file as THREE textures (rows stored top-down; flipped in the shader). */
export function eftTextures(eft: Eft): THREE.Texture[] {
  return eft.textures.map((t) => { const x = new THREE.DataTexture(t.rgba, t.width, t.height, THREE.RGBAFormat); x.magFilter = THREE.LinearFilter; x.minFilter = THREE.LinearFilter; x.colorSpace = THREE.SRGBColorSpace; x.needsUpdate = true; return x; });
}

const VS = /* glsl */`
attribute vec4 iOff; attribute vec4 iSc; attribute vec4 iC0; attribute vec4 iC1; attribute vec4 iUv; attribute vec3 iVel;
varying vec2 vUv; varying vec4 vC0; varying vec4 vC1;
void main() {
  vec2 q = position.xy * iSc.xy;
  float c = cos(iOff.w), s = sin(iOff.w);
  vec4 center = modelViewMatrix * vec4(iOff.xyz, 1.0);
  vec3 off;
#if PTYPE == 3
  // polygon XY: quad in the emitter's XY plane
  vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  center = modelViewMatrix * vec4(iOff.xyz + vec3(r, 0.0), 1.0); off = vec3(0.0);
#elif PTYPE == 2
  // velocity look: the quad's Y axis follows the velocity projected on the screen
  vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz; vec2 d = length(vv.xy) > 1e-5 ? normalize(vv.xy) : vec2(0.0, 1.0);
  vec2 rx = vec2(d.y, -d.x); off = vec3(rx * q.x + d * q.y, 0.0);
#elif PTYPE == 1
  // Y billboard: keep the model's up axis
  vec3 up = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz); vec3 rt = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
  vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y); off = -rt * r.x + up * r.y;
#else
  vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y); off = vec3(r, 0.0);
#endif
  gl_Position = projectionMatrix * (center + vec4(off, 0.0));
  vec2 uv = position.xy + 0.5; uv.y = 1.0 - uv.y;
  vUv = iUv.xy + uv * iUv.zw; vC0 = iC0; vC1 = iC1;
}`;
// Combiners: copies of the original fragment shader's _COLOR_PROCESS_* / _ALPHA_PROCESS_* lines (SHPF).
const FS = /* glsl */`
uniform sampler2D map; uniform int hasMap;
varying vec2 vUv; varying vec4 vC0; varying vec4 vC1;
void main() {
  vec4 t = hasMap == 1 ? texture2D(map, vUv) : vec4(1.0);
#if TEX_COLOR_ONE == 1
  t.rgb = vec3(1.0);
#endif
#if TEX_ALPHA_INPUT == 1
  t.a = t.r;
#elif TEX_ALPHA_INPUT == 2
  t.a = 1.0;
#endif
  vec4 o;
#if COLOR_PROCESS == 0
  o.rgb = vC0.rgb;
#elif COLOR_PROCESS == 1
  o.rgb = t.rgb * vC0.rgb;
#elif COLOR_PROCESS == 2
  o.rgb = mix(vC1.rgb, vC0.rgb, t.rgb);
#else
  o.rgb = t.rgb * vC0.rgb + vC1.rgb;
#endif
#if ALPHA_PROCESS == 0
  o.a = t.a * vC0.a;
#elif ALPHA_PROCESS == 1
  o.a = t.a * vC0.a * vC1.a;
#elif ALPHA_PROCESS == 2
  o.a = (t.a - (1.0 - vC0.a)) * 2.0;
#elif ALPHA_PROCESS == 3
  o.a = (t.a - vC0.a) * vC1.a;
#else
  o.a = clamp((t.a - vC0.a) * 4.0, 0.0, 1.0) * vC1.a;
#endif
  if (o.a <= 0.003) discard;
  gl_FragColor = vec4(o.rgb, clamp(o.a, 0.0, 1.0));
}`;
