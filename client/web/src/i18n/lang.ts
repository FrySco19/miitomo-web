/**
 * The game language for every screen (launcher, Classic, Reboot, desktop panels): one choice, stored as
 * `mtw.reboot.lang` (the Reboot settings key, kept for compatibility), else the browser language. Italian or English.
 * A change made in one page (Reboot settings, launcher) reaches the others of the same account (storage event).
 */
export type UiLang = 'it' | 'en';
export const LANG_STORE = 'mtw.reboot.lang';
export function uiLang(): UiLang {
  try { const l = localStorage.getItem(LANG_STORE); if (l) return l === 'it' ? 'it' : 'en'; } catch { /* */ }
  return typeof navigator !== 'undefined' && /^it\b/i.test(navigator.language) ? 'it' : 'en';
}
const subs = new Set<(l: UiLang) => void>();
let last: UiLang | null = null;
function check() { const l = uiLang(); if (l !== last) { last = l; for (const s of subs) { try { s(l); } catch (e) { console.warn(e); } } } }
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === LANG_STORE) check(); });
/** Called by whoever changes the language in this page (the storage event only reaches the other pages). */
export function langChanged() { check(); }
export function onLang(cb: (l: UiLang) => void) { last ??= uiLang(); subs.add(cb); return () => subs.delete(cb); }
export function setUiLang(l: UiLang) { try { localStorage.setItem(LANG_STORE, l); } catch { /* */ } check(); }
