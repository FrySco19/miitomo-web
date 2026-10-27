/**
 * PVR v3 texture container reader + ETC1 software decoder.
 *
 * Miitomo 2.4.0 Android textures (e.g. bodyAll0400_AL00.pvr): PVR v3, pixel format 6 (ETC1),
 * 512x512, 10 mip levels, metadata key 3 (orientation) = [x:0 right, y:2 up, z:0].
 * Orientation "up" = rows stored bottom-to-top, i.e. OpenGL convention: upload without flipping.
 * ETC1 is decoded on the CPU because desktop WebGL2 rarely exposes ETC1/ETC2 compression.
 */

export interface PvrImage {
  width: number;
  height: number;
  pixelFormat: number;
  mipCount: number;
  orientation: [number, number, number] | null;
  rgba: Uint8Array; // level 0 decoded, rows in file order
}

const PVR3_MAGIC = 0x03525650;

export function parsePVR(bytes: Uint8Array): PvrImage {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== PVR3_MAGIC) throw new Error('PVR: not a PVR v3 file');
  const pfLow = dv.getUint32(8, true);
  const pfHigh = dv.getUint32(12, true);
  const height = dv.getUint32(24, true);
  const width = dv.getUint32(28, true);
  const mipCount = dv.getUint32(44, true);
  const metaSize = dv.getUint32(48, true);

  let orientation: [number, number, number] | null = null;
  for (let o = 52; o + 12 <= 52 + metaSize;) {
    const key = dv.getUint32(o + 4, true), size = dv.getUint32(o + 8, true);
    if (key === 3 && size === 3) orientation = [bytes[o + 12], bytes[o + 13], bytes[o + 14]];
    o += 12 + size;
  }
  if (pfHigh !== 0) throw new Error('PVR: uncompressed channel formats not implemented yet');
  const data = bytes.subarray(52 + metaSize);
  let rgba: Uint8Array;
  switch (pfLow) {
    case 6: rgba = decodeETC1(data, width, height); break; // ETC1
    default: throw new Error(`PVR: pixel format ${pfLow} not implemented`);
  }
  return { width, height, pixelFormat: pfLow, mipCount, orientation, rgba };
}

const ETC1_MODIFIERS = [
  [2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]
];
const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Decodes ETC1 (Khronos OES_compressed_ETC1_RGB8_texture) to RGBA8. */
export function decodeETC1(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bw = Math.max(1, (width + 3) >> 2), bh = Math.max(1, (height + 3) >> 2);
  const base1 = [0, 0, 0], base2 = [0, 0, 0];
  let p = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, p += 8) {
      const hi = ((src[p] << 24) | (src[p + 1] << 16) | (src[p + 2] << 8) | src[p + 3]) >>> 0;
      const lo = ((src[p + 4] << 24) | (src[p + 5] << 16) | (src[p + 6] << 8) | src[p + 7]) >>> 0;
      const diff = (hi >>> 1) & 1;
      const flip = hi & 1;
      const cw1 = (hi >>> 5) & 7, cw2 = (hi >>> 2) & 7;
      if (diff) {
        for (let c = 0; c < 3; c++) {
          const shift = 27 - c * 8; // R: bits 31..27 of hi, G: 23..19, B: 15..11
          const b5 = (hi >>> shift) & 31;
          let d3 = (hi >>> (shift - 3)) & 7;
          if (d3 >= 4) d3 -= 8;
          const b5b = b5 + d3;
          base1[c] = (b5 << 3) | (b5 >> 2);
          base2[c] = ((b5b & 31) << 3) | ((b5b & 31) >> 2);
        }
      } else {
        for (let c = 0; c < 3; c++) {
          const shift = 28 - c * 8;
          const a = (hi >>> shift) & 15, b = (hi >>> (shift - 4)) & 15;
          base1[c] = (a << 4) | a;
          base2[c] = (b << 4) | b;
        }
      }
      for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
          const px = bx * 4 + x, py = by * 4 + y;
          if (px >= width || py >= height) continue;
          const i = x * 4 + y; // pixel indices are column-major
          const msb = (lo >>> (16 + i)) & 1, lsb = (lo >>> i) & 1;
          const second = flip ? y >= 2 : x >= 2;
          const base = second ? base2 : base1;
          const mod = ETC1_MODIFIERS[second ? cw2 : cw1];
          const m = msb ? -mod[lsb] : mod[lsb]; // idx 0:+a 1:+b 2:-a 3:-b
          const o = (py * width + px) * 4;
          out[o] = clamp8(base[0] + m);
          out[o + 1] = clamp8(base[1] + m);
          out[o + 2] = clamp8(base[2] + m);
          out[o + 3] = 255;
        }
      }
    }
  }
  return out;
}

/** Uncompressed 8-bit greyscale / 24-bit TGA (LUTs in assets/asset/env/lut are 512x1). */
export function parseTGA(bytes: Uint8Array): { width: number; height: number; channels: number; pixels: Uint8Array } {
  const idLen = bytes[0], type = bytes[2];
  const width = bytes[12] | (bytes[13] << 8), height = bytes[14] | (bytes[15] << 8), bpp = bytes[16];
  if (type !== 2 && type !== 3) throw new Error(`TGA: image type ${type} not supported`);
  const channels = bpp >> 3;
  return { width, height, channels, pixels: bytes.subarray(18 + idLen, 18 + idLen + width * height * channels) };
}
