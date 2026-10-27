// Presence / friend requests / signaling server (server/signal). Real server, real WebSocket clients, real Ed25519
// keys. Run: node tests/server/signal.test.mjs   (needs `npm ci` in server/signal)
import crypto from 'node:crypto';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { startSignalServer, authText, turnCredentials, peerIdOf, codeOf } = await import(path.join(root, 'server/signal/server.mjs'));
const WebSocket = createRequire(path.join(root, 'server/signal/package.json'))('ws');

let fails = 0; const ok = (n, c, i) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtw-signal-'));
const srv = await startSignalServer({ port: 0, host: '127.0.0.1', dataDir, turn: 'turn:127.0.0.1:3478', turnSecret: 'test-secret', turnTtl: 3600, log: () => {} });
const url = `ws://127.0.0.1:${srv.port}/v1`;

function identity(name) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64url');
  return { name, pub, id: peerIdOf(pub), code: codeOf(pub), sign: (t) => crypto.sign(null, Buffer.from(t), privateKey).toString('base64url') };
}
/** A logged-in client: collects every message. */
async function client(me, { badSig = false } = {}) {
  const ws = new WebSocket(url); const got = [];
  ws.on('message', (b) => { const m = JSON.parse(b.toString()); got.push(m); if (m.t === 'challenge') ws.send(JSON.stringify({ t: 'auth', pub: me.pub, name: me.name, sig: badSig ? me.sign('wrong') : me.sign(authText(m.nonce)) })); });
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  for (let i = 0; i < 50 && !got.some((m) => m.t === 'welcome' || m.t === 'error'); i++) await wait(20);
  return { ws, got, closed, send: (m) => ws.send(JSON.stringify(m)), last: (t) => [...got].reverse().find((m) => m.t === t), count: (t) => got.filter((m) => m.t === t).length };
}
const until = async (f, ms = 2000) => { for (let i = 0; i < ms / 20 && !f(); i++) await wait(20); return f(); };

const alice = identity('Alice'), bob = identity('Bob'), eve = identity('Eve');
// ---- identity
const bad = await client(eve, { badSig: true });
ok('a wrong signature is refused (no login, connection closed)', bad.got.some((m) => m.t === 'error' && m.code === 'AUTH') && (await bad.closed) === 4003);
const A = await client(alice);
const w = A.last('welcome');
ok('login: id and personal code derived from the key, like the desktop app', w && w.id === alice.id && w.code === alice.code && /^MTW-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(w.code), w);
const turn = w.ice.find((s) => String(s.urls).includes('turn:'));
const expect = turnCredentials('test-secret', alice.id, 3600);
ok('ICE: STUN + TURN with short-lived credentials (coturn REST scheme, secret never sent)', turn && turn.username.endsWith(':' + alice.id) && Math.abs(Number(turn.username.split(':')[0]) - Number(expect.username.split(':')[0])) < 5 && turn.credential.length === 28 && !JSON.stringify(w).includes('test-secret'), turn);

// ---- friend request by code to somebody who is OFFLINE, delivered at their next login; answer delivered back
A.send({ t: 'freq', code: bob.code.toLowerCase() });
await until(() => A.got.some((m) => m.t === 'error' || m.t === 'freq.sent'));
ok('request to an unknown code (never logged in) → NOT_FOUND', A.last('error')?.code === 'NOT_FOUND', A.last('error'));
const B0 = await client(bob); B0.ws.close(); await B0.closed;     // Bob exists now, then goes offline
A.send({ t: 'freq', code: bob.code });
await until(() => A.got.some((m) => m.t === 'freq.sent'));
ok('request by personal code to an offline user is accepted (kept for them)', A.last('freq.sent')?.to === bob.id && A.last('freq.sent').pub === bob.pub, A.last('freq.sent'));
A.ws.close(); await A.closed;                                       // Alice offline too
const B = await client(bob);
await until(() => B.got.some((m) => m.t === 'freq'));
const fr = B.last('freq');
ok('Bob gets the request at his next login, with Alice\'s key (pinned later)', fr && fr.from === alice.id && fr.pub === alice.pub && fr.name === 'Alice', fr);
B.send({ t: 'fans', to: alice.id, accept: true });
await wait(100);
const A2 = await client(alice);
await until(() => A2.got.some((m) => m.t === 'facc'));
ok('Alice gets the acceptance at her next login (both offline at different times)', A2.last('facc')?.from === bob.id && A2.last('facc').pub === bob.pub, A2.got.map((m) => m.t));
B.send({ t: 'fans', to: alice.id, accept: true }); await until(() => B.got.some((m) => m.t === 'error' && m.ref === 'fans'));
ok('an answer to a request that does not exist is refused', B.last('error')?.code === 'NOT_FOUND');

// ---- presence: only between MUTUAL friends
const E = await client(eve);
E.send({ t: 'friends', ids: [alice.id] });                          // Eve lists Alice; Alice does not list Eve
A2.send({ t: 'friends', ids: [bob.id] }); B.send({ t: 'friends', ids: [alice.id] });
await until(() => A2.got.some((m) => m.t === 'presence' && m.id === bob.id && m.online) && B.got.some((m) => m.t === 'presence' && m.id === alice.id && m.online));
ok('presence: Alice and Bob (mutual friends) see each other online', A2.got.some((m) => m.t === 'presence' && m.id === bob.id && m.online) && B.got.some((m) => m.t === 'presence' && m.id === alice.id && m.online));
await wait(150);
ok('presence: Eve (not Alice\'s friend) never sees Alice', !E.got.some((m) => m.t === 'presence' && m.id === alice.id), E.got.filter((m) => m.t === 'presence'));
B.send({ t: 'status', status: 'in-room', room: { host: bob.id, joinable: true } });
await until(() => A2.got.some((m) => m.t === 'presence' && m.id === bob.id && m.status === 'in-room'));
ok('status: Bob "in room, joinable" reaches Alice', A2.last('presence')?.room?.joinable === true && A2.last('presence').room.host === bob.id, A2.last('presence'));

// ---- signaling: mutual friends only
A2.send({ t: 'signal', to: bob.id, data: { k: 'offer', sdp: 'v=0' } });
await until(() => B.got.some((m) => m.t === 'signal'));
ok('signal: Alice → Bob relayed with the sender id set by the server', B.last('signal')?.from === alice.id && B.last('signal').data.k === 'offer', B.last('signal'));
E.send({ t: 'signal', to: alice.id, data: { k: 'offer', sdp: 'x' } });
await until(() => E.got.some((m) => m.t === 'error' && m.to === alice.id));
ok('signal: Eve → Alice refused (not mutual friends), nothing reaches Alice', E.last('error')?.code === 'NOT_FRIENDS' && !A2.got.some((m) => m.t === 'signal'), E.last('error'));

// ---- a second login of the same account replaces the first; going offline is announced
const B2 = await client(bob);
await until(() => B.ws.readyState === 3);
ok('same account logs in again → the old connection is replaced (no ghost)', B.ws.readyState === 3 && srv.live.get(bob.id) && srv.live.size === 3, { live: srv.live.size });
B2.send({ t: 'friends', ids: [alice.id] });
B2.ws.close(); await B2.closed;
await until(() => A2.got.some((m) => m.t === 'presence' && m.id === bob.id && !m.online));
ok('Bob leaves → Alice sees him offline (with last seen)', A2.last('presence')?.online === false && !!A2.last('presence').lastSeen, A2.last('presence'));

// ---- the registry survives a restart; nothing but identity data is kept
await srv.close();
const reg = JSON.parse(fs.readFileSync(path.join(dataDir, 'registry.json'), 'utf8'));
ok('registry kept on disk: only id, key, name, code, last seen (no game data)', Object.keys(reg.users).length === 3 && Object.values(reg.users).every((u) => Object.keys(u).sort().join() === 'code,lastSeen,name,pub'), Object.values(reg.users)[0]);
for (const c of [A2, E]) c.ws.terminate();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
