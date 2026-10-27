// M13 local-launcher import: first run imports the folder one file at a time (never all files in memory at once),
// records the imported sources; when new files appear in the folder, the next boot imports only those.
// Usage: node tests/e2e/m13-update.smoke.mjs <url> <outDir> <listFile used by local-launcher.mjs> <list v1> <list v2>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
const [url, out, listFile, v1, v2] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
copyFileSync(v1, listFile);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const logs = []; page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); }); page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const checks = {}; const fail = [];
const expect = (n, ok, info) => { checks[n] = { ok: !!ok, info }; if (!ok) fail.push(`${n}: ${JSON.stringify(info)}`); };
// request timeline of /local/<file>: overlapping downloads would mean "everything at once"
let reqs = [];
page.on('request', (r) => { if (/\/local\/(?!list\.json)/.test(r.url())) reqs.push({ name: decodeURIComponent(r.url().split('/local/')[1]), start: Date.now(), end: 0 }); });
page.on('requestfinished', (r) => { const x = reqs.find((q) => !q.end && r.url().endsWith(encodeURIComponent(q.name))); if (x) x.end = Date.now(); });
const maxOverlap = () => { let m = 0; for (const a of reqs) m = Math.max(m, reqs.filter((b) => b.start <= a.start && (b.end === 0 || b.end > a.start)).length); return m; };
await page.goto(url);
await page.waitForFunction(() => window.__mtw?.play?.currentScreen === 'create', null, { timeout: 300000 });
const first = reqs.map((r) => r.name);
expect('first run: auto-import from the folder, one file at a time', first.length >= 60 && maxOverlap() === 1, { n: first.length, overlap: maxOverlap() });
expect('without the M13 zips: no expression data yet', !(await page.evaluate(() => window.__mtw.playApi.ready().expr)), null);
await page.click('#play [data-a=next]'); await page.fill('#play .pl-input', 'Kelly'); await page.click('#play [data-a=next]');
await page.selectOption('#play select[data-k=m]', '5'); await page.selectOption('#play select[data-k=d]', '2'); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'personality', null, { timeout: 20000 }); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 120000 });
const src1 = await page.evaluate(() => window.__mtw.playApi.importedSources());
const st1 = await page.evaluate(() => window.__mtw.vfs.stats());
expect('two-tier store: item / room-skin packages are cold (IndexedDB), nothing pending in memory', st1.cold > 30 && st1.pending === 0 && st1.lruBytes < 100e6, st1);
// wardrobe still works with cold packages: equip another top → loaded on demand → model built
await page.evaluate(() => { window.__mtw.testClock.paused = true; });
await page.click('#play .pl-tab[data-tab=menu]'); await page.click('#play .pl-mbtn[data-a=closet]');
await page.waitForSelector('#play .pl-citem');
const pick = await page.evaluate(() => { const b = [...document.querySelectorAll('#play .pl-citem')].find((x) => !x.classList.contains('on')); b?.click(); return b?.dataset.id; });
await page.waitForFunction((id) => window.__mtw.lastRes?.parts.some((p) => p.stem.includes(id)), pick, { timeout: 20000 }).catch(() => {});
const worn = await page.evaluate(() => ({ parts: window.__mtw.lastRes?.parts.map((p) => p.stem), st: window.__mtw.vfs.stats() }));
expect('cold item package loads on demand and is worn', worn.parts?.some((s) => s.includes('bodyTops' + pick)), { pick, worn });
await page.click('#play .pl-close');
// unchanged folder: reload imports nothing
reqs = []; await page.reload();
await page.waitForFunction(() => window.__mtw?.play?.currentScreen === 'room', null, { timeout: 120000 });
expect('reload with the same folder: nothing re-imported', reqs.length === 0 && src1.length === first.length, { reqs: reqs.length, src: src1.length });
// new files appear in the folder (a new CDN batch): only those are imported at the next boot
copyFileSync(v2, listFile);
reqs = []; await page.reload();
await page.waitForFunction(() => window.__mtw?.play?.currentScreen === 'room', null, { timeout: 120000 });
const second = reqs.map((r) => r.name);
expect('new files: only the new wanted ones are imported (effect.ptcl is not a wanted source)', second.length === 2 && second.every((n) => /EmotionExpression|miiStudio/.test(n)), second);
expect('after the update the expression data is available, save kept', await page.evaluate(() => window.__mtw.playApi.ready().expr && window.__mtw.play.save.profile.name === 'Kelly'), null);
// keep rules changed since the import (simulated: keepVersion 1): only the sources REIMPORT lists are read again (the APK)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('miitomo-web'); r.onsuccess = () => { const tx = r.result.transaction('vfs', 'readwrite'); tx.objectStore('vfs').put(1, 'keepVersion'); tx.oncomplete = () => { r.result.close(); res(); }; }; }));
reqs = []; await page.reload();
await page.waitForFunction(() => window.__mtw?.play?.currentScreen === 'room', null, { timeout: 120000 });
const third = reqs.map((r) => r.name);
reqs = []; await page.reload();
await page.waitForFunction(() => window.__mtw?.play?.currentScreen === 'room', null, { timeout: 120000 });
// REIMPORT (vfs.ts): v2/v3 the APK, v5 sound.zip (M17: all scene BGMs) — only those, once
expect('keep rules changed: only the sources REIMPORT lists (APK, sound.zip) are re-read once, then nothing', third.length === 2 && third.some((n) => /\.apk$/.test(n)) && third.includes('sound.zip') && reqs.length === 0, { third, after: reqs.map((r) => r.name) });
const errors = logs.filter((l) => /^(error|pageerror)/.test(l));
expect('zero console errors', errors.length === 0, errors);
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, logs }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail, logs: logs.filter((l) => /error|warn/i.test(l)).slice(0, 10) }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
