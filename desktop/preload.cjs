/**
 * The only bridge between the pages (login, game, P2P engine) and the desktop app. Pages get `window.mtwDesktop`:
 * no Node, no file system; every call is checked again in the main process (who may log in, who may sign).
 */
const { contextBridge, ipcRenderer } = require('electron');
const on = (ch) => (cb) => { const f = (_e, v) => cb(v); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };

contextBridge.exposeInMainWorld('mtwDesktop', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('app:info'),
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    register: (u, p) => ipcRenderer.invoke('accounts:register', u, p),
    login: (u, p) => ipcRenderer.invoke('accounts:login', u, p),
    current: () => ipcRenderer.invoke('accounts:current'),
    logout: () => ipcRenderer.invoke('accounts:logout'),
    changePassword: (a, b) => ipcRenderer.invoke('accounts:password', a, b),
  },
  identity: {
    sign: (text) => ipcRenderer.invoke('identity:sign', text),
    verify: (pub, text, sig) => ipcRenderer.invoke('identity:verify', pub, text, sig),
  },
  assets: {
    info: () => ipcRenderer.invoke('assets:info'),
    choose: () => ipcRenderer.invoke('assets:choose'),
  },
  game: { open: (mode) => ipcRenderer.invoke('game:open', mode) },
  lan: {
    start: (me) => ipcRenderer.invoke('lan:start', me),
    stop: () => ipcRenderer.invoke('lan:stop'),
    signal: (peerId, data) => ipcRenderer.invoke('lan:signal', peerId, data),
    onPeers: on('lan:peers'),
    onSignal: on('lan:signal'),
    onError: on('lan:error'),
  },
});
