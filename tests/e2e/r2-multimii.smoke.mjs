// REBOOT R2: several Miis in the same room (NEW, not original Nintendo). Gate ?reboot=1 → Reboot pill + panel, default
// 4 Miis (host + 3), group invite, one Mii through the shared door at a time, personal distance between ALL pairs, no
// state violations, Miis not in lockstep, tapping one specific guest, dismissing one (goodbye 1.4 → 1.3), capacity
// persisted across reload, and ?reboot=0 → pure Classic (no Reboot UI, one guest at most).
// Usage: node tests/e2e/r2-multimii.smoke.mjs <url> <outDir> <file1> [file2...]
// Usage: node tests/e2e/m18-guest.smoke.mjs <url> <outDir> <file1> [file2...]
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
const simUntil = async (fn, maxSec, step = 0.25) => { for (let t = 0; t < maxSec; t += step) { if (await ev(fn)) return true; await sim(step); } return !!(await ev(fn)); };
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
const pill = await ev(() => { const l = document.querySelector('.rbt-layer'); const p = document.querySelector('.rbt-pill'); return { layer: !!l && !l.hidden, text: p?.textContent, cap: window.__mtw.playApi.guestCapacity() }; });
expect('Reboot on: pill on the room screen, default 4 Miis (host + 3 guests)', pill.layer && /Reboot/.test(pill.text) && pill.cap === 3, pill);
// four local friends with different personalities
const names = ['Lucia', 'Marco', 'Sara', 'Gino'];
const ids = await ev(async (names) => {
  const P = window.__mtw.play; const out = [];
  for (let i = 0; i < names.length; i++) {
    const b = window.__mtw.playApi.randomMii(i % 2); const b64 = btoa(String.fromCharCode(...b));
    const f = await P.social.add({ profile: { miiData: b64, name: names[i], birthday: { month: 3, day: 3 + i }, height: 50 + i * 10, build: 50, personality: [i * 2, 8 - i * 2, i, 8 - i, 4], greetings: { welcome: '', goIn: `Ciao, sono ${names[i]}!`, seeingOff: '', goHome: 'A presto!' }, voice: { pitch: 50, speed: 50, accent: 50, energy: 50, depth: 50 } }, outfit: structuredClone(P.save.outfit), room: { wall: '0000', floor: '0000', variant: 0 } });
    out.push(f.id);
  }
  return out;
}, names);
// panel: invite everyone
await page.click('.rbt-pill'); await page.waitForSelector('.rbt-sheet:not([hidden]) [data-a=inviteAll]');
await page.screenshot({ path: `${out}/r2-01-panel.png` });
await page.click('[data-a=inviteAll]');
await page.waitForFunction(() => window.__mtw.guests.length === 3, null, { timeout: 120000 });
const g0 = await ev(() => window.__mtw.guests.map((g) => ({ n: g.spec.name, st: g.director.state })));
expect('group invite: 3 of 4 friends accepted (capacity), the 4th refused', g0.length === 3 && g0.map((g) => g.n).join() === 'Lucia,Marco,Sara', g0);
const msg = await ev(() => document.querySelector('[data-msg]')?.textContent);
// walk the arrivals: door one at a time, distance between all pairs, all inside
let maxDoor = 0, minD = Infinity, minWhy = null, inside = true;
for (let i = 0; i < 400; i++) {
  await sim(0.25);
  const r = await ev(() => { const all = [window.__mtw.director, ...window.__mtw.guests.map((g) => g.director)].filter((d) => d.state !== 'outside');
    let m = Infinity, why = null; for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) { const dd = all[a].pos.distanceTo(all[b].pos); if (dd < m) { m = dd; why = [all[a], all[b]].map((d) => `${d.state}@${d.pos.x.toFixed(1)},${d.pos.z.toFixed(1)} ${d.currentClip}`); } }
    return { why, m2: m, door: [window.__mtw.director, ...window.__mtw.guests.map((g) => g.director)].filter((d) => d.state === 'entering' || d.state === 'exiting').length, m, ok: all.filter((d) => d.state !== 'entering' && d.state !== 'exiting').every((d) => Math.abs(d.pos.x) < 34 && Math.abs(d.pos.z) < 34), present: all.length,
      walking: all.filter((d) => d.state === 'walking').length }; });
  maxDoor = Math.max(maxDoor, r.door); inside = inside && r.ok;
  if (r.present >= 2 && r.walking === 0 && r.m < minD) { minD = r.m; minWhy = r.why; }
  if (r.present === 4 && i > 40) { const idle = await ev(() => window.__mtw.guests.every((g) => g.director.state === 'idle')); if (idle) break; }
}
const arrived = await ev(() => ({ st: window.__mtw.guests.map((g) => g.director.state), telops: window.__mtw.guestLog.filter((l) => /^arrivo/.test(l)) }));
expect('all three came in, one at a time through the shared door', arrived.st.every((s) => s === 'idle' || s === 'walking' || s === 'reacting') && arrived.telops.length >= 3 && maxDoor <= 1, { arrived, maxDoor, msg });
await ev(() => window.__mtw.roomUi.close(true));
await page.click('[data-a=close]');
await page.screenshot({ path: `${out}/r2-02-four-miis.png` });
// life: everybody moves for a while — distance between all pairs, no violations, not in lockstep
const clips = new Set(); let lock = 0, samples = 0;
for (let i = 0; i < 120; i++) {
  if (i === 20) await ev(() => { const g = window.__mtw.guests[1].director.pos; window.__mtw.director.goTo(g.clone()); });
  if (i === 60) await ev(() => window.__mtw.guests[2].director.goTo(window.__mtw.guests[0].director.pos.clone()));
  await sim(0.5);
  const r = await ev(() => { const all = [window.__mtw.director, ...window.__mtw.guests.map((g) => g.director)].filter((d) => d.state !== 'outside');
    let m = Infinity, why = null; for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) { const dd = all[a].pos.distanceTo(all[b].pos); if (dd < m) { m = dd; why = [all[a], all[b]].map((d) => `${d.state}@${d.pos.x.toFixed(1)},${d.pos.z.toFixed(1)} ${d.currentClip}`); } }
    const gs = window.__mtw.guests.map((g) => `${g.director.currentClip}@${g.director.clipTime.toFixed(2)}`);
    return { m, why, ok: all.filter((d) => d.state !== 'entering' && d.state !== 'exiting').every((d) => Math.abs(d.pos.x) < 34 && Math.abs(d.pos.z) < 34), gs, walking: all.filter((d) => d.state === 'walking').length };
  });
  if (r.walking === 0 && r.m < minD) { minD = r.m; minWhy = r.why; }
  inside = inside && r.ok; samples++; if (new Set(r.gs).size === 1) lock++; r.gs.forEach((c) => clips.add(c.split('@')[0]));
}
const viol = await ev(() => [window.__mtw.director, ...window.__mtw.guests.map((g) => g.director)].flatMap((d) => d.violations));
expect('four Miis: personal distance between every pair when they stop (≥ 4.0), all inside the room', minD >= 4.0 && inside, { minD, minWhy, inside });
expect('no state-machine violations on any Mii', viol.length === 0, viol);
expect('guests are not in lockstep (different clip / phase)', lock === 0, { lock, samples, clips: [...clips] });
// tap ONE specific guest
await simUntil(() => window.__mtw.guests.every((g) => g.director.state === 'idle') && window.__mtw.director.state === 'idle', 20);
// a guest that is not hidden behind another Mii from the camera: the tap point must pick exactly that guest
const tgt = await ev(() => { const M = window.__mtw; for (let i = 0; i < M.guests.length; i++) { const g = M.guests[i], p = g.director.pos; for (const h of [6, 8, 4, 10]) { const s = M.projectRoom(p.x, h, p.z); const k = M.roomPick(s.x, s.y); if (k.kind === 'guest' && k.guestId === g.spec.id) return { s, name: g.spec.name, i }; } } return { s: null, name: null, i: -1 }; });
const ti = tgt.i;
const hit = await ev((s) => window.__mtw.roomClick(s.x, s.y), tgt.s);
await sim(0.2);
const st0 = await ev(() => window.__mtw.guests.map((g) => g.director.state));
let touched = ['', '', '']; for (let k = 0; k < 12 && touched[ti] !== 'stroked'; k++) { await sim(0.25); touched = await ev(() => window.__mtw.guests.map((g) => g.director.currentClip === 'animActionStroked' ? 'stroked' : g.director.state)); }   // others may be in their own reactions (R2b life, idle look-around): only the tapped one is stroked
await simUntil(() => window.__mtw.roomUi.snapshot()?.kind === 'greeting' && window.__mtw.roomUi.speaker === 'guest', 8);
const tb = await ev(() => ({ name: document.querySelector('.rb-name')?.textContent, talker: window.__mtw.talker?.spec.name }));
expect('tapping one guest: only that guest reacts and greets with its own name', ti >= 0 && hit === 'guest' && st0[ti] === 'reacting' && touched[ti] === 'stroked' && touched.filter((t, j) => j !== ti).every((t) => t !== 'stroked') && tb.talker === tgt.name, { hit, st0, touched, tb, tgt: tgt.name, ti });
await page.screenshot({ path: `${out}/r2-03-tap-one.png` });
await ev(() => window.__mtw.roomUi.close(true));
// dismiss one from the panel → goodbye 1.4 → 1.3 → exits; the others stay
await simUntil(() => window.__mtw.guests.every((g) => g.director.state === 'idle'), 15);
if (await ev(() => document.querySelector('.rbt-sheet').hidden)) await page.click('.rbt-pill');
await page.waitForSelector('.rbt-sheet:not([hidden])');
await page.click(`[data-a=dismiss][data-id="${ids[0]}"]`);
const bye = await simUntil(() => window.__mtw.roomUi.snapshot()?.label === 'customGreetingGoHome', 10);
const byeName = await ev(() => window.__mtw.talker?.spec.name);
const seeing = await simUntil(() => window.__mtw.roomUi.snapshot()?.label === 'customGreetingSeeingOff', 10);
const gone = await simUntil(() => window.__mtw.guests.length === 2, 40);
expect('dismissed guest says goodbye (1.4), the host sees it off (1.3), it leaves; the others stay', bye && byeName === 'Lucia' && seeing && gone && (await ev(() => window.__mtw.guests.map((g) => g.spec.name).join())) === 'Marco,Sara', { bye, byeName, seeing, gone });
// capacity: 8 Miis, persisted
if (await ev(() => document.querySelector('.rbt-sheet').hidden)) await page.click('.rbt-pill');
await page.waitForSelector('.rbt-sheet:not([hidden]) [data-a=more]');
for (let i = 0; i < 4; i++) await page.click('[data-a=more]');
const cap8 = await ev(() => ({ cap: window.__mtw.playApi.guestCapacity(), shown: document.querySelector('[data-cap]')?.textContent, more: document.querySelector('[data-a=more]')?.disabled }));
expect('capacity stepper up to 8 Miis (7 guests), then disabled', cap8.cap === 7 && cap8.shown === '8' && cap8.more === true, cap8);
const okInv = await ev((id) => window.__mtw.play.inviteGuest(id), ids[3]);
expect('with room for more, the 4th friend can now come in', okInv === true && (await ev(() => window.__mtw.guests.length)) === 3, okInv);
const logs0 = logs.filter((l) => /pageerror|error:/i.test(l));
expect('no page errors', logs0.length === 0, logs0);
await page.reload();
await page.waitForFunction(() => window.__mtw?.director && window.__mtw.play.currentScreen === 'room' && !!window.__mtw.reboot, null, { timeout: 300000 });
const after = await ev(() => ({ cap: window.__mtw.playApi.guestCapacity(), on: window.__mtw.REBOOT_ON }));
expect('reload: Reboot stays on, 8-Mii capacity remembered', after.on && after.cap === 7, after);
// Classic again: ?reboot=0
await page.goto(url + (url.includes('?') ? '&' : '?') + 'reboot=0');
await page.waitForFunction(() => window.__mtw?.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 300000 });
await ev(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
await sim(16); await ev(() => window.__mtw.roomUi.close(true));
const c1 = await ev(async (ids) => { const a = await window.__mtw.play.inviteGuest(ids[0]); const b = await window.__mtw.play.inviteGuest(ids[1]); return { a, b, cap: window.__mtw.playApi.guestCapacity(), pill: !!document.querySelector('.rbt-layer'), on: window.__mtw.REBOOT_ON, reboot: !!window.__mtw.reboot }; }, ids);
expect('?reboot=0 → pure Classic: no Reboot UI or runtime, one visiting friend at most', !c1.on && !c1.reboot && !c1.pill && c1.cap === 1 && c1.a === true && c1.b === false, c1);
await page.screenshot({ path: `${out}/r2-04-classic.png` });
const passed = Object.values(checks).filter((c) => c.ok).length;
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, logs: logs.slice(-40) }, null, 1));
console.log(JSON.stringify({ passed, total: Object.keys(checks).length, fail }, null, 1));
await browser.close();
process.exit(fail.length ? 1 : 0);
