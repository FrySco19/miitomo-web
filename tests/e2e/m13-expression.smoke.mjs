// M13 smoke test (PLAY): personality (reversed classifier) + EmotionExpression talking gestures / faces.
// boot → import → create (personality type 2 = Nagomi) → room: tagged lines play the personality's gesture, emotion faces build,
// the user's own greeting triggers a word-list rule; personality change switches _Ng/_Dr variants.
// Usage: node tests/e2e/m13-expression.smoke.mjs <url> <outDir> <file1> [file2...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const checks = {}; const fail = [];
const expect = (n, ok, info) => { checks[n] = { ok: !!ok, info }; if (!ok) fail.push(`${n}: ${JSON.stringify(info)}`); };
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const sim = (s) => page.evaluate((s) => window.__mtw.simRoom(s), s);
const simUntil = async (pred, max = 20, step = 0.1) => { for (let t = 0; t < max; t += step) { if (await page.evaluate(pred)) return true; await sim(step); } return page.evaluate(pred); };
await page.goto(url);
await page.waitForFunction(() => window.__mtw?.play?.currentScreen === 'setup', null, { timeout: 60000 });
await page.setInputFiles('#play input[type=file]', files);
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'create', null, { timeout: 300000 });
await page.click('#play [data-a=next]'); await page.fill('#play .pl-input', 'Kelly'); await page.click('#play [data-a=next]');
await page.selectOption('#play select[data-k=m]', '5'); await page.selectOption('#play select[data-k=d]', '2'); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'personality', null, { timeout: 20000 });
// levels 2,2,8,8: slow/gentle (A <= 100) + cheerful/intense (B >= 101) → engine type 2 = Nagomi (M17b: type order 0 Cool,
// 1 Dry, 2 Nagomi, 3 Nori, REVERSED). Expected gestures come from the rule data (er_Expression<P>) for that type.
const pType = await page.evaluate(() => { for (const [a, v] of [[0, 2], [1, 2], [2, 8], [3, 8]]) { const i = document.querySelector(`#play [data-ax="${a}"]`); i.value = String(v); i.dispatchEvent(new Event('input')); } return { p: window.__mtw.personality, t: document.querySelector('#play [data-a=type]').textContent }; });
expect('classifier: 2,2,8,8 → engine type 2 = Nagomi, original result Tranquillo / Affettuoso (characterInfo00)', pType.p === 2 && /Tranquillo/.test(pType.t) && /Affettuoso/.test(pType.t), pType);
await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 120000 });
await page.evaluate(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
expect('head built with the emotion face masks (no fallback warning)', !logs.some((l) => /facce emozione/.test(l)), logs.filter((l) => /facce/.test(l)));
// first entry: tutorialFirst (tags Question … Nintendo) → highest weight rule Question → Dry variant
await simUntil(() => window.__mtw.speakLog.length > 0, 25);
await simUntil(() => window.__mtw.director.state === 'reacting', 6);
await sim(0.4); await shot('m13-01-gesture-question');
let sp = await page.evaluate(() => ({ log: window.__mtw.speakLog.at(-1), clip: window.__mtw.director.currentClip, st: window.__mtw.director.state, balloon: window.__mtw.roomUi.snapshot()?.label }));
const rq = await page.evaluate(() => ({ r: window.__mtw.ruleInfo('Question'), name: window.__mtw.PERSONALITIES[2] }));
expect('tagged line → rule Question → the Nagomi column of er_Question, balloon stays open', rq.name === 'Nagomi' && sp.log?.gesture === rq.r.expr[2] && sp.balloon === 'tutorialFirst', { sp, rq });
await page.evaluate(() => window.__mtw.roomUi.close(true)); await simUntil(() => window.__mtw.director.state === 'idle', 10);
// Joy: personality-specific variants through a user greeting with a Joy word ("amico")
await page.evaluate(() => { window.__mtw.playApi.setGreetings({ welcome: 'Ciao amico!', goIn: '', seeingOff: '', goHome: '' }); window.__mtw.playApi.showBalloon('Scene/RoomSceneTalkWords.msbt', 'customGreetingWelcome', 'Ciao', 4); });
await simUntil(() => window.__mtw.director.state === 'reacting', 3);
await sim(1.2); await shot('m13-02-joy-dry');
const j1 = await page.evaluate(() => ({ log: window.__mtw.speakLog.at(-1), clip: window.__mtw.director.currentClip }));
const rj = await page.evaluate(() => window.__mtw.ruleInfo('Joy'));
expect('word list: "amico" in the user greeting → er_Joy → Nagomi column (type 2)', j1.log?.rules.includes('Joy') && j1.log.gesture === rj.expr[2], { j1, rj });
await page.evaluate(() => window.__mtw.roomUi.close(true)); await simUntil(() => window.__mtw.director.state === 'idle', 15);
await page.evaluate(() => { window.__mtw.playApi.setPersonality([1, 1, 1, 1, 4]); window.__mtw.playApi.showBalloon('Scene/RoomSceneTalkWords.msbt', 'customGreetingWelcome', 'Ciao', 4); });
await simUntil(() => window.__mtw.director.state === 'reacting', 3); await sim(1.2);
await shot('m13-03-joy-nagomi');
const j2 = await page.evaluate(() => ({ p: window.__mtw.personality, log: window.__mtw.speakLog.at(-1), clip: window.__mtw.director.currentClip }));
expect('Cool (1,1,1,1 → type 0): same line → Cool column of er_Joy', j2.p === 0 && j2.log?.gesture === rj.expr[0], { j2, rj });
await page.evaluate(() => window.__mtw.roomUi.close(true)); await simUntil(() => window.__mtw.director.state === 'idle', 15);
// matching model: longest entry wins and consumes (phrase "non sono felice" beats the Joy stem "felic"; the exception
// list Empty keeps "pensione" from the Question stem "pens"); Inhibition (profanity list) cancels the inhibited rules
const say = (t) => page.evaluate((t) => { window.__mtw.playApi.setGreetings({ welcome: t, goIn: '', seeingOff: '', goHome: '' }); window.__mtw.playApi.showBalloon('Scene/RoomSceneTalkWords.msbt', 'customGreetingWelcome', 'x', 3); const r = window.__mtw.speakLog.at(-1); window.__mtw.roomUi.close(true); return r; }, t);
const m1 = await say('sono in pensione'), m2 = await say('boh, chi lo sa'), m3 = await say('che cazzata, sono felice'), m4 = await say('non sono felice');
await sim(8);
expect('word lists: Empty exception, stem, Inhibition', m1.rules.join() === 'Greeting' && m2.rules.includes('Question') && m3.rules.includes('Inhibition') && m3.gesture === null && m4.rules.includes('Sadness') && !m4.rules.includes('Joy') && m4.face === 3, { m1, m2, m3, m4 });
// emotion face: a line with a {9.0}/{9.1} emotion tag, if any, selects the personality face
const emo = await page.evaluate(() => window.__mtw.speakLog.filter((x) => x.face !== null).map((x) => x.label));
expect('emotion tags select a face (at least one line so far)', emo.length > 0, emo);
const errors = logs.filter((l) => /^(error|pageerror)/.test(l));
expect('zero console errors', errors.length === 0, errors);
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, logs }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail, logs: logs.filter((l) => /error|warn/i.test(l)).slice(0, 15) }, null, 1));
await browser.close();
process.exit(fail.length ? 1 : 0);
