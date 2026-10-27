// REBOOT R4: Social Hub ("Piazza") on the real engine. Scenarios A–H from the R4 brief + a soak of repeated
// Hub ↔ Room transitions (no duplicated Miis / visitors / listeners / timers / conversations, consistent public room,
// no evident memory growth, no deadlock). The hub is a model over R3: R3 opens, closes and cleans; the hub follows events.
// Usage: node tests/e2e/r4-hub.smoke.mjs <url> <outDir> <file1> [file2...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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
const names = ['Lucia', 'Marco', 'Sara', 'Gino', 'Ada', 'Teo', 'Bea'];
await ev(async (names) => {
  const P = window.__mtw.play;
  for (let i = 0; i < names.length; i++) {
    const b = window.__mtw.playApi.randomMii(i % 2); const b64 = btoa(String.fromCharCode(...b));
    const lv = [[8, 8, 8, 8, 4], [0, 0, 0, 0, 4], [8, 0, 8, 0, 4], [0, 8, 0, 8, 4]][i % 4];
    await P.social.add({ profile: { miiData: b64, name: names[i], birthday: { month: 3, day: 3 + i }, height: 50, build: 50, personality: lv, greetings: { welcome: '', goIn: `Ciao, sono ${names[i]}!`, seeingOff: '', goHome: 'A presto!' }, voice: { pitch: 50, speed: 50, accent: 50, energy: 50, depth: 50 } }, outfit: structuredClone(P.save.outfit), room: { wall: '0000', floor: '0000', variant: 0 } });
  }
}, names);
await ev(() => { window.__mtw.reboot.rooms.visitors.config = { gap: [2, 5], stay: [100, 220], mischief: 0 }; });
const H = () => ev(() => { const R = window.__mtw.reboot, h = R.hub, s = h.publicStatus;
  return { at: h.at, nav: h.state.navigating, err: h.state.lastError, label: s.label, present: s.present, cap: s.capacity, mode: R.rooms.mode,
    overlay: !document.querySelector('.hub-screen').hidden, pill: !document.querySelector('.hub-pill').hidden, chip: document.querySelector('[data-hubchip]')?.textContent ?? null,
    cards: [...document.querySelectorAll('.hub-card')].map((b) => ({ id: b.dataset.dest, dis: b.disabled, t: b.querySelector('small')?.textContent })),
    guests: window.__mtw.guests.length }; });
const go = (to) => ev((to) => window.__mtw.reboot.hub.go(to), to);
const clickDest = async (id) => { await page.click(`.hub-card[data-dest="${id}"]`); };
// ---- A: Reboot → Hub → Casa → Hub (through the real UI)
const h0 = await H();
expect('hub present: "Piazza" pill on the room screen, at home', h0.at === 'home' && h0.pill && !h0.overlay, h0);
await page.click('.hub-pill'); await page.waitForSelector('.hub-screen:not([hidden])');
const hA = await H();
await page.screenshot({ path: `${out}/r4-01-hub.png` });
expect('A1 pill → hub screen: Casa, my public room (Chiusa), future destinations disabled', hA.at === 'hub' && hA.overlay && hA.cards[0].id === 'home' && hA.cards[1].id === 'public' && /Chiusa/.test(hA.cards[1].t) && hA.cards.filter((c) => !['home', 'public'].includes(c.id)).every((c) => c.dis), hA.cards);
await clickDest('home'); await sim(1);
const hA2 = await H();
expect('A2 hub → Casa: overlay gone, at home, room as before', hA2.at === 'home' && !hA2.overlay && hA2.pill, hA2);
await page.click('.hub-pill'); await page.waitForSelector('.hub-screen:not([hidden])');
expect('A3 Casa → hub again', (await H()).at === 'hub', null);
// ---- B + D: Hub → Public Room (R3 opens; status reflected), D: open → hub shows state and capacity
await clickDest('public'); await sim(1);
const hB = await H();
expect('B1 hub → my public room: R3 opened it, R3 panel shown, at public', hB.at === 'public' && hB.mode === 'public' && !hB.overlay && (await ev(() => !document.querySelector('.rbt-sheet').hidden)), hB);
await ev(() => { document.querySelector('.rbt-sheet').hidden = true; });
await simUntil(() => window.__mtw.reboot.rooms.room.presence().length >= 4, 150, 1);
const hD = await H();
expect('D public room open: hub status "Aperta · n/8" = R3 presence and capacity, shown on the pill', /^Aperta · \d\/8$/.test(hD.label) && hD.present === (await ev(() => window.__mtw.reboot.rooms.room.presence().length)) && hD.cap === 8 && hD.chip === hD.label, hD);
await page.screenshot({ path: `${out}/r4-02-public.png` });
// B2: Public → Hub: R3 closes (same cleanup), hub at once, status follows
await page.click('.hub-pill'); await page.waitForSelector('.hub-screen:not([hidden])');
const hB2 = await H();
expect('B2 public → hub: at hub immediately, R3 closing ("In chiusura…"), public card disabled meanwhile', hB2.at === 'hub' && hB2.mode === 'closing' && hB2.label === 'In chiusura…' && hB2.cards[1].dis, hB2);
const closingTry = await go('public');
expect('   going back to the public room while it closes → explicit CLOSING error, hub usable', closingTry.code === 'CLOSING' && (await H()).at === 'hub', closingTry);
await simUntil(() => window.__mtw.reboot.rooms.mode === 'private', 200, 1);
await sim(1);
const hE = await H();
await page.screenshot({ path: `${out}/r4-03-closed.png` });
expect('E public room closed: hub shows "Chiusa", R3 cleanup done (no guests, presence 0)', hE.label === 'Chiusa' && hE.guests === 0 && (await ev(() => window.__mtw.reboot.rooms.room.presence().length)) === 0 && hE.cards[1].dis === false, hE);
// ---- C + F: Hub → Public (visitors) → Casa: R3 polite close, then home, private room works
await clickDest('public');
await simUntil(() => window.__mtw.guests.length >= 3 && window.__mtw.guests.every((g) => g.director.state !== 'entering' && g.director.state !== 'outside'), 200, 1);
const before = await ev(() => window.__mtw.guests.length);
const pHome = ev(() => window.__mtw.reboot.hub.go('home'));
const busy = await go('hub');
expect('double navigation during public → Casa: BUSY', busy.code === 'BUSY', busy);
await simUntil(() => !window.__mtw.reboot.hub.state.navigating, 240, 1);
const rC = await pHome; const hC = await H();
const clean = await ev(() => ({ pres: window.__mtw.reboot.rooms.room.presence().length, running: window.__mtw.reboot.rooms.visitors.running, cap: window.__mtw.playApi.guestCapacity(), agents: window.__mtw.reboot.social.agentCount, convos: window.__mtw.reboot.social.conversations.length }));
expect('C/F public room with visitors → Casa: everybody left politely (R3), cleanup complete, at home', before >= 3 && rC.ok && hC.at === 'home' && hC.guests === 0 && clean.pres === 0 && !clean.running && clean.cap === 3 && clean.agents === 1 && clean.convos === 0, { before, rC, hC, clean });
const priv = await ev(async () => { const f = (await window.__mtw.play.social.list())[0]; return window.__mtw.play.inviteGuest(f.id); });
await simUntil(() => window.__mtw.guests[0]?.director.state === 'idle', 60, 1);
await sim(30);
const pv = await ev(() => ({ n: window.__mtw.guests.length, agents: window.__mtw.reboot.social.agentCount, hostMoves: window.__mtw.reboot.social.log.filter((l) => l.ids[0] === 'host' && ['wander', 'inspect', 'watch'].includes(l.type)).length }));
expect('back home: private Reboot room as R2b (friend comes in, social life, the user\'s Mii never moved by the AI)', priv && pv.n === 1 && pv.agents === 2 && pv.hostMoves === 0, pv);
await ev(() => window.__mtw.playApi.guestEnd());
// ---- G + soak: many transitions, nothing accumulates
await ev(() => { if (typeof window.gc === 'function') window.gc(); });
const snap = () => ev(() => { const R = window.__mtw.reboot; return { L: window.__mtw.listenerCounts(), hub: R.hub.listenerCount, rooms: R.rooms.listenerCount, svc: R.rooms.svc.listenerCount, timers: R.social.pendingTimers,
  heap: performance.memory?.usedJSHeapSize ?? 0, dom: document.querySelectorAll('*').length, scene: (() => { let n = 0; window.__mtw.renderer && window.__mtw.camera; return n; })() }; });
// warm-up: two cycles first, so one-time caches (cold assets, outfits, BGM) are not counted as growth
for (const to of ['hub', 'public', 'hub']) { await go(to); await sim(20); }
await simUntil(() => window.__mtw.reboot.rooms.mode === 'private', 240, 1); await go('home'); await sim(3);
await ev(() => { if (typeof window.gc === 'function') { window.gc(); window.gc(); } });
const s0 = await snap();
let sMid = null;
const badCodes = []; let dupMii = 0, ghost = 0, badState = 0, dupConvo = 0, cycles = 0, maxConvos = 0, deadlock = 0;
for (let i = 0; i < 16; i++) {
  const route = i % 2 === 0 ? ['hub', 'home'] : ['hub', 'public', 'hub', 'home'];   // every cycle starts and ends at home
  for (const to of route) {
    const pr = go(to);
    if (to === 'home') await simUntil(() => !window.__mtw.reboot.hub.state.navigating, 240, 1);   // hub → home waits for R3 to finish closing
    const r = await pr;
    if (!r.ok && r.code !== 'CLOSING') { badState++; badCodes.push(`${to}:${r.code}`); }
    if (r.code === 'CLOSING') { const ok = await simUntil(() => window.__mtw.reboot.rooms.mode === 'private', 240, 1); if (!ok) deadlock++; const r2 = await go(to); if (!r2.ok) badState++; }
    await sim(i % 2 ? 25 : 5);
    const c = await ev(() => { const g = window.__mtw.guests.map((x) => x.spec.id), R = window.__mtw.reboot, vis = R.rooms.room.visitors();
      const onScreen = window.__mtw.guests.filter((x) => !x.leaving).map((x) => x.spec.id);
      const pairs = R.social.conversations.map((c) => [c.a, c.b].sort().join('+'));
      return { dup: g.length !== new Set(g).size, ghost: onScreen.filter((id) => !vis.includes(id)).length, convos: R.social.conversations.length, dupConvo: pairs.length !== new Set(pairs).size, stuckNav: !!R.hub.state.navigating, at: R.hub.at, mode: R.rooms.mode }; });
    if (c.dup) dupMii++; if (c.ghost && c.mode === 'public') ghost++; if (c.dupConvo) dupConvo++; if (c.stuckNav) deadlock++; maxConvos = Math.max(maxConvos, c.convos);
  }
  cycles++;
  if (cycles === 8) { await ev(() => { if (typeof window.gc === 'function') { window.gc(); window.gc(); } }); sMid = await snap(); }
}
// settle: back home, room closed
if ((await H()).at !== 'hub') await go('hub');
await simUntil(() => window.__mtw.reboot.rooms.mode === 'private', 240, 1);
await go('home'); await sim(5);
await ev(() => { if (typeof window.gc === 'function') { window.gc(); window.gc(); } });
const s1 = await snap();
const sameL = JSON.stringify(s0.L) === JSON.stringify(s1.L) && s0.hub === s1.hub && s0.rooms === s1.rooms && s0.svc === s1.svc;
expect('G repeated transitions: same listeners as before (room hooks, hub, R3 controller, service)', sameL, { s0, s1 });
expect('soak: no duplicated Miis, no ghost visitors, no duplicated conversations, no deadlock', dupMii === 0 && ghost === 0 && dupConvo === 0 && deadlock === 0 && badState === 0 && maxConvos <= 2, { dupMii, ghost, dupConvo, deadlock, badState, badCodes, maxConvos, cycles });
expect('soak: social timers bounded, DOM not growing', s1.timers <= s0.timers + 6 && s1.dom <= s0.dom + 30, { t0: s0.timers, t1: s1.timers, d0: s0.dom, d1: s1.dom });
expect('soak: no evident memory growth after warm-up (heap after GC: +20 % max overall, second half of the soak +8 % max)', !s0.heap || (s1.heap < s0.heap * 1.2 && s1.heap < sMid.heap * 1.08), { h0: s0.heap, hMid: sMid?.heap, h1: s1.heap });
const fin = await H();
expect('soak end state consistent: home, room private and closed, no guests, nothing navigating', fin.at === 'home' && fin.mode === 'private' && fin.label === 'Chiusa' && fin.guests === 0 && !fin.nav, fin);
const errs = logs.filter((l) => /pageerror|^error/.test(l));
expect('no page errors', errs.length === 0, errs.slice(0, 5));
// ---- H: Classic unchanged
await page.goto(url + (url.includes('?') ? '&' : '?') + 'reboot=0');
await page.waitForFunction(() => window.__mtw?.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 300000 });
const classicJs = await ev(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\.js(\?|$)/.test(n)));
const extra = rebootJs.filter((u) => !classicJs.includes(u));
const cl = await ev(() => ({ reboot: !!window.__mtw.reboot, pill: !!document.querySelector('.hub-pill'), screen: !!document.querySelector('.hub-screen'), cap: window.__mtw.playApi.guestCapacity() }));
expect('H Classic: no Reboot chunk downloaded, no hub, capacity 1', extra.length >= 1 && !cl.reboot && !cl.pill && !cl.screen && cl.cap === 1, { extra, cl });
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, soak: { s0, s1, cycles }, logs: logs.slice(-40) }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
