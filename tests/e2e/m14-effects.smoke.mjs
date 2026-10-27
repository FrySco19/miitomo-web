// M14 smoke test: original particle effects (effect.ptcl, nw::eft2) on the Mii in PLAY.
// Usage: node tests/e2e/m14-effects.smoke.mjs <url> <outDir> <file1> [file2...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const logs = []; page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); }); page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const checks = {}; const fail = [];
const expect = (n, ok, info) => { checks[n] = { ok: !!ok, info }; if (!ok) fail.push(`${n}: ${JSON.stringify(info)}`); };
const sim = (s) => page.evaluate((s) => window.__mtw.simRoom(s), s);
await page.goto(url);
await page.waitForFunction(() => window.__mtw?.play?.currentScreen === 'setup', null, { timeout: 60000 });
await page.setInputFiles('#play input[type=file]', files);
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'create', null, { timeout: 300000 });
await page.click('#play [data-a=next]'); await page.fill('#play .pl-input', 'Kelly'); await page.click('#play [data-a=next]');
await page.selectOption('#play select[data-k=m]', '5'); await page.selectOption('#play select[data-k=d]', '2'); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'personality', null, { timeout: 20000 }); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 120000 });
await page.evaluate(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
await sim(16); await page.evaluate(() => window.__mtw.roomUi.close(true)); await sim(3);
expect('effect.ptcl loaded from the APK', await page.evaluate(() => window.__mtw.effects.available()), null);
// close-up around the head
const clip = async () => { const p = await page.evaluate(() => { const d = window.__mtw.director.pos; return window.__mtw.stagePoint(d.x, 3, d.z); }); return { x: Math.max(0, p.x - 260), y: Math.max(0, p.y - 300), width: 520, height: 420 }; };
const res = {};
for (const [name, t] of [['arLike', 0.9], ['arQuestion', 0.5], ['arJoy', 0.4], ['arCry', 0.6], ['arStroke', 0.3], ['arLove', 0.8], ['arSurprise_Cm', 0.3], ['arAnger_Cm', 0.4], ['arSleepness', 1.0], ['arOk', 0.4]]) {
  const ok = await page.evaluate((n) => window.__mtw.playEffect(n), name);
  await sim(t);
  const inst = await page.evaluate(() => { let n = 0; window.__mtw.slots.original.root.traverse((o) => { if (o.isMesh && o.geometry?.isInstancedBufferGeometry) n += o.geometry.instanceCount; }); return n; });
  await page.screenshot({ path: `${out}/m14-${name}.png`, clip: await clip() });
  res[name] = { ok, particles: inst };
  await sim(4);
}
expect('all ten effect sets start and emit particles', Object.values(res).every((r) => r.ok && r.particles > 0), res);
expect('finished effects are removed', await page.evaluate(() => window.__mtw.effects.count) === 0, await page.evaluate(() => window.__mtw.effects.count));
// gesture → effect: a Joy word in the user greeting plays the expression's effect
await page.evaluate(() => { window.__mtw.playApi.setGreetings({ welcome: 'Ciao amico!', goIn: '', seeingOff: '', goHome: '' }); window.__mtw.playApi.showBalloon('Scene/RoomSceneTalkWords.msbt', 'customGreetingWelcome', 'x', 3); });
await sim(0.2);
const fxLog = await page.evaluate(() => window.__mtw.effects.log.slice(-1)[0]);
// expected effect = the effects of the gesture the rule gives this personality (er_Joy column of the engine type, M17b order)
const want = await page.evaluate(() => { const r = window.__mtw.ruleInfo('Joy'); const g = r.expr[window.__mtw.personality]; return { g, fx: window.__mtw.gestureInfo(g)?.effects ?? [], p: window.__mtw.PERSONALITIES[window.__mtw.personality] }; });
expect('talking gesture plays its original effect (ex_EffectFileName* of the Joy gesture for this personality)', want.fx.length > 0 && want.fx.includes(fxLog?.name), { fxLog, want });
// effect sounds (Sound/Action/effect.msbt): arJoy → se_arJoy at start, arCry → se_arCry at frame 17
const snd = await page.evaluate(async () => { const S = window.__mtw.sound; const n0 = S.log.length; window.__mtw.playEffect('arCry'); window.__mtw.simRoom(0.1); const a = S.log.slice(n0).map((e) => e.key + '>' + e.event); window.__mtw.simRoom(0.4); const b = S.log.slice(n0).map((e) => e.key + '>' + e.event); return { a, b, joy: S.actionEvent('arJoy'), face: S.actionEvent('face.change.wink_left') }; });
expect('effect sounds from the original table (incl. timed arCry:17)', snd.joy === 'se_arJoy' && snd.face === 'se_face_00' && !snd.a.some((x) => x.startsWith('arCry:17')) && snd.b.some((x) => x === 'arCry:17>se_arCry'), snd);
const errors = logs.filter((l) => /^(error|pageerror)/.test(l));
expect('zero console errors', errors.length === 0, errors);
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, logs }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
