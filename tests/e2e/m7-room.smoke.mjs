// M7 smoke test: first Miitomo room (original room, camera, lights) + Mii (M6.1 outfit) + walk/door/touch.
// Usage: node tests/e2e/m7-room.smoke.mjs <url> <outDir> <file1> [file2...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FIXTURE = 'AwAAQKBBOMSghAAA27iHMb5gKyoqQgAAWS1KAGEAcwBtAGkAbgBlAAAAAAAAABw3EhB7ASFuQxwNZMcYAAgegg0AMEGzW4JtAABvAHMAaQBnAG8AbgBhAGwAAAAAAJA6';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.setInputFiles('#resFile', files);
await page.waitForFunction(() => window.__mtw?.slots.original.parts.length || document.querySelector('#miiError:not([hidden])'), null, { timeout: 240000 });
await page.fill('#miiData', FIXTURE); await page.click('#loadDataBtn');
await page.evaluate(() => { const m = window.__mtw; Object.assign(m.outfit, structuredClone({ ...m.OUTFIT_1, acce: { id: '0003', color: 0 } })); });
await page.click('#sceneSeg button[data-v="room"]');
await page.waitForFunction(() => window.__mtw.director, null, { timeout: 60000 });
const report = { steps: [] };
const snap = async (name, extra = {}) => {
  const st = await page.evaluate(() => { const m = window.__mtw, d = m.director; return { state: d.state, clip: d.currentClip, pos: d.pos.toArray().map((v) => +v.toFixed(2)), heading: +d.heading.toFixed(2), door: { open: d.door.open, t: +d.door.t.toFixed(1) }, err: document.querySelector('#miiError:not([hidden])')?.textContent ?? null }; });
  await page.locator('.stage').screenshot({ path: `${out}/${name}.png` });
  report.steps.push({ name, ...st, ...extra });
};
const sim = (s) => page.evaluate((s) => window.__mtw.simRoom(s), s);
// entrance: door opens, Mii walks in from the corridor, door closes, wave
await sim(0.15); await snap('m7-01-enter-door-opening');
await sim(0.6); await snap('m7-02-enter-walking-in');
await sim(2.0); await snap('m7-03-enter-inside');
await sim(4.0); await snap('m7-04-idle-original-camera');
// walk: click on the floor (room point projected to screen)
const click = async (x, y, z) => { const p = await page.evaluate(([x, y, z]) => window.__mtw.projectRoom(x, y, z), [x, y, z]); return page.evaluate(([cx, cy]) => window.__mtw.roomClick(cx, cy), [p.x, p.y]); };
report.clickFloor = await click(14, 0, 12);
await sim(0.5); await snap('m7-05-walking');
await sim(4.0); await snap('m7-06-arrived');
// touch the Mii
const miiPos = await page.evaluate(() => window.__mtw.director.pos.toArray());
report.clickMii = await click(miiPos[0], 4, miiPos[2]);
await sim(0.6); await snap('m7-07-touch-reaction');
await sim(3.0);
// furniture
report.clickShelf = await click(22, 6, 30);
await sim(4.0); await snap('m7-08-walked-to-shelf');
// door: exit and re-enter
report.clickDoorExit = await click(0, 10, -34);
await sim(4.0); await snap('m7-09-exit-door');
await page.waitForFunction(() => true); for (let i = 0; i < 30 && (await page.evaluate(() => window.__mtw.director.state)) !== 'outside'; i++) await sim(1.0);
await snap('m7-10-outside');
report.clickDoorEnter = await click(0, 10, -34);
await sim(5.0); await snap('m7-11-reentered');
await sim(5.0);
// appear (fall + landing) clip pair
await page.click('#roomAppear'); await sim(0.25); await snap('m7-12-appear-fall'); await sim(1.2); await snap('m7-13-appear-landing');
await sim(2.0);
// cameras
await page.click('#roomCamSeg button[data-v="follow"]'); await sim(0.1); await snap('m7-14-camera-follow');
await page.click('#roomCamSeg button[data-v="free"]'); await page.evaluate(() => { const v = window.__mtw.view; v.yaw = 0.7; v.pitch = 0.3; v.dist = 1000; }); await sim(0.1); await snap('m7-15-camera-free');
await page.click('#roomCamSeg button[data-v="original"]');
// other original room skin (CDN rmWl0010 / rmFl0010) and a wall variant of rmWl0000
await page.selectOption('#roomWall', '0010'); await page.selectOption('#roomFloor', '0010'); await sim(0.2); await snap('m7-16-room-rmWl0010-rmFl0010');
await page.selectOption('#roomWall', '0000'); await page.selectOption('#roomFloor', '0000'); await page.selectOption('#roomVariant', '2'); await sim(0.2); await snap('m7-17-room-rmWl0000-AL02');
await page.selectOption('#roomVariant', '0'); await sim(0.2);
await page.screenshot({ path: `${out}/m7-page-desktop.png` });
report.diag = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#diag dt')].map((d) => [d.textContent, d.nextElementSibling.textContent])));
report.checklist = await page.evaluate(() => [...document.querySelectorAll('#checklist li')].map((l) => `${l.className}: ${l.textContent}`));
report.log = await page.evaluate(() => window.__mtw.director.log.slice(-60));
report.camera = await page.evaluate(() => { const c = window.__mtw.room.camera; return c && { pos: c.position.toArray(), target: c.target.toArray().map((v) => +v.toFixed(2)), up: c.up.toArray().map((v) => +v.toFixed(3)), fovDeg: +(c.fovRad * 180 / Math.PI).toFixed(2), near: c.near, far: c.far }; });
report.lights = await page.evaluate(() => window.__mtw.room.lights);
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300); await sim(0.1);
await page.screenshot({ path: `${out}/m7-page-mobile.png` });
writeFileSync(`${out}/report.json`, JSON.stringify({ report, logs }, null, 1));
console.log(JSON.stringify({ steps: report.steps, clicks: [report.clickFloor, report.clickMii, report.clickShelf, report.clickDoorExit, report.clickDoorEnter], camera: report.camera, logs: logs.filter((l) => /error|warn/i.test(l)).slice(0, 20) }, null, 1));
await browser.close();
