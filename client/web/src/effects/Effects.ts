/**
 * Effect manager (M14): loads effect.ptcl (user's APK) once, reads asset/effect/output/character/<set>.xml (user's
 * CDN zip asset_effect_output) for the bone / offset, plays EffectInstances under the Mii's root.
 */
import * as THREE from 'three';
import { vfs } from '../assets/vfs';
import { parseEft, Eft, V3 } from './Eft';
import { EffectInstance, eftTextures } from './EftPlayer';

const PTCL = 'asset/effect/effect.ptcl';
const XML_DIR = 'asset/effect/output/character/';

export class Effects {
  private eft: Eft | null | undefined;
  private tex: THREE.Texture[] = [];
  private active: EffectInstance[] = [];
  readonly log: { name: string; at: number; bone: string; emitters: number }[] = [];
  private seed = 1;
  available() { return !!this.load(); }
  private load(): Eft | null {
    if (this.eft !== undefined) return this.eft;
    const b = vfs.get(PTCL);
    if (!b) return (this.eft = null);
    try { this.eft = parseEft(b); this.tex = eftTextures(this.eft); } catch (e) { console.warn('effect.ptcl non leggibile', e); this.eft = null; }
    return this.eft;
  }
  reset() { this.clear(); this.tex.forEach((t) => t.dispose()); this.tex = []; this.eft = undefined; }
  /** Bone and offset from the effect's XML (BoneName / OffsetPosition); default Head. */
  /**
   * The descriptor XML (asset/effect/output/character/<name>.xml) names the emitter set it plays (<EmitterSet><Name>) —
   * M18b fix, VERIFIED: e.g. arJoy_Dr.xml plays the set "arJoy" (with its own bone / offset); several descriptors share a set.
   */
  private place(name: string): { bone: string; offset: V3; set: string } {
    const x = vfs.get(XML_DIR + name + '.xml');
    if (!x) return { bone: 'Head', offset: [0, 0, 0], set: name };
    const s = new TextDecoder().decode(x);
    const set = /<EmitterSet>\s*<Name[^>]*>([^<]+)</.exec(s)?.[1]?.trim() || name;
    const bone = /<BoneName[^>]*>([^<]+)</.exec(s)?.[1]?.trim() || 'Head';
    const off = (/<OffsetPosition[^>]*>([^<]+)</.exec(s)?.[1] ?? '0,0,0').split(',').map((v) => Number(v) || 0);
    return { bone, offset: [off[0] ?? 0, off[1] ?? 0, off[2] ?? 0], set };
  }
  /** Starts the effect `name` (descriptor, e.g. "arJoy_Dr") under `parent`. False when the set or the file is missing. */
  play(name: string, parent: THREE.Object3D, at = 0): boolean {
    const eft = this.load(); if (!eft) return false;
    const pl = this.place(name);
    const set = eft.sets.get(pl.set) ?? eft.sets.get(name); if (!set) return false;
    const { bone, offset } = pl;
    const inst = new EffectInstance(set, this.tex, bone, offset, this.seed++);
    parent.add(inst.group); this.active.push(inst);
    this.log.push({ name, at, bone, emitters: set.emitters.length }); if (this.log.length > 50) this.log.shift();
    return true;
  }
  update(dt: number, frame: (bone: string) => THREE.Matrix4 | null) {
    this.active = this.active.filter((i) => { const alive = i.update(dt, frame(i.bone)); if (!alive) i.dispose(); return alive; });
  }
  get count() { return this.active.length; }
  clear() { this.active.forEach((i) => i.dispose()); this.active = []; }
}
