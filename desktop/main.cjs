/**
 * Miitomo Web — desktop app (Electron). One program for both modes:
 *   login / register (local accounts, desktop/lib/accounts.cjs)
 *   → launcher (the user's Mii in the room, original music from the user's own files) → Classic or Reboot
 *   + peer-to-peer friends (LAN discovery here, WebRTC in the hidden p2p page of the account).
 *
 * The game is the same web client (client/web/dist), served on the private scheme mtw://app/ so every account keeps a
 * stable origin with its own storage partition (persist:acct-<id>): its own save, Reboot data and P2P friends.
 * The user's Miitomo files are read from a folder they choose (never bundled, never uploaded), like serve-local.ps1.
 */
const { app, BrowserWindow, protocol, session, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Accounts } = require('./lib/accounts.cjs');
const assets = require('./lib/assets.cjs');
const { Lan } = require('./lib/lan.cjs');

// Sound may start without a first click (the launcher's music). The pages also resume the AudioContext on the first
// click / key, so the game does not depend on this switch alone.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{ scheme: 'mtw', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

const DEV = !app.isPackaged;
const CLIENT = DEV ? path.join(__dirname, '..', 'client', 'web', 'dist') : path.join(process.resourcesPath, 'client');
const UI = path.join(__dirname, 'ui');
const ORIGIN = 'mtw://app';
// a test run can keep its data apart (MTW_USER_DATA) — set before the app is ready
if (process.env.MTW_USER_DATA) app.setPath('userData', process.env.MTW_USER_DATA);

let accounts, config, lan = null;
let shellWin = null, gameWin = null, p2pWin = null;
const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch { return {}; } }
function saveConfig() { try { fs.writeFileSync(CONFIG(), JSON.stringify(config, null, 1)); } catch { /* read-only */ } }
/** Default folder of the user's files: next to the portable .exe, else the repository root in development. */
function defaultAssets() { return process.env.MTW_ASSETS || process.env.PORTABLE_EXECUTABLE_DIR || (DEV ? path.join(__dirname, '..') : path.dirname(process.execPath)); }
const assetsFolder = () => config.assets || defaultAssets();

// ---------------------------------------------------------------- mtw://app/ (one handler per session)
async function serve(req) {
  const u = new URL(req.url);
  if (u.host !== 'app') return new Response('not found', { status: 404 });
  let p = decodeURIComponent(u.pathname);
  const file = (f) => { try { const b = fs.readFileSync(f); return new Response(b, { headers: { 'content-type': assets.mimeOf(f), 'cache-control': 'no-cache' } }); } catch { return new Response('not found', { status: 404 }); } };
  if (p === '/local/list.json') return new Response(assets.listJson(assets.scan(assetsFolder())), { headers: { 'content-type': 'application/json' } });
  if (p.startsWith('/local/')) { const f = assets.scan(assetsFolder()).get(p.slice(7)); return f ? file(f) : new Response('not found', { status: 404 }); }
  if (p.startsWith('/desktop/')) { const f = assets.inside(UI, p.slice(9)); return f ? file(f) : new Response('not found', { status: 404 }); }
  if (p === '/' || p === '') p = '/index.html';
  const f = assets.inside(CLIENT, p.slice(1));
  return f ? file(f) : new Response('not found', { status: 404 });
}
const served = new Set();
function partition(p) {
  const s = session.fromPartition(p);
  if (!served.has(p)) {
    s.protocol.handle('mtw', serve); served.add(p);
    s.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media' ? false : perm === 'fullscreen' || perm === 'clipboard-sanitized-write'));
  }
  return s;
}
const accountPartition = () => `persist:acct-${accounts.session.id}`;

function win(opts, url, part) {
  const w = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600, backgroundColor: '#fff4e8', title: 'Miitomo Web', show: false, icon: path.join(__dirname, 'build', 'icon.png'), ...opts,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required', session: partition(part) },
  });
  w.webContents.on('will-navigate', (e, to) => { if (!to.startsWith(ORIGIN + '/')) { e.preventDefault(); if (/^https:\/\//.test(to)) shell.openExternal(to); } });
  w.webContents.setWindowOpenHandler(({ url: to }) => { if (/^https:\/\//.test(to)) shell.openExternal(to); return { action: 'deny' }; });
  w.loadURL(url);
  if (!opts.hidden) w.once('ready-to-show', () => w.show());
  return w;
}
function openShell() {
  shellWin = win({ width: 980, height: 680, resizable: true }, `${ORIGIN}/desktop/login.html`, 'persist:shell');
  shellWin.on('closed', () => { shellWin = null; if (!gameWin) app.quit(); });
}
function openGame() {
  const part = accountPartition();
  gameWin = win({}, `${ORIGIN}/index.html?launcher=1&autoload=1&desktop=1`, part);
  gameWin.on('closed', () => { gameWin = null; closeP2P(); if (!shellWin && accounts.session) { accounts.logout(); app.quit(); } });
  // the P2P engine lives in a hidden page of the same account: it keeps the connections while the game page reloads
  p2pWin = win({ hidden: true, width: 400, height: 300 }, `${ORIGIN}/p2p.html?desktop=1`, part);
  menu();
}
function closeP2P() { lan?.stop(); lan = null; if (p2pWin && !p2pWin.isDestroyed()) p2pWin.destroy(); p2pWin = null; }
function goto(mode) {
  if (!gameWin) return;
  const q = mode === 'launcher' ? 'launcher=1&autoload=1' : `autoload=1&reboot=${mode === 'reboot' ? 1 : 0}`;
  gameWin.loadURL(`${ORIGIN}/index.html?${q}&desktop=1`);
}
function logout() {
  accounts.logout();
  // the login window opens first: with no window left, the app would quit
  if (!shellWin) openShell();
  const g = gameWin; gameWin = null; closeP2P(); g?.destroy();
  menu();
}
function menu() {
  const inGame = !!gameWin;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Miitomo', submenu: [
      { label: 'Launcher', accelerator: 'CmdOrCtrl+L', enabled: inGame, click: () => goto('launcher') },
      { label: 'Miitomo Classic', enabled: inGame, click: () => goto('classic') },
      { label: 'Miitomo Reboot', enabled: inGame, click: () => goto('reboot') },
      { type: 'separator' },
      { label: 'Esci dall\'account', enabled: inGame, click: () => logout() },
      { role: 'quit', label: 'Chiudi' },
    ] },
    { label: 'Vista', submenu: [{ role: 'togglefullscreen', label: 'Schermo intero' }, { role: 'reload', label: 'Ricarica' }, ...(DEV ? [{ role: 'toggleDevTools' }] : [])] },
  ]));
}

// ---------------------------------------------------------------- IPC
const fromShell = (e) => shellWin && e.sender === shellWin.webContents;
const fromAccount = (e) => accounts.session && [gameWin, p2pWin].some((w) => w && !w.isDestroyed() && e.sender === w.webContents);
function ipc() {
  ipcMain.handle('accounts:list', () => accounts.list());
  ipcMain.handle('accounts:register', (e, u, p) => { if (!fromShell(e)) return { ok: false, code: 'DENIED' }; const r = accounts.register(u, p); if (r.ok) { openGame(); shellWin?.close(); } return r; });
  ipcMain.handle('accounts:login', (e, u, p) => { if (!fromShell(e)) return { ok: false, code: 'DENIED' }; const r = accounts.login(u, p); if (r.ok) { openGame(); shellWin?.close(); } return r; });
  ipcMain.handle('accounts:current', (e) => (fromAccount(e) ? accounts.current() : null));
  ipcMain.handle('accounts:logout', (e) => { if (fromAccount(e)) logout(); return true; });
  ipcMain.handle('accounts:password', (e, a, b) => (fromAccount(e) ? accounts.changePassword(a, b) : { ok: false, code: 'DENIED' }));
  ipcMain.handle('identity:sign', (e, text) => (fromAccount(e) ? accounts.sign(text) : null));
  ipcMain.handle('identity:verify', (_e, pub, text, sig) => Accounts.verify(pub, text, sig));
  ipcMain.handle('assets:info', () => { const m = assets.scan(assetsFolder()); return { folder: assetsFolder(), files: m.size, kinds: assets.summary(m), names: [...m.keys()].sort() }; });
  ipcMain.handle('assets:choose', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Cartella dei tuoi file di Miitomo', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    config.assets = r.filePaths[0]; saveConfig();
    { const m = assets.scan(config.assets); return { folder: config.assets, files: m.size, kinds: assets.summary(m), names: [...m.keys()].sort() }; }
  });
  ipcMain.handle('game:open', (e, mode) => { if (e.sender === gameWin?.webContents && ['launcher', 'classic', 'reboot'].includes(mode)) goto(mode); return true; });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dev: DEV }));
  // LAN (only the account's hidden P2P page drives it)
  ipcMain.handle('lan:start', async (e, me) => {
    if (!fromAccount(e) || e.sender !== p2pWin?.webContents) return false;
    const cur = accounts.current();
    if (!lan) {
      lan = new Lan(process.env.MTW_LAN_PORT ? { port: Number(process.env.MTW_LAN_PORT), targets: process.env.MTW_LAN_TARGETS ? JSON.parse(process.env.MTW_LAN_TARGETS) : undefined } : {});
      lan.on('peers', (list) => p2pWin?.webContents.send('lan:peers', list));
      lan.on('signal', (m) => p2pWin?.webContents.send('lan:signal', m));
      lan.on('error', (msg) => p2pWin?.webContents.send('lan:error', msg));
    }
    return lan.start({ id: cur.peerId, pub: cur.pub, code: cur.code, name: String(me?.name ?? cur.username) });
  });
  ipcMain.handle('lan:signal', (e, peerId, data) => (fromAccount(e) && lan ? lan.signal(peerId, data) : false));
  ipcMain.handle('lan:stop', (e) => { if (fromAccount(e)) { lan?.stop(); } return true; });
}

app.whenReady().then(() => {
  accounts = new Accounts(app.getPath('userData'));
  config = loadConfig();
  ipc(); menu(); openShell();
});
app.on('window-all-closed', () => app.quit());
