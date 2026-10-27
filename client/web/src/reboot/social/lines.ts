/**
 * REBOOT chat lines (NEW text written for Reboot — NOT Nintendo / Miitomo text). Short and neutral. Since R6 they live
 * in the i18n table (`chat.<kind>.<n>`, personality extras `chat.tone.<p>.<kind>.<n>`), so the Miis talk in the
 * language of the Reboot UI. `{name}` = the Mii being addressed. Personality picks the tone set.
 * Classic greetings (MSBT, tags 1.2–1.5) stay Classic and are not reused here.
 */
import type { Personality } from './traits';
import { I18n } from '../i18n/i18n';

export type LineKind = 'open' | 'reply' | 'follow' | 'close' | 'closeReply';

/** Keys of a pool: n = 0, 1, … while the key exists (every language has the same keys: same pool size, same picks). */
function pool(i18n: I18n, prefix: string) { const out: string[] = []; for (let n = 0; i18n.has(`${prefix}.${n}`); n++) out.push(`${prefix}.${n}`); return out; }

/** Italian when no i18n is given (what R2b shipped). */
const IT = I18n.fixed('it');

export function chatLine(kind: LineKind, p: Personality, name: string, rnd: () => number, i18n: I18n = IT): string {
  const keys = [...pool(i18n, `chat.${kind}`), ...pool(i18n, `chat.tone.${p}.${kind}`)];
  return i18n.t(keys[Math.floor(rnd() * keys.length) % keys.length], { name });
}
