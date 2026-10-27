// REBOOT R1/R2 unit tests: gate, flags, rate limits, providers (local + server contracts), multi-Mii settings,
// and the Classic ↔ Reboot import boundary. Run from client/web: npx tsx ../../tests/unit/reboot.test.mts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { rebootRequested, REBOOT_STORAGE_KEY } from '../../client/web/src/reboot/gate';
import { RebootFlags, FLAGS } from '../../client/web/src/reboot/flags';
import { RateLimiter } from '../../client/web/src/reboot/safety/rateLimit';
import { createLocalProvider, createServerProvider } from '../../client/web/src/reboot/api/provider';
import { ENDPOINTS } from '../../client/web/src/reboot/api/contracts';
import { MultiMii, clampMiis, loadSettings } from '../../client/web/src/reboot/multimii/MultiMii';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const kv = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

// ---- gate
{
  const store = kv(); (globalThis as any).localStorage = store;
  ok('gate: closed by default', rebootRequested('') === false);
  ok('gate: ?reboot=1 opens and is remembered', rebootRequested('?reboot=1') === true && rebootRequested('') === true && store.getItem(REBOOT_STORAGE_KEY) === '1');
  ok('gate: ?reboot=0 closes and is remembered (Classic launcher)', rebootRequested('?reboot=0') === false && rebootRequested('') === false);
  delete (globalThis as any).localStorage;
}
// ---- flags
{
  const s = kv();
  const off = new RebootFlags(false, s);
  ok('flags: master off → every flag off', FLAGS.every((f) => off.on(f.id) === false));
  const on = new RebootFlags(true, s);
  ok('flags: master on → REBOOT + implemented MULTI_MII on by default', on.on('REBOOT_ENABLED') && on.on('MULTI_MII_ENABLED'));
  ok('flags: not-implemented features are never effective (even if stored on)', (on.set('EVENTS_ENABLED', true), !on.on('EVENTS_ENABLED')) && !on.on('NOTIFICATIONS_ENABLED'));
  on.set('MULTI_MII_ENABLED', false);
  ok('flags: persisted per browser', new RebootFlags(true, s).on('MULTI_MII_ENABLED') === false);
  ok('flags: all 10 requested flags declared', ['REBOOT_ENABLED', 'MIINSTAGRAM_ENABLED', 'PUBLIC_ROOMS_ENABLED', 'MINIGAMES_ENABLED', 'EVENTS_ENABLED', 'NOTIFICATIONS_ENABLED', 'MULTI_MII_ENABLED', 'HUB_ENABLED', 'REWARDS_ENABLED', 'MIIFOTO2_ENABLED'].every((id) => FLAGS.some((f) => f.id === id)));
  const bad = kv(); bad.setItem('mtw.reboot.flags', '{not json');
  ok('flags: corrupt storage → defaults, no throw', new RebootFlags(true, bad).on('MULTI_MII_ENABLED') === true);
}
// ---- rate limiter
{
  let t = 0; const rl = new RateLimiter({ default: { capacity: 2, refillPerSec: 1 }, comment: { capacity: 1, refillPerSec: 0.5 } }, () => t);
  ok('rate: burst within capacity allowed', rl.take('x') === 0 && rl.take('x') === 0);
  const w = rl.take('x');
  ok('rate: over capacity → wait ms', w > 0 && w <= 1000, w);
  t += 1000; ok('rate: refills over time', rl.take('x') === 0);
  ok('rate: per-operation buckets', rl.take('comment') === 0 && rl.take('comment') === 2000);
}
// ---- local provider
{
  const store = kv(); const api = createLocalProvider(store);
  const r1 = await api.report({ targetType: 'post', targetId: 'p1', reason: 'spam', note: 'x'.repeat(900) });
  ok('local: report stored, note capped', r1.ok && api.safety().reports.length === 1 && api.safety().reports[0].note!.length === 500);
  const bad = await api.report({ targetType: 'evil' as any, targetId: 'p1', reason: 'spam' });
  ok('local: invalid report refused (untrusted input)', !bad.ok && bad.error.code === 'INVALID');
  await api.mute('u2', true); await api.block('u2');
  ok('local: block wins over mute, persisted', api.safety().blocked.includes('u2') && !api.safety().muted.includes('u2') && JSON.parse(store.getItem('mtw.reboot.safety')!).blocked[0] === 'u2');
  const pv = await api.privacy({ room: 'public' }); const pbad = await api.privacy({ posts: 'everyone' as any });
  ok('local: privacy defaults friends, validated update', pv.ok && pv.value.room === 'public' && pv.value.profile === 'friends' && !pbad.ok);
  const nc = await api.feed();
  ok('local: not-yet-built method answers NOT_CONFIGURED with its phase', !nc.ok && nc.error.code === 'NOT_CONFIGURED' && /R5/.test(nc.error.message), nc);
  let limited = false; for (let i = 0; i < 8; i++) { const r = await api.report({ targetType: 'post', targetId: 'p' + i, reason: 'spam' }); if (!r.ok && r.error.code === 'RATE_LIMITED') limited = true; }
  ok('local: reports rate-limited', limited);
}
// ---- server provider (contracts)
{
  let threw = false; try { createServerProvider('https://api.accounts.nintendo.com'); } catch { threw = true; }
  ok('server: Nintendo hosts refused', threw);
  const none = await createServerProvider(null).me();
  ok('server: no URL → NOT_CONFIGURED', !none.ok && none.error.code === 'NOT_CONFIGURED');
  const calls: any[] = [];
  const fake = (async (url: string, init: any) => { calls.push({ url, ...init }); return { ok: url.includes('/v1/posts/p%2F1/reactions'), status: url.includes('reactions') ? 200 : 429, json: async () => (url.includes('reactions') ? { id: 'p/1' } : { error: { code: 'RATE_LIMITED', message: 'slow' } }) }; }) as any;
  const api = createServerProvider('https://example.test/api/', fake);
  const r = await api.react('p/1', 'smile', true); const f = await api.feed({ limit: 5 });
  ok('server: endpoint path + id encoding + JSON body + session cookie', r.ok && calls[0].url === 'https://example.test/api/v1/posts/p%2F1/reactions' && calls[0].method === 'PUT' && calls[0].credentials === 'include' && calls[0].body === JSON.stringify(['smile', true]), calls[0]);
  ok('server: GET query + server error mapped', !f.ok && f.error.code === 'RATE_LIMITED' && calls[1].url.endsWith('/v1/feed?limit=5'), calls[1]);
  ok('server: every API method has an endpoint', Object.keys(ENDPOINTS).length >= 34, Object.keys(ENDPOINTS).length);
}
// ---- multi-Mii settings + group invite
{
  ok('multi: clamp 2..8', clampMiis(1) === 2 && clampMiis(99) === 8 && clampMiis(NaN) === 4);
  const store = kv();
  const guests: { id: string; name: string; state: string; leaving: boolean }[] = []; let cap = 1;
  const host: any = { capacity: () => cap, setCapacity: (n: number) => (cap = n), guests: () => guests, invite: async (id: string) => { if (guests.length >= cap) return false; guests.push({ id, name: id, state: 'entering', leaving: false }); return true; }, dismiss: (id: string) => { const g = guests.find((x) => x.id === id); if (g) g.leaving = true; return !!g; } };
  const mm = new MultiMii(host, store);
  ok('multi: default 4 Miis → capacity 3 guests', cap === 3 && mm.settings.miis === 4);
  const got = await mm.inviteMany(['a', 'b', 'c', 'd', 'e']);
  ok('multi: group invite stops at capacity', got.join() === 'a,b,c' && guests.length === 3);
  mm.setMiis(6);
  ok('multi: capacity persisted', loadSettings(store).miis === 6 && cap === 5);
  ok('multi: dismiss all', mm.dismissAll() === 3 && guests.every((g) => g.leaving));
}
// ---- Classic ↔ Reboot boundary
{
  const src = join(process.cwd(), 'src');
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n)) files.push(p); } };
  walk(src);
  const classic = files.filter((f) => !relative(src, f).startsWith('reboot'));
  const offenders: string[] = [];
  for (const f of classic) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/(?:^|\n)\s*import\s+(type\s+)?[^'"]*from\s+['"]([^'"]*reboot\/[^'"]*)['"]/g)) {
      const typeOnly = !!m[1], spec = m[2];
      if (!(spec.endsWith('reboot/gate') || (typeOnly && spec.endsWith('reboot/host')))) offenders.push(`${relative(src, f)}: ${spec}`);
    }
  }
  ok('boundary: Classic imports only reboot/gate (+ the RebootHost type) statically', offenders.length === 0, offenders);
  const main = readFileSync(join(src, 'main.ts'), 'utf8');
  ok('boundary: the Reboot runtime is a dynamic import guarded by the gate', /REBOOT_ON[\s\S]{0,5000}import\('\.\/reboot\/index'\)/.test(main));
  const reb = files.filter((f) => relative(src, f).startsWith('reboot'));
  const rebBad = reb.filter((f) => /from\s+['"]\.\.\/\.\.\/(play|room|body|agx)\//.test(readFileSync(f, 'utf8')) || /from\s+['"]\.\.\/(main|play\/Play)['"]/.test(readFileSync(f, 'utf8')));
  ok('boundary: Reboot reaches shared infrastructure only through RebootHost', rebBad.length === 0, rebBad);
}
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else console.log('ALL PASS');
