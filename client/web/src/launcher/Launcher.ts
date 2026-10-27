/**
 * LAUNCHER (?launcher=1) — the start screen of the desktop app (it also works in a browser). Behind it, the game boots
 * as usual: the user's Mii idles in their room and the original music plays — both come from the user's OWN imported
 * files (nothing is bundled). In front: the logo, the account, the choice Classic / Reboot and, in the desktop app, the
 * peer-to-peer friends. Choosing reloads the page in that mode (Classic and Reboot never share a page load).
 *
 * Classification: NEW (desktop shell). It does not change Classic: under the launcher Reboot is never loaded.
 */
import './launcher.css';

export interface DesktopApi {
  isDesktop: true;
  accounts: { current(): Promise<{ username: string; code: string; peerId: string } | null>; logout(): Promise<boolean> };
  assets: { info(): Promise<{ folder: string; files: number }>; choose(): Promise<{ folder: string; files: number } | null> };
  game: { open(mode: 'launcher' | 'classic' | 'reboot'): Promise<boolean> };
}
export interface LauncherHost {
  screen: () => string;
  logo: () => string;
  /** Starts the launcher music (the original title music if the user's files have it, else the room music). */
  music: () => void;
  desktop: DesktopApi | null;
  /** Mounts the P2P friends panel (desktop only); returns the unmount. */
  friends?: ((el: HTMLElement) => () => void) | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const LANG = (() => { try { const l = localStorage.getItem('mtw.reboot.lang'); if (l) return l === 'it' ? 'it' : 'en'; } catch { /* */ } return /^it\b/i.test(navigator.language) ? 'it' : 'en'; })();
const TX = {
  it: { classic: 'Miitomo Classic', classicSub: 'Il gioco originale, ricostruito dai tuoi file.', reboot: 'Miitomo Reboot', rebootSub: 'Funzioni nuove: Piazza, stanze degli amici, MiiPhone, MIInstagram.', play: 'Gioca',
    loading: 'Sto preparando la tua stanza…', setup: 'Primo avvio: dopo la scelta crei il tuo Mii.', noFiles: 'Non trovo i tuoi file di Miitomo.', choose: 'Scegli la cartella dei file', files: '{n} file trovati in {folder}',
    friends: 'Amici', logout: 'Esci', code: 'Il tuo codice amico', newBadge: 'NUOVO · non presente in Miitomo', music: 'Musica e Mii dai tuoi file originali, su questo PC.', close: 'Chiudi' },
  en: { classic: 'Miitomo Classic', classicSub: 'The original game, rebuilt from your files.', reboot: 'Miitomo Reboot', rebootSub: 'New features: Plaza, friends\' rooms, MiiPhone, MIInstagram.', play: 'Play',
    loading: 'Getting your room ready…', setup: 'First start: after choosing, you create your Mii.', noFiles: 'Your Miitomo files were not found.', choose: 'Choose the files folder', files: '{n} files found in {folder}',
    friends: 'Friends', logout: 'Log out', code: 'Your friend code', newBadge: 'NEW · not in Miitomo', music: 'Music and Miis from your own original files, on this PC.', close: 'Close' },
}[LANG];
const t = (k: keyof typeof TX, v: Record<string, string | number> = {}) => TX[k].replace(/\{(\w+)\}/g, (_, x) => String(v[x] ?? ''));

export function mountLauncher(h: LauncherHost) {
  const el = document.createElement('div');
  el.className = 'ln'; el.dataset.screen = 'boot';
  document.body.append(el);
  let account: { username: string; code: string } | null = null, files: { folder: string; files: number } | null = null, musicOn = false, unmountFriends: (() => void) | null = null;
  const status = () => {
    const sc = h.screen();
    if (files && files.files === 0) return `<p class="ln-status warn">${esc(t('noFiles'))}${h.desktop ? ` <button type="button" class="ln-link" data-a="folder">${esc(t('choose'))}</button>` : ''}</p>`;
    if (sc === 'room') return `<p class="ln-status">${esc(t('music'))}</p>`;
    if (sc === 'setup' || sc === 'create') return `<p class="ln-status">${esc(t('setup'))}</p>`;
    return `<p class="ln-status"><span class="ln-spin" aria-hidden="true"></span>${esc(t('loading'))}</p>`;
  };
  const render = () => {
    el.innerHTML = `
      <header class="ln-top"><div class="ln-logo">${h.logo()}</div>
        ${account ? `<div class="ln-acct"><span class="ln-avatar" aria-hidden="true">${esc(account.username[0]?.toUpperCase() ?? '?')}</span><span class="ln-who"><b>${esc(account.username)}</b><small title="${esc(t('code'))}">${esc(account.code)}</small></span>
          ${h.friends ? `<button type="button" class="ln-btn" data-a="friends">${esc(t('friends'))}</button>` : ''}<button type="button" class="ln-btn ghost" data-a="logout">${esc(t('logout'))}</button></div>` : ''}
      </header>
      <section class="ln-choice" aria-label="Miitomo">
        <button type="button" class="ln-card classic" data-go="classic"><b>${esc(t('classic'))}</b><span>${esc(t('classicSub'))}</span><em>${esc(t('play'))}</em></button>
        <button type="button" class="ln-card reboot" data-go="reboot"><small>${esc(t('newBadge'))}</small><b>${esc(t('reboot'))}</b><span>${esc(t('rebootSub'))}</span><em>${esc(t('play'))}</em></button>
      </section>
      <footer class="ln-foot">${status()}${files && files.files ? `<small class="ln-files">${esc(t('files', { n: files.files, folder: files.folder }))}</small>` : ''}</footer>
      <div class="ln-sheet" hidden><div class="ln-sheet-in" role="dialog" aria-modal="true" aria-label="${esc(t('friends'))}"><header><h2>${esc(t('friends'))}</h2><button type="button" class="ln-btn ghost" data-a="closeFriends">${esc(t('close'))}</button></header><div class="ln-friends"></div></div></div>`;
  };
  const go = (mode: 'classic' | 'reboot') => {
    if (h.desktop) void h.desktop.game.open(mode);
    else location.href = `?autoload=1&reboot=${mode === 'reboot' ? 1 : 0}`;
  };
  el.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-go],[data-a]'); if (!b) return;
    if (b.dataset.go) { go(b.dataset.go as 'classic' | 'reboot'); return; }
    const a = b.dataset.a;
    if (a === 'logout') void h.desktop?.accounts.logout();
    if (a === 'folder' && h.desktop) { const r = await h.desktop.assets.choose(); if (r) { files = r; if (r.files) void h.desktop.game.open('launcher'); else render(); } }
    if (a === 'friends' && h.friends) { const sh = el.querySelector<HTMLElement>('.ln-sheet')!; sh.hidden = false; unmountFriends?.(); unmountFriends = h.friends(sh.querySelector('.ln-friends')!); }
    if (a === 'closeFriends') { unmountFriends?.(); unmountFriends = null; el.querySelector<HTMLElement>('.ln-sheet')!.hidden = true; }
  });
  // the room appears behind (the Mii, the music): follow the game's screen without rebuilding the friends sheet
  const tick = window.setInterval(() => {
    const sc = h.screen();
    if (el.dataset.screen !== sc) {
      el.dataset.screen = sc;
      const f = el.querySelector('.ln-foot'); if (f) f.innerHTML = status() + (files && files.files ? `<small class="ln-files">${esc(t('files', { n: files.files, folder: files.folder }))}</small>` : '');
      const lg = el.querySelector('.ln-logo'); if (lg) lg.innerHTML = h.logo();
    }
    if (sc === 'room' && !musicOn) { musicOn = true; h.music(); }
  }, 300);
  render();
  if (h.desktop) {
    void h.desktop.accounts.current().then((a) => { account = a; render(); });
    void h.desktop.assets.info().then((f) => { files = f; render(); });
  }
  (el.querySelector('[data-go=classic]') as HTMLElement | null)?.focus();
  return () => { clearInterval(tick); unmountFriends?.(); el.remove(); };
}
