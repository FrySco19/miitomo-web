// M5 smoke test: original body (bodyAll0400) + FFL head, original APK LUT shader vs FFL.js approximation.
// Usage: node tests/e2e/mii-full.smoke.mjs <url> <outDir> <file1> [file2...]
//   files: APK (or APK-subset zip), AFLResHigh_2_3.dat/zip, asset_env*.zip, animation zips
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FIXTURE = 'AwAAQKBBOMSghAAA27iHMb5gKyoqQgAAWS1KAGEAcwBtAGkAbgBlAAAAAAAAABw3EhB7ASFuQxwNZMcYAAgegg0AMEGzW4JtAABvAHMAaQBnAG8AbgBhAGwAAAAAAJA6';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.setInputFiles('#resFile', files);
await page.waitForFunction(() => window.__mtw?.slots.original.body || document.querySelector('#miiError:not([hidden])'), null, { timeout: 120000 });
const err = await page.evaluate(() => document.querySelector('#miiError:not([hidden])')?.textContent);
if (err) { console.log('UI ERROR', err); }
const setState = async (o) => {
  await page.evaluate(async (o) => {
    const m = window.__mtw;
    m.view.autoRotate = false; m.view.yaw = o.yaw ?? 0; m.view.pitch = 0;
    if (o.view) m.ui.view = o.view;
    if (o.shade) m.ui.shade = o.shade;
    if ('pose' in o) m.ui.pose = o.pose;
    if (o.dist) m.view.dist = o.dist; else m.view.dist = m.ui.view === 'full' ? 1000 : 520;
    m.rebuild();
  }, o);
  await page.waitForTimeout(500);
};
await page.fill('#miiData', FIXTURE); await page.click('#loadDataBtn');
const shots = [
  ['full-original-bind', { view: 'full', shade: 'original', pose: '' }],
  ['full-original-waitmale', { view: 'full', shade: 'original', pose: 'animWaitMale' }],
  ['full-original-waitmale-side', { view: 'full', shade: 'original', pose: 'animWaitMale', yaw: 1.2 }],
  ['full-original-waitfemale', { view: 'full', shade: 'original', pose: 'animWaitFemale' }],
  ['full-approx-waitmale', { view: 'full', shade: 'approx', pose: 'animWaitMale' }],
  ['full-ab-waitmale', { view: 'full', shade: 'ab', pose: 'animWaitMale' }],
  ['head-ab', { view: 'head', shade: 'ab', pose: '' }]
];
for (const [name, st] of shots) { await setState(st); await page.locator('.stage').screenshot({ path: `${out}/${name}.png` }); }
await page.evaluate(() => { document.querySelector('#showRef').click(); });
await setState({ view: 'full', shade: 'original', pose: 'animWaitMale' });
await page.screenshot({ path: `${out}/page-desktop-with-reference.png` });
const info = await page.evaluate(() => ({
  checklist: [...document.querySelectorAll('#checklist li')].map((l) => `${l.className}: ${l.textContent}`),
  diag: Object.fromEntries([...document.querySelectorAll('#diag dt')].map((d) => [d.textContent, d.nextElementSibling.textContent])),
  programs: window.__mtw.renderer.info.programs?.length,
  anchor: (() => { const b = window.__mtw.slots.original.body; return b ? { head: b.jointPosition('Head')?.toArray().map((v) => +v.toFixed(3)), zHead: b.jointPosition('z_Head')?.toArray().map((v) => +v.toFixed(3)) } : null; })()
}));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/page-mobile.png` });
writeFileSync(`${out}/report.json`, JSON.stringify({ info, logs }, null, 1));
console.log(JSON.stringify({ info, logs: logs.slice(0, 40) }, null, 1));
await browser.close();
