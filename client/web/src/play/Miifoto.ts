/**
 * Miifoto (M12): photo composer rebuilt from the original data. Everything comes from the user's files.
 *
 *  poses       System/ArchCamera/ArchCameraAnimation.msbt — 88 labels with MSBT attributes (set "ac_"):
 *              ac_AnimFileName (clip), ac_AnimCaptureFrame, ac_BaseLocation, ac_CameraFileName(63), ac_FaceNumber    REVERSED
 *  faces       ArchCameraFace.msbt labels faceN (N = FFL/AFL expression index; 0–5 = normal, smile, anger, sorrow,
 *              surprise, blink match the names "Normale/Felicità/Rabbia/Tristezza/Sorpresa/Sonno")              DEDUCED
 *  cameras     asset/model/camera/output/cameraCapNN*_L.xml (ArchCameraAnim: Position, Aim, Near, Far, FovY)     VERIFIED (data)
 *  lights      asset/env/scene/archCamera_scene.xml                                                           VERIFIED (data)
 *  backgrounds asset/archCamera/cameraBg/default/cameraBgNNN.webp 640×640 (+ t_ thumbnails)                     VERIFIED (data)
 *  stamps      asset/archCamera/cameraStamp/<category>/*.webp, category names ArchCameraStampCategory_v2-2.msbt  VERIFIED (data)
 *  fonts       ArchCameraFont.msbt ac_FontFile / ac_FontOutline; files asset/layout/font/* (APK + CDN font zips)  REVERSED
 *  templates   asset/archCamera/template/default/*.dat (plist: BgLabel, Label*, Stamp*, Mii* per slot 0–4),
 *              template texts ArchCameraTemplateText.msbt                                                     VERIFIED (data)
 * Photo size 640×640 (backgrounds). Coordinates of labels/stamps: cocos2d points, origin bottom-left (DEDUCED).
 * Mii placement uses MiiCameraScale / MiiCameraOffsetX/Y (NDC of the photo) — interpretation DEDUCED.
 */
import { vfs, text } from '../assets/vfs';
import { line, label, render } from '../room/RoomText';
import { parseMSBP, msbtAttributes, Msbp } from '../formats/msbt';

const AC = 'message/Release/Console/EUit/Client/System/ArchCamera/';
export const PHOTO = 640;

let proj: Msbp | null = null;
function project(): Msbp | null {
  if (!proj) { const b = vfs.get('message/Release/Arch.msbp'); if (b) proj = parseMSBP(b); }
  return proj;
}
export function miifotoAvailable() { return vfs.has(`${AC}ArchCameraAnimation.msbt`) && [...vfs.keys()].some((k) => k.startsWith('asset/archCamera/cameraBg/')); }

export interface Pose { id: string; name: string; clip: string; frame: number; camera: string; face: number; }
export function poses(): Pose[] {
  const b = vfs.get(`${AC}ArchCameraAnimation.msbt`); const p = project(); if (!b || !p) return [];
  const out: Pose[] = [];
  for (const [id, a] of msbtAttributes(b, p, 'ac_')) {
    const clip = String(a.ac_AnimFileName ?? ''); if (!clip) continue;
    out.push({ id, name: label('System/ArchCamera/ArchCameraAnimation.msbt', id, id), clip, frame: Number(a.ac_AnimCaptureFrame ?? 0), camera: String(a.ac_CameraFileName ?? ''), face: Number(a.ac_FaceNumber ?? 1) });
  }
  return out;
}
export interface Face { id: string; name: string; expression: number; }
export function faces(): Face[] {
  const rel = 'System/ArchCamera/ArchCameraFace.msbt';
  const out: Face[] = [];
  for (let n = 0; n < 70; n++) { const id = `face${n}`; if (line(rel, id)) out.push({ id, name: label(rel, id, id), expression: n }); }
  return out;
}
export interface Cam { pos: number[]; aim: number[]; near: number; far: number; fovY: number; }
export function camera(file: string): Cam | null {
  const b = vfs.get(`asset/model/camera/output/${file}`); if (!b) return null;
  const doc = new DOMParser().parseFromString(text(b), 'application/xml');
  const v = (n: string) => doc.querySelector(`Stream[Name="${n}"]`)?.textContent?.trim().split(/\s+/).map(Number) ?? [];
  return { pos: v('Position'), aim: v('Aim'), near: v('Near')[0] ?? 20, far: v('Far')[0] ?? 80, fovY: v('FovY')[0] ?? 0.384 };
}
export function backgrounds(): { id: string; url: () => string; thumb: () => string }[] {
  const dir = 'asset/archCamera/cameraBg/default/';
  return [...vfs.keys()].filter((k) => k.startsWith(dir) && /\/cameraBg\d+\.webp$/.test(k)).sort().map((k) => {
    const id = /cameraBg(\d+)/.exec(k)![1]; const t = `${dir}t_cameraBg${id}.webp`;
    return { id, url: () => blobUrl(k), thumb: () => blobUrl(vfs.has(t) ? t : k) };
  });
}
export function stampCategories(): { id: string; name: string; stamps: { file: string; url: () => string }[] }[] {
  const cats = new Map<string, string[]>();
  for (const k of vfs.keys()) { const m = /^asset\/archCamera\/cameraStamp\/cameraStamp([A-Za-z]+)\/[^/]+\.webp$/.exec(k); if (m) (cats.get(m[1]) ?? cats.set(m[1], []).get(m[1])!).push(k); }
  return [...cats].map(([c, files]) => ({ id: c, name: label('System/ArchCamera/ArchCameraStampCategory_v2-2.msbt', c.toLowerCase(), c), stamps: files.sort().map((f) => ({ file: f, url: () => blobUrl(f) })) }));
}
export interface FontDef { id: string; name: string; file: string; outline: number; }
export function fonts(): FontDef[] {
  const b = vfs.get(`${AC}ArchCameraFont.msbt`); const p = project(); if (!b || !p) return [];
  const out: FontDef[] = [];
  for (const [id, a] of msbtAttributes(b, p, 'ac_Font')) {
    const file = String(a.ac_FontFile ?? '');
    if (file && vfs.has(`asset/layout/font/${file}`)) out.push({ id, name: label('System/ArchCamera/ArchCameraFont.msbt', id, id), file, outline: Number(a.ac_FontOutline ?? 0) });
  }
  return out;
}
const loadedFonts = new Map<string, Promise<string>>();
/** Registers an original font file as a CSS font family; resolves to the family name. */
export function loadFont(f: FontDef): Promise<string> {
  if (!loadedFonts.has(f.file)) {
    const fam = `MTW-${f.id}`;
    const bytes = vfs.get(`asset/layout/font/${f.file}`)!;
    loadedFonts.set(f.file, new FontFace(fam, bytes.slice().buffer).load().then((ff) => { document.fonts.add(ff); return fam; }));
  }
  return loadedFonts.get(f.file)!;
}

export interface Template { id: string; data: Record<string, unknown>; }
export function templates(): Template[] {
  const dir = 'asset/archCamera/template/default/';
  return [...vfs.keys()].filter((k) => k.startsWith(dir) && k.endsWith('.dat')).sort().map((k) => ({ id: k.slice(dir.length, -4), data: parsePlist(text(vfs.get(k)!)) }));
}
function parsePlist(src: string): Record<string, unknown> {
  const doc = new DOMParser().parseFromString(src, 'application/xml');
  const dict = doc.querySelector('plist > dict'); const out: Record<string, unknown> = {};
  if (!dict) return out;
  const kids = [...dict.children];
  for (let i = 0; i + 1 < kids.length; i += 2) {
    const k = kids[i].textContent ?? '', v = kids[i + 1];
    out[k] = v.tagName === 'integer' || v.tagName === 'real' ? Number(v.textContent) : v.tagName === 'true' ? true : v.tagName === 'false' ? false : v.textContent ?? '';
  }
  return out;
}

// ---------------- composition ----------------
export interface PhotoText { text: string; font: string; color: string; x: number; y: number; scale: number; rot: number; }
export interface PhotoStamp { file: string; x: number; y: number; scale: number; rot: number; flipX: boolean; }
export interface Photo {
  bg: string | null;
  mii: { pose: string; face: number; scale: number; offX: number; offY: number; visible: boolean; frame?: number; cam?: { pos: number[]; aim: number[]; up: number[] } };
  stamps: PhotoStamp[];
  texts: PhotoText[];
}
export function newPhoto(): Photo { return { bg: '000', mii: { pose: 'stand1', face: 1, scale: 0.6, offX: 0, offY: -0.35, visible: true }, stamps: [], texts: [] }; }

/** Applies an original template (.dat) to a photo (Mii slot 0 only; other slots are friends' Miis). */
export function fromTemplate(t: Template): Photo {
  const d = t.data as Record<string, any>;
  const p = newPhoto();
  p.bg = typeof d.BgLabel === 'string' && /^bg\d+$/.test(d.BgLabel) ? d.BgLabel.slice(2).padStart(3, '0') : p.bg;
  p.mii = { pose: d.MiiManualAnimation_0 || 'stand1', face: faceIndex(d.MiiManualAFLExpression_0), scale: Number(d.MiiCameraScale_0 ?? 0.6), offX: Number(d.MiiCameraOffsetX_0 ?? 0), offY: Number(d.MiiCameraOffsetY_0 ?? -0.35), visible: d.MiiVisible_0 !== false };
  if (Number(d.MiiCameraPosZ_0)) p.mii.cam = { pos: [Number(d.MiiCameraPosX_0), Number(d.MiiCameraPosY_0), Number(d.MiiCameraPosZ_0)], aim: [Number(d.MiiCameraTargetX_0), Number(d.MiiCameraTargetY_0), Number(d.MiiCameraTargetZ_0)], up: [Number(d.MiiCameraUpX_0), Number(d.MiiCameraUpY_0), Number(d.MiiCameraUpZ_0)] };
  p.mii.frame = Number(d.MiiCurrentFrame_0 ?? NaN);
  for (let i = 0; i < 8; i++) {
    if (d[`StampImageLabel_${i}`] === undefined) break;
    const cat = String(d[`StampCategoryLabel_${i}`] ?? ''), img = String(d[`StampImageLabel_${i}`] ?? '');
    const file = [...vfs.keys()].find((k) => k.startsWith('asset/archCamera/cameraStamp/') && k.endsWith(`/${img}.webp`) && (!cat || k.toLowerCase().includes(cat.toLowerCase()))) ?? [...vfs.keys()].find((k) => k.endsWith(`/${img}.webp`));
    if (file) p.stamps.push({ file, x: Number(d[`StampPosX_${i}`]), y: Number(d[`StampPosY_${i}`]), scale: Number(d[`StampScaleX_${i}`] ?? 1), rot: Number(d[`StampRotation_${i}`] ?? 0), flipX: !!d[`StampReverseX_${i}`] });
  }
  for (let i = 0; i < 8; i++) {
    const key = d[`LabelText_${i}`]; if (key === undefined) break;
    const l = line('System/ArchCamera/ArchCameraTemplateText.msbt', String(key));
    const txt = l ? render(l.nodes, { nickname: '', female: false }).pages.map((pg) => pg.spans.map((x) => x.text).join('')).join('\n') : String(key);
    p.texts.push({ text: txt.replace(/\{[^}]*\}/g, ''), font: String(d[`LabelFontLabel_${i}`] ?? 'default0'), color: String(d[`LabelColorLabel_${i}`] ?? 'black'), x: Number(d[`LabelPosX_${i}`]), y: Number(d[`LabelPosY_${i}`]), scale: Number(d[`LabelScale_${i}`] ?? 1), rot: Number(d[`LabelRotation_${i}`] ?? 0) });
  }
  return p;
}
function faceIndex(v: unknown) { const m = /face(\d+)/.exec(String(v ?? '')); return m ? Number(m[1]) : String(v) === 'normal' ? 0 : 1; }

const COLORS: Record<string, string> = { black: '#505050', white: '#ffffff', red: '#f05a28', blue: '#009bbe', gray: '#969696', yellow: '#f5c800', green: '#3caa3c', pink: '#f08cb4' }; // Arch_* colours where known (msbp CLR1), others APPROXIMATED
const imgCache = new Map<string, Promise<HTMLImageElement>>();
function img(url: string) { if (!imgCache.has(url)) imgCache.set(url, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; })); return imgCache.get(url)!; }
const blobs = new Map<string, string>();
function blobUrl(path: string) { if (!blobs.has(path)) blobs.set(path, URL.createObjectURL(new Blob([vfs.get(path)!], { type: 'image/webp' }))); return blobs.get(path)!; }

/** Draws the photo: background, Mii layer (pre-rendered 640×640, transparent), stamps, texts. */
export async function compose(ctx: CanvasRenderingContext2D, p: Photo, mii: HTMLCanvasElement | null, fontFamily: (id: string) => Promise<string>) {
  const S = PHOTO;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, S, S);
  if (p.bg) { const k = `asset/archCamera/cameraBg/default/cameraBg${p.bg}.webp`; if (vfs.has(k)) ctx.drawImage(await img(blobUrl(k)), 0, 0, S, S); }
  if (mii && p.mii.visible) {
    // Mii layer: rendered with the pose camera, scaled by MiiCameraScale/0.6 around the photo centre and offset in NDC
    // MiiCameraScale = size of the Mii layer relative to the photo, MiiCameraOffsetX/Y = layer centre in photo NDC (DEDUCED)
    const w = S * p.mii.scale, cx = S / 2 + p.mii.offX * S / 2, cy = S / 2 - p.mii.offY * S / 2;
    ctx.drawImage(mii, cx - w / 2, cy - w / 2, w, w);
  }
  for (const s of p.stamps) {
    const im = await img(blobUrl(s.file));
    ctx.save(); ctx.translate(s.x, S - s.y); ctx.rotate((s.rot * Math.PI) / 180); ctx.scale(s.flipX ? -s.scale : s.scale, s.scale);
    ctx.drawImage(im, -im.width / 2, -im.height / 2); ctx.restore();
  }
  for (const t of p.texts) {
    const fam = await fontFamily(t.font);
    ctx.save(); ctx.translate(t.x, S - t.y); ctx.rotate((t.rot * Math.PI) / 180);
    const size = 64 * t.scale;   // base size APPROXIMATED
    ctx.font = `${size}px "${fam}", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = t.text.split('\n');
    lines.forEach((ln, i) => {
      const y = (i - (lines.length - 1) / 2) * size * 1.1;
      ctx.lineWidth = Math.max(2, size / 9); ctx.strokeStyle = t.color === 'white' ? '#505050' : '#ffffff'; ctx.lineJoin = 'round'; ctx.strokeText(ln, 0, y);
      ctx.fillStyle = COLORS[t.color] ?? t.color; ctx.fillText(ln, 0, y);
    });
    ctx.restore();
  }
}
