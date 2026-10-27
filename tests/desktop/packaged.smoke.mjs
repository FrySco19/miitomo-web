// Packaged desktop app smoke (the folder electron-builder makes): the bundled client and the login load from the
// app's resources, an account can be created, the launcher appears. Run: xvfb-run -a node tests/desktop/packaged.smoke.mjs <path to the app binary>
import { _electron } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const exe = process.argv[2];
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'mtw-pk-'));
const app = await _electron.launch({ executablePath: exe, args: ['--no-sandbox'], env: { ...process.env, MTW_USER_DATA: ud, MTW_ASSETS: ud } });
let ok = true;
try {
  const w = await app.firstWindow(); await w.waitForSelector('#f', { timeout: 20000 });
  await w.click('[data-tab=register]'); await w.fill('input[name=u]', 'Pack'); await w.fill('input[name=p]', 'password1'); await w.fill('input[name=p2]', 'password1');
  const g = app.waitForEvent('window', { predicate: (p) => p.url().includes('/index.html'), timeout: 20000 });
  await w.click('.go');
  const game = await g; await game.waitForSelector('.ln-card', { timeout: 20000 });
  const p2p = app.windows().some((x) => x.url().includes('p2p.html'));
  console.log(`PASS packaged: login → launcher from the app resources; P2P page ${p2p ? 'running' : 'MISSING'}`); ok = p2p;
} catch (e) { ok = false; console.log('FAIL packaged', e.message); }
await app.close();
process.exit(ok ? 0 : 1);
