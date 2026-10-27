/**
 * MSBT ("MsgStdBn", Nintendo LibMessageStudio) reader.               format: REVERSED (public format + the game's files)
 *
 * Layout: 0x20-byte header (magic, BOM, encoding byte at 0x0c: 0 = UTF-8, 1 = UTF-16, section count at 0x0e),
 * then 16-byte-aligned sections. We read LBL1 (hash-bucketed labels -> message index) and TXT2 (offset table +
 * NUL-terminated strings). Inside TXT2 a 0x0E code starts a tag: group(u16) type(u16) paramSize(u16) params;
 * a 0x0F code closes a tag: group(u16) type(u16).
 * Used for the room texts (Client/Scene, Client/System, Client/Layout/room) and for the sound tables
 * (Client/Sound/{Action,BGM,Wave}), which store plain "key -> value" strings.
 */
export interface MsbtTag { kind: 'tag'; group: number; type: number; params: Uint8Array; }
export interface MsbtClose { kind: 'close'; group: number; type: number; }
export type MsbtNode = string | MsbtTag | MsbtClose;
export type Msbt = Map<string, MsbtNode[]>;

export function parseMSBT(bytes: Uint8Array): Msbt {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 8)) !== 'MsgStdBn') throw new Error('MSBT: magic non valido');
  const le = bytes[8] === 0xff && bytes[9] === 0xfe;
  const utf16 = bytes[0x0c] !== 0;
  const nsec = dv.getUint16(0x0e, le);
  const sections = new Map<string, { off: number; size: number }>();
  let off = 0x20;
  for (let i = 0; i < nsec && off + 16 <= bytes.length; i++) {
    const magic = String.fromCharCode(...bytes.subarray(off, off + 4));
    const size = dv.getUint32(off + 4, le);
    sections.set(magic, { off: off + 16, size });
    off = (off + 16 + size + 15) & ~15;
  }
  const lbl = sections.get('LBL1'), txt = sections.get('TXT2');
  if (!lbl || !txt) throw new Error('MSBT: sezioni LBL1/TXT2 mancanti');
  const names = new Map<number, string>();
  const buckets = dv.getUint32(lbl.off, le);
  for (let b = 0; b < buckets; b++) {
    const count = dv.getUint32(lbl.off + 4 + b * 8, le);
    let p = lbl.off + dv.getUint32(lbl.off + 8 + b * 8, le);
    for (let k = 0; k < count; k++) {
      const len = bytes[p];
      const name = new TextDecoder().decode(bytes.subarray(p + 1, p + 1 + len));
      names.set(dv.getUint32(p + 1 + len, le), name);
      p += 5 + len;
    }
  }
  const n = dv.getUint32(txt.off, le);
  const out: Msbt = new Map();
  const u16 = (p: number) => dv.getUint16(p, le);
  for (let i = 0; i < n; i++) {
    const s = txt.off + dv.getUint32(txt.off + 4 + i * 4, le);
    const e = i + 1 < n ? txt.off + dv.getUint32(txt.off + 8 + i * 4, le) : txt.off + txt.size;
    const nodes: MsbtNode[] = [];
    let buf = '';
    const flush = () => { if (buf) { nodes.push(buf); buf = ''; } };
    let p = s;
    while (p < e) {
      let ch: number;
      if (utf16) { ch = u16(p); p += 2; } else { ch = bytes[p]; p += 1; }
      if (ch === 0) break;
      if (ch === 0x0e) {
        const group = u16(p), type = u16(p + 2), ps = u16(p + 4);
        flush(); nodes.push({ kind: 'tag', group, type, params: bytes.slice(p + 6, p + 6 + ps) }); p += 6 + ps;
      } else if (ch === 0x0f) {
        flush(); nodes.push({ kind: 'close', group: u16(p), type: u16(p + 2) }); p += 4;
      } else if (utf16 && ch >= 0xd800 && ch < 0xdc00) {
        const lo = u16(p); p += 2; buf += String.fromCharCode(ch, lo);
      } else buf += String.fromCharCode(ch);
    }
    flush();
    out.set(names.get(i) ?? String(i), nodes);
  }
  return out;
}

/** Text without tags (sound tables, simple labels). */
export function plain(nodes: MsbtNode[] | undefined): string {
  return (nodes ?? []).filter((x): x is string => typeof x === 'string').join('');
}

/** Debug form: "{group.type:hex}" for tags, "{/}" for closing tags (same notation as docs/reverse-engineering). */
export function debugText(nodes: MsbtNode[]): string {
  return nodes.map((x) => typeof x === 'string' ? x : x.kind === 'close' ? '{/}' : `{${x.group}.${x.type}${x.params.length ? ':' + [...x.params].map((b) => b.toString(16).padStart(2, '0')).join('') : ''}}`).join('');
}

// ---------------- attributes (ATR1) decoded with the project file (Arch.msbp) ----------------
/** MSBP attribute definitions: name, type, list index, offset (offsets restart per attribute set). */
export interface MsbpAttr { name: string; type: number; list: number; offset: number; }
export interface Msbp { attrs: MsbpAttr[]; lists: string[][]; }

function sections(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = bytes[8] === 0xff && bytes[9] === 0xfe;
  const n = dv.getUint16(0x0e, le);
  const out = new Map<string, { off: number; size: number }>();
  let off = 0x20;
  for (let i = 0; i < n && off + 16 <= bytes.length; i++) {
    out.set(String.fromCharCode(...bytes.subarray(off, off + 4)), { off: off + 16, size: dv.getUint32(off + 4, le) });
    off = (off + 16 + dv.getUint32(off + 4, le) + 15) & ~15;
  }
  return { dv, le, out };
}
const cstr = (b: Uint8Array, o: number) => { let e = o; while (e < b.length && b[e]) e++; return new TextDecoder().decode(b.subarray(o, e)); };

export function parseMSBP(bytes: Uint8Array): Msbp {
  const { dv, le, out } = sections(bytes);
  const ati = out.get('ATI2')!, alb = out.get('ALB1')!, ali = out.get('ALI2')!;
  const n = dv.getUint32(ati.off, le);
  const names = new Map<number, string>();
  const nb = dv.getUint32(alb.off, le);
  for (let i = 0; i < nb; i++) {
    const c = dv.getUint32(alb.off + 4 + i * 8, le); let p = alb.off + dv.getUint32(alb.off + 8 + i * 8, le);
    for (let k = 0; k < c; k++) { const L = bytes[p]; names.set(dv.getUint32(p + 1 + L, le), new TextDecoder().decode(bytes.subarray(p + 1, p + 1 + L))); p += 5 + L; }
  }
  const attrs: MsbpAttr[] = [];
  for (let i = 0; i < n; i++) { const o = ati.off + 4 + i * 8; attrs.push({ name: names.get(i) ?? `attr${i}`, type: bytes[o], list: dv.getUint16(o + 2, le), offset: dv.getUint32(o + 4, le) }); }
  const nl = dv.getUint32(ali.off, le); const lists: string[][] = [];
  for (let i = 0; i < nl; i++) {
    const o = ali.off + dv.getUint32(ali.off + 4 + i * 4, le); const c = dv.getUint32(o, le);
    const l: string[] = []; for (let k = 0; k < c; k++) l.push(cstr(bytes, o + dv.getUint32(o + 4 + k * 4, le))); lists.push(l);
  }
  return { attrs, lists };
}

const ASIZE: Record<number, number> = { 0: 1, 1: 2, 2: 4, 3: 1, 4: 2, 5: 4, 6: 4, 8: 4, 9: 1 };
/**
 * Attributes of every label, using the attribute set whose names start with `prefix` (e.g. "ac_" for ArchCamera,
 * "ex_" for EmotionExpression). Offsets are relative to the first attribute of the set; only attributes that fit
 * inside the file's entry size are read.                                                  REVERSED (LMS layout)
 */
export function msbtAttributes(bytes: Uint8Array, proj: Msbp, prefix: string): Map<string, Record<string, string | number>> {
  const { dv, le, out } = sections(bytes);
  const labels = [...parseMSBT(bytes).keys()];
  const res = new Map<string, Record<string, string | number>>();
  const atr = out.get('ATR1'); if (!atr) return res;
  const cnt = dv.getUint32(atr.off, le), esz = dv.getUint32(atr.off + 4, le);
  const defs = proj.attrs.filter((a) => a.name.startsWith(prefix)); if (!defs.length) return res;
  const base = defs[0].offset;
  const utf16 = (o: number) => { let s = ''; for (let p = o; p + 1 < atr.off + atr.size; p += 2) { const c = dv.getUint16(p, le); if (!c) break; s += String.fromCharCode(c); } return s; };
  for (let i = 0; i < Math.min(cnt, labels.length); i++) {
    const e = atr.off + 8 + i * esz; const rec: Record<string, string | number> = {};
    for (const a of defs) {
      const r = a.offset - base; if (r < 0 || r + (ASIZE[a.type] ?? 1) > esz) continue;
      const p = e + r;
      switch (a.type) {
        case 8: { const so = dv.getUint32(p, le); rec[a.name] = so ? utf16(atr.off + so) : ''; break; }
        case 9: { const x = bytes[p]; rec[a.name] = proj.lists[a.list]?.[x] ?? x; break; }
        case 6: rec[a.name] = Math.round(dv.getFloat32(p, le) * 1000) / 1000; break;
        case 1: case 4: rec[a.name] = dv.getUint16(p, le); break;
        case 2: case 5: rec[a.name] = dv.getUint32(p, le); break;
        default: rec[a.name] = bytes[p];
      }
    }
    res.set(labels[i], rec);
  }
  return res;
}
