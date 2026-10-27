// LAN discovery + signaling, two copies of the game on ONE computer (0.2 fix). Before: both bound 47777 with
// SO_REUSEADDR and a set-up message for one copy could land in the other one's socket (dropped). Now each copy binds
// its own port of the range and both find each other through this computer's address.
// Run: node tests/desktop/lan.test.cjs
const { Lan } = require('../../desktop/lib/lan.cjs');
let fails = 0; const ok = (n, c, i) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const base = 48100 + Math.floor(Math.random() * 400);
  const a = new Lan({ port: base }), b = new Lan({ port: base });
  const A = { id: 'p2p-' + 'a'.repeat(16), pub: 'A'.repeat(43), name: 'Alice', code: 'MTW-A' }, B = { id: 'p2p-' + 'b'.repeat(16), pub: 'B'.repeat(43), name: 'Bob', code: 'MTW-B' };
  ok('two copies on one computer both start (no port fight)', (await a.start(A)) && (await b.start(B)), { a: a.port, b: b.port });
  ok('each copy has its own port of the range', a.port !== b.port && a.port >= base && b.port < base + 6, { a: a.port, b: b.port });
  for (let i = 0; i < 40 && (!a.peers.has(B.id) || !b.peers.has(A.id)); i++) await wait(100);
  ok('they find each other (beacons to this computer)', a.peers.has(B.id) && b.peers.has(A.id));
  const got = []; b.on('signal', (m) => got.push(m)); const gotA = []; a.on('signal', (m) => gotA.push(m));
  a.signal(B.id, { k: 'offer', sdp: 'x' });
  for (let i = 0; i < 20 && !got.length; i++) await wait(50);
  ok('a set-up message reaches the right copy', got.length === 1 && got[0].from === A.id && got[0].data.k === 'offer', got);
  b.signal(A.id, { k: 'answer', sdp: 'y' });
  for (let i = 0; i < 20 && !gotA.length; i++) await wait(50);
  ok('the reply reaches the other copy', gotA.length === 1 && gotA[0].data.k === 'answer', gotA);
  const c = new Lan({ port: base, span: 2 }); let why = ''; c.on('error', (m) => { why = m; });
  ok('range full → refused with a reason (not a silent failure)', !(await c.start({ ...A, id: 'p2p-' + 'c'.repeat(16) })) && /no free UDP port/.test(why), why);
  a.stop(); b.stop(); c.stop();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
