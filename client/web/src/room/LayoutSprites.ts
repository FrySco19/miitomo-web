/**
 * Sprites of the original room layout (asset_layout_v2-0_room, CDN zip imported by the user):
 *   asset/layout/room/Published-iOS/texture-room/resources-iphone/textureNN.pvr.ccz + textureNN.plist
 * .pvr.ccz = "CCZ!" header (16 B, big-endian length) + zlib stream -> PVR v2 (52-byte header, pixel type in the low
 * byte of flags: 0x10 = RGBA4444, 0x1B = A8). .plist = cocos2d TexturePacker format 2 (frame / rotated).  REVERSED
 * texture00/02/03 hold UI parts and white A8 masks (the game tints them), texture01 the 38 speech-balloon shapes.
 * Sprites are decoded in this browser only; nothing is bundled.
 */
import { unzlibSync } from 'fflate';
import { vfs, text } from '../assets/vfs';

const DIR = 'asset/layout/room/Published-iOS/texture-room/resources-iphone/';
export const BOOT_DIR = 'asset/layout/boot/Published-iOS/texture-boot/resources-iphone/';
export interface Sprite { canvas: HTMLCanvasElement; url: string; w: number; h: number; atlas: string; }

const atlases = new Map<string, { img: ImageData; frames: Map<string, { x: number; y: number; w: number; h: number; rot: boolean }> } | null>();
const sprites = new Map<string, Sprite | null>();

export function layoutAvailable() { return vfs.has(`${DIR}texture00.pvr.ccz`) && vfs.has(`${DIR}texture00.plist`); }

function decodeCCZ(b: Uint8Array): ImageData {
  if (String.fromCharCode(...b.subarray(0, 4)) !== 'CCZ!') throw new Error('CCZ: magic');
  const d = unzlibSync(b.subarray(16));
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const hdr = dv.getUint32(0, true), H = dv.getUint32(4, true), W = dv.getUint32(8, true), fmt = dv.getUint32(16, true) & 0xff;
  const px = d.subarray(hdr);
  const out = new ImageData(W, H);
  const o = out.data;
  if (fmt === 0x10) {
    for (let i = 0; i < W * H; i++) { const v = px[i * 2] | (px[i * 2 + 1] << 8); o[i * 4] = ((v >> 12) & 15) * 17; o[i * 4 + 1] = ((v >> 8) & 15) * 17; o[i * 4 + 2] = ((v >> 4) & 15) * 17; o[i * 4 + 3] = (v & 15) * 17; }
  } else if (fmt === 0x1b) {
    for (let i = 0; i < W * H; i++) { o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = 255; o[i * 4 + 3] = px[i]; }
  } else throw new Error(`PVR v2: formato 0x${fmt.toString(16)} non supportato`);
  return out;
}

/**
 * The layout atlases (TexturePacker .pvr.ccz, PVR v2 RGBA4444) store PREMULTIPLIED alpha — VERIFIED (data): in every
 * atlas no texel has a colour channel above its alpha (e.g. the white rim of bulletTab00 fades as 44/44/44 @ 0x44).
 * cocos2d-x draws them with GL_ONE / GL_ONE_MINUS_SRC_ALPHA; a browser <img>/canvas expects straight alpha, so drawing
 * the raw texels darkened every anti-aliased edge (grey fringes on the bottom-bar buttons and other icons).
 * Converted once per atlas, only when the data is premultiplied (no texel with rgb > a).
 */
export function unpremultiply(img: ImageData): ImageData {
  const o = img.data;
  for (let i = 0; i < o.length; i += 4) { const a = o[i + 3]; if (o[i] > a || o[i + 1] > a || o[i + 2] > a) return img; }
  for (let i = 0; i < o.length; i += 4) {
    const a = o[i + 3];
    if (a > 0 && a < 255) { const k = 255 / a; o[i] = Math.min(255, Math.round(o[i] * k)); o[i + 1] = Math.min(255, Math.round(o[i + 1] * k)); o[i + 2] = Math.min(255, Math.round(o[i + 2] * k)); }
  }
  return img;
}

function atlas(n: string, dir = DIR) {
  const key = dir + n;
  if (!atlases.has(key)) {
    let a = null;
    try {
      const pv = vfs.get(`${dir}${n}.pvr.ccz`), pl = vfs.get(`${dir}${n}.plist`);
      if (pv && pl) {
        const img = unpremultiply(decodeCCZ(pv));
        const doc = new DOMParser().parseFromString(text(pl), 'application/xml');
        const frames = new Map<string, { x: number; y: number; w: number; h: number; rot: boolean }>();
        const top = doc.querySelector('plist > dict')!;
        const fr = [...top.children].find((e, i, arr) => arr[i - 1]?.textContent === 'frames' && e.tagName === 'dict');
        const kids = fr ? [...fr.children] : [];
        for (let i = 0; i + 1 < kids.length; i += 2) {
          const name = kids[i].textContent!.split('/').pop()!;
          const d = [...kids[i + 1].children];
          const val = (k: string) => { const j = d.findIndex((e) => e.tagName === 'key' && e.textContent === k); return j >= 0 ? d[j + 1] : null; };
          const nums = (val('frame')?.textContent ?? '').match(/-?\d+/g)?.map(Number) ?? [];
          frames.set(name, { x: nums[0], y: nums[1], w: nums[2], h: nums[3], rot: val('rotated')?.tagName === 'true' });
        }
        a = { img, frames };
      }
    } catch (e) { console.warn(`atlas ${n}: ${(e as Error).message}`); }
    atlases.set(key, a);
  }
  return atlases.get(key)!;
}

/** e.g. sprite('texture00', 'balloonMenu00.png'). Rotated frames are stored 90° clockwise in the atlas. */
export function sprite(atlasName: string, name: string, dir = DIR): Sprite | null {
  const key = `${dir}${atlasName}/${name}`;
  if (!sprites.has(key)) {
    let s: Sprite | null = null;
    const a = atlas(atlasName, dir); const f = a?.frames.get(name);
    if (a && f) {
      const aw = f.rot ? f.h : f.w, ah = f.rot ? f.w : f.h;
      const src = document.createElement('canvas'); src.width = aw; src.height = ah;
      const sc = src.getContext('2d')!;
      sc.putImageData(a.img, -f.x, -f.y, f.x, f.y, aw, ah);
      const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
      const g = c.getContext('2d')!;
      if (f.rot) { g.translate(0, f.h); g.rotate(-Math.PI / 2); }
      g.drawImage(src, 0, 0);
      s = { canvas: c, url: c.toDataURL('image/png'), w: f.w, h: f.h, atlas: atlasName };
    }
    sprites.set(key, s);
  }
  return sprites.get(key)!;
}
export function clearSpriteCache() { atlases.clear(); sprites.clear(); }

/**
 * Speech balloon at an arbitrary size from texture00/balloonMenu00.png (306x114, rounded box + bottom-centre tail +
 * shadow): nine-slice with an unstretched tail column. The slice geometry is ours (APPROXIMATED); the art is original.
 */
export function balloonImage(w: number, h: number, scale = 1, tailX = w / 2): string | null {
  const s = sprite('texture00', 'balloonMenu00.png'); if (!s) return null;
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const L = 24, R = 24, T = 24, B = 44, TAIL = 70;            // source slices (px of the 306x114 sprite)
  const sw = s.w, sh = s.h, tx0 = Math.round(sw / 2 - TAIL / 2) - 2, tx1 = tx0 + TAIL;
  const k = scale * 0.5;                                      // sprite is @2x (resources-iphone)
  const dl = L * k, dr = R * k, dt = T * k, db = B * k, dtail = TAIL * k;
  const tx = Math.min(Math.max(tailX * scale, dl + dtail / 2 + 2), W - dr - dtail / 2 - 2);
  const dx0 = Math.round(tx - dtail / 2), dx1 = Math.round(dx0 + dtail);
  const cols: [number, number, number, number][] = [[0, L, 0, dl], [L, tx0, dl, dx0], [tx0, tx1, dx0, dx1], [tx1, sw - R, dx1, W - dr], [sw - R, sw, W - dr, W]];
  const rows: [number, number, number, number][] = [[0, T, 0, dt], [T, sh - B, dt, H - db], [sh - B, sh, H - db, H]];
  for (const [sx0, sx1, ex0, ex1] of cols) for (const [sy0, sy1, ey0, ey1] of rows) {
    if (sx1 <= sx0 || sy1 <= sy0 || ex1 <= ex0 || ey1 <= ey0) continue;
    // integer destination rects + 1 px overlap: no hairline seams between slices
    const X0 = Math.floor(ex0), Y0 = Math.floor(ey0), X1 = Math.ceil(ex1), Y1 = Math.ceil(ey1);
    g.drawImage(s.canvas, sx0, sy0, sx1 - sx0, sy1 - sy0, X0, Y0, X1 - X0 + (X1 < W ? 1 : 0), Y1 - Y0 + (Y1 < H ? 1 : 0));
  }
  return c.toDataURL('image/png');
}
