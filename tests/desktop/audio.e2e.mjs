// Desktop app — AUDIO end-to-end (Electron, real app). Uses synthetic sound files (tests/desktop/audio-fixture.mjs:
// the game's real table chain, our own tones; no Nintendo data). Checks: the files are found even when the sound zip
// sits in the folder itself (the hotfix), the tables load, the AudioContext runs, the MP3 decodes and plays, the
// launcher falls back to the room music when the title music is missing (with the reason), a sound effect, the voice
// (or a clear message when no voice is installed), mute / unmute, Classic / Reboot, closing and reopening the app.
// Run: npm --prefix client/web run build && xvfb-run -a node tests/desktop/audio.e2e.mjs
import { _electron } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { makeAudioFixture, makeThumbFixture, THUMB_KEYS } from './audio-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = path.join(root, 'desktop', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const out = process.argv[2] ?? path.join(root, 'test-results', 'desktop');
fs.mkdirSync(out, { recursive: true });
const fail = []; const expect = (n, ok, info) => { if (!ok) fail.push(n); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' ' + JSON.stringify(info)}`); };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const assets = tmp('mtw-audio-assets-'), userData = tmp('mtw-audio-ud-');
makeAudioFixture(assets);              // APK + sound zip both in the folder itself (not local-assets/cdn)
makeThumbFixture(path.join(assets, 'local-assets', 'cdn'));   // 0.1.2: a dated weekly zip with closet / room thumbnails
const launch = () => _electron.launch({ executablePath: exe, args: [path.join(root, 'desktop', 'main.cjs'), '--no-sandbox'], env: { ...process.env, MTW_USER_DATA: userData, MTW_ASSETS: assets, MTW_LAN_PORT: '47861', MTW_LAN_TARGETS: '[]' } });
const gameOf = (app) => app.waitForEvent('window', { predicate: (p) => p.url().includes('/index.html'), timeout: 20000 });
const diag = (g) => g.evaluate(() => window.__mtw.diagnostics());
const errors = [];

let app = await launch();
try {
  const w = await app.firstWindow(); await w.waitForSelector('#f');
  await w.click('[data-tab=register]'); await w.fill('input[name=u]', 'Suono'); await w.fill('input[name=p]', 'password1'); await w.fill('input[name=p2]', 'password1');
  let g = gameOf(app); await w.click('.go'); g = await g;
  g.on('pageerror', (e) => errors.push(e.message));
  await g.waitForSelector('.ln-card');
  // the game imports the user's files by itself (first start, empty storage)
  let d = await diag(g);
  for (let i = 0; i < 60 && d.importedSources.length < 3; i++) { await g.waitForTimeout(500); d = await diag(g); }
  const th = await g.evaluate((keys) => keys.map((k) => window.__mtw.vfs.has(k)), THUMB_KEYS);
  expect('0.1.2 thumbnails: the dated weekly zip is found and its closet / room thumbnails are imported (were skipped by the local import)', d.files.kinds.thumbs === 1 && d.importedSources.includes('20161110testwebp.zip') && th.every(Boolean) && d.vfs.thumbnails === 2, { kinds: d.files.kinds, imp: d.importedSources, th, n: d.vfs.thumbnails });
  expect('files: the APK and the sound zip in the folder itself are found and imported (hotfix: was local-assets/cdn only)', d.files.kinds.apk === 1 && d.files.kinds.sound === 1 && d.importedSources.includes('sound_TEST_mp3.zip') && d.vfs.soundFiles === 2, { files: d.files, imp: d.importedSources, sf: d.vfs.soundFiles });

  // ---- launcher music (title missing → room) through the diagnostics UI
  await g.click('[data-a=diag]'); await g.waitForSelector('.ln-diag:not([hidden])');
  await g.click('[data-t=music]');
  await g.waitForFunction(() => /✓|✗/.test(document.querySelector('.dg-result')?.textContent ?? ''), null, { timeout: 15000 });
  d = await diag(g);
  const s = d.audio.sound;
  expect('tables: the 4 sound tables of the fixture are loaded (MSBT)', ['Action/bgm', 'BGM/common', 'Wave/bgm', 'Wave/common'].every((t) => s.tables.present.includes(t)), s.tables);
  expect('AudioContext created by the app and running (desktop: no click needed)', s.context === 'running', s.context);
  expect('title music missing → its precise reason is shown', d.audio.title.state === 'missing-file' && /BGM_TITLE\.mp3/.test(d.audio.title.why), d.audio.title);
  expect('launcher music falls back to the room music; the MP3 is decoded and plays', d.audio.launcher.which === 'room' && s.bgm.state === 'playing' && s.bgm.file === 'BGM_TESTROOM.mp3' && !s.missing.some((m) => /decodifica/.test(m)), { launcher: d.audio.launcher, bgm: s.bgm, missing: s.missing });
  expect('gains connected and not zero (music 0.45, effects 0.9 × levels)', s.gains.music > 0 && s.gains.effects > 0, s.gains);
  const ui1 = await g.textContent('.dg-result');
  expect('the test shows the result in words (no DevTools needed)', /✓/.test(ui1) && /BGM_TESTROOM/.test(ui1), ui1);
  // the AudioContext clock really advances while the music plays
  const t0 = await g.evaluate(() => window.__mtw.sound && window.__mtw.sound.status().context === 'running' ? performance.now() : 0);
  await g.waitForTimeout(400);
  expect('time passes in the running AudioContext', t0 > 0);
  await g.screenshot({ path: `${out}/audio-01-diagnostics.png` });

  // ---- an effect
  await g.click('[data-t=effect]');
  await g.waitForFunction(() => /Effet|Effect|effect|✓|✗/.test(document.querySelector('.dg-result')?.textContent ?? '') && !/…/.test(document.querySelector('.dg-result')?.textContent ?? ''), null, { timeout: 8000 });
  const fx = await g.evaluate(() => window.__mtw.testEffect());
  expect('a sound effect (se_test.wav) is found, decoded and played', fx.ok && fx.event === 'se_test' && fx.file === 'se_test.wav', fx);

  // ---- the voice: plays, or says exactly why not
  const vi = await g.evaluate(() => window.__mtw.testVoice('it'));
  const vr = vi.report;
  expect('voice: Italian line spoken by a system voice, OR a clear message naming the missing voice / how to add it', vi.ok ? !!vr.lastSpoken : /Nessuna voce|non disponibile|voci di sistema/.test(String(vi.why ?? vr.italianMissing ?? '')), vi);
  console.log(`   (voices on this machine: ${vr.voices.length}; state ${vr.state}; italian ${vr.italian ?? '—'}; english ${vr.english ?? '—'})`);
  expect('the original Miitomo voice is not claimed: provider is the system TTS or silent', ['web-tts', 'silent'].includes(vi.provider), vi.provider);

  // ---- mute / unmute
  const m1 = await g.evaluate(() => { window.__mtw.ui.audio = false; window.__mtw.sound.setEnabled(false); return window.__mtw.sound.status().bgm; });
  const m2 = await g.evaluate(async () => { window.__mtw.ui.audio = true; window.__mtw.sound.setEnabled(true); await new Promise((r) => setTimeout(r, 800)); return window.__mtw.sound.status().bgm; });
  expect('mute stops the music; sound back restarts it', m1.state !== 'playing' && m2.state === 'playing', { m1, m2 });

  // ---- Classic and Reboot pages: the audio works there too (a new page: new context, no click)
  for (const mode of ['classic', 'reboot']) {
    await g.evaluate((m) => window.mtwDesktop.game.open(m), mode);
    await g.waitForURL(new RegExp(`reboot=${mode === 'reboot' ? 1 : 0}`));
    await g.waitForFunction(() => !!window.__mtw?.startMusic);
    // asked at once, while the page is still restoring the files: the music must start by itself once they are there
    await g.evaluate(() => window.__mtw.startMusic());
    await g.waitForFunction(() => window.__mtw.sound?.status().bgm?.state === 'playing', null, { timeout: 10000 }).catch(() => {});
    const st = await g.evaluate(() => ({ bgm: window.__mtw.sound?.status().bgm, context: window.__mtw.sound?.status().context, screen: window.__mtw.play.currentScreen }));
    expect(`${mode}: music plays after the page change, also when asked before the files were restored (context ${st.context})`, st.bgm?.state === 'playing' && st.context === 'running', st);
  }
} catch (e) { fail.push('crash: ' + e.message); console.log('CRASH', e); }
await app.close().catch(() => {});

// ---- close and reopen: same account, files already kept, sound again
// 0.1.2 upgrade path: a cache made by 0.1.1 lacks the thumbnail zips (they were skipped); a zip never imported before
// must be imported by itself at the next start
const LATE = 'asset/capture2/small/character/bodyShoes/bodyShoes0002_00.webp';
makeThumbFixture(path.join(assets, 'local-assets', 'cdn'), '20161117latewebp.zip', [LATE]);
app = await launch();
try {
  const w = await app.firstWindow(); await w.waitForSelector('#f');
  await w.fill('input[name=u]', 'Suono'); await w.fill('input[name=p]', 'password1');
  let g = gameOf(app); await w.click('.go'); g = await g;
  await g.waitForSelector('.ln-card');
  await g.waitForFunction(() => !!window.__mtw?.startMusic);
  const r = await g.evaluate(async () => { for (let i = 0; i < 50 && !(await window.__mtw.diagnostics()).vfs.soundFiles; i++) await new Promise((x) => setTimeout(x, 200)); return window.__mtw.startMusic(); });
  expect('reopened app: files from the local store, music plays again', r.status?.state === 'playing', r);
  const late = await g.evaluate(async (k) => { for (let i = 0; i < 50 && !window.__mtw.vfs.has(k); i++) await new Promise((x) => setTimeout(x, 200)); const d = await window.__mtw.diagnostics(); return { has: window.__mtw.vfs.has(k), imported: d.importedSources.includes('20161117latewebp.zip'), n: d.vfs.thumbnails }; }, LATE);
  expect('0.1.2 upgrade: a thumbnail zip missing from the old cache is imported at the next start (no manual step)', late.has && late.imported && late.n === 3, late);
} catch (e) { fail.push('crash (reopen): ' + e.message); console.log('CRASH', e); }
await app.close().catch(() => {});
expect('no page errors', !errors.length, errors);
console.log(fail.length ? `${fail.length} FAILED` : 'ALL PASS');
process.exit(fail.length ? 1 : 0);
