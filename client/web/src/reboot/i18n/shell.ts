/**
 * R6 hotfix: the shared shell (the original bottom bar, the friend-room bar and the Menu) in the Reboot language.
 * Classic draws these labels from the original Italian texts (Layout/room tabBtn / menuBtn msbt); in Reboot they now
 * follow the chosen language. Italian keeps the original texts exactly (no Reboot text replaces them).
 */
import type { I18n } from './i18n';

const TB0 = 'Layout/room/parts/layer1/tabBtn00.msbt', TB1 = 'Layout/room/parts/layer1/tabBtn01.msbt';
const M1 = 'Layout/room/parts/layer1/menuBtn01.msbt', M4 = 'Layout/room/parts/layer1/menuBtn04.msbt';
/** original file#label → Reboot string key */
export const SHELL_LABELS: Readonly<Record<string, string>> = {
  [`${TB0}#title00@home00`]: 'shell.home', [`${TB0}#title00@answer00`]: 'shell.page', [`${TB0}#title00@friendlist00`]: 'shell.friends',
  [`${TB0}#title00@shop00`]: 'shell.shop', [`${TB0}#title00@menu00`]: 'shell.menu',
  [`${TB1}#title00@answer01`]: 'shell.answers', [`${TB1}#title00@cloth01`]: 'shell.items', [`${TB1}#title00@friendlist01`]: 'shell.friends',
  [`${TB1}#title00@information01`]: 'shell.profile',
  [`${M1}#title00@changeCloth00`]: 'shell.closet', [`${M1}#title00@remakeMii00`]: 'shell.editMii', [`${M1}#title00@customRoom00`]: 'shell.decorate',
  [`${M1}#title00@miiPhoto00`]: 'shell.miifoto', [`${M4}#title00@greeting00`]: 'shell.greetings', [`${M4}#title00@config00`]: 'shell.settings',
};
/** The override for RebootHost.setShellLabels in the current language (null = Italian: the originals). */
export function shellLabels(i18n: I18n): ((file: string, label: string) => string | null) | null {
  if (i18n.lang === 'it') return null;
  return (file, label) => { const k = SHELL_LABELS[`${file}#${label}`]; return k ? i18n.t(k) : null; };
}
