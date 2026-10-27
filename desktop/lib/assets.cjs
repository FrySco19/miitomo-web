/**
 * The user's own Miitomo files, read from a folder they choose (default: the folder of the .exe), with exactly the
 * patterns of tools/serve-local.ps1. They are served read-only to the game page under /local/ (list.json + files by
 * name); nothing is copied into the app, nothing is uploaded.
 */
const fs = require('node:fs');
const path = require('node:path');

const PATTERNS = [/^Miitomo_.*\.apk$/i, /^asset_model_character_mii_AFLResHigh.*\.zip$/i, /^asset_env.*\.zip$/i, /^asset_model_character_animation_output\.zip$/i];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.zip': 'application/zip', '.apk': 'application/octet-stream', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.map': 'application/json' };
const mimeOf = (f) => MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream';

/** Files of the folder (and its local-assets/cdn/*.zip) that the game can import, by name. */
function scan(folder) {
  const out = new Map();
  const add = (dir, test) => { try { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (test(n) && fs.statSync(p).isFile() && !out.has(n)) out.set(n, p); } } catch { /* missing folder */ } };
  if (!folder) return out;
  add(folder, (n) => PATTERNS.some((r) => r.test(n)));
  add(path.join(folder, 'local-assets', 'cdn'), (n) => /\.zip$/i.test(n));
  return out;
}
function listJson(map) {
  return JSON.stringify({ files: [...map].map(([name, p]) => { let size = 0; try { size = fs.statSync(p).size; } catch { /* gone */ } return { name, size }; }) });
}
/** A path inside `root` only (no ../ escapes). */
function inside(root, rel) {
  const full = path.resolve(root, '.' + path.sep + rel);
  return full === path.resolve(root) || full.startsWith(path.resolve(root) + path.sep) ? full : null;
}
module.exports = { scan, listJson, mimeOf, inside, PATTERNS };
