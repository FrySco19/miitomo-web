/**
 * REBOOT chat lines (NEW text written for Reboot — NOT Nintendo / Miitomo text). Short, neutral, Italian.
 * `{name}` = the Mii being addressed. Kept small on purpose; personality picks the tone set.
 * Classic greetings (MSBT, tags 1.2–1.5) stay Classic and are not reused here.
 */
import type { Personality } from './traits';

export type LineKind = 'open' | 'reply' | 'follow' | 'close' | 'closeReply';

const BASE: Record<LineKind, string[]> = {
  open: ['Ehi, {name}!', 'Ciao {name}, come va?', '{name}! Che si dice?'],
  reply: ['Tutto bene, grazie!', 'Bene! E tu?', 'Non c\'è male.', 'Benissimo!'],
  follow: ['Che bello!', 'Davvero? Racconta!', 'Ah, capisco.', 'Anch\'io!', 'Ma dai!'],
  close: ['Bene, a dopo!', 'Vado a fare un giro.', 'Ci vediamo!'],
  closeReply: ['A dopo!', 'Ciao ciao!', 'Ok, a presto!'],
};
/** Personality tone overrides (only where it changes something visible). */
const TONE: Partial<Record<Personality, Partial<Record<LineKind, string[]>>>> = {
  0: { open: ['Ciao, {name}.', '{name}.'], close: ['Bene. A dopo.'] },                                  // Cool · Riservato
  3: { open: ['Ehi ehi, {name}!!', '{name}! Che bello vederti!'], follow: ['Fantastico!', 'Wow, davvero?!'] },  // Nori · Espansivo
};

export function chatLine(kind: LineKind, p: Personality, name: string, rnd: () => number): string {
  const pool = [...BASE[kind], ...(TONE[p]?.[kind] ?? [])];
  return pool[Math.floor(rnd() * pool.length) % pool.length].replace('{name}', name);
}
