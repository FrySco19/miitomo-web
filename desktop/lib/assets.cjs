/**
 * The user's own Miitomo files, read from a folder they choose (default: the folder of the .exe). They are served
 * read-only to the game page under /local/ (list.json + files by name); nothing is copied into the app, nothing is
 * uploaded.
 *
 * HOTFIX 2026-10-28: the first version listed only the names of tools/serve-local.ps1 (APK, AFL, asset_env*,
 * animations in the folder itself + local-assets/cdn/*.zip). The game wants many more sources (body / clothes
 * packages, sound*.zip with all music and effects, room models, layouts…): kept anywhere else in the folder they
 * were never offered, so the game ran with no music / effects and an incomplete body. Now every .apk / .zip / .dat
 * of the folder and its sub-folders (3 levels) is listed; the game keeps the ones it needs (vfs.wantedSource) — the
 * same choice as importing them by hand in the browser.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.zip': 'application/zip', '.apk': 'application/octet-stream', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.map': 'application/json' };
const mimeOf = (f) => MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream';

const SOURCE = /\.(apk|zip|dat)$/i;
const SKIP = new Set(['node_modules', '.git', 'dist', 'release', 'win-unpacked', 'linux-unpacked', '$RECYCLE.BIN', 'System Volume Information']);
/**
 * Files of the folder that the game may import, by name (first found wins; the folder itself first, then
 * local-assets/cdn, then the other sub-folders, at most 3 levels deep). The game filters them (wantedSource).
 */
const cache = { folder: '', at: 0, map: new Map() };
function scan(folder, depth = 3) {
  // the game fetches the files one by one: one walk of the folder serves a whole import
  if (folder && cache.folder === folder && Date.now() - cache.at < 3000) return cache.map;
  const out = new Map();
  if (!folder) return out;
  const visit = (dir, d) => {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const dirs = [];
    for (const e of names) {
      const p = path.join(dir, e.name);
      if (e.isFile() && SOURCE.test(e.name) && !out.has(e.name)) out.set(e.name, p);
      else if (e.isDirectory() && d > 0 && !SKIP.has(e.name) && !e.name.startsWith('.')) dirs.push(p);
    }
    // local-assets/cdn first (where the README puts the CDN zips), then the rest in name order
    dirs.sort((a, b) => (/local-assets$/i.test(b) ? 1 : 0) - (/local-assets$/i.test(a) ? 1 : 0) || a.localeCompare(b));
    for (const sub of dirs) visit(sub, d - 1);
  };
  visit(folder, depth);
  Object.assign(cache, { folder, at: Date.now(), map: out });
  return out;
}
/** What was found, by kind (shown by the launcher's diagnostics). */
function summary(map) {
  const k = { apk: 0, afl: 0, env: 0, anim: 0, body: 0, sound: 0, room: 0, other: 0 };
  for (const n of map.keys()) {
    if (/\.apk$/i.test(n)) k.apk++; else if (/AFLRes/i.test(n)) k.afl++; else if (/^asset_env/i.test(n)) k.env++;
    else if (/animation_output/i.test(n)) k.anim++; else if (/^asset_model_character_(body|headwear)/i.test(n)) k.body++;
    else if (/^sound/i.test(n)) k.sound++; else if (/^asset_model_room_/i.test(n)) k.room++; else k.other++;
  }
  return k;
}
function listJson(map) {
  return JSON.stringify({ files: [...map].map(([name, p]) => { let size = 0; try { size = fs.statSync(p).size; } catch { /* gone */ } return { name, size }; }) });
}
/** A path inside `root` only (no ../ escapes). */
function inside(root, rel) {
  const full = path.resolve(root, '.' + path.sep + rel);
  return full === path.resolve(root) || full.startsWith(path.resolve(root) + path.sep) ? full : null;
}
module.exports = { scan, summary, listJson, mimeOf, inside };
