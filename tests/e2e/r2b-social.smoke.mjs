// REBOOT R2b: social life in the room (NEW, not original Nintendo) on the real engine. 2 Miis (host ↔ guest talk),
// then 8 Miis: conversations one balloon at a time, glances, varied autonomous activities, no lockstep, movement not
// blocked by talking, nobody stuck, player tap pauses / resumes a conversation, a guest leaving mid-conversation,
// and Classic (?reboot=0) loads no Reboot code.
// Usage: node tests/e2e/r2b-social.smoke.mjs <url> <outDir> <file1> [file2...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const logs = []; page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); }); page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const checks = {}; const fail = [];
const expect = (n, ok, info) => { checks[n] = { ok: !!ok, info }; if (!ok) fail.push(`${n}: ${JSON.stringify(info)}`); };
const sim = (s) => page.evaluate((s) => window.__mtw.simRoom(s), s);
const ev = (f, a) => page.evaluate(f, a);
const screen = (n, t = 60000) => page.waitForFunction((n) => window.__mtw.play.currentScreen === n, n, { timeout: t });
const simUntil = async (fn, maxSec, step = 0.25, arg) => { for (let t = 0; t < maxSec; t += step) { if (await ev(fn, arg)) return true; await sim(step); } return !!(await ev(fn, arg)); };
await page.goto(url + (url.includes('?') ? '&' : '?') + 'reboot=1');
await screen('setup');
await page.setInputFiles('#play input[type=file]', files);
await screen('create', 300000);
await page.click('#play [data-a=next]'); await page.fill('#play .pl-input', 'Kelly'); await page.click('#play [data-a=next]');
await page.selectOption('#play select[data-k=m]', '5'); await page.selectOption('#play select[data-k=d]', '2'); await page.click('#play [data-a=ok]');
await screen('personality', 20000); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 120000 });
await ev(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
await sim(16); await ev(() => window.__mtw.roomUi.close(true));
await page.waitForFunction(() => !!window.__mtw.reboot, null, { timeout: 20000 });
const rebootJs = await ev(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\.js(\?|$)/.test(n)));
const soc0 = await ev(() => ({ social: !!window.__mtw.reboot.social, flag: window.__mtw.reboot.flags.on('SOCIAL_LIFE_ENABLED') }));
expect('Reboot: social life on by default (flag SOCIAL_LIFE_ENABLED)', soc0.social && soc0.flag, soc0);
const names = ['Lucia', 'Marco', 'Sara', 'Gino', 'Ada', 'Teo', 'Bea'];
const ids = await ev(async (names) => {
  const P = window.__mtw.play; const out = [];
  for (let i = 0; i < names.length; i++) {
    const b = window.__mtw.playApi.randomMii(i % 2); const b64 = btoa(String.fromCharCode(...b));
    const lv = [[8, 8, 8, 8, 4], [0, 0, 0, 0, 4], [8, 0, 8, 0, 4], [0, 8, 0, 8, 4]][i % 4];
    const f = await P.social.add({ profile: { miiData: b64, name: names[i], birthday: { month: 3, day: 3 + i }, height: 50, build: 50, personality: lv, greetings: { welcome: '', goIn: `Ciao, sono ${names[i]}!`, seeingOff: '', goHome: 'A presto!' }, voice: { pitch: 50, speed: 50, accent: 50, energy: 50, depth: 50 } }, outfit: structuredClone(P.save.outfit), room: { wall: '0000', floor: '0000', variant: 0 } });
    out.push(f.id);
  }
  return out;
}, names);
const S = () => ev(() => { const s = window.__mtw.reboot.social; return { stats: s.stats, convos: s.conversations, floor: s.floorHolder }; });
// ---- 2 Miis: the host and one guest
await ev((id) => window.__mtw.play.inviteGuest(id), ids[0]);
await simUntil(() => window.__mtw.guests[0]?.director.state === 'idle', 40);
const hostTalk = await simUntil(() => window.__mtw.reboot.social.log.some((l) => l.type === 'end' && /done/.test(l.info) && l.ids.includes('host')), 240, 0.5);
const say2 = await ev(() => window.__mtw.reboot.social.log.filter((l) => l.type === 'say').map((l) => l.ids[0]));
expect('2 Miis: host and guest have a real conversation (both speak, it ends)', hostTalk && say2.includes('host') && say2.some((x) => x !== 'host'), { hostTalk, say2 });
// ---- 8 Miis
await ev(() => window.__mtw.reboot.multi.setMiis(8));
for (const id of ids.slice(1)) await ev((id) => window.__mtw.play.inviteGuest(id), id);
const all = await simUntil(() => window.__mtw.guests.length === 7 && window.__mtw.guests.every((g) => g.director.state !== 'entering' && g.director.state !== 'outside'), 260, 0.5);
expect('8 Miis in the room (7 guests through the door, one at a time)', all, await ev(() => window.__mtw.guests.map((g) => g.director.state)));
await page.screenshot({ path: `${out}/r2b-01-eight.png` });
const st0 = (await S()).stats;
let insideOk = true, badBal = [], lock = 0, samples = 0, mixed = 0, walkWhileTalk = 0, maxWalk = {}, walkT = {}, balloonOk = true, glanceAll = 0, shot = 0;
for (let i = 0; i < 240; i++) {
  await sim(1);
  const r = await ev(() => {
    const s = window.__mtw.reboot.social, snap = new Map(s.snapshot().map((x) => [x.id, x]));
    const ds = [['host', window.__mtw.director], ...window.__mtw.guests.map((g) => [g.spec.id, g.director])];
    const lab = ds.filter(([id]) => id !== 'host').map(([id, d]) => { const x = snap.get(id); return x?.convo ? 'talk' : d.state === 'walking' ? 'walk' : d.state === 'interacting' ? 'use' : x?.plan ?? d.state; });
    const talking = s.conversations.some((c) => c.phase === 'talk') && window.__mtw.roomUi.isOpen;
    const bal = window.__mtw.roomUi.isOpen ? { sp: window.__mtw.roomUi.speaker, talker: window.__mtw.talker?.spec.id ?? null, label: window.__mtw.roomUi.openLabel } : null;
    const conv = s.conversations.find((c) => c.id === s.floorHolder);
    return { lab, talking, walking: ds.filter(([, d]) => d.state === 'walking').map(([id]) => id), bal, conv, inside: ds.every(([, d]) => d.state === 'entering' || d.state === 'exiting' || d.state === 'outside' || (Math.abs(d.pos.x) < 34 && Math.abs(d.pos.z) < 34)) };
  });
  samples++; if (new Set(r.lab).size === 1) lock++; if (new Set(r.lab).size >= 3) mixed++;
  if (r.talking && r.walking.length) walkWhileTalk++;
  for (const id of Object.keys(walkT)) if (!r.walking.includes(id)) walkT[id] = 0;
  for (const id of r.walking) { walkT[id] = (walkT[id] ?? 0) + 1; maxWalk[id] = Math.max(maxWalk[id] ?? 0, walkT[id]); }
  if (r.bal && /^reboot:chat/.test(r.bal.label ?? '') && (!r.conv || (r.bal.sp === 'guest' && ![r.conv.a, r.conv.b].includes(r.bal.talker)) || (r.bal.sp === 'host' && ![r.conv.a, r.conv.b].includes('host')))) { balloonOk = false; badBal.push({ bal: r.bal, conv: r.conv }); }
  if (!r.inside) insideOk = false;
  if (r.talking && shot < 2 && i > 30 + shot * 60) { await page.screenshot({ path: `${out}/r2b-0${2 + shot}-talk.png` }); shot++; }
}
const st1 = await S();
const d = (k) => st1.stats[k] - st0[k];
expect('8 Miis: several conversations completed in 4 minutes, more than one pair', d('done') >= 3 && new Set((await ev(() => window.__mtw.reboot.social.log.filter((l) => l.type === 'convo').map((l) => [...l.ids].sort().join('+'))))).size >= 3, { done: d('done'), started: d('started'), aborted: d('aborted') });
expect('a chat balloon always belongs to a member of the conversation holding the floor', balloonOk, badBal.slice(0, 3));
expect('everybody stays inside the room', insideOk, null);
expect('talking does not block movement: others walk while two Miis talk', walkWhileTalk >= 5, walkWhileTalk);
expect('variety: the guests are almost never all doing the same thing', lock / samples < 0.1 && mixed / samples > 0.5, { lock, mixed, samples });
expect('nobody stuck: no Mii walks for more than 20 s in a row', Object.values(maxWalk).every((w) => w <= 20), maxWalk);
const acts = st1.stats.activities;
expect('autonomous activities: wander, use objects, rest, watch a conversation', acts.wander > 3 && acts.inspect >= 1 && acts.rest > 3, acts);
expect('social reactions: Miis turn toward who talks / who comes in', d('looks') >= 5, d('looks'));
const viol = await ev(() => [window.__mtw.director, ...window.__mtw.guests.map((g) => g.director)].flatMap((x) => x.violations));
expect('no state-machine violations with 8 social Miis', viol.length === 0, viol);
// ---- player priority: tap a guest that is talking
let tapped = null;
for (let i = 0; i < 240 && !tapped; i++) {
  await sim(0.5);
  tapped = await ev(() => { const s = window.__mtw.reboot.social, c = s.conversations.find((x) => x.phase === 'talk' && x.line >= 1); const t = window.__mtw.talker;
    if (!c || !window.__mtw.roomUi.isOpen || window.__mtw.roomUi.speaker !== 'guest' || !t || ![c.a, c.b].includes(t.spec.id) || t.director.state !== 'idle') return null;
    const p = t.director.pos; const sp = window.__mtw.projectRoom(p.x, 6, p.z); const hit = window.__mtw.roomPick(sp.x, sp.y); if (hit.kind !== 'guest' || hit.guestId !== t.spec.id) return null;
    window.__mtw.roomClick(sp.x, sp.y); return { id: t.spec.id, convo: c.id, line: c.line }; });
}
await sim(0.3);
const tap = await ev((t) => t && ({ st: window.__mtw.guests.find((g) => g.spec.id === t.id)?.director.state, log: window.__mtw.reboot.social.log.filter((l) => (l.type === 'player' || l.type === 'pause') && l.ids.includes(t.id)).map((l) => l.type) }), tapped);
expect('player tap on a talking Mii wins (priority 1): it reacts, the conversation pauses', tapped && tap.st === 'reacting' && tap.log.includes('player') && tap.log.includes('pause'), { tapped, tap });
await ev(() => window.__mtw.roomUi.close(true));
const after = tapped && await simUntil((t) => window.__mtw.reboot.social.log.some((l) => (l.type === 'resume' && l.info?.startsWith(`#${t.convo}`)) || (l.type === 'end' && l.info?.startsWith(`#${t.convo} `))), 30, 0.5, tapped);
const how = await ev((t) => window.__mtw.reboot.social.log.filter((l) => l.info?.startsWith(`#${t.convo}`)).map((l) => `${l.type} ${l.info}`), tapped);
expect('then the conversation resumes from where it was (or ends politely after the wait)', after, how);
// ---- a guest leaves in the middle of a conversation
let gone = null;
for (let i = 0; i < 240 && !gone; i++) {
  await sim(0.5);
  gone = await ev(() => { const c = window.__mtw.reboot.social.conversations.find((x) => x.phase === 'talk' && x.a !== 'host' && x.b !== 'host'); if (!c) return null; window.__mtw.playApi.guestLeave(c.a); return { id: c.a, convo: c.id }; });
}
const left = gone && await simUntil((g) => !window.__mtw.guests.some((x) => x.spec.id === g.id), 60, 0.5, gone);
const endLog = await ev((g) => window.__mtw.reboot.social.log.filter((l) => l.type === 'end' && l.info?.startsWith(`#${g.convo} `)).map((l) => l.info), gone);
await sim(20);
const still = await ev(() => window.__mtw.reboot.social.snapshot().length);
expect('a guest leaving mid-conversation: it says goodbye and goes, the conversation ends, the others go on', gone && left && endLog.length === 1 && still === 7, { gone, left, endLog, still });
const errs = logs.filter((l) => /pageerror|^error/.test(l));
expect('no page errors', errs.length === 0, errs.slice(0, 5));
// ---- Classic loads no Reboot code
await page.goto(url + (url.includes('?') ? '&' : '?') + 'reboot=0');
await page.waitForFunction(() => window.__mtw?.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 300000 });
const classicJs = await ev(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\.js(\?|$)/.test(n)));
const extra = rebootJs.filter((u) => !classicJs.includes(u));
const cl = await ev(() => ({ reboot: !!window.__mtw.reboot, layer: !!document.querySelector('.rbt-layer'), cap: window.__mtw.playApi.guestCapacity() }));
expect('Classic (?reboot=0) does not download the Reboot chunk, no Reboot UI, capacity 1', extra.length >= 1 && !classicJs.some((u) => extra.includes(u)) && !cl.reboot && !cl.layer && cl.cap === 1, { extra, classicJs, cl });
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, social: st1, logs: logs.slice(-40) }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
