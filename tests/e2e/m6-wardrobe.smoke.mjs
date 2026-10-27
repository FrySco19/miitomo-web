// M6/M6.1 smoke test: Mii proportions (body scale from the binary) + original outfit composition,
// accessories (RootType joints), several hat types, variant selection.
// Usage: node tests/e2e/m6-wardrobe.smoke.mjs <url> <outDir> <file1> [file2...]
//   files: APK (or subset), AFLResHigh_2_3.dat, asset_env*.zip, animation zips, CDN clothing + colorlist zips
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
await page.waitForFunction(() => window.__mtw?.slots.original.parts.length || document.querySelector('#miiError:not([hidden])'), null, { timeout: 180000 });
await page.fill('#miiData', FIXTURE); await page.click('#loadDataBtn');
await page.waitForTimeout(500);
const set = async (o) => {
  const r = await page.evaluate(async (o) => {
    const m = window.__mtw;
    m.view.autoRotate = false; m.view.yaw = o.yaw ?? 0; m.view.pitch = 0;
    m.ui.view = 'full'; m.ui.shade = o.shade ?? 'original';
    m.ui.pose = o.pose ?? 'animWaitMale';
    m.ui.dress = o.dress ?? 'outfit'; m.ui.scaleOn = o.scaleOn ?? true;
    m.ui.height = o.height ?? null; m.ui.build = o.build ?? null;
    if (o.male) { m.miiData = m.engine.randomCharInfo(0); }
    if (o.outfit) { for (const k of Object.keys(m.outfit)) delete m.outfit[k]; Object.assign(m.outfit, structuredClone(o.outfit)); }
    m.view.dist = o.dist ?? 720;
    m.rebuild();
    m.applyPose(0);
    const err = document.querySelector('#miiError:not([hidden])')?.textContent ?? null;
    const sl = m.slots[m.ui.shade === 'ab' ? 'original' : m.ui.shade];
    const minY = Math.min(...sl.parts.filter((p) => !p.group.userData.headwear).map((p) => p.minY()));
    const sk = sl.body;
    const acce = sl.parts.filter((p) => p.group.userData.acce).map((p) => { p.group.updateMatrixWorld(true); const v = new p.group.matrixWorld.constructor(); const e = p.group.matrixWorld.elements; return { root: p.group.userData.acce.root, s: +p.group.userData.acce.s.toFixed(3), tf: p.group.userData.acce.tf.toArray().map((x) => +x.toFixed(3)), visible: p.group.visible, rootPos: [e[12], e[13], e[14]].map((x) => +(x / 10).toFixed(3)) }; });
    const head = sk?.jointPosition('Head')?.toArray().map((v) => +v.toFixed(3));
    return { err, acce, minY: +minY.toFixed(3), head, parts: sl.parts.map((p) => p.group.userData.part ?? 'bodyAll0400'), res: m.lastRes ? { removed: m.lastRes.removed, notes: m.lastRes.notes } : null,
      scale: m.lastScale ? { h: m.lastScale.height, b: m.lastScale.build, a: m.lastScale.a.toArray().map((v) => +v.toFixed(4)), B: +m.lastScale.b.x.toFixed(4) } : null };
  }, o);
  await page.waitForTimeout(400);
  return r;
};
const O1 = await page.evaluate(() => window.__mtw.OUTFIT_1);
const report = {};
const shots = [
  ['m6-outfit1-wait-front', { outfit: O1 }],
  ['m6-outfit1-wait-side', { outfit: O1, yaw: 1.2 }],
  ['m6-outfit1-wait-back', { outfit: O1, yaw: Math.PI }],
  ['m6-outfit1-bind-noscale', { outfit: O1, pose: '', scaleOn: false }],
  ['m6-outfit1-bind-scale', { outfit: O1, pose: '' }],
  ['m6-height0-build0', { outfit: O1, height: 0, build: 0 }],
  ['m6-height127-build0', { outfit: O1, height: 127, build: 0 }],
  ['m6-height64-build127', { outfit: O1, height: 64, build: 127 }],
  ['m6-height127-build127', { outfit: O1, height: 127, build: 127 }],
  ['m6-tucked', { outfit: { ...O1, tuck: true } }],
  ['m6-base-only', { outfit: {} }],
  ['m6-all0004-excludes', { outfit: { ...O1, all: { id: '0004', color: 3 } } }],
  ['m6-topslong-skirt', { outfit: { topslong: { id: '0001', color: 2 }, bottomsA: { id: '0002', color: 1 }, shoes: { id: '0004', color: 0 } } }],
  ['m6-ab', { outfit: O1, shade: 'ab' }],
  ['m6-m5-body-scaled', { dress: 'm5' }],
  // M6.1
  ['m61-acce-rose-hand', { outfit: { ...O1, acce: { id: '0003', color: 0 } } }],
  ['m61-acce-rose-hand-side', { outfit: { ...O1, acce: { id: '0003', color: 0 } }, yaw: -1.2 }],
  ['m61-acce-apple-shadow', { outfit: { ...O1, acce: { id: '0000', color: 0 } } }],
  ['m61-acce-apple-shadow-side', { outfit: { ...O1, acce: { id: '0000', color: 0 } }, yaw: 1.4 }],
  ['m61-hat0001', { outfit: { ...O1, headwear: { id: '0001', color: 0 } } }],
  ['m61-hat0001-side', { outfit: { ...O1, headwear: { id: '0001', color: 0 } }, yaw: 1.3 }],
  ['m61-hat0002', { outfit: { ...O1, headwear: { id: '0002', color: 1 } } }],
  ['m61-hat0003', { outfit: { ...O1, headwear: { id: '0003', color: 2 } } }],
  ['m61-hat0003-back', { outfit: { ...O1, headwear: { id: '0003', color: 2 } }, yaw: Math.PI }],
  ['m61-nohat', { outfit: { ...O1, headwear: undefined } }],
  ['m61-wide-bottoms-Wd', { outfit: { ...O1, bottomsA: { id: '0002', color: 2 } } }],
  ['m61-full-categories', { outfit: { headwear: { id: '0002', color: 3 }, tops: { id: '0003', color: 5 }, bottomsA: { id: '0003', color: 4 }, bottomsB: { id: '0001', color: 1 }, shoes: { id: '0004', color: 1 }, acce: { id: '0003', color: 0 }, tuck: true }, height: 100, build: 90, pose: 'animWaitFemale' }],
  ['m61-full-categories-side', { outfit: { headwear: { id: '0002', color: 3 }, tops: { id: '0003', color: 5 }, bottomsA: { id: '0003', color: 4 }, bottomsB: { id: '0001', color: 1 }, shoes: { id: '0004', color: 1 }, acce: { id: '0003', color: 0 }, tuck: true }, height: 100, build: 90, pose: 'animWaitFemale', yaw: -1.0 }],
  ['m61-male-base', { male: true, outfit: {} }],
  ['m61-male-outfit', { male: true, outfit: { ...O1, acce: { id: '0003', color: 0 } }, height: 90, build: 40 }]
];
// animation check: several frames of Wait with the full outfit, no errors and finite matrices
for (const [name, st] of shots) { report[name] = await set(st); await page.locator('.stage').screenshot({ path: `${out}/${name}.png` }); }
report.final = await set({ outfit: { ...O1, acce: { id: '0003', color: 0 } } });
report.animFrames = await page.evaluate(async () => {
  const m = window.__mtw; const out = [];
  for (let i = 0; i < 6; i++) { m.applyPose(0.25); const sl = m.slots.original; if (!sl.body) { out.push({ ok: false, err: document.querySelector('#miiError')?.textContent }); continue; } const ok = sl.parts.every((p) => p.group.visible !== undefined) && Number.isFinite(sl.body.jointPosition('Head').y); out.push({ ok, headY: +sl.body.jointPosition('Head').y.toFixed(3) }); }
  return out;
});
await page.screenshot({ path: `${out}/m6-page-desktop.png` });
const info = await page.evaluate(() => ({
  checklist: [...document.querySelectorAll('#checklist li')].map((l) => `${l.className}: ${l.textContent}`),
  diag: Object.fromEntries([...document.querySelectorAll('#diag dt')].map((d) => [d.textContent, d.nextElementSibling.textContent])),
  catalog: Object.fromEntries([...window.__mtw.catalog()].map(([k, v]) => [k, v.map((i) => i.id)]))
}));
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/m6-page-mobile.png`, fullPage: true });
writeFileSync(`${out}/report.json`, JSON.stringify({ report, info, logs }, null, 1));
console.log(JSON.stringify({ report, info, logs: logs.slice(0, 30) }, null, 1));
await browser.close();
