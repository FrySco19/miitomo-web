// M8 smoke test: first offline gameplay loop in the original room.
// enter -> idle -> walk -> touch Mii (interrupting a walk) -> reaction -> balloon + menu -> answer -> object interaction
// -> return idle -> exit -> re-enter -> cameras -> wall/floor change, plus input-robustness checks.
// Usage: node tests/e2e/m8-loop.smoke.mjs <url> <outDir> <file1> [file2...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FIXTURE = 'AwAAQKBBOMSghAAA27iHMb5gKyoqQgAAWS1KAGEAcwBtAGkAbgBlAAAAAAAAABw3EhB7ASFuQxwNZMcYAAgegg0AMEGzW4JtAABvAHMAaQBnAG8AbgBhAGwAAAAAAJA6';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.setInputFiles('#resFile', files);
await page.waitForFunction(() => window.__mtw?.slots.original.parts.length || document.querySelector('#miiError:not([hidden])'), null, { timeout: 240000 });
await page.fill('#miiData', FIXTURE); await page.click('#loadDataBtn');
await page.evaluate(() => { const m = window.__mtw; m.clock.hour = 10; Object.assign(m.outfit, structuredClone({ ...m.OUTFIT_1, acce: { id: '0003', color: 0 } })); });
await page.click('#sceneSeg button[data-v="room"]');   // user gesture: unlocks WebAudio
await page.waitForFunction(() => window.__mtw.director, null, { timeout: 60000 });
await page.evaluate(() => { window.__mtw.testClock.paused = true; });   // time advances only through simRoom()

const report = { steps: [], checks: {}, clicks: {} };
const fail = [];
const expect = (name, ok, info) => { report.checks[name] = { ok: !!ok, info }; if (!ok) fail.push(`${name}: ${JSON.stringify(info)}`); };
const state = () => page.evaluate(() => {
  const m = window.__mtw, d = m.director;
  return { state: d.state, clip: d.currentClip, pos: d.pos.toArray().map((v) => +v.toFixed(2)), heading: +d.heading.toFixed(2), target: d.target?.toArray().map((v) => +v.toFixed(1)) ?? null,
    intent: d.intent?.name ?? null, door: { open: d.door.open, t: +d.door.t.toFixed(1) }, balloon: m.roomUi.snapshot(), violations: d.violations.slice(), err: document.querySelector('#miiError:not([hidden])')?.textContent ?? null };
});
const snap = async (name, extra = {}) => {
  const st = await state();
  await page.locator('.stage').screenshot({ path: `${out}/${name}.png` });
  report.steps.push({ name, ...st, ...extra });
  return st;
};
const sim = (s) => page.evaluate((s) => window.__mtw.simRoom(s), s);
const simUntil = async (pred, max = 20, step = 0.25) => { for (let t = 0; t < max; t += step) { if (await page.evaluate(pred)) return true; await sim(step); } return page.evaluate(pred); };
const px = (x, y, z) => page.evaluate(([x, y, z]) => window.__mtw.projectRoom(x, y, z), [x, y, z]);
const clickAt = async (x, y, z) => { const p = await px(x, y, z); return page.evaluate(([cx, cy]) => window.__mtw.roomClick(cx, cy), [p.x, p.y]); };
const clickMii = async () => { const p = await page.evaluate(() => window.__mtw.director.pos.toArray()); return clickAt(p[0], 4, p[2]); };

// 1 enter
await sim(0.15);
let s = await snap('m8-01a-enter-door');
expect('01 enter: entering', s.state === 'entering', s.state);
await simUntil(() => window.__mtw.roomUi.snapshot()?.kind === 'greeting', 15);
await sim(0.6);
s = await snap('m8-01-enter');
expect('01 enter: greeting balloon (fixedGreeting)', s.balloon?.label === 'fixedGreeting' && /Ciao/.test(s.balloon.text) && s.balloon.source.startsWith('EUit'), s.balloon);
// 2 idle
await simUntil(() => window.__mtw.director.state === 'idle' && !window.__mtw.roomUi.isOpen, 15);
s = await snap('m8-02-idle');
expect('02 idle: WaitMale/WaitFemale', s.state === 'idle' && /^animWait(Male|Female)$/.test(s.clip), s);
// 3-4 click floor, walking (+ destination marker)
report.clicks.floor = await clickAt(14, 0, -14);
await sim(0.5);
s = await snap('m8-03-walking');
expect('03 click floor -> floor', report.clicks.floor === 'floor', report.clicks.floor);
expect('04 walking with WalkClone + marker target', s.state === 'walking' && s.clip === 'animWalkClone' && !!s.target, s);
await simUntil(() => window.__mtw.director.state === 'idle', 10);
// 5 click Mii while walking: interrupts the walk
report.clicks.floor2 = await clickAt(-16, 0, -12);
await sim(0.4);
const before = await state();
report.clicks.miiWhileWalking = await clickMii();
await sim(0.3);
s = await snap('m8-04-mii-interaction');
expect('05 click Mii during walking -> mii', report.clicks.miiWhileWalking === 'mii' && before.state === 'walking', { before: before.state, r: report.clicks.miiWhileWalking });
expect('06 reaction: reacting + animActionStroked, walk cancelled', s.state === 'reacting' && s.clip === 'animActionStroked' && !s.target, s);
// input during reaction is ignored (atomic)
report.clicks.floorDuringReaction = await clickAt(10, 0, -10);
const sr = await state();
expect('click during reaction ignored', sr.state === 'reacting', sr.state);
// back to idle -> balloon + touch menu
await simUntil(() => window.__mtw.roomUi.snapshot()?.kind === 'touch' && window.__mtw.roomUi.snapshot().menu.length > 0, 15);
s = await snap('m8-05-dialog');
expect('dialog after touch: mySubMii0 + menu, back to Wait', s.state === 'idle' && /^animWait/.test(s.clip) && s.balloon?.label === 'mySubMii0' && s.balloon.menu.length >= 4, s.balloon);
await page.evaluate(() => window.__mtw.roomUi.clickMenu('ask'));
await simUntil(() => window.__mtw.roomUi.snapshot()?.kind === 'answer' && window.__mtw.roomUi.snapshot().typed, 10);
s = await snap('m8-05b-dialog-answer');
expect('answer: noQuestion (original text)', s.balloon?.label === 'noQuestion' && /domande/.test(s.balloon.text), s.balloon);
await page.evaluate(() => window.__mtw.roomUi.clickOk());
await sim(0.1);
expect('answer closed with OK', !(await page.evaluate(() => window.__mtw.roomUi.isOpen)), null);
// 7-8 click furniture (interactive object: chest) -> path -> spot -> CheckTheBox -> nod -> idle
const objs = await page.evaluate(() => window.__mtw.interactables.map((o) => ({ name: o.name, clip: o.clip, spot: o.spot.toArray(), box: { min: o.box.min.toArray(), max: o.box.max.toArray(), top: o.box.top } })));
report.interactables = objs;
const chest = objs.find((o) => o.name === 'chest') ?? objs[0];
expect('interactive objects found', objs.length >= 2 && !!chest, objs.map((o) => o.name));
const cz = (chest.box.min[1] + chest.box.max[1]) / 2;
report.clicks.object = await clickAt(chest.box.min[0] + 0.05, 3, cz);   // left face of the chest (the plant in front hides its top)
await sim(0.3);
const w = await state();
expect('07 click furniture -> object + walking with intent', report.clicks.object === `object:${chest.name}` && w.state === 'walking' && w.intent === chest.name, { r: report.clicks.object, w });
report.pathWaypoints = await page.evaluate(() => window.__mtw.director.path.length);
await simUntil(() => window.__mtw.director.state === 'interacting' && window.__mtw.director.currentClip === 'animActionCheckTheBox', 20, 0.2);
await sim(0.8);
s = await snap('m8-06-object-interaction');
expect('08 interaction: interacting + object clip at the spot', s.state === 'interacting' && s.clip === chest.clip && Math.hypot(s.pos[0] - chest.spot[0], s.pos[2] - chest.spot[2]) < 0.5, s);
// click Mii during interaction: ignored
report.clicks.miiDuringInteraction = await clickMii();
expect('click during interaction ignored', (await state()).state === 'interacting', null);
await simUntil(() => window.__mtw.director.currentClip === 'animNodClone', 20, 0.2);
const nod = await state();
expect('reaction after object: animNodClone (reacting)', nod.state === 'reacting', nod);
await simUntil(() => window.__mtw.director.state === 'idle', 10);
s = await snap('m8-07-return-idle');
expect('09 return idle', s.state === 'idle' && /^animWait/.test(s.clip) && !s.intent, s);
// plant (second interactive object) via the same path, checked quickly
const plant = objs.find((o) => o.name.startsWith('plant'));
if (plant) {
  const r = await clickAt((plant.box.min[0] + plant.box.max[0]) / 2, 3, (plant.box.min[1] + plant.box.max[1]) / 2);
  await simUntil(() => window.__mtw.director.state === 'interacting', 20, 0.2); await sim(1.0);
  s = await snap('m8-06b-object-plant', { click: r });
  expect('second object (plant) interaction', s.state === 'interacting' && s.clip === plant.clip, { r, s: s.state, clip: s.clip });
  await simUntil(() => window.__mtw.director.state === 'idle', 20);
}
// robustness: burst of mixed clicks + keys, no impossible state
for (let i = 0; i < 12; i++) {
  if (i % 3 === 0) await clickMii(); else await clickAt(-10 + i * 2, 0, -8 - i);
  await page.keyboard.press(['ArrowLeft', 'd', 'Space', 'w'][i % 4]);
  await sim(0.07);
}
await simUntil(() => window.__mtw.director.state === 'idle', 20);
await page.evaluate(() => window.__mtw.roomUi.close(true));
// 10-11 click door -> exit (goodbye balloon) -> outside
report.clicks.doorExit = await clickAt(0, 10, -34);
await sim(0.4);
s = await snap('m8-08-exit');
expect('10 click door -> exiting + goodbye balloon', report.clicks.doorExit === 'door' && s.state === 'exiting' && s.balloon?.label === 'defaultGoodByeGoHome', s);
await simUntil(() => window.__mtw.director.state === 'outside', 20);
s = await snap('m8-08b-outside');
expect('11 exit -> outside', s.state === 'outside', s.state);
const bgmOutside = await page.evaluate(() => window.__mtw.sound?.bgmKey);
// 12 re-enter
report.clicks.doorEnter = await clickAt(0, 10, -34);
await simUntil(() => window.__mtw.director.state === 'idle', 20);
s = await snap('m8-09-reentered');
expect('12 re-enter -> idle', report.clicks.doorEnter === 'door' && s.state === 'idle', s.state);
// 13-14 cameras
await page.click('#roomCamSeg button[data-v="follow"]'); await sim(0.1); await snap('m8-10-camera-follow');
await page.click('#roomCamSeg button[data-v="free"]'); await page.evaluate(() => { const v = window.__mtw.view; v.yaw = 0.7; v.pitch = 0.3; v.dist = 1000; }); await sim(0.1); await snap('m8-11-camera-free');
await page.click('#roomCamSeg button[data-v="original"]');
expect('13/14 cameras (follow, free) render', true, null);
// 15 wall/floor change keeps the loop alive
await page.selectOption('#roomWall', '0010'); await page.selectOption('#roomFloor', '0010'); await sim(0.3);
s = await snap('m8-12-room-rmWl0010-rmFl0010');
expect('15 wall/floor change -> idle, director restored', s.state === 'idle', s.state);
report.clicks.afterSkin = await clickAt(-8, 0, -10); await sim(0.4);
expect('walk after skin change', (await state()).state === 'walking', null);
await simUntil(() => window.__mtw.director.state === 'idle', 10);
await page.selectOption('#roomWall', '0000'); await page.selectOption('#roomFloor', '0000'); await sim(0.2);
// WASD / arrows still drive the M7 movement
await page.keyboard.press('ArrowRight'); await sim(0.3);
expect('keyboard -> walking', (await state()).state === 'walking', null);
await simUntil(() => window.__mtw.director.state === 'idle', 10);

// global checks
const fin = await page.evaluate(() => {
  const m = window.__mtw, d = m.director, so = m.sound;
  return { violations: d.violations, history: d.history, log: d.log.slice(-80), shown: m.roomUi.shown,
    sound: so ? { tables: so.tablesLoaded, files: so.filesAvailable, unlocked: so.unlocked, missing: [...so.missing], played: so.log.filter((e) => e.file).map((e) => `${e.key} -> ${e.event} -> ${e.file}${e.played ? '' : ` (${e.why})`}`), bgm: so.bgmKey } : null,
    diag: Object.fromEntries([...document.querySelectorAll('#diag dt')].map((x) => [x.textContent, x.nextElementSibling.textContent])) };
});
report.final = fin;
expect('no invalid state transitions', fin.violations.length === 0, fin.violations);
const errors = logs.filter((l) => /^(error|pageerror)/.test(l));
expect('zero console errors', errors.length === 0, errors);
expect('no missing clips', !fin.log.some((l) => /mancante/.test(l)), fin.log.filter((l) => /mancante/.test(l)));
expect('sound tables + files loaded', fin.sound && fin.sound.tables === 10 /* M14: + Action/effect, Action/face */ && fin.sound.files > 0, fin.sound && { t: fin.sound.tables, f: fin.sound.files });
// files named by Wave/common but present neither in sound.zip nor in the APK (documented in LOOP.md)
const KNOWN_ABSENT = ['se_wipe_up_button_noclk.wav', 'se_wipe_down_button_noclk.wav'];
report.knownAbsent = fin.sound?.missing.filter((m) => KNOWN_ABSENT.includes(m));
expect('no missing sound files (except the 2 documented absent)', fin.sound && fin.sound.missing.every((m) => KNOWN_ABSENT.includes(m)), fin.sound?.missing);
const uniq = [...new Set((fin.sound?.played ?? []).map((p) => p.replace(/ \(.*\)$/, '')))];
report.soundEvents = uniq;
for (const k of ['doorAnim/doorAnimOpen -> se_door_open01', 'doorAnim/doorAnimClose -> se_door_close01', 'animWalkClone:2 -> se_walk_nori_00', 'SequenceTouch:se_nade01 -> se_nade01', 'bgm_room'])
  expect(`sound event ${k}`, uniq.some((u) => u.startsWith(k)), null);
expect('BGM switches to NOBODY while outside', /NOBODY/.test(bgmOutside ?? ''), bgmOutside);
await page.screenshot({ path: `${out}/m8-page-desktop.png` });
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
await clickMii(); await simUntil(() => window.__mtw.roomUi.snapshot()?.kind === 'touch' && window.__mtw.roomUi.snapshot().menu.length > 0, 15);
await page.screenshot({ path: `${out}/m8-page-mobile.png` });
writeFileSync(`${out}/report.json`, JSON.stringify({ report, logs, fail }, null, 1));
console.log(JSON.stringify({ passed: Object.values(report.checks).filter((c) => c.ok).length, total: Object.keys(report.checks).length, fail, clicks: report.clicks, soundEvents: uniq, logs: logs.filter((l) => /error|warn/i.test(l)).slice(0, 20) }, null, 1));
await browser.close();
process.exit(fail.length ? 1 : 0);
