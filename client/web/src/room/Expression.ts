/**
 * Talking gestures and faces (M13) — the game's own EmotionExpression data, from the user's CDN zip
 * message_Release_Console_JPja_EmotionExpression.zip (decoded with the attribute sets of Arch.msbp).
 *
 *  ExpressionRule/Rule.msbt   er_<rule>: expression per personality (Nagomi / Nori / Dry / Cool), emotion genre,
 *                             weight, inhibition type (Inhibited / Uninhibited / Inhibitor)            VERIFIED (data)
 *  Expression.msbt            ex_<name>: In / loop / Out animation, min-max loop count, effects (ar*)  VERIFIED (data)
 *  Emotion.msbt               em_<emotion>: face per personality (an FFL expression id)                VERIFIED (data)
 *  Face.msbt                  face table: default / opened-mouth / closed-mouth FFL expression ids     VERIFIED (data)
 *  Wordlist_it/WLit_<rule>    words that trigger a rule in free text (wd_Word, wd_Expression)          VERIFIED (data)
 *
 * The rule struct layout (4 expression strings at +0x0c/+0x18/+0x24/+0x30, genre +0x3c, weight +0x40, inhibition
 * +0x44) come from libcocos2dcpp.so 0x1118640 (struct order Nagomi +0x0c, Nori +0x18, Dry +0x24, Cool +0x30).
 * M17b CORRECTION — the engine personality TYPE (0x5be42c) is 0 Cool, 1 Dry, 2 Nagomi, 3 Nori (REVERSED, three paths agree):
 *   0x95c218 stores the type at +0x2c0 → 0x95d0b0 state = [2,3,4,5][type] → 0x98b934 switch: 2 ConfirmCharacterCool,
 *   3 Dry, 4 Nagomi, 5 Nori; the room callers use bgm_room line type+2 (lines … FRIEND_COOL, DRY, NAGOMI, NORI);
 *   0x10edd8c (per-personality face byte): type 0 → +4 (Cool), 1 → +3 (Dry), 2 → +1 (Nagomi), 3 → +2 (Nori).
 * Matches the group texts (characterInfoTitle00 Riservato, Deciso, Tranquillo, Espansivo) and the QR card keys
 * (qrCode typeNode00: cool_type Riservato, dry_type Deciso, nagomi_type Tranquillo, nori_type Espansivo).
 * REVERSED. How several rules in one line are combined and when the gesture starts are not reversed: here the rule
 * with the highest weight wins, an Inhibitor word ("non" ...) cancels the Inhibited ones, the gesture starts with the
 * balloon. APPROXIMATED. Word matching: case-insensitive, word-start (the lists hold stems such as "felic"),
 * DEDUCED from the data (wd_MatchingType is not stored in the Italian files).
 */
import { vfs } from '../assets/vfs';
import { parseMSBP, msbtAttributes, Msbp } from '../formats/msbt';

const ROOT = 'message/Release/Console/JPja/EmotionExpression/';
const MSBP = 'message/Release/Arch.msbp';
/** Indexed by the engine personality type (see above). Earlier versions used the attribute order (Nagomi, Nori, Dry, Cool): wrong. */
export const PERSONALITIES = ['Cool', 'Dry', 'Nagomi', 'Nori'] as const;
export type Personality = 0 | 1 | 2 | 3;

export interface Gesture { name: string; inAnim: string | null; anim: string; outAnim: string | null; min: number; max: number; effects: string[]; }
export interface Rule { name: string; expr: [string, string, string, string]; genre: string; weight: number; inhibition: string; }
export interface FaceTriple { def: number; open: number; closed: number; label?: string; }

interface Word { word: string; rule: string; re: RegExp | null; }
interface Data { rules: Map<string, Rule>; gestures: Map<string, Gesture>; emotionFace: Map<string, number[]>; faces: FaceTriple[]; words: Word[]; }
let data: Data | null | undefined;

const anim = (s: unknown) => { const v = String(s ?? '').replace(/\.Anim$/, ''); return v || null; };
/** One typo in the original data (ex_Hunger_Dr out animation): the game would not find it either. */
const FIX: Record<string, string> = { animHandOnMouthRIOut: 'animHandOnMouthROut' };

function load(): Data | null {
  if (data !== undefined) return data;
  const pb = vfs.get(MSBP), rb = vfs.get(ROOT + 'ExpressionRule/Rule.msbt'), eb = vfs.get(ROOT + 'Expression.msbt');
  if (!pb || !rb || !eb) return (data = null);
  try {
    const proj: Msbp = parseMSBP(pb);
    const rules = new Map<string, Rule>();
    for (const [k, v] of msbtAttributes(rb, proj, 'er_')) {
      rules.set(k.replace(/^er_/, ''), { name: k, expr: PERSONALITIES.map((p) => String(v['er_Expression' + p] ?? 'ex_Empty')) as Rule['expr'], genre: String(v.er_EmotionGenre ?? 'None'), weight: Number(v.er_Weight ?? 0), inhibition: String(v.er_InhibitionType ?? 'Inhibited') });
    }
    const gestures = new Map<string, Gesture>();
    for (const [k, v] of msbtAttributes(eb, proj, 'ex_')) {
      const a = anim(v.ex_AnimFileName); if (!a) continue;
      const fx = (x: string | null) => (x ? FIX[x] ?? x : null);
      gestures.set(k, { name: k, inAnim: fx(anim(v.ex_InAnimFileName)), anim: fx(a)!, outAnim: fx(anim(v.ex_OutAnimFileName)), min: Number(v.ex_AnimMinLoopCount ?? 1) || 1, max: Number(v.ex_AnimMaxLoopCount ?? 1) || 1,
        effects: ['ex_EffectFileName', 'ex_EffectFileName2', 'ex_EffectFileName3'].map((n) => String(v[n] ?? '')).filter(Boolean) });
    }
    const emotionFace = new Map<string, number[]>();
    const emb = vfs.get(ROOT + 'Emotion.msbt');
    if (emb) for (const [k, v] of msbtAttributes(emb, proj, 'em_')) emotionFace.set(k.replace(/^em_/, ''), PERSONALITIES.map((p) => Number(v['em_Face' + p] ?? 0)));
    const faces: FaceTriple[] = [];
    const fb = vfs.get(ROOT + 'Face.msbt');
    if (fb) for (const v of msbtAttributes(fb, proj, 'fc_').values()) faces.push({ def: Number(v.fc_Default), open: Number(v.fc_OpenedMouth), closed: Number(v.fc_ClosedMouth), label: String(v.fc_Label ?? '') });
    const words: Data['words'] = [];
    for (const k of vfs.keys()) {
      if (!k.startsWith(ROOT + 'Wordlist_it/') || !k.endsWith('.msbt')) continue;
      for (const v of msbtAttributes(vfs.get(k)!, proj, 'wd_').values()) {
        const w = String(v.wd_Word ?? '').trim().toLowerCase(), r = String(v.wd_Expression ?? '').replace(/^er_/, '');
        if (!w || !r) continue;                     // rule None = exception entries (WLit_Empty): they consume text
        // Notation in the lists: a few real regular expressions ("mest[oiae]\\b", "(mi sono|ti sei) spanciat(e|i|o|a)\\b"),
        // the custom wildcard "/.*/" for an inflected ending ("soffr/.*/ di"), everything else literal (emoticons
        // such as "[ ͡° ͜ʖ ͡°]" or ":-[" are literal). DEDUCED: wd_UseRegex is not stored in the Italian files.
        let re: RegExp | null = null;
        const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try {
          if (w.includes('/.*/')) re = new RegExp(w.split('/.*/').map(esc).join('\\S*'), 'uy');
          else if (/\\b|\([^)]*\|[^)]*\)/.test(w) || /^[\p{L} ]+\[[\p{L}]+\]/u.test(w)) re = new RegExp(w, 'uy');
          else if (w === '.*admin.*') re = /\S*admin\S*/uy;
        } catch { re = null; }
        words.push({ word: w, rule: r, re });
      }
    }
    words.sort((a, b) => b.word.length - a.word.length);   // longer phrases first
    data = { rules, gestures, emotionFace, faces, words };
  } catch (e) { console.warn('EmotionExpression non leggibile', e); data = null; }
  return data;
}
export function resetExpressions() { data = undefined; }
/** Debug / tests: a gesture's effects (ex_EffectFileName*). */
export function gestureInfo(name: string) { const g = load()?.gestures.get(name); return g ? { effects: [...g.effects], anim: g.anim } : null; }
/** Debug / tests: a rule's per-personality expressions (indexed by engine type) and its weight. */
export function ruleInfo(name: string) { const r = load()?.rules.get(name); return r ? { expr: [...r.expr], weight: r.weight, genre: r.genre } : null; }
export function expressionsAvailable() { return !!load(); }

/** Faces the emotions can ask for (+ their open / closed mouth pairs): the head is built with these masks. */
export function neededFaces(): number[] {
  const d = load(); if (!d) return [];
  const out = new Set<number>();
  for (const ids of d.emotionFace.values()) for (const id of ids) { const t = faceTriple(id); out.add(t.def); out.add(t.open); out.add(t.closed); }
  return [...out].filter((x) => x >= 0 && x < 70);
}
/** Face entry whose default is this FFL expression (em_Face values are fc_Default ids — VERIFIED by the labels). */
export function faceTriple(id: number): FaceTriple {
  const t = load()?.faces.find((f) => f.def === id);
  return t ?? { def: id, open: id >= 0 && id <= 5 ? id + 6 : id, closed: id };
}
export function emotionFace(emotion: string | null, p: Personality): FaceTriple | null {
  if (!emotion || emotion === 'None') return null;
  const ids = load()?.emotionFace.get(emotion); if (!ids) return null;
  return faceTriple(ids[p]);
}

/**
 * Rules found in free text (the user's own answers / greetings) through the Italian word lists. Scan left to right; at
 * each word start the longest entry of any list wins and consumes its characters, so the exception list "Empty"
 * ("pensione" vs the Question stem "pens") and longer phrases ("non sono felice" vs "felic") take precedence.
 * Entries are stems (prefix match). DEDUCED from the lists' content: the matching fields are not in the files.
 */
export function rulesInText(text: string): string[] {
  const d = load(); if (!d || !text) return [];
  const t = text.toLowerCase();
  const isL = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  const found: string[] = [];
  for (let i = 0; i < t.length;) {
    if (isL(t[i - 1]) && isL(t[i])) { i++; continue; }          // only at word starts (punctuation entries anywhere)
    let best: { len: number; rule: string } | null = null;
    for (const w of d.words) {
      let len = 0;
      if (w.re) { w.re.lastIndex = i; const m = w.re.exec(t); if (m) len = m[0].length; }
      else if (t.startsWith(w.word, i)) len = w.word.length;
      if (len && (!best || len > best.len)) best = { len, rule: w.rule };
    }
    if (best) { if (best.rule !== 'None' && !found.includes(best.rule)) found.push(best.rule); i += best.len; }
    else i++;
  }
  return found;
}

/** Emotion genre of the strongest active rule (er_EmotionGenre): face for free text without emotion tags. DEDUCED. */
export function dominantGenre(rules: string[]): string | null {
  const d = load(); if (!d) return null;
  const rs = rules.map((r) => d.rules.get(r)).filter((r): r is Rule => !!r);
  const inhibited = rs.some((r) => r.inhibition === 'Inhibitor');
  let best: Rule | null = null;
  for (const r of rs) { if (inhibited && r.inhibition === 'Inhibited') continue; if (r.genre !== 'None' && (!best || r.weight > best.weight)) best = r; }
  return best?.genre ?? null;
}
/** The gesture to play for a set of rules and a personality (null = no gesture). */
export function pickGesture(rules: string[], p: Personality): { rule: Rule; gesture: Gesture } | null {
  // (effects: Gesture.effects = ex_EffectFileName* → asset/effect/output/character/<name>.xml, played by main.ts)
  const d = load(); if (!d) return null;
  const rs = rules.map((r) => d.rules.get(r)).filter((r): r is Rule => !!r);
  const inhibited = rs.some((r) => r.inhibition === 'Inhibitor');
  let best: { rule: Rule; gesture: Gesture } | null = null;
  for (const r of rs) {
    if (inhibited && r.inhibition === 'Inhibited') continue;
    const g = d.gestures.get(r.expr[p]); if (!g) continue;
    if (!best || r.weight > best.rule.weight) best = { rule: r, gesture: g };
  }
  return best;
}
