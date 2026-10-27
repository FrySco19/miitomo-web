/**
 * REBOOT gate — the ONLY Reboot module Classic code imports statically. No dependencies.
 *
 * Miitomo Reboot (new features, NOT original Nintendo content) is off unless the user turns it on:
 *   ?reboot=1  → on  (remembered in this browser)
 *   ?reboot=0  → off (remembered) — the Classic launcher always passes this
 * Everything else of Reboot is loaded with a dynamic import only when the gate is open, so Classic runs and builds
 * without depending on any Reboot feature (docs/reboot/ARCHITECTURE.md).
 */
export const REBOOT_STORAGE_KEY = 'mtw.reboot.enabled';

export function rebootRequested(search = typeof location !== 'undefined' ? location.search : ''): boolean {
  const q = new URLSearchParams(search).get('reboot');
  try {
    if (q === '1' || q === '0') localStorage.setItem(REBOOT_STORAGE_KEY, q);
    return (q ?? localStorage.getItem(REBOOT_STORAGE_KEY)) === '1';
  } catch {
    return q === '1';
  }
}
