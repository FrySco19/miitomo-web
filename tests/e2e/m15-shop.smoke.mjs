// M15 shop (catalogue only, economy disabled): shop top with original texts/banners → shop venue (original interior)
// → categories and weekly arrivals → try-on (preview) → leave restores the outfit. No prices / coins anywhere.
// Usage: node tests/e2e/m15-shop.smoke.mjs <url> <outDir> <file1> [file2...]
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
const ev = (f, a) => page.evaluate(f, a);
await page.goto(url);
await page.waitForFunction(() => window.__mtw?.play?.currentScreen === 'setup', null, { timeout: 60000 });
await page.setInputFiles('#play input[type=file]', files);
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'create', null, { timeout: 300000 });
await page.click('#play [data-a=next]'); await page.fill('#play .pl-input', 'Kelly'); await page.click('#play [data-a=next]');
await page.selectOption('#play select[data-k=m]', '5'); await page.selectOption('#play select[data-k=d]', '2'); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'personality', null, { timeout: 20000 }); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 120000 });
await ev(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
await sim(16); await ev(() => window.__mtw.roomUi.close(true));
const before = await ev(() => JSON.stringify(window.__mtw.outfit));
expect('Negozio tab enabled', !(await ev(() => document.querySelector('#play .pl-tab[data-tab=shop]').disabled)), null);
await page.click('#play .pl-tab[data-tab=shop]');
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'shopTop', null, { timeout: 10000 });
const top = await ev(() => ({ title: document.querySelector('.pl-shop-head h2').textContent, entries: [...document.querySelectorAll('.pl-shop-entry')].map((e) => e.textContent.trim()), banners: document.querySelectorAll('.pl-shop-top img').length, note: document.querySelector('.pl-shop-note').textContent }));
await page.screenshot({ path: `${out}/m15-01-top.png` });
expect('shop top: original title / entries, original banners, server-only note', top.title === 'Negozio Miitomo' && top.entries.some((t) => /Nuovi articoli/.test(t)) && top.banners >= 2 && /server/.test(top.note), top);
await page.click('[data-a=arrivals]');
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'shop', null, { timeout: 30000 });
await sim(0.5);
const arr = await ev(() => ({ venue: window.__mtw.venue, dates: [...document.querySelectorAll('[data-date]')].map((b) => b.textContent), items: [...document.querySelectorAll('.pl-shop-grid .pl-citem')].map((b) => b.dataset.cat + b.dataset.id), prices: [...document.querySelectorAll('.pl-price')].map((p) => p.textContent) }));
await page.screenshot({ path: `${out}/m15-02-arrivals.png` });
expect('shop venue with the original interior', arr.venue === 'shop', arr.venue);
expect('weekly arrivals from the dated zips (05/04, 01/03 2018)', arr.dates.some((d) => /\b0?5\/0?4\b/.test(d)) && arr.dates.some((d) => /\b0?1\/0?3\b/.test(d)) && arr.items.some((i) => /0755/.test(i)), arr);
expect('no invented prices: every price is "—"', arr.prices.length > 0 && arr.prices.every((p) => p === '—'), arr.prices.slice(0, 3));
// try on
await page.click('.pl-shop-grid .pl-citem[data-id="0755"]');
await page.waitForFunction(() => window.__mtw.lastRes?.parts.some((p) => p.stem.includes('bodyTops0755')), null, { timeout: 30000 });
await sim(0.3); await page.screenshot({ path: `${out}/m15-03-tryon.png` });
expect('try-on dresses the Mii in the shop', true, null);
// category view
await page.click('.pl-ctab[data-cat=headwear]'); await page.waitForTimeout(500);
const cat = await ev(() => [...document.querySelectorAll('.pl-shop-grid .pl-citem')].length);
expect('category tab lists items with original names', cat > 0 && await ev(() => [...document.querySelectorAll('.pl-shop-grid .pl-cname')].some((n) => !n.classList.contains('raw'))), cat);
await page.screenshot({ path: `${out}/m15-04-category.png` });
// leave
await page.click('.pl-shop-head [data-a=close]');
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'room', null, { timeout: 10000 });
await sim(0.3);
const after = await ev(() => ({ outfit: JSON.stringify(window.__mtw.outfit), saved: JSON.stringify(window.__mtw.play.save.outfit), venue: window.__mtw.venue, balloon: window.__mtw.roomUi.snapshot()?.label }));
expect('leaving restores the outfit (try-on only), back in the room, original goodbye line', after.outfit === before && after.venue === 'room' && after.balloon === 'text00', after);
const save = await ev(() => JSON.parse(window.__mtw.play.exportJson()));
expect('save has no coins / purchases', save.inventory.coins === 0 && save.inventory.items.length === 0, save.inventory);
const errors = logs.filter((l) => /^(error|pageerror)/.test(l));
expect('zero console errors', errors.length === 0, errors);
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, logs }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
