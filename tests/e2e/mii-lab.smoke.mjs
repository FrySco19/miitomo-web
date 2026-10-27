// Smoke test for the M4 Mii Lab: import a real AFL resource, build Miis, capture screenshots.
// Usage: node tests/e2e/mii-lab.smoke.mjs <url> <AFLResHigh_2_3.dat> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [url, res, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = {};
for (const [name, vp] of [['desktop', { width: 1600, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(url);
  await page.setInputFiles('#resFile', res);
  await page.waitForFunction(() => window.__mtw?.state.group, null, { timeout: 60000 });
  await page.evaluate(() => { window.__mtw.view.autoRotate = false; window.__mtw.view.yaw = 0.35; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-random.png` });
  results[name] = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#diag dt')].map((d) => [d.textContent, d.nextElementSibling.textContent])));
  if (name === 'desktop') {
    // Deterministic fixture Mii (Wii U FFLStoreData sample "Jasmine", from FFL.js examples), then AFL expressions.
    await page.fill('#miiData', 'AwAAQKBBOMSghAAA27iHMb5gKyoqQgAAWS1KAGEAcwBtAGkAbgBlAAAAAAAAABw3EhB7ASFuQxwNZMcYAAgegg0AMEGzW4JtAABvAHMAaQBnAG8AbgBhAGwAAAAAAJA6');
    await page.click('#loadDataBtn');
    await page.evaluate(() => { window.__mtw.view.yaw = 0; });
    for (const expr of [0, 1, 25, 49, 56]) {
      await page.evaluate((e) => { window.__mtw.state.expression = e; window.__mtw.rebuild(); }, expr);
      await page.waitForTimeout(300);
      await page.locator('.stage').screenshot({ path: `${out}/stage-expr${expr}.png` });
    }
    await page.evaluate(() => { document.querySelector('#shaderSeg button[data-v="wiiu-ffl"]').click(); });
    await page.waitForTimeout(300);
    await page.locator('.stage').screenshot({ path: `${out}/stage-wiiu-shader.png` });
  }
  results[name + '_logs'] = logs.filter((l) => !l.startsWith('debug')).slice(0, 30);
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
