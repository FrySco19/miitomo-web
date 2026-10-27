// REBOOT R3: the user's room opened as a PUBLIC ROOM (NEW, not original Nintendo), visitors = local friends simulated
// by the local room service (our server from R10). 8 Miis (owner + 7 visitors), capacity respected (ROOM_FULL),
// blocked friend never enters, visitors' host actions refused, object permission applied to the social layer, owner
// kick, R2b social life running on visitors, minutes of life with nobody stuck, polite close, and leaving the room
// screen cleans every piece of public state; the private room still works afterwards.
// Usage: node tests/e2e/r3-public.smoke.mjs <url> <outDir> <file1> [file2...]
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
const names = ['Lucia', 'Marco', 'Sara', 'Gino', 'Ada', 'Teo', 'Bea', 'Ugo', 'Pia'];
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
const blocked = ids[8];
await ev(async (id) => { await window.__mtw.reboot.api.block(id); }, blocked);
// ---- open as a public room from the panel
await page.click('.rbt-pill'); await page.waitForSelector('.rbt-sheet:not([hidden]) [data-a=popen]');
await page.click('[data-a=popen]');
const op = await ev(() => ({ mode: window.__mtw.reboot.rooms.mode, cap: window.__mtw.playApi.guestCapacity(), state: window.__mtw.reboot.rooms.room.state }));
expect('owner opens the room as public: mode public, 8 places (owner + 7)', op.mode === 'public' && op.cap === 7 && op.state === 'open', op);
// test pacing for the simulated visitors (documented knob): quicker arrivals, long enough stays, some mischief
await ev(() => { window.__mtw.reboot.rooms.visitors.config = { gap: [2, 5], stay: [100, 220], mischief: 0.35 }; });
const R = () => ev((b) => { const r = window.__mtw.reboot.rooms, s = window.__mtw.reboot.social;
  const ds = [['host', window.__mtw.director], ...window.__mtw.guests.map((g) => [g.spec.id, g.director])];
  const onScreen = window.__mtw.guests.filter((g) => !g.leaving && !g.leaveWanted).map((g) => g.spec.id), /* leaveWanted = leave requested, finishing a short action first */ all = window.__mtw.guests.map((g) => g.spec.id), vis = r.room.visitors();
  return { pres: r.room.presence().map((p) => p.profileId), ghosts: onScreen.filter((id) => !vis.includes(id)), lost: vis.filter((id) => !all.includes(id) && !r.pendingIds.includes(id)), pending: r.pendingIds.length,
    walking: ds.filter(([, d]) => d.state === 'walking').map(([id]) => id), inside: ds.every(([, d]) => ['entering', 'exiting', 'outside'].includes(d.state) || (Math.abs(d.pos.x) < 34 && Math.abs(d.pos.z) < 34)),
    blockedIn: r.room.has(b), now: s.now, state: r.room.state };
}, blocked);
let maxPres = 0, ghosts = 0, lost = 0, maxPending = 0, mismatch = 0, samples = 0, walkT = {}, maxWalk = 0, insideOk = true, blockedIn = false, eight = false, shot = false;
for (let i = 0; i < 420; i++) {
  await sim(1);
  const r = await R(); samples++;
  maxPres = Math.max(maxPres, r.pres.length); blockedIn = blockedIn || r.blockedIn; insideOk = insideOk && r.inside;
  if (r.ghosts.length) ghosts++; if (r.lost.length) lost++; maxPending = Math.max(maxPending, r.pending);
  for (const id of Object.keys(walkT)) if (!r.walking.includes(id)) walkT[id] = 0;
  for (const id of r.walking) { walkT[id] = (walkT[id] ?? 0) + 1; maxWalk = Math.max(maxWalk, walkT[id]); }
  if (r.pres.length === 8 && !eight) { eight = true; }
  if (eight && !shot && i > 150) { await page.click('.rbt-pill').catch(() => {}); await page.waitForTimeout(300); if (await ev(() => document.querySelector('.rbt-sheet').hidden)) await page.click('.rbt-pill'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/r3-01-public-full.png` }); shot = true; await page.click('[data-a=close]').catch(() => {}); }
}
const vs = await ev(() => window.__mtw.reboot.rooms.visitors.stats);
const rlog = await ev(() => window.__mtw.reboot.rooms.svc.log.map((l) => l.e.type + (l.e.code ? ':' + l.e.code : '') + (l.e.action ? ':' + l.e.action : '')));
expect('8 Miis: the room fills up (owner + 7 visitors) and never goes over capacity', eight && maxPres <= 8, { maxPres, eight });
expect('capacity respected: a 9th visitor is refused with ROOM_FULL', rlog.some((x) => /room\.denied:ROOM_FULL/.test(x)), rlog.filter((x) => /denied/.test(x)).slice(0, 6));
expect('blocked friend never enters', !blockedIn && !rlog.includes('presence.join:' + blocked), null);
expect('visitors come and go by themselves (turnover)', vs.joined >= 8 && vs.left >= 1, vs);
const churn = await ev(() => window.__mtw.reboot.rooms.events.filter((e) => e.type === 'invite-failed').length);
expect('no churn: every admitted visitor really comes in (no join → instant leave)', churn === 0 && vs.joined <= vs.left + 8 + 2, { churn, vs });
expect('presence and scene in sync: no Mii on screen without presence, no admitted visitor lost (on screen, at the door or waiting for a free place)', ghosts <= 2 && lost <= 2, { ghosts, lost, maxPending, samples });
expect('visitors cannot do host actions: attempts refused and logged, settings unchanged', vs.mischief >= 1 && rlog.some((x) => /room\.denied:FORBIDDEN:(changeSettings|kick|close|invite)/.test(x)) && (await ev(() => window.__mtw.reboot.rooms.room.info.capacity)) === 8, { vs, denied: rlog.filter((x) => /FORBIDDEN/.test(x)).slice(0, 4) });
const soc = await ev(() => { const s = window.__mtw.reboot.social; return { done: s.stats.done, pairs: [...new Set(s.log.filter((l) => l.type === 'convo').map((l) => [...l.ids].sort().join('+')))].length, visitorsTalked: [...new Set(s.log.filter((l) => l.type === 'say').map((l) => l.ids[0]))].length, acts: s.stats.activities }; });
expect('R2b social life runs on the visitors with no public-room social code', soc.done >= 3 && soc.visitorsTalked >= 3 && soc.acts.wander > 3, soc);
expect('several minutes of life: nobody walks more than 20 s in a row, everybody inside, no violations', maxWalk <= 20 && insideOk && (await ev(() => [window.__mtw.director, ...window.__mtw.guests.map((g) => g.director)].flatMap((d) => d.violations))).length === 0, { maxWalk, insideOk });
// ---- permissions from the panel: objects for the owner only → the social layer stops visitors using them
await ev(() => { window.__mtw.reboot.panel.render(); });
if (await ev(() => document.querySelector('.rbt-sheet').hidden)) await page.click('.rbt-pill');
await page.waitForSelector('.rbt-sheet:not([hidden]) [data-a=pobj]');
await page.click('[data-a=pobj]');
const t0 = await ev(() => window.__mtw.reboot.social.now);
await sim(90);
const inspects = await ev((t0) => window.__mtw.reboot.social.log.filter((l) => l.type === 'inspect' && l.t > t0 + 1 && l.ids[0] !== 'host').length, t0);
const perm = await ev(() => window.__mtw.reboot.rooms.room.info.permissions.whoCanInteract);
expect('owner sets "objects: only me": visitors stop using objects (permission applied to R2b)', perm === 'owner' && inspects === 0, { perm, inspects });
// owner tries to shrink capacity below the people inside → refused with a message
await page.click('[data-a=pless]');
const shrink = await ev(() => ({ cap: window.__mtw.reboot.rooms.room.info.capacity, msg: document.querySelector('[data-msg]')?.textContent, pres: window.__mtw.reboot.rooms.room.presence().length }));
expect('capacity cannot go below the Miis inside', shrink.pres < 8 ? shrink.cap === 7 : shrink.cap === 8 && /già più Mii/.test(shrink.msg), shrink);
// ---- kick from the panel
const victim = await ev(() => { const r = window.__mtw.reboot.rooms; return r.room.visitors().find((id) => window.__mtw.guests.some((g) => g.spec.id === id && !g.leaving && g.director.state !== 'outside')); });
await page.click(`[data-a=pkick][data-id="${victim}"]`);
const kickGone = await simUntil((v) => !window.__mtw.guests.some((g) => g.spec.id === v), 60, 0.5, victim);
await sim(30);
const kicked = await ev((v) => ({ inRoom: window.__mtw.reboot.rooms.room.has(v), back: window.__mtw.guests.some((g) => g.spec.id === v) }), victim);
expect('owner kicks a visitor: it goes out through the door and does not come back', kickGone && !kicked.inRoom && !kicked.back, { victim, kickGone, kicked });
// ---- close politely
if (await ev(() => document.querySelector('.rbt-sheet').hidden)) await page.click('.rbt-pill');
await page.waitForSelector('.rbt-sheet:not([hidden]) [data-a=pclose]');
await page.click('[data-a=pclose]');
const closed = await simUntil(() => window.__mtw.reboot.rooms.mode === 'private' && window.__mtw.guests.length === 0, 240, 1);
const after = await ev(() => ({ mode: window.__mtw.reboot.rooms.mode, state: window.__mtw.reboot.rooms.room.state, pres: window.__mtw.reboot.rooms.room.presence().length, cap: window.__mtw.playApi.guestCapacity(), guests: window.__mtw.guests.map((g) => [g.spec.name, g.director.state, g.leaving, g.leaveWanted]), ev: window.__mtw.reboot.rooms.events.slice(-8), glog: window.__mtw.guestLog.slice(-8) }));
const triesA = await ev(() => window.__mtw.reboot.rooms.visitors.stats.tries); await sim(40);
const triesB = await ev(() => window.__mtw.reboot.rooms.visitors.stats.tries);
expect('close: every visitor leaves through the door, private settings restored (capacity 3), no new visitors', closed && after.state === 'closed' && after.pres === 0 && after.cap === 3 && triesA === triesB, { closed, after, triesA, triesB });
// ---- reopen, then the owner leaves the room screen: immediate full cleanup
await ev(() => window.__mtw.reboot.rooms.open());
await ev(() => { window.__mtw.reboot.rooms.visitors.config = { gap: [2, 4], stay: [200, 300], mischief: 0 }; });
await simUntil(() => window.__mtw.guests.length >= 2, 120, 1);
await page.click('[data-a=close]').catch(() => {});
await page.click('#play .pl-tab[data-tab=shop]');
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'shopTop', null, { timeout: 10000 });
await page.waitForTimeout(1500);
const away = await ev(() => ({ mode: window.__mtw.reboot.rooms.mode, pres: window.__mtw.reboot.rooms.room.presence().length, state: window.__mtw.reboot.rooms.room.state, guests: window.__mtw.guests.length, running: window.__mtw.reboot.rooms.visitors.running, cap: window.__mtw.playApi.guestCapacity() }));
expect('owner leaves the room screen: public room closed and cleaned at once (no presence, no guests, no simulation)', away.mode === 'private' && away.pres === 0 && away.state === 'closed' && away.guests === 0 && !away.running && away.cap === 3, away);
await page.click('.pl-shop-head [data-a=close]');
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'room', null, { timeout: 10000 });
await sim(3);
const priv = await ev(async (id) => { const ok = await window.__mtw.play.inviteGuest(id); return { ok, n: window.__mtw.guests.length, agents: window.__mtw.reboot.social.snapshot().length }; }, ids[0]);
await simUntil(() => window.__mtw.guests[0]?.director.state === 'idle', 40);
expect('back home: the private Reboot room works as before (invite a friend, social layer clean)', priv.ok && priv.n === 1, priv);
const errs = logs.filter((l) => /pageerror|^error/.test(l));
expect('no page errors', errs.length === 0, errs.slice(0, 5));
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, rooms: { stats: vs, log: rlog.slice(-60) }, logs: logs.slice(-40) }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
