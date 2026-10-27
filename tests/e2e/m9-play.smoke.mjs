// M9 smoke test: PLAY mode (game shell) + boot flow + local profile + persistence across reload, Lab still reachable.
// boot → import own files → create Mii → name → birthday → room (first-entry line) → Mii → menu → wardrobe → room skin
// → reload → everything restored → export / import of the save → ?lab=1.
// Usage: node tests/e2e/m9-play.smoke.mjs <url> <outDir> <file1> [file2...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const checks = {}; const fail = [];
const expect = (n, ok, info) => { checks[n] = { ok: !!ok, info }; if (!ok) fail.push(`${n}: ${JSON.stringify(info)}`); };
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const screen = () => page.evaluate(() => window.__mtw.play?.currentScreen);
const sim = (s) => page.evaluate((s) => window.__mtw.simRoom(s), s);
const simUntil = async (pred, max = 20, step = 0.25) => { for (let t = 0; t < max; t += step) { if (await page.evaluate(pred)) return true; await sim(step); } return page.evaluate(pred); };
const clickAt = async (x, y, z) => { const p = await page.evaluate(([x, y, z]) => window.__mtw.projectRoom(x, y, z), [x, y, z]); return page.evaluate(([cx, cy]) => window.__mtw.roomClick(cx, cy), [p.x, p.y]); };

// 1 boot → first run (no files yet)
await page.goto(url);
await page.waitForFunction(() => ['setup', 'boot'].includes(window.__mtw?.play?.currentScreen), null, { timeout: 30000 });
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'setup', null, { timeout: 30000 });
await shot('m9-01-first-run');
expect('PLAY hides the Lab UI', await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).display === 'none' && getComputedStyle(document.querySelector('.panel-left')).display === 'none'), null);
// 2 import own files
await page.setInputFiles('#play input[type=file]', files);
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'create', null, { timeout: 300000 });
await page.waitForFunction(() => window.__mtw.slots.original.parts.length > 0, null, { timeout: 120000 });
await page.waitForTimeout(500);
await shot('m9-02-create-mii');
await page.click('#play [data-a=roll]'); await page.waitForTimeout(300);
await page.click('#play [data-a=next]');
expect('name screen', (await screen()) === 'name', await screen());
await page.fill('#play .pl-input', 'Kelly');
await shot('m9-03-name');
await page.click('#play [data-a=next]');
expect('birthday screen with original texts', (await screen()) === 'birthday' && /compleanno/i.test(await page.textContent('#play h2')), await page.textContent('#play h2'));
await page.selectOption('#play select[data-k=m]', '3'); await page.selectOption('#play select[data-k=d]', '14');
await shot('m9-04-birthday');
await page.click('#play [data-a=ok]');
// 2b personality (M13): original axis labels + level descriptions, reversed type
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'personality', null, { timeout: 20000 });
const pers = await page.evaluate(() => {
  for (const a of [0, 1]) { const i = document.querySelector(`#play [data-ax="${a}"]`); i.value = '8'; i.dispatchEvent(new Event('input')); }
  return { labels: [...document.querySelectorAll('#play .pl-axis')].map((l) => l.firstChild.textContent.trim()), lv: [...document.querySelectorAll('#play .pl-lv')].map((x) => x.textContent), type: document.querySelector('#play [data-a=type]').textContent, p: window.__mtw.personality };
});
await shot('m9-04b-personality');
expect('personality: original labels, levels, original result (characterInfo00: index 7 = Intraprendente / Deciso), engine type 1', pers.labels[0] === 'Movimenti' && pers.lv[0] === 'Super rapidi' && pers.lv[1] === 'Super diretto' && /Intraprendente/.test(pers.type) && /Deciso/.test(pers.type) && /orgoglioso/.test(pers.type) && pers.p === 1, pers);
await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 120000 });
await page.evaluate(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
// 3 first entry: tutorial line instead of the greeting
await simUntil(() => window.__mtw.roomUi.snapshot()?.label === 'tutorialFirst', 20);
await simUntil(() => window.__mtw.roomUi.snapshot()?.typed, 10);
let b = await page.evaluate(() => window.__mtw.roomUi.snapshot());
await shot('m9-05-first-entry');
expect('first entry shows tutorialFirst with the Mii name', b?.label === 'tutorialFirst' && /Kelly/.test(JSON.stringify(await page.evaluate(() => window.__mtw.roomUi.shown.at(-1)))) && b.pages >= 3, b);
for (let i = 0; i < 12 && (await page.evaluate(() => window.__mtw.roomUi.isOpen)); i++) { await page.click('.room-balloon'); await sim(3); }
expect('tutorial pages advance and close', !(await page.evaluate(() => window.__mtw.roomUi.isOpen)), null);
await simUntil(() => window.__mtw.director.state === 'idle', 10);
expect('PLAY: no debug status / badges visible', await page.evaluate(() => getComputedStyle(document.querySelector('.room-status')).display === 'none' && getComputedStyle(document.querySelector('.room-badges')).display === 'none'), null);
// 4 move + Mii interaction + question
expect('walk', (await clickAt(-10, 0, -14)) === 'floor', null); await simUntil(() => window.__mtw.director.state === 'idle', 10);
const mp = await page.evaluate(() => window.__mtw.director.pos.toArray());
await clickAt(mp[0], 4, mp[2]);
await simUntil(() => window.__mtw.roomUi.snapshot()?.kind === 'touch' && window.__mtw.roomUi.snapshot().menu.length > 0, 15);
await shot('m9-06-mii-menu');
console.log('DBG', JSON.stringify(await page.evaluate(() => ({ snap: window.__mtw.roomUi.snapshot(), speak: window.__mtw.speakLog, st: window.__mtw.director.state, log: window.__mtw.director.log.slice(-12) }))));
await page.evaluate(() => window.__mtw.roomUi.clickMenu('ask'));
await simUntil(() => window.__mtw.roomUi.snapshot()?.label === 'noQuestion' && window.__mtw.roomUi.snapshot().typed, 10);
expect('question: noQuestion (no question database yet)', (await page.evaluate(() => window.__mtw.roomUi.snapshot()?.label)) === 'noQuestion', null);
await page.evaluate(() => window.__mtw.roomUi.clickOk());
// 4b drag the Mii (pick up / drop) with real pointer events
{
  const pos = await page.evaluate(() => window.__mtw.director.pos.toArray());
  const p = await page.evaluate(([x, y, z]) => window.__mtw.projectRoom(x, y, z), [pos[0], 4, pos[2]]);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 40, p.y - 10, { steps: 4 }); await page.mouse.move(p.x + 90, p.y - 20, { steps: 4 });
  const held = await page.evaluate(() => ({ s: window.__mtw.director.state, c: window.__mtw.director.currentClip, y: window.__mtw.director.pos.y }));
  await shot('m9-06b-held');
  await page.mouse.up();
  const rel = await page.evaluate(() => window.__mtw.director.state);
  await simUntil(() => window.__mtw.director.state === 'idle', 10, 0.1);
  const hist = await page.evaluate(() => window.__mtw.director.history.slice(-4));
  const snd = await page.evaluate(() => window.__mtw.sound.log.map((e) => e.key).filter((k) => /se_ui_hand/.test(k)));
  expect('drag: held (PickUp) → drop (Fall) → TouchLanding → idle, hand sounds', held.s === 'held' && held.c === 'animActionPickUp' && held.y > 0 && rel === 'reacting' && hist.includes('held>reacting') && snd.length >= 2, { held, rel, hist, snd });
}
// 4c idle variation in PLAY after a quiet period
await simUntil(() => window.__mtw.director.currentClip === 'animActionLookAroundRestlessly', 40, 0.5);
expect('idle variation (LookAroundRestlessly) after a quiet period', (await page.evaluate(() => window.__mtw.director.currentClip)) === 'animActionLookAroundRestlessly', null);
await simUntil(() => window.__mtw.director.state === 'idle', 15);
// 5 wardrobe from the bottom bar
await page.click('#play .pl-tab[data-tab=menu]');
await shot('m9-07-menu');
await page.click('#play .pl-mbtn[data-a=closet]');
const pick = await page.evaluate(() => { const b = [...document.querySelectorAll('#play .pl-citem')].find((x) => !x.classList.contains('on')); b?.click(); return b?.dataset.id ?? null; });
const names = await page.evaluate(() => [...document.querySelectorAll('#play .pl-cname')].map((x) => ({ t: x.textContent, raw: x.classList.contains('raw') })));
expect('closet: original Italian item names', names.length > 0 && names.filter((n) => !n.raw).length >= names.length / 2, names.slice(0, 6));
await page.waitForTimeout(600); await sim(0.2);
await shot('m9-08-wardrobe');
expect('wardrobe equip tops', pick && (await page.evaluate(() => window.__mtw.outfit.tops?.id)) === pick, pick);
await page.click('#play .pl-close');
// 6 room skin
await page.click('#play .pl-tab[data-tab=menu]'); await page.click('#play .pl-mbtn[data-a=room]');
const wall = await page.evaluate(() => { const b = [...document.querySelectorAll('#play .pl-citem')].find((x) => x.dataset.id !== '0000'); b?.click(); return b?.dataset.id; });
await page.waitForTimeout(1200); await sim(0.3);
await shot('m9-09-custom-room');
await page.click('#play .pl-close');
// 6b greetings (Saluti)
await page.click('#play .pl-tab[data-tab=menu]'); await page.click('#play .pl-mbtn[data-a=greet]');
const gph = await page.evaluate(() => [...document.querySelectorAll('#play [data-g]')].map((i) => i.placeholder));
await page.fill('#play [data-g=welcome]', 'Benvenuto!');
await shot('m9-09b-greetings');
await page.click('#play [data-a=gsave]');
await simUntil(() => window.__mtw.roomUi.snapshot()?.label === 'customGreetingWelcome', 6);
const gb = await page.evaluate(() => window.__mtw.roomUi.snapshot()?.text ?? window.__mtw.roomUi.snapshot());
expect('greetings: 4 fields with original defaults, custom welcome spoken', gph.length === 4 && gph.every(Boolean) && JSON.stringify(gb).includes('Benvenuto!'), { gph, gb });
await page.waitForTimeout(500);
const saved = await page.evaluate(() => JSON.parse(window.__mtw.play.exportJson()));
expect('save has profile/outfit/room', saved.version === 1 && saved.profile.name === 'Kelly' && saved.profile.birthday?.month === 3 && saved.outfit.tops?.id === pick && saved.room.wall === wall && saved.progress.firstEntryDone && saved.profile.greetings?.welcome === 'Benvenuto!' && saved.profile.personality?.[0] === 8, { p: saved.profile.name, o: saved.outfit.tops, r: saved.room });
// 7 reload: restored without the creation flow, normal greeting
await page.reload();
await page.waitForFunction(() => window.__mtw?.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 300000 });
await page.evaluate(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
await simUntil(() => window.__mtw.roomUi.snapshot()?.kind === 'greeting', 20);
b = await page.evaluate(() => window.__mtw.roomUi.snapshot());
await sim(1.0);
await shot('m9-10-restored');
const st = await page.evaluate(() => ({ name: window.__mtw.roomUi.ctx.nickname, tops: window.__mtw.outfit.tops?.id, wall: window.__mtw.ui.wall, label: window.__mtw.roomUi.snapshot()?.label, launches: window.__mtw.play.save.progress.launches }));
expect('reload restores name / outfit / wall, greeting = fixedGreeting', st.name === 'Kelly' && st.tops === pick && st.wall === wall && b?.label === 'fixedGreeting' && st.launches === 2, st);
// 8 export / import roundtrip + invalid file
const rt = await page.evaluate(async () => { const p = window.__mtw.play; const j = p.exportJson(); await p.importSave(j); let bad = null; try { await p.importSave('{"format":"x"}'); } catch (e) { bad = e.message; } return { ok: p.save.profile.name, bad }; });
expect('export/import roundtrip + invalid save refused', rt.ok === 'Kelly' && !!rt.bad, rt);
// 9 Lab still available
await page.goto(url.replace(/\/?$/, '/') + '?lab=1');
await page.waitForFunction(() => window.__mtw?.LAB === true, null, { timeout: 60000 });
await page.waitForTimeout(800);
await shot('m9-11-lab');
expect('Lab: developer panels visible', await page.evaluate(() => getComputedStyle(document.querySelector('.panel-left')).display !== 'none' && !!document.querySelector('#sceneSeg')), null);
// mobile PLAY
await page.goto(url); await page.setViewportSize({ width: 390, height: 844 });
await page.waitForFunction(() => window.__mtw?.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 300000 });
await page.evaluate(() => { window.__mtw.testClock.paused = true; }); await sim(6);
await shot('m9-12-mobile');
const errors = logs.filter((l) => /^(error|pageerror)/.test(l));
expect('zero console errors', errors.length === 0, errors);
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, logs, saved }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail, logs: logs.filter((l) => /error|warn/i.test(l)).slice(0, 15) }, null, 1));
await browser.close();
process.exit(fail.length ? 1 : 0);
