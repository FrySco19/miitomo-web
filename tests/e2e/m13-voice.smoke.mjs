// M13 voice providers: original Nuance = unavailable on the Web; Web TTS = APPROXIMATED / NON-ORIGINAL; silent fallback.
// speechSynthesis is mocked (headless Chromium has no system voices): run 1 with an Italian voice, run 2 without voices.
// Usage: node tests/e2e/m13-voice.smoke.mjs <url> <outDir> <file1> [file2...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const checks = {}; const fail = []; const logs = [];
const expect = (n, ok, info) => { checks[n] = { ok: !!ok, info }; if (!ok) fail.push(`${n}: ${JSON.stringify(info)}`); };
const mock = (withVoice) => `(() => {
  const spoken = []; window.__spoken = spoken;
  const voices = ${withVoice} ? [{ name: 'Test Italiano', lang: 'it-IT', localService: true, default: true, voiceURI: 'test-it' }] : [];
  const synth = { speaking: false, pending: false, paused: false, getVoices: () => voices, speak: (u) => spoken.push({ text: u.text, pitch: u.pitch, rate: u.rate, lang: u.lang, voice: u.voice && u.voice.name }), cancel: () => spoken.push({ cancel: true }), pause() {}, resume() {}, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };   // the real one rejects a mocked voice object
})();`;
async function run(withVoice, tag) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`${tag} ${m.text()}`); }); page.on('pageerror', (e) => logs.push(`${tag} pageerror: ${e.message}`));
  await page.addInitScript(mock(withVoice));
  await page.goto(url);
  await page.waitForFunction(() => window.__mtw?.play?.currentScreen === 'setup', null, { timeout: 60000 });
  await page.setInputFiles('#play input[type=file]', files);
  await page.waitForFunction(() => window.__mtw.play.currentScreen === 'create', null, { timeout: 300000 });
  await page.click('#play [data-a=next]'); await page.fill('#play .pl-input', 'Kelly'); await page.click('#play [data-a=next]');
  await page.selectOption('#play select[data-k=m]', '5'); await page.selectOption('#play select[data-k=d]', '2'); await page.click('#play [data-a=ok]');
  await page.waitForFunction(() => window.__mtw.play.currentScreen === 'personality', null, { timeout: 20000 }); await page.click('#play [data-a=ok]');
  await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 120000 });
  await page.evaluate(() => { window.__mtw.testClock.paused = true; });
  for (let i = 0; i < 120 && !(await page.evaluate(() => window.__mtw.voiceLog.length)); i++) await page.evaluate(() => window.__mtw.simRoom(0.25));
  const st = await page.evaluate(() => ({ status: window.__mtw.playApi.voiceStatus(), log: window.__mtw.voiceLog.slice(0, 3), spoken: window.__spoken.slice(0, 4) }));
  // Settings shows the classification
  await page.click('#play .pl-tab[data-tab=menu]'); await page.click('#play .pl-mbtn[data-a=config]');
  await page.waitForTimeout(400);
  const ui = await page.evaluate(() => ({ text: document.querySelector('#play .pl-voices')?.textContent ?? '', active: document.querySelector('#play [data-a=vact]')?.textContent ?? '', origDisabled: document.querySelector('#play input[name=voice][value=original-nuance]')?.disabled }));
  await page.screenshot({ path: `${out}/voice-settings-${tag}.png` });
  await page.close();
  return { st, ui };
}
const a = await run(true, 'tts');
const orig = a.st.status.providers.find((p) => p.id === 'original-nuance');
expect('original Nuance provider listed, unavailable on the Web with a reason', orig && orig.classification === 'ORIGINAL' && /nativ/i.test(orig.unavailable ?? ''), orig);
expect('auto → Web TTS, classified APPROXIMATED_NON_ORIGINAL_TTS', a.st.status.active.id === 'web-tts' && a.st.status.active.classification === 'APPROXIMATED_NON_ORIGINAL_TTS', a.st.status.active);
expect('balloon page spoken through the Italian system voice', a.st.spoken.some((s) => s.text && s.voice === 'Test Italiano' && s.lang === 'it-IT') && a.st.log[0]?.classification === 'APPROXIMATED_NON_ORIGINAL_TTS', a.st);
expect('Settings: original disabled, TTS labelled NON originale, active voice says not the Miitomo voice', a.ui.origDisabled === true && /NON originale/.test(a.ui.text) && /non.*la voce originale/i.test(a.ui.active), a.ui);
const b = await run(false, 'none');
expect('no system voice → silent fallback, nothing spoken', b.st.status.active.id === 'silent' && !b.st.spoken.some((s) => s.text), b.st);
expect('zero console errors', logs.length === 0, logs);
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, logs, a, b }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
