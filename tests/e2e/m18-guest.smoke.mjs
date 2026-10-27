// M18: a friend enters the user's room — two Miis at the same time. Arrival through the door with the original telop,
// greetings 1.5 (guest) → 1.2 (host), personal distance while both move, tapping the guest, the guest's own personality /
// voice / face, friend BGM, goodbye 1.4 (guest) → 1.3 (host) and exit through the door; leaving the room ends the visit.
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
await page.goto(url);
await screen('setup');
await page.setInputFiles('#play input[type=file]', files);
await screen('create', 300000);
await page.click('#play [data-a=next]'); await page.fill('#play .pl-input', 'Kelly'); await page.click('#play [data-a=next]');
await page.selectOption('#play select[data-k=m]', '5'); await page.selectOption('#play select[data-k=d]', '2'); await page.click('#play [data-a=ok]');
await screen('personality', 20000); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 120000 });
await ev(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
await sim(16); await ev(() => window.__mtw.roomUi.close(true));
// Mii head: noseline (XluNoseLine, FFL R8 texture) read through the A8 adapter — no opaque black square on the nose
const nose = await ev(() => { const out = []; const walk = (o) => { if (!o) return; const m = o.material; if (m?.userData?.miitomoMaterial) out.push({ n: m.userData.miitomoMaterial, mode: m.modulateMode, fmt: m.map?.format ?? null, fetch: m.defines?.['MTW_FETCH(t)'] ?? null }); for (const c of o.children ?? []) walk(c); };
  for (const s of Object.values(window.__mtw.slots)) if (s.head) walk(s.head.isObject3D ? s.head : (s.head.meshes ?? s.head.model?.meshes)); return out; });
const nl = nose.find((m) => m.n === 'XluNoseLine');
expect('noseline: alpha read from the R8 texture (A8 adapter), so the original alpha test discards the background', nl && nl.mode === 3 && nl.fmt === 1028 && nl.fetch === 'vec4(0.0, 0.0, 0.0, (t).r)' && nose.filter((m) => m.mode === 1 || m.mode === 0).every((m) => m.fetch === '(t)' || m.fetch === null), nose);
// bottom bar: bulletTab00 base drawn as Scale9 (CCControlButton background) from the un-premultiplied atlas — no grey fringe
const bar = await ev(async () => { const e = document.querySelector('#play .pl-nav .pl-tab:not(.on) .pl-tab-ico'); const st = e?.getAttribute('style') ?? ''; const u = /url\(([^)]+)\)/.exec(st)?.[1];
  if (!u) return { st }; const im = new Image(); im.src = u; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  const rim = Array.from(g.getImageData(3, 0, 1, 1).data); return { nine: /border-image:/.test(st), w: im.width, rim }; });
expect('bottom bar base: 9-slice bulletTab00 (13 px) with a WHITE anti-aliased rim (premultiplied atlas converted)', bar.nine && bar.w === 13 && bar.rim[0] >= 245 && bar.rim[3] > 0 && bar.rim[3] < 255, bar);
// PLAY room framing (WEB ADAPTATION): original camera moved back along its own axis + lens shift, front of the floor visible
const fr = await ev(() => { const f = window.__mtw.framing, c = window.__mtw.room.camera; const p = window.__mtw.projectRoom(c.target.x, 0, 31); return { f, feetY: p?.y, H: innerHeight, cam: window.__mtw.camera.position.toArray() }; });
expect('PLAY framing: camera dollied back (fixed, no user control) and a Mii at the front of the floor is above the bottom bar', fr.f && fr.f.dolly > 0 && fr.f.dolly < 60 && fr.feetY > 0 && fr.feetY < fr.H * 0.9, fr);
// a local friend (LocalProvider) with its own goIn greeting and personality 8,8,8,8 (type 3 = Nori)
const fid = await ev(async () => {
  const P = window.__mtw.play; const b = window.__mtw.playApi.randomMii(1); const b64 = btoa(String.fromCharCode(...b));
  const f = await P.social.add({ profile: { miiData: b64, name: 'Lucia', birthday: { month: 8, day: 14 }, height: 70, build: 50, personality: [8, 8, 8, 8, 4], greetings: { welcome: '', goIn: 'Eccomi qua!', seeingOff: '', goHome: 'Ci vediamo!' }, voice: { pitch: 70, speed: 50, accent: 50, energy: 50, depth: 50 } }, outfit: structuredClone(P.save.outfit), room: { wall: '0000', floor: '0000', variant: 0 } });
  return f.id;
});
expect('automatic visits are off under automation (tests drive them)', await ev(() => window.__mtw.play.autoGuests === false), null);
const hostPos0 = await ev(() => window.__mtw.director.pos.toArray());
// ---- arrival
const ok = await ev((id) => window.__mtw.play.inviteGuest(id), fid);
const telop = await ev(() => document.querySelector('.pl-telop:not([hidden])')?.textContent);
expect('guest arrives: original telop "{name} è qui!"', ok && telop === 'Lucia è qui!', { ok, telop });
const g0 = await ev(() => ({ st: window.__mtw.guest?.director.state, parts: window.__mtw.guest?.slot.parts.length, head: !!window.__mtw.guest?.slot.head, door: window.__mtw.doorOwner, hostState: window.__mtw.director.state }));
expect('guest has its own body, head and director; enters through the door it opens', g0.st === 'entering' && g0.parts > 0 && g0.head && g0.door === 'guest' && g0.hostState === 'idle', g0);
await sim(1);
await page.screenshot({ path: `${out}/m18-01-door.png` });
const greet = await simUntil(() => window.__mtw.roomUi.snapshot()?.label === 'customGreeting', 25);
const gb = await ev(() => ({ snap: window.__mtw.roomUi.snapshot(), speaker: window.__mtw.roomUi.speaker, name: document.querySelector('.rb-name')?.textContent, gst: window.__mtw.guest?.director.state, dist: window.__mtw.guest?.director.pos.distanceTo(window.__mtw.director.pos) }));
await page.screenshot({ path: `${out}/m18-02-guest-greets.png` });
expect('arrival: the guest says its own goIn greeting (customGreeting, tag 1.5) in its balloon', greet && gb.speaker === 'guest' && gb.name === 'Lucia' && /Eccomi qua!/.test(gb.snap.text), gb);
expect('guest stops next to the host (personal distance kept)', gb.dist >= 4.4 && gb.dist < 14, gb.dist);
const welcome = await simUntil(() => window.__mtw.roomUi.snapshot()?.label === 'customGreetingWelcome', 12);
const wb = await ev(() => ({ speaker: window.__mtw.roomUi.speaker, name: document.querySelector('.rb-name')?.textContent, text: window.__mtw.roomUi.snapshot()?.text }));
expect('then the host answers with its welcome (customGreetingWelcome, tag 1.2) in its own balloon', welcome && wb.speaker === 'host' && wb.name === 'Kelly' && /Ciao/.test(wb.text), wb);
const doorShut = await simUntil(() => !window.__mtw.room?.model || true, 1);
const snd = await ev(() => window.__mtw.sound.log.map((l) => l.key + '>' + l.event));
expect('door sounds of the guest entrance (doorAnimOpen / doorAnimClose)', snd.some((s) => /doorAnim\/doorAnimOpen/.test(s)) && snd.some((s) => /doorAnim\/doorAnimClose/.test(s)), snd.filter((s) => /door/.test(s)));
const bgm = await ev(() => window.__mtw.sound.log.filter((l) => l.key === 'bgm_room').map((l) => l.event).slice(-1)[0]);
expect('friend visit BGM for the guest personality (type 3 → BGM_MIIWATCH_FRIEND_NORI)', bgm === 'BGM_MIIWATCH_FRIEND_NORI', bgm);
// ---- both move: personal distance, room bounds, no state violations
await ev(() => window.__mtw.roomUi.close(true));

let minD = Infinity, inRoom = true;
for (let i = 0; i < 70; i++) {
  if (i === 5) await ev(() => { const g = window.__mtw.guest.director.pos; window.__mtw.director.goTo(g.clone()); });   // the host walks right into the guest
  if (i === 30) await ev(() => window.__mtw.guest.director.goTo(window.__mtw.director.pos.clone()));                     // and the other way round
  await sim(0.5);
  const r = await ev(() => { const a = window.__mtw.director.pos, b = window.__mtw.guest?.director.pos; return b ? { d: a.distanceTo(b), ok: [a, b].every((p) => Math.abs(p.x) < 34 && Math.abs(p.z) < 34) } : null; });
  if (r) { minD = Math.min(minD, r.d); inRoom = inRoom && r.ok; }
}
const viol = await ev(() => ({ host: window.__mtw.director.violations, guest: window.__mtw.guest?.director.violations, hlog: window.__mtw.guest?.director.history.slice(-6) }));
expect('two Miis moving: personal distance kept (≥ 4.0), both inside the room', minD >= 4.0 && inRoom, { minD, inRoom });
expect('no state-machine violations on either Mii', viol.host.length === 0 && viol.guest.length === 0, viol);
await page.screenshot({ path: `${out}/m18-03-two-miis.png` });
// ---- host outfit change while the guest is there: the guest stays
const before = await ev(() => window.__mtw.guest.director.pos.toArray());
await ev(() => { window.__mtw.outfit.shoes = { id: '0003', color: 0 }; window.__mtw.rebuild(); });
await sim(1);
const after = await ev(() => ({ pos: window.__mtw.guest?.director.pos.toArray(), st: window.__mtw.guest?.director.state, others: window.__mtw.director.others().length }));
expect('host rebuild (outfit change) keeps the guest and the collision link', after.st && after.others === 1, { before, after });
// ---- tap the guest
await simUntil(() => window.__mtw.guest?.director.state === 'idle', 10);
const gp = await ev(() => { const g = window.__mtw.guest; const p = g.director.pos; const s = window.__mtw.projectRoom(p.x, 6, p.z); return s; });
const clickRes = await ev((p) => window.__mtw.roomClick(p.x, p.y), gp);
await sim(0.4);
const tap = await ev(() => ({ st: window.__mtw.guest?.director.state, clip: window.__mtw.guest?.director.currentClip, fx: window.__mtw.effects.log.slice(-1)[0]?.name, nade: window.__mtw.sound.log.some((l) => l.key === 'SequenceTouch:se_nade01') }));
await simUntil(() => window.__mtw.roomUi.snapshot()?.label === 'fixedGreeting' || window.__mtw.roomUi.snapshot()?.label === 'fixedGreetingNight', 6);
const tapB = await ev(() => ({ speaker: window.__mtw.roomUi.speaker, label: window.__mtw.roomUi.snapshot()?.label }));
expect('tap on the guest: its stroke reaction, sound, effect and its greeting balloon (host untouched)', clickRes === 'guest' && tap.nade && tap.fx === 'arStroke' && tapB.speaker === 'guest', { clickRes, tap, tapB });
const gSpeak = await ev(() => window.__mtw.speakLog.filter((x) => x.speaker === 'guest').map((x) => x.gesture));
expect('the guest talks with its own personality (gestures logged for the guest speaker)', gSpeak.length >= 2, gSpeak);
// ---- goodbye
await ev(() => window.__mtw.roomUi.close(true));
await simUntil(() => window.__mtw.guest?.director.state === 'idle', 10);
await ev(() => window.__mtw.guestLeave());
const bye1 = await simUntil(() => window.__mtw.roomUi.snapshot()?.label === 'customGreetingGoHome', 8);
const b1 = await ev(() => ({ speaker: window.__mtw.roomUi.speaker, text: window.__mtw.roomUi.snapshot()?.text }));
const bye2 = await simUntil(() => window.__mtw.roomUi.snapshot()?.label === 'customGreetingSeeingOff', 10);
const b2 = await ev(() => ({ speaker: window.__mtw.roomUi.speaker, text: window.__mtw.roomUi.snapshot()?.text }));
expect('goodbye: guest goHome (1.4, its own text) then host seeingOff (1.3)', bye1 && b1.speaker === 'guest' && /Ci vediamo!/.test(b1.text) && bye2 && b2.speaker === 'host' && /Torna presto/.test(b2.text), { b1, b2 });
const gone = await simUntil(() => !window.__mtw.guest, 30);
const end = await ev(() => ({ log: window.__mtw.guestLog.slice(-3), bgm: window.__mtw.sound.log.filter((l) => l.key === 'bgm_room').map((l) => l.event).slice(-1)[0], host: window.__mtw.director.state }));
expect('the guest walks out through the door and is removed; room music back to normal; host still there', gone && /uscito Lucia/.test(end.log.join()) && !/FRIEND/.test(end.bgm) && end.host !== 'outside', end);
await page.screenshot({ path: `${out}/m18-04-after.png` });
// ---- leaving the room ends a visit
await ev((id) => window.__mtw.play.inviteGuest(id), fid);
await sim(2);
await page.click('#play .pl-tab[data-tab=shop]');
await screen('shopTop', 10000);
const inShop = await ev(() => !!window.__mtw.guest);
await page.click('[data-a=close]'); await screen('room', 10000);
expect('the visit ends when the user leaves the room (shop)', inShop === false, inShop);
const errors = logs.filter((l) => /^(error|pageerror)/.test(l));
expect('zero console errors', errors.length === 0, errors);
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, logs }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
