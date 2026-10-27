// Test double of tools/serve-local.ps1: serves client/web/dist and, read-only, the asset files listed in a JSON file
// (re-read on every /local/list.json request, so a test can "add" files between reloads).
// Usage: node tests/e2e/local-launcher.mjs <distDir> <port> <listFile.json: ["/abs/path", ...]>
import { createServer } from 'node:http';
import { readFileSync, statSync, createReadStream, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
const [dist, port, listFile] = process.argv.slice(2);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.zip': 'application/zip' };
const files = () => JSON.parse(readFileSync(listFile, 'utf8'));
createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/local/list.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ files: files().map((f) => ({ name: basename(f), size: statSync(f).size })) })); }
  if (p.startsWith('/local/')) {
    const f = files().find((x) => basename(x) === p.slice(7)); if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(f).size }); return createReadStream(f).pipe(res);
  }
  let fp = join(dist, p === '/' ? 'index.html' : p); if (!existsSync(fp) || statSync(fp).isDirectory()) fp = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(fp)] ?? 'application/octet-stream' }); createReadStream(fp).pipe(res);
}).listen(Number(port), () => console.log('local launcher test double on', port));
