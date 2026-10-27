// Desktop app E2E (Electron, real app, no game files needed): accounts, launcher, Classic / Reboot choice, and two
// instances becoming peer-to-peer friends — on the LAN (UDP discovery + friend request) and over invite codes.
// Run (Linux CI / cloud): npm --prefix client/web run build && xvfb-run -a node tests/desktop/desktop.e2e.mjs
// The two instances use separate data folders and loopback LAN ports (MTW_LAN_PORT / MTW_LAN_TARGETS).
import { _electron } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = path.join(root, 'desktop', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const out = process.argv[2] ?? path.join(root, 'test-results', 'desktop');
fs.mkdirSync(out, { recursive: true });
const fail = []; const expect = (n, ok, info) => { if (!ok) fail.push(n); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' ' + JSON.stringify(info)}`); };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const assetsDir = tmp('mtw-assets-');           // no game files: the launcher must say so
const errors = [];

async function launch(tag, userData, port, peerPort) {
  const app = await _electron.launch({ executablePath: exe, args: [path.join(root, 'desktop', 'main.cjs'), '--no-sandbox'], env: { ...process.env, MTW_USER_DATA: userData, MTW_ASSETS: assetsDir, MTW_LAN_PORT: String(port), MTW_LAN_TARGETS: JSON.stringify([{ host: '127.0.0.1', port: peerPort }]) } });
  app.on('window', (w) => w.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`)));
  return app;
}
const gameOf = (app) => app.waitForEvent('window', { predicate: (p) => p.url().includes('/index.html'), timeout: 20000 });
async function signUp(app, user, pw) {
  const w = await app.firstWindow(); await w.waitForSelector('#f');
  await w.click('[data-tab=register]'); await w.fill('input[name=u]', user); await w.fill('input[name=p]', pw); await w.fill('input[name=p2]', pw);
  const g = gameOf(app); await w.click('.go'); return g;
}
/** A Mii in the save (the P2P profile needs one): what the Mii creation screen writes. */
async function seedMii(g, name) {
  await g.waitForFunction(() => !!window.__mtw?.play);
  await g.evaluate(async (name) => { const p = window.__mtw.play; p.save.profile.miiData = btoa(String.fromCharCode(...Array.from({ length: 96 }, (_, i) => (i * 7) & 255))); p.save.profile.name = name; p.save.profile.personality = [3, 3, 3, 3, 3]; p.save.profile.greetings.goIn = `Ciao da ${name}!`; await p.persist(); }, name);
}
const st = (g) => g.evaluate(() => window.__mtw.p2p.state);

const A = await launch('A', tmp('mtw-a-'), 47811, 47812);
const B = await launch('B', tmp('mtw-b-'), 47812, 47811);
try {
  // ---- accounts + launcher
  const shellA = await A.firstWindow(); await shellA.waitForSelector('#f');
  await shellA.click('[data-tab=register]'); await shellA.fill('input[name=u]', 'Alice'); await shellA.fill('input[name=p]', 'pw1'); await shellA.fill('input[name=p2]', 'pw1'); await shellA.click('.go');
  expect('register: a short password is refused with a message', /6/.test(await shellA.textContent('.msg')));
  await shellA.fill('input[name=p]', 'password1'); await shellA.fill('input[name=p2]', 'password1');
  let gA = gameOf(A); await shellA.click('.go'); gA = await gA;
  await gA.waitForSelector('.ln-card.classic');
  await gA.waitForFunction(() => /MTW-/.test(document.querySelector('.ln-acct')?.textContent ?? ''));
  const acct = await gA.textContent('.ln-acct');
  expect('launcher: account name and friend code shown; Classic and Reboot offered', /Alice/.test(acct) && /MTW-[0-9A-F]{4}-/.test(acct) && (await gA.locator('.ln-card').count()) === 2, acct);
  await gA.waitForFunction(() => /not found|non trovo/i.test(document.querySelector('.ln-foot')?.textContent ?? ''));
  expect('launcher: no game files → says so and offers to choose the folder', (await gA.locator('[data-a=folder]').count()) === 1);
  expect('launcher: Reboot is not loaded under the launcher', (await gA.evaluate(() => ({ r: window.__mtw.REBOOT_ON, l: window.__mtw.LAUNCHER }))).r === false);
  await gA.screenshot({ path: `${out}/desktop-01-launcher.png` });
  let gB = await signUp(B, 'Bob', 'segreto99');
  await gB.waitForSelector('.ln-card');
  await seedMii(gA, 'Alice'); await seedMii(gB, 'Bob');

  // ---- LAN: discovery, request, accept
  await gA.waitForFunction(() => window.__mtw.p2p.state?.nearby.some((n) => n.name === 'Bob'), null, { timeout: 15000 });
  expect('LAN: Bob appears nearby on Alice\'s side (UDP discovery, no server)', true);
  await gA.click('[data-a=friends]'); await gA.waitForSelector('.fp [data-add]');
  await gA.screenshot({ path: `${out}/desktop-02-friends-nearby.png` });
  await gA.click('.fp [data-add]');
  await gB.waitForFunction(() => window.__mtw.p2p.state?.incoming.some((r) => r.name === 'Alice'), null, { timeout: 20000 });
  expect('LAN: friend request reaches Bob (WebRTC + signed handshake)', true);
  await gB.click('[data-a=friends]'); await gB.waitForSelector('.fp [data-acc]'); await gB.click('.fp [data-acc]');
  await gA.waitForFunction(() => window.__mtw.p2p.state?.friends.some((f) => f.name === 'Bob' && f.online), null, { timeout: 15000 });
  await gB.waitForFunction(() => window.__mtw.p2p.state?.friends.some((f) => f.name === 'Alice' && f.online), null, { timeout: 15000 });
  expect('LAN: friends on both sides, online', true);
  await gA.screenshot({ path: `${out}/desktop-03-friends.png` });
  const asGame = await gA.evaluate(async () => (await window.__mtw.play.social.list()).filter((f) => f.source === 'p2p').map((f) => ({ id: f.id, name: f.profile.name, greet: f.profile.greetings.goIn, mii: f.profile.miiData.length })));
  expect('game friends: Bob is a friend in the game with HIS Mii, name and greeting (sanitized)', asGame.length === 1 && asGame[0].name === 'Bob' && asGame[0].greet === 'Ciao da Bob!' && asGame[0].mii > 20 && /^p2p-[0-9a-f]{16}$/.test(asGame[0].id), asGame);
  // app data between friends
  const got = gB.evaluate(() => new Promise((res) => { const un = window.__mtw.p2p.on('test', (from, data) => { un(); res({ from, data }); }); setTimeout(() => res(null), 8000); }));
  const sent = await gA.evaluate(() => window.__mtw.p2p.send('test', { hello: 'Bob', big: 'x'.repeat(60000) }));
  const rcv = await got;
  expect('data channel: a 60 KB message reaches the friend whole (split in parts), with the sender\'s id', sent.ok && sent.value === 1 && rcv?.data?.hello === 'Bob' && rcv.data.big.length === 60000 && rcv.from === (await st(gA)).me.id, { sent, from: rcv?.from });

  // ---- unfriend, then invite codes (the internet path, no server)
  const bobId = (await st(gA)).friends[0].id;
  await gA.evaluate((id) => window.__mtw.p2p.request('unfriend', { id }), bobId);
  await gB.waitForFunction(() => window.__mtw.p2p.state?.friends.length === 0, null, { timeout: 10000 });
  expect('unfriend: removed on both sides', (await st(gA)).friends.length === 0);
  const inv = await gA.evaluate(() => window.__mtw.p2p.request('invite.create', {}));
  expect('invite code created (compressed WebRTC offer)', inv.ok && /^MTWI1\./.test(inv.value) && inv.value.length < 4000, { len: inv.value?.length });
  const bad = await gB.evaluate((c) => window.__mtw.p2p.request('invite.complete', { code: c }), inv.value);
  expect('wrong kind of code refused (KIND)', !bad.ok && bad.code === 'KIND', bad);
  const rep = await gB.evaluate((c) => window.__mtw.p2p.request('invite.accept', { code: c }), inv.value);
  expect('reply code made by Bob', rep.ok && /^MTWR1\./.test(rep.value), rep);
  const done = await gA.evaluate((c) => window.__mtw.p2p.request('invite.complete', { code: c }), rep.value);
  await gA.waitForFunction(() => window.__mtw.p2p.state?.friends.some((f) => f.name === 'Bob' && f.online && f.via === 'invite'), null, { timeout: 20000 });
  await gB.waitForFunction(() => window.__mtw.p2p.state?.friends.some((f) => f.name === 'Alice' && f.online), null, { timeout: 20000 });
  expect('invite codes: friends again, connected without LAN signaling', done.ok);
  const self = await gA.evaluate((c) => window.__mtw.p2p.request('invite.accept', { code: c }), inv.value);
  expect('own invite code refused (SELF)', !self.ok && self.code === 'SELF', self);

  // ---- choosing a mode; the P2P connection survives the page change (hidden engine page)
  await gA.click('[data-a=closeFriends]');
  await gA.click('[data-go=classic]');
  await gA.waitForURL(/reboot=0/);
  await gA.waitForFunction(() => window.__mtw?.play && !document.querySelector('.ln'));
  expect('Classic chosen: game page in Classic, no launcher, no Reboot', (await gA.evaluate(() => ({ r: window.__mtw.REBOOT_ON }))).r === false);
  await gA.waitForFunction(() => window.__mtw.p2p.state?.friends.some((f) => f.online), null, { timeout: 8000 });
  expect('P2P friend still online after the page changed (engine in its own page)', true);
  await gA.evaluate(() => window.mtwDesktop.game.open('reboot'));
  await gA.waitForURL(/reboot=1/);
  await gA.waitForFunction(() => window.__mtw?.REBOOT_ON === true);
  expect('Reboot chosen: Reboot is on', true);
  // MIInstagram between the two real players (both in Reboot)
  await gB.evaluate(() => window.mtwDesktop.game.open('reboot'));
  await gB.waitForURL(/reboot=1/);
  await gB.waitForFunction(() => window.__mtw?.reboot?.feed);
  await gA.waitForFunction(() => window.__mtw?.reboot?.feed);
  await gA.waitForFunction(() => window.__mtw.p2p.state?.friends.some((f) => f.online), null, { timeout: 10000 });
  await gA.evaluate(() => window.__mtw.reboot.feed.createAnswerPost('host', { question: { key: 'feed.tagline' }, answer: 'Ciao Bob, dal P2P!' }));
  await gB.waitForFunction(() => window.__mtw.reboot.feed.feed({ limit: 30 }).then((r) => r.value.items.some((p) => p.answer === 'Ciao Bob, dal P2P!' && p.authorId.startsWith('p2p-'))), null, { timeout: 10000, polling: 300 });
  expect('Reboot MIInstagram: Alice\'s post reaches Bob over P2P, as a post by Alice', true);
  await gA.evaluate(() => window.mtwDesktop.game.open('launcher'));
  await gA.waitForSelector('.ln-card');
  expect('back to the launcher (menu Ctrl+L does the same)', true);

  // ---- logout / login, persistence
  const shell2 = A.waitForEvent('window', { predicate: (p) => p.url().includes('login.html'), timeout: 10000 });
  await gA.click('[data-a=logout]');
  const sh = await shell2; await sh.waitForSelector('#f');
  await sh.fill('input[name=u]', 'alice'); await sh.fill('input[name=p]', 'wrong-pass'); await sh.click('.go');
  await sh.waitForFunction(() => document.querySelector('.msg')?.textContent.length > 0);
  expect('login: wrong password refused', /wrong|sbagliat/i.test(await sh.textContent('.msg')));
  await sh.fill('input[name=p]', 'password1');
  const g2 = gameOf(A); await sh.click('.go'); gA = await g2;
  await gA.waitForSelector('.ln-card');
  await gA.waitForFunction(() => window.__mtw.p2p.state?.friends.length === 1, null, { timeout: 10000 });
  expect('login again: same account, friends kept (pinned key), Mii kept', (await gA.evaluate(async () => (await window.__mtw.play.social.list()).some((f) => f.source === 'p2p'))));
} catch (e) {
  fail.push('crash: ' + e.message); console.log('CRASH', e);
  // the P2P engines' own logs (hidden pages), to see where a connection stopped
  for (const [tag, app] of [['A', A], ['B', B]]) for (const w of app.windows()) if (w.url().includes('p2p.html')) console.log(`--- ${tag} p2p log\n` + (await w.evaluate(() => (window.__p2p?.log ?? []).join('\n')).catch(() => '?')));
}
finally { await A.close().catch(() => {}); await B.close().catch(() => {}); }
const real = errors.filter((e) => !/WebGL|GPU/i.test(e));
expect('no page errors', !real.length, real);
console.log(fail.length ? `${fail.length} FAILED` : `ALL ${''}PASS`);
process.exit(fail.length ? 1 : 0);
