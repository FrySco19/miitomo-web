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
  music: () => unknown;
  /** Diagnostics report (files, audio, voice, Mii proportions). */
  diagnostics?: () => Promise<Record<string, any>>;
  /** Audio tests (music, one effect, the voice), and mute / unmute. */
  tests?: { music(): Promise<any>; effect(): Promise<any>; voice(lang: 'it' | 'en'): Promise<any>; mute(on: boolean): any };
  desktop: DesktopApi | null;
  /** Mounts the P2P friends panel (desktop only); returns the unmount. */
  friends?: ((el: HTMLElement) => () => void) | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const LANG = (() => { try { const l = localStorage.getItem('mtw.reboot.lang'); if (l) return l === 'it' ? 'it' : 'en'; } catch { /* */ } return /^it\b/i.test(navigator.language) ? 'it' : 'en'; })();
const TX = {
  it: { classic: 'Miitomo Classic', classicSub: 'Il gioco originale, ricostruito dai tuoi file.', reboot: 'Miitomo Reboot', rebootSub: 'Funzioni nuove: Piazza, stanze degli amici, MiiPhone, MIInstagram.', play: 'Gioca',
    loading: 'Sto preparando la tua stanza…', setup: 'Primo avvio: dopo la scelta crei il tuo Mii.', noFiles: 'Non trovo i tuoi file di Miitomo.', choose: 'Scegli la cartella dei file', files: '{n} file trovati in {folder}',
    friends: 'Amici', logout: 'Esci', code: 'Il tuo codice amico', newBadge: 'NUOVO · non presente in Miitomo', music: 'Musica e Mii dai tuoi file originali, su questo PC.', close: 'Chiudi',
    diag: 'Diagnostica e test audio', tMusic: '▶ Musica', tEffect: '▶ Effetto', tVoiceIt: '▶ Voce (italiano)', tVoiceEn: '▶ Voce (inglese)', tMute: 'Muto', tUnmute: 'Audio di nuovo', copy: 'Copia il report', copied: 'Report copiato.', refresh: 'Aggiorna',
    secAudio: 'Audio', secVoice: 'Voce dei Mii', secFiles: 'I tuoi file', secMii: 'Proporzioni del Mii', ok: 'OK', fail: 'Non va', voiceNote: 'La voce originale di Miitomo (Nuance) non funziona fuori dal telefono: qui parla la sintesi vocale del sistema, non originale.' },
  en: { classic: 'Miitomo Classic', classicSub: 'The original game, rebuilt from your files.', reboot: 'Miitomo Reboot', rebootSub: 'New features: Plaza, friends\' rooms, MiiPhone, MIInstagram.', play: 'Play',
    loading: 'Getting your room ready…', setup: 'First start: after choosing, you create your Mii.', noFiles: 'Your Miitomo files were not found.', choose: 'Choose the files folder', files: '{n} files found in {folder}',
    friends: 'Friends', logout: 'Log out', code: 'Your friend code', newBadge: 'NEW · not in Miitomo', music: 'Music and Miis from your own original files, on this PC.', close: 'Close',
    diag: 'Diagnostics and audio test', tMusic: '▶ Music', tEffect: '▶ Effect', tVoiceIt: '▶ Voice (Italian)', tVoiceEn: '▶ Voice (English)', tMute: 'Mute', tUnmute: 'Sound back', copy: 'Copy the report', copied: 'Report copied.', refresh: 'Refresh',
    secAudio: 'Sound', secVoice: 'Mii voice', secFiles: 'Your files', secMii: 'Mii proportions', ok: 'OK', fail: 'Not working', voiceNote: 'The original Miitomo voice (Nuance) does not run outside the phone: here the system speech synthesis talks, not original.' },
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
  const foot = () => `${status()}${h.diagnostics ? `<button type="button" class="ln-link" data-a="diag">${esc(t('diag'))}</button>` : ''}${files && files.files ? `<small class="ln-files">${esc(t('files', { n: files.files, folder: files.folder }))}</small>` : ''}`;
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
      <footer class="ln-foot">${foot()}</footer>
      <div class="ln-sheet ln-diag" hidden><div class="ln-sheet-in" role="dialog" aria-modal="true" aria-label="${esc(t('diag'))}"><header><h2>${esc(t('diag'))}</h2><button type="button" class="ln-btn ghost" data-a="closeDiag">${esc(t('close'))}</button></header>
        <div class="dg-tests">${h.tests ? `<button type="button" class="ln-btn" data-t="music">${esc(t('tMusic'))}</button><button type="button" class="ln-btn" data-t="effect">${esc(t('tEffect'))}</button><button type="button" class="ln-btn" data-t="voice-it">${esc(t('tVoiceIt'))}</button><button type="button" class="ln-btn" data-t="voice-en">${esc(t('tVoiceEn'))}</button><button type="button" class="ln-btn ghost" data-t="mute">${esc(t('tMute'))}</button><button type="button" class="ln-btn ghost" data-t="unmute">${esc(t('tUnmute'))}</button>` : ''}</div>
        <p class="dg-result" role="status"></p><div class="dg-body"></div>
        <div class="dg-tests"><button type="button" class="ln-btn ghost" data-a="diagRefresh">${esc(t('refresh'))}</button><button type="button" class="ln-btn ghost" data-a="diagCopy">${esc(t('copy'))}</button></div></div></div>
      <div class="ln-sheet ln-fr" hidden><div class="ln-sheet-in" role="dialog" aria-modal="true" aria-label="${esc(t('friends'))}"><header><h2>${esc(t('friends'))}</h2><button type="button" class="ln-btn ghost" data-a="closeFriends">${esc(t('close'))}</button></header><div class="ln-friends"></div></div></div>`;
  };
  const go = (mode: 'classic' | 'reboot') => {
    if (h.desktop) void h.desktop.game.open(mode);
    else location.href = `?autoload=1&reboot=${mode === 'reboot' ? 1 : 0}`;
  };
  let lastReport: Record<string, any> | null = null;
  const result = (text: string, good?: boolean) => { const r = el.querySelector<HTMLElement>('.dg-result'); if (r) { r.textContent = text; r.dataset.good = good === undefined ? '' : String(good); } };
  /** Renders the report in plain words (the whole report can be copied). */
  const showDiag = async () => {
    if (!h.diagnostics) return;
    const r = lastReport = await h.diagnostics();
    const body = el.querySelector<HTMLElement>('.dg-body'); if (!body) return;
    const a = r.audio ?? {}, snd = typeof a.sound === 'object' ? a.sound : null, v = r.voice ?? {}, m = r.mii ?? {}, f = r.files ?? {}, vf = r.vfs ?? {};
    const row = (k: string, val: unknown, bad = false) => `<li${bad ? ' class="bad"' : ''}><span>${esc(k)}</span><b>${esc(String(val ?? '—'))}</b></li>`;
    body.innerHTML = `
      <h3>${esc(t('secAudio'))}</h3><ul class="dg">
        ${row('AudioContext', snd?.context ?? 'non creato', snd?.context !== 'running')}
        ${row('audio / musica / effetti', `${a.audioOn ? 'on' : 'off'} / ${a.switches?.music ? 'on' : 'off'} / ${a.switches?.effects ? 'on' : 'off'}`, !a.audioOn)}
        ${row('tabelle MSBT', snd ? `${snd.tables.present.length}/${snd.tables.present.length + snd.tables.missing.length}${snd.tables.missing.length ? ' — mancano: ' + snd.tables.missing.join(', ') : ''}` : '—', !!snd?.tables.missing.length)}
        ${row('file audio importati', vf.soundFiles, !vf.soundFiles)}
        ${row('musica del titolo', a.title ? `${a.title.state === 'loading' ? 'disponibile' : a.title.why} (${a.title.file ?? '—'})` : '—', a.title && a.title.state !== 'loading')}
        ${row('musica della stanza', a.room ? `${a.room.state === 'loading' ? 'disponibile' : a.room.why} (${a.room.file ?? '—'})` : '—', a.room && a.room.state !== 'loading')}
        ${row('ultima musica', snd?.bgm ? `${snd.bgm.key} → ${snd.bgm.state}${snd.bgm.why ? ' (' + snd.bgm.why + ')' : ''}` : '—', snd?.bgm && snd.bgm.state !== 'playing')}
        ${row('volumi (guadagno)', snd ? `musica ${snd.gains.music === null ? '—' : (+snd.gains.music).toFixed(2)} · effetti ${snd.gains.effects === null ? '—' : (+snd.gains.effects).toFixed(2)}` : '—', snd && (snd.gains.music === 0 || snd.gains.effects === 0))}
        ${snd?.lastError ? row('errore', snd.lastError, true) : ''}${snd?.missing?.length ? row('mancanti', snd.missing.slice(-4).join('; '), true) : ''}
      </ul>
      <h3>${esc(t('secVoice'))}</h3><ul class="dg">
        ${row('motore', `${v.provider} (${v.state})`, v.provider !== 'web-tts')}
        ${row('voce italiana', v.italian ?? v.italianMissing ?? (v.state === 'loading' ? 'in caricamento…' : v.state === 'none' ? 'nessuna voce di sistema installata' : '—'), !v.italian)}
        ${row('voce inglese', v.english ?? v.englishMissing ?? (v.state === 'loading' ? 'in caricamento…' : v.state === 'none' ? 'nessuna voce di sistema installata' : '—'), !v.english)}
        ${row('voci installate', (v.voices ?? []).length)}${v.lastError ? row('errore', v.lastError, true) : ''}
      </ul><p class="fp-note">${esc(t('voiceNote'))}</p>
      <h3>${esc(t('secFiles'))}</h3><ul class="dg">
        ${row('cartella', f.folder ?? '—')}
        ${row('trovati', f.kinds ? `${f.files} — APK ${f.kinds.apk} · AFL ${f.kinds.afl} · env ${f.kinds.env} · animazioni ${f.kinds.anim} · corpo/vestiti ${f.kinds.body} · suoni ${f.kinds.sound} · stanza ${f.kinds.room} · altri ${f.kinds.other}` : f.files ?? '—', f.kinds && (!f.kinds.apk || !f.kinds.sound || !f.kinds.body))}
        ${row('importati', (r.importedSources ?? []).length)}
        ${row('vestiti disponibili', vf.bodyItems, !vf.bodyItems)}
        ${row('risorsa testa (AFL)', vf.afl ? `${vf.afl.file}${vf.afl.known ? ' (verificata)' : ''}` : 'mancante', !vf.afl)}
      </ul>
      <h3>${esc(t('secMii'))}</h3><ul class="dg">
        ${row('testa agganciata', m.build ? (m.build.mode === 'joint' ? `joint Head di ${m.build.skeleton}` : `senza scheletro — ${m.build.reason ?? ''}`) : 'Mii non ancora costruito', m.build && m.build.mode !== 'joint')}
        ${row('parti del corpo', m.build?.parts?.join(', ') || '—', m.build && !m.build.parts?.length)}
        ${row('altezza / corporatura', m.build ? `${m.build.height} / ${m.build.build}` : '—')}
        ${row('testa / joint Head', m.measured ? `${m.measured.headHeight} / ${m.measured.headJointY ?? '—'} = ${m.measured.ratio ?? '—'} → ${m.measured.verdict}` : '—', m.measured && m.measured.verdict !== 'proporzioni attese')}
      </ul>`;
  };
  el.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-go],[data-a],[data-t]'); if (!b) return;
    if (b.dataset.go) { go(b.dataset.go as 'classic' | 'reboot'); return; }
    const a = b.dataset.a;
    if (a === 'logout') void h.desktop?.accounts.logout();
    if (a === 'folder' && h.desktop) { const r = await h.desktop.assets.choose(); if (r) { files = r; if (r.files) void h.desktop.game.open('launcher'); else render(); } }
    if (a === 'diag') { el.querySelector<HTMLElement>('.ln-diag')!.hidden = false; void showDiag(); }
    if (a === 'closeDiag') el.querySelector<HTMLElement>('.ln-diag')!.hidden = true;
    if (a === 'diagRefresh') void showDiag();
    if (a === 'diagCopy') { try { await navigator.clipboard.writeText(JSON.stringify(lastReport, null, 1)); result(t('copied')); } catch { result(JSON.stringify(lastReport).slice(0, 200)); } }
    if (b.dataset.t && h.tests) {
      const k = b.dataset.t; result('…');
      const r = k === 'music' ? await h.tests.music() : k === 'effect' ? await h.tests.effect() : k === 'voice-it' ? await h.tests.voice('it') : k === 'voice-en' ? await h.tests.voice('en') : h.tests.mute(k === 'mute');
      const good = k === 'music' ? r?.status?.state === 'playing' : k === 'mute' || k === 'unmute' ? true : !!r?.ok;
      const why = k === 'music' ? `${r?.which === 'title' ? 'titolo' : r?.which === 'room' ? 'stanza' : '—'} · ${r?.status?.file ?? '—'} · ${r?.status?.state ?? '—'}${r?.status?.why ? ` (${r.status.why})` : ''}${r?.which !== 'title' && r?.title?.why ? ` · titolo: ${r.title.why}` : ''} · contesto ${r?.context}`
        : k === 'effect' ? `${r?.event ?? '—'} · ${r?.file ?? '—'}${r?.why ? ` (${r.why})` : ''}${r?.context ? ` · contesto ${r.context}` : ''}`
        : k.startsWith('voice') ? `${r?.report?.lastSpoken?.voice ?? '—'}${r?.why ? ` (${r.why})` : ''}` : `audio ${r?.audioOn ? 'on' : 'off'} · ${r?.bgm?.state ?? '—'}`;
      result(`${good ? '✓ ' + t('ok') : '✗ ' + t('fail')} — ${why}`, good);
      void showDiag();
    }
    if (a === 'friends' && h.friends) { const sh = el.querySelector<HTMLElement>('.ln-fr')!; sh.hidden = false; unmountFriends?.(); unmountFriends = h.friends(sh.querySelector('.ln-friends')!); }
    if (a === 'closeFriends') { unmountFriends?.(); unmountFriends = null; el.querySelector<HTMLElement>('.ln-fr')!.hidden = true; }
  });
  // the room appears behind (the Mii, the music): follow the game's screen without rebuilding the friends sheet
  const tick = window.setInterval(() => {
    const sc = h.screen();
    if (el.dataset.screen !== sc) {
      el.dataset.screen = sc;
      const f = el.querySelector('.ln-foot'); if (f) f.innerHTML = foot();
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
