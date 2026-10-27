// Desktop app — local accounts (register / login / identity keys) and the user's-files scanner. Run: node tests/desktop/accounts.test.cjs
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Accounts, peerId, friendCode } = require('../../desktop/lib/accounts.cjs');
const assets = require('../../desktop/lib/assets.cjs');
let fails = 0; const ok = (n, c, i) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtw-acct-'));
const a = new Accounts(dir);
ok('empty at first', a.list().accounts.length === 0 && a.current() === null);
ok('register: bad names / short passwords refused', a.register('x', 'secret1').code === 'BAD_USERNAME' && a.register('kelly!', 'secret1').code === 'BAD_USERNAME' && a.register('kelly', '12345').code === 'BAD_PASSWORD');
const r = a.register('Kelly', 'segreto1');
ok('register: logged in, identity with peer id and friend code', r.ok && /^p2p-[0-9a-f]{16}$/.test(r.account.peerId) && /^MTW-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(r.account.code), r);
ok('register: the same name (any case) is taken', a.register('kelly', 'altro123').code === 'TAKEN');
const raw = fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8');
ok('stored: no password, no plain private key', !raw.includes('segreto1') && !/BEGIN|PRIVATE/.test(raw) && JSON.parse(raw).accounts[0].key.data.length > 40);
const sig = a.sign('hello');
ok('sign / verify with the account key; a changed text or another key fails', Accounts.verify(r.account.pub, 'hello', sig) && !Accounts.verify(r.account.pub, 'hellO', sig) && !Accounts.verify(a.register('Other', 'pass123').account.pub, 'hello', sig));
a.logout();
ok('logged out: cannot sign', a.sign('x') === null && a.current() === null);
const b = new Accounts(dir);
ok('login: wrong password / unknown user refused the same way', b.login('Kelly', 'nope').code === 'WRONG' && b.login('Nobody', 'segreto1').code === 'WRONG');
const l = b.login('kelly', 'segreto1');
ok('login (any case): same identity as at sign-up; can sign', l.ok && l.account.pub === r.account.pub && Accounts.verify(l.account.pub, 'x', b.sign('x')));
ok('change password: old one refused after, identity kept', b.changePassword('segreto1', 'nuovo-pw').ok && new Accounts(dir).login('Kelly', 'segreto1').code === 'WRONG' && new Accounts(dir).login('Kelly', 'nuovo-pw').account?.pub === r.account.pub);
ok('peer id / code are derived from the key (stable)', peerId(r.account.pub) === r.account.peerId && friendCode(r.account.pub) === r.account.code);
fs.writeFileSync(path.join(dir, 'accounts.json'), '{broken');
const c = new Accounts(dir);
ok('corrupt file: starts empty, the old file is kept aside', c.list().accounts.length === 0 && fs.readdirSync(dir).some((n) => n.startsWith('accounts.json.corrupt-')));
// user's files
const ad = fs.mkdtempSync(path.join(os.tmpdir(), 'mtw-assets-'));
for (const n of ['Miitomo_2.4.0.apk', 'asset_env_room.zip', 'random.zip', 'notes.txt']) fs.writeFileSync(path.join(ad, n), 'x');
fs.mkdirSync(path.join(ad, 'local-assets', 'cdn'), { recursive: true }); fs.writeFileSync(path.join(ad, 'local-assets', 'cdn', 'cdn1.zip'), 'x');
const m = assets.scan(ad);
ok('assets: only the patterns of serve-local.ps1 (+ local-assets/cdn/*.zip)', [...m.keys()].sort().join() === 'Miitomo_2.4.0.apk,asset_env_room.zip,cdn1.zip', [...m.keys()]);
ok('assets: paths cannot escape the served folder', assets.inside(ad, '../etc/passwd') === null && assets.inside(ad, 'a/../../x') === null && !!assets.inside(ad, 'notes.txt'));
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); }
