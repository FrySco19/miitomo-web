/**
 * Original room texts (M8). Files come from the user's own CDN zip message_Release_Console_EUit.zip (Italian); the
 * APK has no Scene/ or room Layout texts. Nothing is bundled.
 *
 *  Client/Scene/RoomSceneTalkWords.msbt   labels used by the room sequences (fixedGreeting, noQuestion, ...)   VERIFIED (data)
 *  Client/System/MiiCommonText.msbt       defaultGreetingWelcome / defaultGoodByeGoHome / ...                  VERIFIED (data)
 *  Client/Layout/room/parts/layer2/*.msbt layout labels of the room CCBI files (balloonTextBtn02 ...)            VERIFIED (data)
 *
 * Tag names and parameters come from the project file message/Release/Arch.msbp (TGG2/TAG2/TGP2/TGL2):  REVERSED
 *   0.3 System.Color(r,g,b,a)   0.4 System.PageBreak   1.0 Mii.Nickname(buffer)   5.0 Gender.Mii(buffer,male,female)
 *   9.0 GlobalEmotion(em)  9.1 SentenceEmotion(em)  9.2 SentenceBreak  9.3 ExpressionRule(rule) ... {/} (0x0F close)
 * What the game does with emotions / expression rules (face + gesture while talking) is NOT reversed: here they are
 * kept as metadata (data-rule on the emphasised span) and the emphasised words are drawn in bold.     APPROXIMATED
 */
import { vfs } from '../assets/vfs';
import { parseMSBT, Msbt, MsbtNode, plain } from '../formats/msbt';

const LANGS = ['EUit'] as const;   // the APK ships no room texts; the CDN selection is the Italian zip
const cache = new Map<string, Msbt | null>();

export const EMOTIONS = ['None', 'Joy', 'Anger', 'Sadness', 'Fear', 'Shame', 'Love', 'Hate', 'Busy', 'Ease', 'Surprise'];
export const RULES = ['None', 'Greeting', 'Thanks', 'Yes', 'No', 'Joy', 'Banzai', 'Laugh', 'Clown', 'Anger', 'Sadness', 'Despair', 'Cry', 'Fear', 'Shame', 'Like', 'Love', 'Hate', 'Busy', 'Surprise', 'Lousy', 'Unspeakable', 'Chyack', 'Sleepiness', 'Trouble', 'Skittshness', 'Praise', 'OK', 'Me', 'You', 'Great', 'Many', 'Few', 'Question', 'Seriousness', 'Cheer', 'Ignorance', 'Merry', 'Cute', 'Affected', 'Hunger', 'Curse', 'Doller', 'Euro', 'Yen', 'Direct', 'Cat', 'Dog', 'Nintendo', 'Empty_Sadness', 'Reflection', 'Patience', 'Gold', 'Cracker', 'Impression', 'Sing', 'Stupefaction'];

function file(lang: string, rel: string): Msbt | null {
  const key = `message/Release/Console/${lang}/Client/${rel}`;
  if (!cache.has(key)) {
    const b = vfs.get(key);
    let m: Msbt | null = null;
    if (b) { try { m = parseMSBT(b); } catch (e) { console.warn(`MSBT ${key}: ${(e as Error).message}`); } }
    cache.set(key, m);
  }
  return cache.get(key)!;
}
export function clearTextCache() { cache.clear(); }

export interface TextRef { file: string; label: string; }
export interface Line { ref: TextRef; lang: string; nodes: MsbtNode[]; }

/** Looks a label up in the preferred language first. */
export function line(rel: string, label: string): Line | null {
  for (const lang of LANGS) { const m = file(lang, rel); const n = m?.get(label); if (n) return { ref: { file: rel, label }, lang, nodes: n }; }
  return null;
}
export function label(rel: string, label: string, fallback: string): string {
  const o = override?.(rel, label); if (o != null) return o;
  const l = line(rel, label); return l ? plain(l.nodes).replace(/\n/g, ' ') : fallback;
}
/**
 * REBOOT only (Classic never sets it): a short UI label in the Reboot language instead of the Italian original
 * (bottom bar, menu). null from the override = keep the original text.
 */
type LabelOverride = (rel: string, label: string) => string | null;
let override: LabelOverride | null = null;
export function setLabelOverride(fn: LabelOverride | null) { override = fn; }
export function textsAvailable(): { lang: string | null; files: number } {
  let files = 0, lang: string | null = null;
  for (const l of LANGS) { const n = [...vfs.keys()].filter((k) => k.startsWith(`message/Release/Console/${l}/Client/`) && !k.includes('/Sound/')).length; if (n) { files += n; lang ??= l; } }
  return { lang, files };
}

// ---- rendering ----
export interface Span { text: string; color?: string; rule?: string; user?: boolean; }
export interface Page { spans: Span[]; }
export interface RenderCtx { nickname: string; female: boolean; greetings?: Partial<Record<'1.2' | '1.3' | '1.4' | '1.5', string>>; /** tag 1.0/1.1 first param = name index (00 = speaker / user, 01, 02 …: telops with several Mii names) */ names?: string[]; }

/** Turns tagged nodes into pages of styled spans. Unknown / data-driven tags (dates, numbers, answers) render empty. */
export function render(nodes: MsbtNode[], ctx: RenderCtx): { pages: Page[]; emotion: string | null; rules: string[] } {
  const pages: Page[] = [{ spans: [] }];
  let color: string | undefined, rule: string | undefined, emotion: string | null = null;
  const rules: string[] = [];
  const push = (t: string, user = false) => { if (t) pages[pages.length - 1].spans.push({ text: t, color, rule, ...(user ? { user } : {}) }); };
  for (const n of nodes) {
    if (typeof n === 'string') { push(n); continue; }
    if (n.kind === 'close') { rule = undefined; continue; }
    const p = n.params;
    const g = `${n.group}.${n.type}`;
    if (g === '0.3' && p.length >= 4) { const hex = [...p.subarray(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join(''); color = hex === '000000' ? undefined : `#${hex}`; }
    else if (g === '0.4') pages.push({ spans: [] });
    else if (g === '1.0' || g === '1.1') push(ctx.names?.[p[0]] ?? ctx.nickname);
    else if (g === '1.2' || g === '1.3' || g === '1.4' || g === '1.5') push(ctx.greetings?.[g] ?? '', true);   // Mii.GreetingMyRoom / GoodByeSeeingOff / GoodByeGoHome / GreetingFriendRoom (user's own greetings)
    else if (g === '5.0') push(genderString(p, ctx.female));
    else if (g === '9.0' || g === '9.1') emotion = EMOTIONS[p[0]] ?? null;
    else if (g === '9.3') { rule = RULES[p[0]] ?? String(p[0]); rules.push(rule); }
    // 9.2 SentenceBreak: a pause between sentences -> handled by the typewriter as a short delay (marker span)
    else if (g === '9.2') pages[pages.length - 1].spans.push({ text: ' ', rule: '__break' });
  }
  return { pages: pages.filter((pg) => pg.spans.some((s) => s.text.trim())), emotion, rules };
}

/** Gender.Mii(buffer:u8, male:string, female:string) - strings are u16 byte length + UTF-16LE. */
function genderString(p: Uint8Array, female: boolean): string {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  let o = 2; const strs: string[] = [];
  while (o + 2 <= p.length && strs.length < 2) {
    const len = dv.getUint16(o, true); o += 2;
    let s = ''; for (let i = 0; i < len; i += 2) s += String.fromCharCode(dv.getUint16(o + i, true));
    strs.push(s); o += len;
  }
  return strs[female ? 1 : 0] ?? '';
}
