// Desktop P2P unit tests — wire checks, large messages in parts, the handshake transcript, peer ids, invite codes,
// and the game's view of P2P friends (sanitized like any untrusted profile). Run from client/web:
//   npx tsx ../../tests/unit/p2p.test.mts
import { parseWire, split, Joiner, transcript, fingerprint, peerIdOf, PART } from '../../client/web/src/p2p/protocol';
import { encodeCode, decodeCode, CODE_TTL_MS } from '../../client/web/src/p2p/codes';
import { toFriend } from '../../client/web/src/p2p/social';
import { createHash, generateKeyPairSync } from 'node:crypto';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const pubRaw = () => generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64url');
const pub = pubRaw();

// peer id = the desktop app's (sha256 of the raw key)
const id = await peerIdOf(pub);
ok('peer id: p2p- + 16 hex of sha256(raw key), same as desktop/lib/accounts.cjs', id === 'p2p-' + createHash('sha256').update(Buffer.from(pub, 'base64url')).digest('hex').slice(0, 16), id);

// wire
ok('wire: a valid hs1 passes; a bad key / short nonce / unknown type does not', !!parseWire({ t: 'hs1', pub, name: 'Bob', nonce: 'a'.repeat(24) }) && !parseWire({ t: 'hs1', pub: 'x', name: '', nonce: 'a'.repeat(24) }) && !parseWire({ t: 'hs1', pub, nonce: 'ab' }) && !parseWire({ t: 'evil' }) && !parseWire(null));
const sig = 'S'.repeat(86);
const h2 = parseWire({ t: 'hs2', sig, pub, name: 'Bob', nonce: 'n'.repeat(24) }) as { pub?: string; nonce?: string };
ok('wire: hs2 repeats the hello fields (enough on its own when hs1 is lost); a bad key in it drops them', h2?.pub === pub && h2.nonce === 'n'.repeat(24) && (parseWire({ t: 'hs2', sig, pub: 'bad', nonce: 'n'.repeat(24) }) as { pub?: string })?.pub === undefined && !parseWire({ t: 'hs2', sig: 'short' }));
ok('wire: app channel names are restricted', !!parseWire({ t: 'app', ch: 'feed', data: 1 }) && !parseWire({ t: 'app', ch: '../x', data: 1 }));
ok('wire: names are cut to 16 characters', (parseWire({ t: 'hs1', pub, name: 'x'.repeat(50), nonce: 'a'.repeat(24) }) as { name: string }).name.length === 16);
// parts
const big = JSON.stringify({ t: 'app', ch: 'feed', data: 'y'.repeat(100_000) });
const parts = split(big, '7');
const j = new Joiner(); let whole: string | null = null;
for (const p of [...parts].reverse()) { const w = parseWire(JSON.parse(p)); whole = j.push(w as never) ?? whole; }
ok('parts: 100 KB in ≤15 KB parts, rebuilt in any order', parts.length === Math.ceil(big.length / PART) && parts.every((p) => p.length < PART + 200) && whole === big);
const j2 = new Joiner();
ok('parts: a duplicated / inconsistent part is ignored', j2.push({ id: 'a', i: 0, n: 2, d: 'x' }) === null && j2.push({ id: 'a', i: 0, n: 2, d: 'x' }) === null && j2.push({ id: 'a', i: 1, n: 3, d: 'y' }) === null);
ok('parts: absurd part counts are refused by the wire check', !parseWire({ t: 'part', id: 'a', i: 0, n: 10_000, d: '' }));
// handshake transcript
const a = { id: 'p2p-aaaaaaaaaaaaaaaa', nonce: 'n1', fp: 'AA' }, b = { id: 'p2p-bbbbbbbbbbbbbbbb', nonce: 'n2', fp: 'BB' };
ok('transcript: identical on both sides, bound to both nonces and both DTLS fingerprints', transcript(a, b) === transcript(b, a) && transcript(a, b) !== transcript({ ...a, fp: 'CC' }, b) && transcript(a, b) !== transcript({ ...a, nonce: 'n3' }, b));
ok('fingerprint read from an SDP', fingerprint('v=0\r\na=fingerprint:sha-256 ab:CD:01\r\n') === 'AB:CD:01' && fingerprint('') === '');

// invite codes
const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n' + 'a=candidate:1 1 udp 2122260223 192.168.1.20 50000 typ host\r\n'.repeat(6);
const code = encodeCode({ kind: 'invite', id, pub, name: 'Bob', sdp, at: Date.now() });
const d1 = decodeCode(`  ${code.slice(0, 20)}\n${code.slice(20)} `, 'invite');
ok('invite code: compressed, survives spaces / line breaks from chat apps', /^MTWI1\./.test(code) && code.length < sdp.length && d1.ok && d1.body.sdp === sdp && d1.body.name === 'Bob');
ok('invite code: wrong kind (KIND), garbage (FORMAT), old (EXPIRED)', (decodeCode(code, 'reply') as { code: string }).code === 'KIND' && (decodeCode('MTWI1.!!!', 'invite') as { code: string }).code === 'FORMAT' && (decodeCode(code, 'invite', Date.now() + CODE_TTL_MS + 1000) as { code: string }).code === 'EXPIRED');
const forged = encodeCode({ kind: 'invite', id: 'p2p-zz', pub, name: 'x', sdp, at: Date.now() });
ok('invite code: a bad id / key inside is refused', (decodeCode(forged, 'invite') as { code: string }).code === 'FORMAT');

// P2P friends in the game
const mii = Buffer.from(Array.from({ length: 96 }, (_, i) => i)).toString('base64');
const good = toFriend({ id, name: 'Bob', online: true, profile: { profile: { miiData: mii, name: 'Bob<script>', birthday: { month: 13, day: 40 }, greetings: { goIn: 'Ciao!' } }, outfit: { tops: { id: '0012', color: 99 } }, room: { wall: '0001', floor: '0002' } } }, { [id]: { n: 2, last: '2026-10-27T10:00:00Z' } });
ok('P2P friend → game friend: source p2p, their Mii, values clamped, visits counted locally', !!good && good.source === 'p2p' && good.profile.miiData === mii && good.profile.name.length <= 10 && good.profile.birthday?.month === 12 && good.outfit.tops?.color === 15 && good.visits === 2, good);
ok('P2P friend with no valid Mii is not shown', toFriend({ id, name: 'X', online: false, profile: { profile: { miiData: 'nope' } } }) === null && toFriend({ id, name: 'X', online: false, profile: null }) === null);
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
