// REBOOT R5 on the REAL engine (needs the user's own game files, like every real-engine suite): friends' rooms,
// Sala Giochi, MiiPhone + MIInstagram, i18n — scenarios A–J of the R5 brief plus a soak (listeners, timers, Miis,
// presence, social life, conversations, DOM, feed subscriptions, heap after GC).
// Usage: node tests/e2e/r5-social.smoke.mjs <url> <outDir> <file1> [file2...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'it-IT' });
const page = await ctx.newPage();
const logs = []; page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); }); page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const checks = {}; const fail = [];
const expect = (n, ok, info) => { checks[n] = { ok: !!ok, info }; if (!ok) fail.push(`${n}: ${JSON.stringify(info)}`); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}`); };
const sim = (s) => page.evaluate((s) => window.__mtw.simRoom(s), s);
const ev = (f, a) => page.evaluate(f, a);
const screen = (n, t = 60000) => page.waitForFunction((n) => window.__mtw.play.currentScreen === n, n, { timeout: t });
const simUntil = async (fn, maxSec, step = 0.25, arg) => { for (let t = 0; t < maxSec; t += step) { if (await ev(fn, arg)) return true; await sim(step); } return !!(await ev(fn, arg)); };
const go = async (to, arg, sec = 60) => { const p = ev(([to, arg]) => window.__mtw.reboot.hub.go(to, arg), [to, arg]); let r; void p.then((x) => (r = x)); for (let t = 0; t < sec && r === undefined; t += 0.5) await sim(0.5); return r ?? p; };
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
await page.waitForFunction(() => !!window.__mtw.reboot?.phone, null, { timeout: 20000 });
const rebootJs = await ev(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\.js(\?|$)/.test(n)));
const names = ['Lucia', 'Marco', 'Sara', 'Gino', 'Ada', 'Teo', 'Bea'];
await ev(async (names) => {
  const P = window.__mtw.play;
  for (let i = 0; i < names.length; i++) {
    const b = window.__mtw.playApi.randomMii(i % 2); const b64 = btoa(String.fromCharCode(...b));
    const lv = [[8, 8, 8, 8, 4], [1, 1, 1, 1, 4], [8, 1, 8, 1, 4], [1, 8, 1, 8, 4]][i % 4];
    await P.social.add({ profile: { miiData: b64, name: names[i], birthday: { month: 3, day: 3 + i }, height: 50, build: 50, personality: lv, greetings: { welcome: '', goIn: `Ciao, sono ${names[i]}!`, seeingOff: '', goHome: 'A presto!' }, voice: { pitch: 50, speed: 50, accent: 50, energy: 50, depth: 50 } }, outfit: structuredClone(P.save.outfit), room: { wall: '0000', floor: '0000', variant: 0 } });
  }
}, names);
await ev(() => window.__mtw.reboot.places.refresh());
const S = () => ev(() => { const R = window.__mtw.reboot; return { at: R.hub.at, scr: window.__mtw.play.currentScreen, room: R.visit.roomId, mode: R.visit.mode, guests: window.__mtw.guests.length, phone: R.phone.phase, dock: !document.querySelector('.mp-dock').hidden, lang: R.i18n.lang, posts: R.feed.count, agents: R.social.agentCount }; });
const openPhone = async () => { await page.click('.mp-dock'); await page.waitForFunction(() => window.__mtw.reboot.phone.phase === 'open', null, { timeout: 5000 }); };
const closePhone = async () => { await page.click('.mp-x'); await page.waitForFunction(() => window.__mtw.reboot.phone.phase === 'closed', null, { timeout: 5000 }); };

// ---- A: Casa → Piazza → friends' rooms → enter → interact → Piazza
await page.click('.hub-pill'); await page.waitForSelector('.hub-screen:not([hidden])');
await page.click('.hub-card[data-dest=friends]'); await page.waitForSelector('.fr-card');
await page.screenshot({ path: `${out}/r5-01-friend-rooms.png` });
const open = await ev(() => window.__mtw.reboot.places.list('friend').find((p) => !p.refusal).id);
const rA = await go('friends', open);
await simUntil(() => window.__mtw.director?.state === 'idle' && window.__mtw.guests.length >= 1, 60, 0.5);
const sA = await S();
expect('A1 friend room entered as visitor: the user\'s Mii came in, the room\'s Miis are in the scene', rA.ok && sA.at === 'friends' && sA.scr === 'place:' + open && sA.guests >= 1 && (await ev((id) => window.__mtw.reboot.places.get(id).role('host'), open)) === 'visitor', { rA, sA });
await sim(30);
const life = await ev(() => window.__mtw.reboot.social.log.filter((l) => ['convo', 'wander', 'inspect', 'look'].includes(l.type)).length);
expect('A2 social life runs in the friend\'s room (R2b, no second social life)', life > 0 && (await ev(() => window.__mtw.reboot.social.agentCount)) === sA.guests + 1, { life });
const tap = await ev(() => { const o = window.__mtw.interactables[0]; if (!o) return 'none'; const p = window.__mtw.projectRoom(o.spot.x, 5, o.spot.z); return window.__mtw.roomClick(p.x, p.y); });
expect('A3 interacting with the room as a visitor (object per owner permission)', /^object|object-denied|none|floor|furniture|guest|mii/.test(tap), tap);
await page.screenshot({ path: `${out}/r5-02-friend-room.png` });
await page.click('.pb-bar [data-go=hub]'); await sim(1);
const sA4 = await S();
expect('A4 friend room → Piazza: presence removed, scene back to the own room, no guests', sA4.at === 'hub' && sA4.scr === 'room' && sA4.guests === 0 && !(await ev((id) => window.__mtw.reboot.places.get(id).has('host'), open)), sA4);
// ---- B: full room → error, previous state intact
const full = await ev(() => window.__mtw.reboot.places.list('friend').find((p) => p.status === 'full')?.id ?? null);
if (full) { const rB = await go('friends', full); const sB = await S(); expect('B full room: FULL, still in the Piazza, scene unchanged', !rB.ok && rB.detail === 'FULL' && sB.at === 'hub' && sB.scr === 'room', { rB, sB }); }
else expect('B full room present in the fixture', false, 'no full room');
// ---- C: friend room → Casa: cleanup
await go('friends', open); await simUntil(() => window.__mtw.director?.state === 'idle', 30, 0.5);
await page.click('.pb-bar [data-go=home]'); await sim(2);
const cC = await ev(() => { const R = window.__mtw.reboot; return { at: R.hub.at, guests: window.__mtw.guests.length, cap: window.__mtw.playApi.guestCapacity(), visit: R.visit.resources, conv: R.social.conversations.length, L: window.__mtw.listenerCounts() }; });
expect('C friend room → Casa: at home, no guests / conversations / place listeners, capacity back', cC.at === 'home' && cC.guests === 0 && cC.conv === 0 && cC.visit.unsubs === 0 && cC.visit.watch === 0, cC);
// ---- D: Piazza → Sala Giochi → match → result → Sala Giochi → Piazza
await go('hub'); const rD = await go('games');
await simUntil(() => window.__mtw.director?.state === 'idle', 30, 0.5); await sim(3);
await page.waitForSelector('.gr-board');
const st = await ev(() => window.__mtw.reboot.games.start('mii-quiz'));
expect('D1 Sala Giochi: a real place (screen place:…), match started with the Miis present; MiiPhone hidden', rD.ok && st.ok && (await S()).scr.startsWith('place:') && (await page.locator('.mp-dock').isHidden()), { rD, st });
await page.screenshot({ path: `${out}/r5-03-quiz.png` });
for (let i = 0; i < 300 && await ev(() => !!window.__mtw.reboot.games.session?.active); i++) { await ev(() => { const g = window.__mtw.reboot.games; const v = g.session.logic.view; if (v.phase === 'question' && v.answered.host === null) g.answer(0); }); await sim(0.5); }
const rs = await ev(() => { const s = window.__mtw.reboot.games.session; return { state: s?.state, players: s?.result?.players.length, reserved: s ? s.players.filter((p) => window.__mtw.reboot.social.isReserved(p.id)).length : -1 }; });
await page.screenshot({ path: `${out}/r5-04-result.png` });
expect('D2 match finished with a result; the Miis are released to social life', rs.state === 'finished' && rs.players >= 1 && rs.reserved === 0, rs);
await ev(() => window.__mtw.reboot.games.closeResult()); await sim(5);
await go('hub');
expect('D3 Sala Giochi → Piazza', (await S()).at === 'hub');
await go('home');
// ---- E: Casa → MiiPhone → MIInstagram → post → close → still Casa
await openPhone(); await page.click('[data-app=miinstagram]').catch(() => {}); await page.waitForSelector('.mi-app');
await page.click('[data-a=new]'); await page.click('[data-a=snap]'); await page.fill('textarea[name=caption]', 'Dalla mia stanza');
await page.click('[data-a=publish]'); await page.waitForSelector('.mi-card');
await page.screenshot({ path: `${out}/r5-05-miinstagram.png` });
await closePhone();
const sE = await S();
expect('E post from a real photo of the room (Miifoto 2), phone closed → still Casa', sE.posts >= 1 && sE.at === 'home' && sE.scr === 'room', sE);
// ---- F: Public Room → MiiPhone → MIInstagram → close → public room coherent
await go('hub'); await go('public'); await ev(() => { document.querySelector('.rbt-sheet').hidden = true; });
await simUntil(() => window.__mtw.reboot.rooms.room.presence().length >= 3, 120, 1);
const pres0 = await ev(() => window.__mtw.reboot.rooms.room.presence().length);
await openPhone(); await sim(5); await closePhone();
const sF = await ev(() => ({ at: window.__mtw.reboot.hub.at, mode: window.__mtw.reboot.rooms.mode, pres: window.__mtw.reboot.rooms.room.presence().length, vis: window.__mtw.reboot.rooms.room.visitors().length, g: window.__mtw.guests.filter((x) => !x.leaving).length }));
expect('F public room + MiiPhone: still public, presence coherent with the scene', sF.at === 'public' && sF.mode === 'public' && Math.abs(sF.pres - pres0) <= 1 && sF.vis <= sF.g + 1, { pres0, sF });
await go('hub'); await simUntil(() => window.__mtw.reboot.rooms.mode === 'private', 240, 1); await go('home');
// ---- G: Friend room → MIInstagram → reaction + comment → close → presence unchanged
await go('hub'); await go('friends', open); await simUntil(() => window.__mtw.director?.state === 'idle', 30, 0.5);
const pg0 = await ev((id) => window.__mtw.reboot.places.get(id).presence().map((p) => p.profileId).sort().join(), open);
await openPhone(); await page.click('[data-app=miinstagram]').catch(() => {}); await page.waitForSelector('.mi-card');
await page.locator('.mi-card').first().locator('.mi-r.r-cute').click();
await page.fill('.mi-cform input >> nth=0', 'Ciao!'); await page.press('.mi-cform input >> nth=0', 'Enter'); await sim(0.5);
await closePhone();
const pg1 = await ev((id) => window.__mtw.reboot.places.get(id).presence().map((p) => p.profileId).sort().join(), open);
expect('G MIInstagram in a friend\'s room: reaction + comment, presence unchanged, still there', pg0 === pg1 && (await S()).at === 'friends', { pg0, pg1 });
await go('home');
// ---- H + I: language IT → EN, reload: language and MIInstagram kept
await go('hub'); await page.click('.hub-lang [data-lang=en]');
expect('H1 English: Plaza', (await page.locator('.hub-screen h1').textContent()).trim() === 'Plaza');
await go('home');
const feed0 = await ev(() => window.__mtw.reboot.feed.feed({ limit: 30 }).then((r) => r.value.items.map((p) => [p.id, Object.keys(p.reactions).length, p.comments.length].join(':')).join()));
await page.reload();
await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room' && window.__mtw.reboot?.feed, null, { timeout: 300000 });
const feed1 = await ev(() => window.__mtw.reboot.feed.feed({ limit: 30 }).then((r) => r.value.items.map((p) => [p.id, Object.keys(p.reactions).length, p.comments.length].join(':')).join()));
expect('H2 language kept after reload', (await ev(() => window.__mtw.reboot.i18n.lang)) === 'en');
expect('I MIInstagram posts, reactions and comments survive the reload', feed0 && feed0 === feed1, { feed0, feed1 });
// ---- soak
await ev(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
await ev(() => window.__mtw.reboot.places.refresh());
const snap = () => ev(() => { const R = window.__mtw.reboot; return { L: window.__mtw.listenerCounts(), hub: R.hub.listenerCount, feed: R.feed.listenerCount, i18n: R.i18n.listenerCount, places: R.places.listenerCount, visit: R.visit.listenerCount, phone: R.phone.listenerCount, social: R.social.listenerCount, timers: R.social.pendingTimers, dom: document.querySelectorAll('*').length, heap: performance.memory?.usedJSHeapSize ?? 0 }; });
const gc = () => ev(() => { if (typeof window.gc === 'function') { window.gc(); window.gc(); } });
for (let i = 0; i < 2; i++) { await go('hub'); await go('friends', open); await sim(5); await go('home'); }      // warm-up (cold assets of the places)
await gc(); const s0 = await snap();
let bad = 0, dupMii = 0;
for (let i = 0; i < 12; i++) {
  await go('hub');
  const id = await ev((i) => { const l = window.__mtw.reboot.places.list('friend').filter((p) => !p.refusal); return l[i % l.length].id; }, i);
  const r = await go('friends', id); if (!r.ok) bad++;
  await sim(8);
  await openPhone(); await closePhone();
  if (await ev(() => { const g = window.__mtw.guests.map((x) => x.spec.id); return g.length !== new Set(g).size; })) dupMii++;
  await go(i % 2 ? 'hub' : 'home');
}
await go('hub'); await go('games'); await sim(4);
for (let m = 0; m < 3; m++) { await ev(() => window.__mtw.reboot.games.start('mii-quiz')); for (let i = 0; i < 300 && await ev(() => !!window.__mtw.reboot.games.session?.active); i++) await sim(0.5); await ev(() => window.__mtw.reboot.games.closeResult()); await sim(3); }
await go('home'); await sim(3);
await gc(); const s1 = await snap();
expect('soak: 12 friend-room visits + phone + 3 matches completed, no duplicated Miis', bad === 0 && dupMii === 0, { bad, dupMii });
expect('soak: same listeners as before (room hooks, hub, feed, i18n, places, visit, phone, social)', JSON.stringify(s0.L) === JSON.stringify(s1.L) && ['hub', 'feed', 'i18n', 'places', 'visit', 'phone', 'social'].every((k) => s0[k] === s1[k]), { s0, s1 });
expect('soak: social timers bounded, DOM stable, heap after GC +15 % max', s1.timers <= s0.timers + 6 && Math.abs(s1.dom - s0.dom) <= 60 && (!s0.heap || s1.heap < s0.heap * 1.15), { s0, s1 });
const errs = logs.filter((l) => /pageerror|^error/.test(l));
expect('no page errors', errs.length === 0, errs.slice(0, 5));
// ---- J: Classic ?reboot=0 — no MiiPhone, no Reboot chunk
await page.goto(url + (url.includes('?') ? '&' : '?') + 'reboot=0');
await page.waitForFunction(() => window.__mtw?.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 300000 });
const classicJs = await ev(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\.js(\?|$)/.test(n)));
const cl = await ev(() => ({ reboot: !!window.__mtw.reboot, dock: !!document.querySelector('.mp-dock'), layer: !!document.querySelector('.r5-layer'), cap: window.__mtw.playApi.guestCapacity() }));
expect('J Classic: no Reboot chunk, no MiiPhone, no R5 layer, capacity 1', rebootJs.some((u) => !classicJs.includes(u)) && !cl.reboot && !cl.dock && !cl.layer && cl.cap === 1, cl);
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, logs: logs.slice(-40) }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
