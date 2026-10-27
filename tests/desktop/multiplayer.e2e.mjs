// SHARED ROOM + FRIENDS OVER THE INTERNET — two real copies of the desktop app (Electron), two accounts, real WebRTC,
// the real presence / signaling server (server/signal) and a real TURN server (node-turn, coturn-style short-lived
// credentials checked against the signal server's secret). The LAN discovery is OFF here (the internet path alone;
// the LAN path is tests/desktop/desktop.e2e.mjs + lan.test.cjs).
// No game files: the 3D room is not drawn, so the Mii states / actions are sent by the page the way the room adapter
// sends them (p2p.castAv / castAct). What runs for real: accounts, engines, server, WebRTC (direct and TURN), session
// rules, page ↔ engine, page changes, restarts. The room adapter itself is tested with the real RoomDirector in
// tests/unit/remoteavatar.test.mts.
// Run: npm --prefix client/web run build && (cd server/signal && npm ci) && xvfb-run -a node tests/desktop/multiplayer.e2e.mjs
import { _electron } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = path.join(root, 'desktop', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const out = process.argv[2] ?? path.join(root, 'test-results', 'multiplayer');
fs.mkdirSync(out, { recursive: true });
const fail = []; const expect = (n, ok, info) => { if (!ok) fail.push(n); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' ' + JSON.stringify(info)}`); };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const errors = [];
const metrics = {};

// ---- TURN (node-turn) with coturn "use-auth-secret" credentials, and the presence / signaling server
const SECRET = crypto.randomBytes(16).toString('hex');
const req = createRequire(path.join(root, 'server/signal/package.json'));
const Turn = req('node-turn');
const turnPort = 34000 + Math.floor(Math.random() * 2000);
const turnUsed = new Set();
const creds = new Proxy({}, { get: (_, u) => {
  if (typeof u !== 'string') return undefined;
  const exp = Number(u.split(':')[0]); if (!(exp * 1000 > Date.now())) return undefined;      // expired → refused
  turnUsed.add(u);
  return crypto.createHmac('sha1', SECRET).update(u).digest('base64');
} });
const turn = new Turn({ listeningPort: turnPort, listeningIps: ['127.0.0.1'], relayIps: ['127.0.0.1'], authMech: 'long-term', credentials: creds, realm: 'mtw-test', debugLevel: 'OFF' });
turn.start();
const { startSignalServer } = await import(path.join(root, 'server/signal/server.mjs'));
const dataDir = tmp('mtw-mp-signal-');
const srv = await startSignalServer({ port: 0, host: '127.0.0.1', dataDir, stun: '', turn: `turn:127.0.0.1:${turnPort}?transport=udp`, turnSecret: SECRET, turnTtl: 600, log: () => {} });
const SIGNAL = `ws://127.0.0.1:${srv.port}/v1`;

const assetsDir = tmp('mtw-mp-assets-');
const dataA = tmp('mtw-mp-a-'), dataB = tmp('mtw-mp-b-');
async function launch(tag, userData, port) {
  const app = await _electron.launch({ executablePath: exe, args: [path.join(root, 'desktop', 'main.cjs'), '--no-sandbox'], env: { ...process.env, MTW_USER_DATA: userData, MTW_ASSETS: assetsDir, MTW_LAN_PORT: String(port), MTW_LAN_TARGETS: '[]', MTW_SIGNAL: SIGNAL } });
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
async function seedMii(g, name) {
  await g.waitForFunction(() => !!window.__mtw?.play);
  await g.evaluate(async (name) => { const p = window.__mtw.play; p.save.profile.miiData = btoa(String.fromCharCode(...Array.from({ length: 96 }, (_, i) => (i * 7 + name.length) & 255))); p.save.profile.name = name; p.save.profile.personality = [3, 3, 3, 3, 3]; await p.persist(); window.__mtw.p2p.request('profile.push'); }, name);
}
const st = (g) => g.evaluate(() => window.__mtw.p2p.state);
const mp = (g) => g.evaluate(() => window.__mtw.p2p.mp);
const until = (g, fn, arg, ms = 20000) => g.waitForFunction(fn, arg, { timeout: ms, polling: 200 });
const saveOf = (g) => g.evaluate(() => ({ mii: window.__mtw.play.save.profile.miiData, name: window.__mtw.play.save.profile.name, room: { ...window.__mtw.play.save.room } }));
const engineLog = async (app, tag) => { for (const w of app.windows()) if (w.url().includes('p2p.html')) console.log(`--- ${tag} p2p log\n` + (await w.evaluate(() => (window.__p2p?.log ?? []).slice(-40).join('\n')).catch(() => '?'))); };

let A = await launch('A', dataA, 47911), B = await launch('B', dataB, 47921);
try {
  let gA = await enter(A, 'Alice', 'password1', true);
  let gB = await enter(B, 'Bob', 'password2', true);
  await gA.waitForSelector('.ln-card'); await gB.waitForSelector('.ln-card');
  await seedMii(gA, 'Alice'); await seedMii(gB, 'Bob');
  await until(gA, () => window.__mtw.p2p.state?.server.state === 'on');
  await until(gB, () => window.__mtw.p2p.state?.server.state === 'on');
  expect('both apps logged in to the presence server with their account key (no LAN in this test)', (await st(gA)).lan !== 'on' || (await st(gA)).nearby.length === 0);

  // ---- 1. add a friend ONCE, by personal code (UI), over the internet path
  const bobCode = (await st(gB)).me.code;
  await gA.click('[data-a=friends]'); await gA.waitForSelector('.fp [data-in=code]');
  await gA.fill('.fp [data-in=code]', bobCode.toLowerCase().replace(/-/g, ' '));
  await gA.click('.fp [data-a=code]');
  await gA.waitForFunction(() => /Richiesta inviata|Request sent/.test(document.querySelector('.fp-msg')?.textContent ?? ''), null, { timeout: 10000 });
  await gA.screenshot({ path: `${out}/mp-01-add-by-code.png` });
  await until(gB, () => window.__mtw.p2p.state?.incoming.some((r) => r.name === 'Alice' && r.via === 'server'));
  expect('code: Bob receives Alice\'s request through the server', true);
  await gB.click('[data-a=friends]'); await gB.waitForSelector('.fp [data-acc]'); await gB.click('.fp [data-acc]');
  const t0 = Date.now();
  await until(gA, () => window.__mtw.p2p.state?.friends.some((f) => f.name === 'Bob' && f.online), null, 30000);
  await until(gB, () => window.__mtw.p2p.state?.friends.some((f) => f.name === 'Alice' && f.online), null, 30000);
  metrics.connectAfterAccept = Date.now() - t0;
  const fA = (await st(gA)).friends[0];
  expect('accepted: friends on both sides and CONNECTED (WebRTC set up through the server, no code to exchange)', fA.via === 'server' && fA.online, fA);
  await until(gA, () => !!window.__mtw.p2p.state?.friends[0]?.route);
  expect('path of the link is known (direct candidate on this machine)', ['host', 'srflx', 'prflx', 'relay'].includes((await st(gA)).friends[0].route), (await st(gA)).friends[0].route);
  await until(gA, () => window.__mtw.p2p.friends.some((f) => f.profile));
  expect('profiles exchanged on the link (Bob\'s Mii data reaches Alice)', (await gA.evaluate(() => window.__mtw.p2p.friends[0].profile?.profile?.name)) === 'Bob');

  // ---- 2. invite from the launcher (Bob), Alice is in Classic and answers on the overlay
  const saveA0 = await saveOf(gA), saveB0 = await saveOf(gB);
  await gA.evaluate(() => window.mtwDesktop.game.open('classic')); await gA.waitForURL(/reboot=0/);
  await gA.waitForFunction(() => !!window.__mtw?.p2p?.mp && !!document.querySelector('.mp-overlay'));
  await gB.waitForSelector('.fp [data-mp-invite]');
  await gB.screenshot({ path: `${out}/mp-02-friends-presence.png` });
  await gB.click('.fp [data-mp-invite]');
  await gA.waitForSelector('.mp-overlay [data-mp-accept]', { timeout: 10000 });
  await gA.screenshot({ path: `${out}/mp-03-invitation.png` });
  const tJoin = Date.now();
  await gA.click('.mp-overlay [data-mp-accept]');
  await until(gA, () => window.__mtw.p2p.mp?.session?.members.length === 2);
  await until(gB, () => window.__mtw.p2p.mp?.session?.members.length === 2);
  metrics.joinMs = Date.now() - tJoin;
  const [mA, mB] = [await mp(gA), await mp(gB)];
  expect('one session: Bob hosts, Alice is his guest, both see two members (two Miis)', mB.session.role === 'host' && mA.session.role === 'guest' && mA.session.host === mB.me && mA.session.sid === mB.session.sid, { a: mA.session, b: mB.session?.role });
  expect('Alice gets Bob\'s room look; the members carry each one\'s OWN profile (Alice\'s Mii stays Alice\'s)', JSON.stringify(mA.session.room) === JSON.stringify(saveB0.room) && mA.session.members.find((m) => m.id === mA.me)?.name === 'Alice' && mA.session.members.find((m) => m.id === mB.me)?.name === 'Bob');
  await until(gA, () => document.querySelector('.mp-overlay .mp-bar') !== null);
  await gA.screenshot({ path: `${out}/mp-04-in-room-bar.png` });
  await until(gB, () => window.__mtw.p2p.state?.friends[0]?.presence === 'in-room' || window.__mtw.p2p.mp?.session?.members.length === 2);
  expect('presence: Bob\'s friend list shows Alice "here" (in his room)', (await gB.evaluate(() => document.querySelector('.fp [data-friend] .mp-dot')?.className ?? '')).includes('here'));

  // ---- 3. movement + actions both ways (what the room adapter sends every frame)
  const recv = (g) => g.evaluate(() => { window.__avIn = []; window.__actIn = []; window.__mtw.p2p.onAv((id, seq, s) => window.__avIn.push({ id, seq, s, at: Date.now() })); window.__mtw.p2p.onAct((id, seq, a) => window.__actIn.push({ id, seq, a })); });
  await recv(gA); await recv(gB);
  const burst = (g, n, x0) => g.evaluate(async ({ n, x0 }) => { for (let i = 0; i < n; i++) { window.__mtw.p2p.castAv({ x: x0 + i * 0.3, z: 2, h: 0.1, st: 'walking', tx: x0 + 15, tz: 2, t: Date.now() }); await new Promise((r) => setTimeout(r, 100)); } }, { n, x0 });
  await Promise.all([burst(gA, 30, -10), burst(gB, 30, 5)]);
  await gA.waitForTimeout(800);
  const inB = await gB.evaluate(() => window.__avIn), inA = await gA.evaluate(() => window.__avIn);
  const lat = (arr) => arr.map((e) => e.at - e.s.t);
  metrics.avLatencyMs = { avg: +(lat(inB).reduce((a, b) => a + b, 0) / Math.max(1, inB.length)).toFixed(1), max: Math.max(...lat(inB)), received: inB.length, sent: 30, perSecond: 10 };
  expect('Mii states: Alice → Bob all 30 arrive in order (latest x = Alice\'s last), and Bob → Alice', inB.length === 30 && inB.at(-1).s.x === -10 + 29 * 0.3 && inB.every((e, i) => i === 0 || e.seq > inB[i - 1].seq) && inA.length === 30 && inA.every((e) => e.id === mB.me), { b: inB.length, a: inA.length });
  await gA.evaluate(() => window.__mtw.p2p.castAct({ k: 'wave' }));
  await gB.evaluate(() => window.__mtw.p2p.castAct({ k: 'interact', o: 'chest' }));
  await gA.waitForTimeout(600);
  const actB = await gB.evaluate(() => window.__actIn), actA = await gA.evaluate(() => window.__actIn);
  expect('actions: Alice waves → Bob sees it once; Bob uses the chest → Alice sees it once', actB.length === 1 && actB[0].a.k === 'wave' && actB[0].id === mA.me && actA.length === 1 && actA[0].a.o === 'chest', { actA, actB });
  expect('nobody\'s save was touched by the session (Mii, name, room of both)', JSON.stringify(await saveOf(gA)) === JSON.stringify(saveA0) && JSON.stringify(await saveOf(gB)) === JSON.stringify(saveB0));

  // ---- 4. page changes keep the session (launcher → Classic → Reboot), no duplicate member
  await gA.evaluate(() => window.mtwDesktop.game.open('reboot')); await gA.waitForURL(/reboot=1/);
  await until(gA, () => window.__mtw?.p2p?.mp?.session?.members.length === 2);
  await gB.evaluate(() => window.mtwDesktop.game.open('classic')); await gB.waitForURL(/reboot=0/);
  await until(gB, () => window.__mtw?.p2p?.mp?.session?.members.length === 2);
  expect('page changes (Alice → Reboot, Bob → Classic): same session, still exactly two members', (await mp(gA)).session.sid === mB.session.sid && (await mp(gB)).session.members.length === 2);
  await until(gA, () => window.__mtw.reboot?.dock !== undefined || !!document.querySelector('.mp-dock'), null, 10000).catch(() => {});
  await recv(gB);
  await gA.evaluate(() => window.__mtw.p2p.castAv({ x: 3, z: 4, h: 0, st: 'idle', tx: null, tz: null, t: Date.now() }));
  await until(gB, () => window.__avIn.some((e) => e.s.x === 3 && e.s.st === 'idle'), null, 5000);
  expect('after the reloads the states still flow (Alice from Reboot reaches Bob in Classic)', true);
  await gA.screenshot({ path: `${out}/mp-05-reboot-in-session.png` });

  // ---- 5. the host closes the game → the guest is told at once (no 30 s ghost seat)
  const tEnd = Date.now();
  await B.close();
  await until(gA, () => !window.__mtw.p2p.mp?.session, null, 15000);
  metrics.hostClosedToGuestEndMs = Date.now() - tEnd;
  const lastA = (await mp(gA)).last;
  expect('Bob closes the app: Alice\'s session ends with a reason she can read', ['HOST_LEFT', 'LOGOUT', 'HOST_LOST'].includes(lastA?.why), lastA);
  await until(gA, () => !window.__mtw.p2p.state?.friends[0]?.online, null, 15000);
  expect('presence: Bob shows offline at Alice\'s', (await st(gA)).friends[0].presence === 'offline');

  // ---- 6. Bob starts the game again (same PC, same account): friends found again BY THEMSELVES (no code)
  B = await launch('B', dataB, 47921);
  gB = await enter(B, 'bob', 'password2', false);
  await gB.waitForSelector('.ln-card');
  const tRe = Date.now();
  await until(gB, () => window.__mtw.p2p.state?.friends.some((f) => f.name === 'Alice' && f.online), null, 40000);
  metrics.reconnectAfterRestartMs = Date.now() - tRe;
  expect('after a restart: still friends (kept), connected again by themselves through the server — no code', (await st(gB)).friends.length === 1 && (await st(gB)).friends[0].via === 'server');
  // and the shared room again, the other way round: Alice (in Reboot) invites, Bob accepts from the launcher overlay
  await gA.evaluate((id) => window.__mtw.p2p.request('mp.invite', { to: id }), (await st(gB)).me.id);
  await gB.waitForSelector('.mp-overlay [data-mp-accept]', { timeout: 10000 });
  await gB.click('.mp-overlay [data-mp-accept]');
  await until(gA, () => window.__mtw.p2p.mp?.session?.members.length === 2);
  await until(gB, () => window.__mtw.p2p.mp?.session?.role === 'guest');
  expect('invitation the other way (Alice hosts in Reboot, Bob joins): two members', (await mp(gA)).session.role === 'host' && (await mp(gB)).session.host === (await mp(gA)).me);

  // ---- 7. logout of the guest: the host is told, the seat is freed
  const shell = B.waitForEvent('window', { predicate: (p) => p.url().includes('login.html'), timeout: 10000 });
  await gB.click('[data-a=logout]').catch(async () => { await gB.evaluate(() => window.mtwDesktop.accounts.logout()); });
  await shell;
  await until(gA, () => window.__mtw.p2p.mp?.session?.members.length === 1, null, 15000);
  expect('Bob logs out: Alice\'s room has only Alice again (no ghost Mii)', (await mp(gA)).session.members.length === 1);
  await B.close(); await A.close();

  // ---- 8. TURN: both force the relay path (setting kept in the account), restart, connect through TURN only
  A = await launch('A', dataA, 47911); B = await launch('B', dataB, 47921);
  gA = await enter(A, 'alice', 'password1', false); gB = await enter(B, 'bob', 'password2', false);
  await gA.waitForSelector('.ln-card'); await gB.waitForSelector('.ln-card');
  await until(gA, () => window.__mtw.p2p.state?.friends[0]?.online, null, 40000);
  await gA.evaluate(() => window.__mtw.p2p.request('settings', { relayOnly: true }));
  await gB.evaluate(() => window.__mtw.p2p.request('settings', { relayOnly: true }));
  await B.close();
  B = await launch('B', dataB, 47921); gB = await enter(B, 'bob', 'password2', false); await gB.waitForSelector('.ln-card');
  const tTurn = Date.now();
  await until(gB, () => window.__mtw.p2p.state?.friends[0]?.online && !!window.__mtw.p2p.state.friends[0].route, null, 60000);
  metrics.turnConnectMs = Date.now() - tTurn;
  const route = (await st(gB)).friends[0].route;
  expect('TURN only: the friends connect again through the relay (route = relay, credentials from the server accepted by TURN)', route === 'relay' && turnUsed.size > 0, { route, turnUsers: turnUsed.size });
  const got = gA.evaluate(() => new Promise((res) => { const un = window.__mtw.p2p.on('t', (from, data) => { un(); res(data); }); setTimeout(() => res(null), 8000); }));
  await gB.evaluate(() => window.__mtw.p2p.send('t', { via: 'turn', big: 'y'.repeat(30000) }));
  const data = await got;
  expect('data goes through the relay (30 KB message intact)', data?.via === 'turn' && data.big.length === 30000);
} catch (e) {
  fail.push('crash: ' + e.message); console.log('CRASH', e);
  await engineLog(A, 'A').catch(() => {}); await engineLog(B, 'B').catch(() => {});
} finally {
  await A.close().catch(() => {}); await B.close().catch(() => {});
  await srv.close(); turn.stop();
}
const real = errors.filter((e) => !/WebGL|GPU/i.test(e));
expect('no page errors', !real.length, real);
console.log('metrics', JSON.stringify(metrics));
fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 1));
console.log(fail.length ? `${fail.length} FAILED` : 'ALL PASS');
process.exit(fail.length ? 1 : 0);
