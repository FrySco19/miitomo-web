// MIInstagram between two REAL accounts — two copies of the desktop app (Electron), real WebRTC (LAN discovery on
// loopback), the real Reboot runtime and MIInstagram app, each account with its own storage. Everything the brief asks:
// A → B and B → A, photo, author and id, reactions and comments both ways, deletion, posts made while the other was
// not in Reboot (or offline), the feed updating on screen, and after restarting both apps.
// No game files are needed (MIInstagram does not draw the 3D room). Photos are small generated JPEGs.
// Run: npm --prefix client/web run build && xvfb-run -a node tests/desktop/miinstagram.e2e.mjs
import { _electron } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = path.join(root, 'desktop', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const out = process.argv[2] ?? path.join(root, 'test-results', 'miinstagram');
fs.mkdirSync(out, { recursive: true });
const fail = []; const expect = (n, ok, info) => { if (!ok) fail.push(n); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' ' + JSON.stringify(info)}`); };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const errors = [];
const assetsDir = tmp('mtw-ig-assets-'), dataA = tmp('mtw-ig-a-'), dataB = tmp('mtw-ig-b-');
const PA = 48011, PB = 48021;
async function launch(tag, userData, port, peer) {
  const app = await _electron.launch({ executablePath: exe, args: [path.join(root, 'desktop', 'main.cjs'), '--no-sandbox'], env: { ...process.env, MTW_USER_DATA: userData, MTW_ASSETS: assetsDir, MTW_LAN_PORT: String(port), MTW_LAN_TARGETS: JSON.stringify([{ host: '127.0.0.1', port: peer }]), MTW_SIGNAL: '' } });
  app.on('window', (w) => w.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`)));
  return app;
}
const gameOf = (app) => app.waitForEvent('window', { predicate: (p) => p.url().includes('/index.html'), timeout: 20000 });
async function enter(app, user, pw, register) {
  const w = await app.firstWindow(); await w.waitForSelector('#f');
  if (register) { await w.click('[data-tab=register]'); await w.fill('input[name=p2]', pw); }
  await w.fill('input[name=u]', user); await w.fill('input[name=p]', pw);
  const g = gameOf(app); await w.click('.go'); return g;
}
/** Polls fn(arg) in the page until it is true (fn may be async: waitForFunction would take its Promise as "true"). */
async function until(g, fn, arg, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) { if (await g.evaluate(fn, arg).catch(() => false)) return true; if (Date.now() > end) throw new Error('timeout: ' + String(fn).slice(0, 80)); await new Promise((r) => setTimeout(r, 250)); }
}
const reboot = async (g) => { await g.evaluate(() => window.mtwDesktop.game.open('reboot')); await g.waitForURL(/reboot=1/); await until(g, () => !!window.__mtw?.reboot?.feed); };
const launcher = async (g) => { await g.evaluate(() => window.mtwDesktop.game.open('launcher')); await g.waitForSelector('.ln-card'); };
const feed = (g) => g.evaluate(async () => (await window.__mtw.reboot.feed.feed({ limit: 30 })).value.items);
/** A small real JPEG made in the page (MIInstagram stores photos as data URLs). */
const photo = (g, color) => g.evaluate((color) => { const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 96, 96); x.fillStyle = '#fff'; x.fillText('MTW', 30, 50); return c.toDataURL('image/jpeg', 0.8); }, color);
const post = async (g, caption, color) => g.evaluate(async ({ caption, url }) => (await window.__mtw.reboot.feed.createPhotoPost('host', { photo: url, caption, source: 'miifoto' })).value, { caption, url: await photo(g, color) });
/** The real MIInstagram app UI (the component the MiiPhone shows; the phone itself needs the 3D room → game files). */
const openApp = (g) => g.evaluate(() => { const el = document.createElement('div'); el.id = 'igTest'; el.style.cssText = 'position:fixed;right:0;top:0;width:380px;height:100vh;overflow:auto;background:#fff;z-index:99'; document.body.append(el); window.__igUnmount = window.__mtw.reboot.miinstagram.mount(el); });
const onScreen = (g, text) => g.evaluate((t) => [...document.querySelectorAll('.ig-post, .ig-card, [data-post]')].some((e) => e.textContent.includes(t)), text);

let A = await launch('A', dataA, PA, PB), B = await launch('B', dataB, PB, PA);
try {
  let gA = await enter(A, 'Anna', 'password1', true), gB = await enter(B, 'Bruno', 'password2', true);
  await gA.waitForSelector('.ln-card'); await gB.waitForSelector('.ln-card');
  for (const [g, n] of [[gA, 'Anna'], [gB, 'Bruno']]) await g.evaluate(async (n) => { const p = window.__mtw.play; p.save.profile.miiData = btoa(String.fromCharCode(...Array.from({ length: 96 }, (_, i) => (i * 5 + n.length) & 255))); p.save.profile.name = n; await p.persist(); }, n);
  // friends over the LAN (UI)
  await until(gA, () => window.__mtw.p2p.state?.nearby.some((n) => n.name === 'Bruno'));
  await gA.click('[data-a=friends]'); await gA.waitForSelector('.fp [data-add]'); await gA.click('.fp [data-add]');
  await until(gB, () => window.__mtw.p2p.state?.incoming.length === 1);
  await gB.click('[data-a=friends]'); await gB.waitForSelector('.fp [data-acc]'); await gB.click('.fp [data-acc]');
  await until(gA, () => window.__mtw.p2p.state?.friends[0]?.online); await until(gB, () => window.__mtw.p2p.state?.friends[0]?.online);
  const idA = await gA.evaluate(() => window.__mtw.p2p.state.me.id), idB = await gB.evaluate(() => window.__mtw.p2p.state.me.id);

  // ---- 1. A posts while B is NOT in Reboot (launcher); B opens Reboot later → the post is there, with its photo
  await reboot(gA);
  const pA1 = await post(gA, 'Prima foto di Anna', '#e2552b');
  await gA.waitForTimeout(1500);
  await reboot(gB);
  let ok1 = true; try { await until(gB, (t) => window.__mtw.reboot.feed.feed({ limit: 30 }).then((r) => r.value.items.some((p) => p.caption === t)), 'Prima foto di Anna', 15000); } catch { ok1 = false; }
  const got1 = (await feed(gB)).find((p) => p.caption === 'Prima foto di Anna');
  expect('A posts while B is in the launcher; B opens Reboot → A\'s post is there', ok1, (await feed(gB)).map((p) => p.caption));
  expect('author and id: the post is A\'s (author = A\'s account id), id = A\'s id + A\'s post id', got1 && got1.authorId === idA && got1.id === `${idA}:${pA1?.id}`, got1 && { a: got1.authorId, id: got1.id });
  const ph = got1 ? await gB.evaluate((id) => window.__mtw.reboot.feed.photo(id), got1.photoId) : null;
  expect('photo: B has the photo itself (a JPEG data URL), not a placeholder', typeof ph === 'string' && ph.startsWith('data:image/jpeg;base64,') && ph.length > 500, ph?.slice(0, 40));

  // ---- 2. B posts, A (MIInstagram open on screen) sees it appear without reopening
  await openApp(gA); await gA.waitForTimeout(500);
  await post(gB, 'Bruno risponde', '#2b7de9');
  let ok2 = true; try { await until(gA, () => document.querySelector('#igTest')?.textContent.includes('Bruno risponde') && !!document.querySelector('#igTest img[src^="data:image/jpeg"]'), null, 10000); } catch { ok2 = false; }
  expect('B posts → it appears on A\'s open MIInstagram screen by itself, with the photo (no reopening)', ok2, ok2 ? null : await gA.evaluate(() => document.querySelector('#igTest')?.textContent.slice(0, 300)));
  await gA.screenshot({ path: `${out}/ig-01-feed-A.png` });

  // ---- 3. reactions + comments both ways
  const bOnA = (await feed(gB)).find((p) => p.caption === 'Prima foto di Anna');
  await gB.evaluate((id) => window.__mtw.reboot.feed.react(id, 'host', 'wow'), bOnA.id);
  await gB.evaluate((id) => window.__mtw.reboot.feed.comment(id, 'host', { text: 'Bellissima!' }), bOnA.id);
  let ok3 = true; try { await until(gA, ({ id, b }) => window.__mtw.reboot.feed.get(id).then((r) => r.ok && r.value.reactions[b] === 'wow' && r.value.comments.some((c) => c.authorId === b && c.text === 'Bellissima!')), { id: pA1.id, b: idB }, 10000); } catch { ok3 = false; }
  expect('B reacts + comments on A\'s post → A\'s own post has them, by B', ok3, ok3 ? null : await gA.evaluate((id) => window.__mtw.reboot.feed.get(id), pA1.id));
  let ok3b = true; try { await until(gB, (id) => window.__mtw.reboot.feed.get(id).then((r) => r.ok && r.value.reactions.host === 'wow' && r.value.comments.filter((c) => c.text === 'Bellissima!').length === 1), bOnA.id, 10000); } catch { ok3b = false; }
  expect('… and B\'s copy shows them as B\'s own (once, not doubled by the update)', ok3b, ok3b ? null : await gB.evaluate((id) => window.__mtw.reboot.feed.get(id), bOnA.id));
  const aOnB = (await feed(gA)).find((p) => p.caption === 'Bruno risponde');
  await gA.evaluate((id) => window.__mtw.reboot.feed.react(id, 'host', 'like'), aOnB.id);
  await gA.evaluate((id) => window.__mtw.reboot.feed.comment(id, 'host', { text: 'Grazie Bruno' }), aOnB.id);
  const pB1 = (await feed(gB)).find((p) => p.caption === 'Bruno risponde');
  let ok4 = true; try { await until(gB, ({ id, a }) => window.__mtw.reboot.feed.get(id).then((r) => r.ok && r.value.reactions[a] === 'like' && r.value.comments.some((c) => c.authorId === a && c.text === 'Grazie Bruno')), { id: pB1.id, a: idA }, 10000); } catch { ok4 = false; }
  expect('A reacts + comments on B\'s post → on B\'s post, by A (the other direction)', ok4);

  // ---- 4. a comment while the author is NOT in Reboot is delivered when they come back
  await launcher(gA);
  await gB.evaluate((id) => window.__mtw.reboot.feed.comment(id, 'host', { text: 'Ci sei?' }), bOnA.id);
  await gB.waitForTimeout(1500);
  await reboot(gA);
  let ok5 = true; try { await until(gA, (id) => window.__mtw.reboot.feed.get(id).then((r) => r.ok && r.value.comments.some((c) => c.text === 'Ci sei?')), pA1.id, 15000); } catch { ok5 = false; }
  expect('B comments while A is in the launcher → A gets it when A opens Reboot again', ok5);

  // ---- 5. deletion (live, and while the other is away)
  await gA.evaluate((id) => window.__mtw.reboot.feed.deletePost(id, 'host'), pA1.id);
  let ok6 = true; try { await until(gB, (id) => window.__mtw.reboot.feed.get(id).then((r) => !r.ok), bOnA.id, 10000); } catch { ok6 = false; }
  expect('A deletes the post → gone from B\'s feed', ok6);
  const pA2 = await post(gA, 'Anna, seconda foto', '#1aa260');
  await until(gB, (t) => window.__mtw.reboot.feed.feed({ limit: 30 }).then((r) => r.value.items.some((p) => p.caption === t)), 'Anna, seconda foto', 10000);
  await launcher(gB);
  await gA.evaluate((id) => window.__mtw.reboot.feed.deletePost(id, 'host'), pA2.id);
  await gA.waitForTimeout(1000);
  await reboot(gB);
  let ok7 = true; try { await until(gB, (t) => window.__mtw.reboot.feed.feed({ limit: 30 }).then((r) => !r.value.items.some((p) => p.caption === t)), 'Anna, seconda foto', 15000); } catch { ok7 = false; }
  expect('A deletes a post while B is in the launcher → gone at B\'s next Reboot', ok7);

  // ---- 6. both apps restart: the feeds are kept, and it keeps working
  await A.close(); await B.close();
  A = await launch('A', dataA, PA, PB); B = await launch('B', dataB, PB, PA);
  gA = await enter(A, 'anna', 'password1', false); gB = await enter(B, 'bruno', 'password2', false);
  await gA.waitForSelector('.ln-card'); await gB.waitForSelector('.ln-card');
  await reboot(gA); await reboot(gB);
  const keptB = (await feed(gB)).map((p) => p.caption);
  expect('after restarting both apps: B\'s feed still has B\'s and A\'s posts (stored per account)', keptB.includes('Bruno risponde') && !keptB.includes('Prima foto di Anna'), keptB);
  await until(gA, () => window.__mtw.p2p.state?.friends[0]?.online, null, 30000);
  await post(gA, 'Dopo il riavvio', '#a020f0');
  let ok8 = true; try { await until(gB, (t) => window.__mtw.reboot.feed.feed({ limit: 30 }).then((r) => r.value.items.some((p) => p.caption === t)), 'Dopo il riavvio', 15000); } catch { ok8 = false; }
  expect('after the restart a new post still reaches the friend', ok8);

  // ---- 7. accounts stay apart: what each one stores, and nobody acts as somebody else
  const fa = await feed(gA), fb = await feed(gB);
  expect('A\'s own posts are "host" at A and A\'s id at B; B\'s are the other way round', fa.every((p) => p.authorId === 'host' || p.authorId === idB) && fb.every((p) => p.authorId === 'host' || p.authorId === idA) && fa.some((p) => p.authorId === idB) && fb.some((p) => p.authorId === idA));
  // B forges a message that claims to be about a post of somebody else, and a reaction "by A"
  await gB.evaluate((idA) => window.__mtw.p2p.send('feed', { op: 'posts', v: 2, items: [{ post: { id: 'fake-1', authorId: idA, kind: 'answer', createdAt: new Date().toISOString(), question: { key: 'x' }, answer: 'Firmato Anna (falso)', reactions: {}, comments: [] }, photo: null }] }), idA);
  await gA.waitForTimeout(1500);
  const forged = (await feed(gA)).find((p) => p.answer === 'Firmato Anna (falso)');
  expect('a post claiming to be by A, sent by B, is stored as B\'s (the sender\'s authenticated id) or refused', !forged || forged.authorId === idB, forged);
} catch (e) {
  fail.push('crash: ' + e.message); console.log('CRASH', e);
} finally { await A.close().catch(() => {}); await B.close().catch(() => {}); }
const real = errors.filter((e) => !/WebGL|GPU/i.test(e));
expect('no page errors', !real.length, real);
console.log(fail.length ? `${fail.length} FAILED` : 'ALL PASS');
process.exit(fail.length ? 1 : 0);
