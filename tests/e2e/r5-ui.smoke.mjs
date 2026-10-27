// REBOOT R5 — UI end to end in Chromium, WITHOUT the user's game files: the real Reboot runtime (bootReboot) on the
// R5 room test double (tests/e2e/harness), plus the real built app for the Classic check (J). Scenarios A–J of the R5
// brief that do not need the 3D engine, responsive sizes, persistence across reloads and a soak (listeners, timers,
// DOM, heap). The same scenarios on the real engine: tests/e2e/r5-social.smoke.mjs (needs the user's files).
// Usage (from the repo root, after `npm run build` in client/web):  node tests/e2e/r5-ui.smoke.mjs <outDir>
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = process.argv[2] ?? join(root, 'test-results', 'r5-ui');
mkdirSync(out, { recursive: true });
// ---- build the harness with the client's own esbuild (no extra dependency)
const esbuild = createRequire(join(root, 'client/web/package.json'))('esbuild');
const hdir = join(out, 'harness'); mkdirSync(hdir, { recursive: true });
await esbuild.build({ entryPoints: [join(root, 'tests/e2e/harness/r5-harness.ts')], bundle: true, format: 'esm', outfile: join(hdir, 'r5-harness.js'), loader: { '.css': 'css' }, logLevel: 'error', target: 'es2022' });
copyFileSync(join(root, 'tests/e2e/harness/index.html'), join(hdir, 'index.html'));
const dist = join(root, 'client/web/dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname);
  const base = p.startsWith('/harness/') ? hdir : dist; if (p.startsWith('/harness/')) p = p.slice(8);
  let fp = join(base, p === '/' || p === '' ? 'index.html' : p); if (!existsSync(fp) || statSync(fp).isDirectory()) fp = join(base, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(fp)] ?? 'application/octet-stream' }); res.end(readFileSync(fp));
}).listen(0);
const port = server.address().port, H = `http://127.0.0.1:${port}/harness/`;

const browser = await chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'it-IT' });
const page = await ctx.newPage();
const logs = []; page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); }); page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const checks = {}; const fail = [];
const expect = (n, ok, info) => { checks[n] = { ok: !!ok, info }; if (!ok) fail.push(`${n}: ${JSON.stringify(info)}`); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' ' + JSON.stringify(info)}`); };
const ev = (f, a) => page.evaluate(f, a);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const wait = (ms) => page.waitForTimeout(ms);
const S = () => ev(() => { const R = window.__r5.rt, h = window.__r5.host; return { at: R.hub.at, scr: h.scr, phase: R.phone.phase, app: R.phone.app, room: R.visit.roomId, mode: R.visit.mode, guests: h.guests().length, posts: R.feed.count, lang: R.i18n.lang, dock: !document.querySelector('.mp-dock').hidden, bar: !document.querySelector('.pb-bar').hidden, hub: !document.querySelector('.hub-screen').hidden }; });
const openPhone = async () => { await page.click('.mp-dock'); await page.waitForFunction(() => window.__r5.rt.phone.phase === 'open'); };
const closePhone = async () => { await page.click('.mp-x'); await page.waitForFunction(() => window.__r5.rt.phone.phase === 'closed'); };

await page.goto(H); await page.waitForFunction(() => document.body.dataset.ready === '1');
await wait(400);
// ---- start: Italian browser → Italian, MiiPhone on the right in Casa
const s0 = await S();
expect('start: at home, Italian (browser language), MiiPhone dock shown, no place bar', s0.at === 'home' && s0.lang === 'it' && s0.dock && !s0.bar, s0);
const dockBox = await page.locator('.mp-dock').boundingBox();
expect('MiiPhone dock sits on the right edge', dockBox && dockBox.x > 1400 - 90, dockBox);
await shot('r5-ui-01-casa');
// ---- E: Casa → MiiPhone → MIInstagram → post → close → still Casa
await openPhone();
const box = await page.locator('.mp-phone').boundingBox();
expect('E1 phone opens beside the world (desktop: a side phone, the room still visible)', box && box.width < 420 && box.x > 900, box);
await shot('r5-ui-02-phone-home');
await page.click('[data-app=miinstagram]');
await page.waitForSelector('.mi-app');
expect('E2 MIInstagram opens inside the phone (empty feed first)', await page.locator('.mi-emptybox').count() === 1);
await page.click('[data-a=new]'); await page.click('[data-a=snap]');
await page.fill('textarea[name=caption]', 'La mia stanza oggi');
await page.click('[data-a=publish]');
await page.waitForSelector('.mi-card');
const sE = await S();
expect('E3 post published from a photo of the room, appears at once in the feed', sE.posts === 1 && (await page.locator('.mi-card .mi-cap').first().textContent()).includes('La mia stanza oggi'), sE);
await shot('r5-ui-03-miinstagram-post');
await page.click('.mi-card .mi-r.r-like'); await wait(150);
expect('E4 reaction from the UI (Mi piace), one per person', await ev(() => { const p = window.__r5.rt.feed; return p.feed({ limit: 1 }).then((r) => r.value.items[0].reactions.host); }) === 'like');
await page.fill('.mi-cform input', 'Che bella!'); await page.press('.mi-cform input', 'Enter'); await wait(200);
expect('E5 comment from the UI', (await page.locator('.mi-comments li').allTextContents()).some((t) => t.includes('Che bella!')));
await closePhone();
const sE2 = await S();
expect('E6 phone closed → still Casa: location, screen and guests untouched', sE2.at === 'home' && sE2.scr === 'room' && sE2.phase === 'closed' && sE2.dock, sE2);
// ---- autonomous Miis react (room clock fast-forward)
await ev(() => { window.__r5.setAuto(false); window.__r5.step(400); window.__r5.setAuto(true); });
await wait(300);
const auto = await ev(() => window.__r5.rt.feed.feed({ limit: 5 }).then((r) => { const p = r.value.items.find((x) => x.kind === 'photo'); return { reactions: Object.keys(p.reactions).length, comments: p.comments.length }; }));
expect('social simulation: local Miis reacted / commented on the user\'s post (personality-driven, no spam)', auto.reactions >= 2 && auto.reactions <= 8 && auto.comments <= 3, auto);
// ---- H: language IT → EN (Piazza), UI updates, survives a reload
await page.click('.hub-pill'); await page.waitForSelector('.hub-screen:not([hidden])');
expect('H1 Piazza in Italian', (await page.locator('.hub-screen h1').textContent()).trim() === 'Piazza');
await page.click('.hub-lang [data-lang=en]'); await wait(100);
expect('H2 switched to English: Piazza → Plaza, cards translated at once', (await page.locator('.hub-screen h1').textContent()).trim() === 'Plaza' && (await page.locator('.hub-card[data-dest=friends] b').textContent()).includes('Friends'));
await shot('r5-ui-04-plaza-en');
// ---- A: Piazza → friends' rooms → enter → interact → MiiPhone (G) → Piazza
await page.click('.hub-card[data-dest=friends]'); await page.waitForSelector('.fr-card');
await shot('r5-ui-05-friend-rooms');
const cards = await page.locator('.fr-card').evaluateAll((els) => els.map((e) => ({ id: e.dataset.room, off: e.classList.contains('off'), chip: e.querySelector('.fr-chip')?.textContent })));
expect('A1 friend rooms listed with status (open / full / closed / private) and n/capacity', cards.length === 7 && cards.some((c) => c.off) && cards.some((c) => !c.off), cards);
// B: full room → error, nothing changed
const full = await ev(() => window.__r5.rt.places.list('friend').find((p) => p.status === 'full')?.id);
const presBefore = await ev((id) => window.__r5.rt.places.get(id).presence().length, full);
const rB = await ev((id) => window.__r5.rt.hub.go('friends', id), full);
const sB = await S();
expect('B full room: refused (FULL), still in the Piazza, presence unchanged', !rB.ok && rB.detail === 'FULL' && sB.at === 'hub' && sB.hub && (await ev((id) => window.__r5.rt.places.get(id).presence().length, full)) === presBefore, { rB, sB });
const open = cards.find((c) => !c.off).id;
await page.click(`[data-enter="${open}"]`);
await page.waitForFunction(() => window.__r5.rt.visit.mode === 'inside', null, { timeout: 10000 });
await wait(600);
const sA = await S();
expect('A2 inside the friend\'s room as a visitor: place bar, Miis of that room in the scene', sA.at === 'friends' && sA.bar && sA.guests >= 1 && (await page.locator('.pb-bar small').textContent()).includes('visitor'), sA);
await shot('r5-ui-06-friend-room');
await page.waitForFunction(() => window.__r5.host.ms[0].state === 'idle');
const tapOk = await ev(() => window.__r5.host.tapObject('shelf'));
expect('A3 interacting with the room (object allowed by this owner)', tapOk === true);
// G: Friend room → MIInstagram → reaction/comment → close → presence unchanged (room clock held: only the phone acts)
await ev(() => window.__r5.setAuto(false));
const presG = await ev((id) => window.__r5.rt.places.get(id).presence().map((p) => p.profileId).sort().join(), open);
await openPhone();
await page.click('[data-app=miinstagram]').catch(() => {});   // restoration may already show MIInstagram
await page.waitForSelector('.mi-card');
await page.locator('.mi-card').first().locator('.mi-r.r-wow').click(); await wait(100);
await page.fill('.mi-cform input >> nth=0', 'Ciao da casa di un amico'); await page.press('.mi-cform input >> nth=0', 'Enter'); await wait(150);
// R6: deleting an own post asks first (Settings → confirmations, on by default); "keep it" keeps it
const ownBefore = await ev(() => window.__r5.rt.feed.count);
await page.locator('.mi-del').first().click(); await page.waitForSelector('.mi-ask');
await page.click('.mi-ask [data-delno]'); await wait(100);
expect('R6 delete own post: asks first; "keep it" keeps the post', (await page.locator('.mi-ask').count()) === 0 && (await ev(() => window.__r5.rt.feed.count)) === ownBefore && (await page.locator('.mi-del').count()) >= 1);
await closePhone();
const presG2 = await ev((id) => window.__r5.rt.places.get(id).presence().map((p) => p.profileId).sort().join(), open);
const sG = await S();
await ev(() => window.__r5.setAuto(true));
expect('G phone in a friend\'s room: reaction + comment, closed → same room, same presence, same location', sG.at === 'friends' && sG.room === open && presG === presG2 && sG.mode === 'inside', { presG, presG2, sG });
// R6: leaving asks for a second tap (confirmations on by default)
await page.click('.pb-bar [data-go=hub]'); await wait(150);
const armed = await page.locator('.pb-bar [data-go=hub].armed').count(), stillIn = (await S()).room === open;
await page.click('.pb-bar [data-go=hub]'); await page.waitForFunction(() => window.__r5.rt.hub.at === 'hub');
expect('R6 leave confirmation: first tap arms the button and stays, second tap leaves', armed === 1 && stillIn);
const sA4 = await S();
expect('A4 friend room → Piazza: presence removed, scene emptied', sA4.at === 'hub' && sA4.guests === 0 && sA4.room === null && !(await ev((id) => window.__r5.rt.places.get(id).has('host'), open)), sA4);
// ---- R6 Settings app (MiiPhone): every control changes the stored record and the running game at once
await openPhone();
if (await ev(() => window.__r5.rt.phone.app !== 'home')) await page.click('.mp-back');   // reopening restores the last app
await page.click('[data-app=settings]'); await page.waitForSelector('.set');
await shot('r5-ui-06b-settings');
await page.locator('[data-vol=music]').fill('40'); await wait(50);
await page.click('[data-set=quality][data-v=low]'); await wait(50);
await page.selectOption('select[data-set=region]', 'GB'); await wait(50);
await page.locator('input[data-set=confirm]').click(); await wait(50);
await page.fill('.set-name input[name=n]', '   '); await page.click('.set-name [type=submit]'); await wait(50);
const emptyRefused = (await page.locator('.set .r-msg').textContent()).length > 0 && (await ev(() => window.__r5.host.profile().name)) === 'Kelly';
await page.fill('.set-name input[name=n]', 'Kelly R6'); await page.click('.set-name [type=submit]'); await wait(50);
const st = await ev(() => ({ vol: window.__r5.host.volumes, q: window.__r5.host.quality, locale: window.__r5.rt.i18n.locale, stored: JSON.parse(localStorage.getItem('mtw.reboot.settings')), name: window.__r5.host.profile().name, motion: document.documentElement.dataset.motion }));
expect('R6 settings: music 40% → host volume 0.4; quality low → host; region GB → en-GB dates; confirmations off; all stored', Math.abs(st.vol.music - 0.4) < 1e-9 && st.q === 'low' && st.locale === 'en-GB' && st.stored.confirm === false && st.stored.volumes.music === 40 && st.stored.region === 'GB' && st.motion === 'full', st);
expect('R6 settings: player name — empty refused, a new name saved to the profile', emptyRefused && st.name === 'Kelly R6', st);
await page.click('[data-set=language][data-v=it]'); await wait(80);
const itTitle = await page.locator('.mp-title').textContent();
await page.click('[data-set=language][data-v=en]'); await wait(80);
expect('R6 settings: language from the Settings app, applied to the phone at once', itTitle === 'Impostazioni' && (await page.locator('.mp-title').textContent()) === 'Settings', itTitle);
await page.locator('input[data-set=light]').click(); await wait(50);
const light = await ev(() => ({ q: window.__r5.host.quality, motion: document.documentElement.dataset.motion, gap: window.__r5.rt.places.turnover.gap, posts: window.__r5.rt.feedSim.config.maxPostsPerHour }));
await page.locator('input[data-set=light]').click(); await page.click('[data-set=quality][data-v=auto]'); await wait(50);
const unlight = await ev(() => ({ q: window.__r5.host.quality, motion: document.documentElement.dataset.motion, gap: window.__r5.rt.places.turnover.gap, posts: window.__r5.rt.feedSim.config.maxPostsPerHour }));
expect('R6 light mode: reduced motion, calmer world (arrivals ×2, half the posts); off = back exactly', light.motion === 'reduced' && light.q === 'low' && light.gap[0] === unlight.gap[0] * 2 && light.posts === unlight.posts / 2 && unlight.q === 'high' && unlight.motion === 'full', { light, unlight });
await closePhone();
// ---- R6 MiiPhone as the hub: My page, Friends (visit for real), shortcuts, Reboot panel translated
const toHome = async () => { if (await ev(() => window.__r5.rt.phone.app !== 'home')) await page.click('.mp-back'); };
await openPhone(); await toHome();
const tiles = await page.$$eval('.mp-app', (b) => b.map((x) => x.dataset.app));
expect('R6 phone home: only real apps, in order (no placeholders)', tiles.join() === 'profile,friends,miinstagram,plaza,house,rooms,games,settings', tiles);
await shot('r5-ui-06c-phone-home-r6');
await page.click('[data-app=profile]'); await page.waitForSelector('.pp-me');
const me = await ev(() => ({ name: document.querySelector('.pp-name').textContent, stats: [...document.querySelectorAll('.pp-stat b')].map((b) => +b.textContent), posts: window.__r5.rt.feed.postsBy('host').length, played: window.__r5.rt.games.stats.played }));
expect('R6 My page: real name and real counters (posts, friends, matches)', me.name === 'Kelly R6' && me.stats[0] === me.posts && me.stats[1] === 7 && me.stats[2] === me.played, me);
await shot('r5-ui-06d-my-page');
await page.click('[data-tab=posts]'); await wait(80);
const tilesN = await page.locator('.pp-tile').count();
await page.click('[data-tab=friends]'); await page.waitForSelector('.pp-close li');
const closeN = await page.locator('.pp-close li').count();
expect('R6 My page tabs: one tile per own post; the 5 closest friends', tilesN === me.posts && closeN === 5, { tilesN, closeN });
await page.click('[data-open=friends]'); await page.waitForSelector('.fa-row');
const rows = await ev(() => [...document.querySelectorAll('.fa-row')].map((r) => ({ id: r.dataset.id, where: r.querySelector('small').textContent, go: r.querySelector('[data-go]')?.dataset.go ?? null, can: !!r.querySelector('[data-go]:not([disabled])') })));
const whereOk = await ev((rows) => rows.every((r) => { const w = window.__r5.rt.places.whereIs(r.id); return (w.placeId ?? null) === r.go || (w.placeId && window.__r5.rt.places.current === w.placeId); }), rows);
expect('R6 Friends: every local friend with where they are now (same as the places) and a visit button', rows.length === 7 && whereOk && rows.some((r) => r.can), rows);
await shot('r5-ui-06e-friends');
const target = rows.find((r) => r.can).go;
await page.click(`.fa-row [data-go="${target}"]`);
await page.waitForFunction((id) => window.__r5.rt.visit.roomId === id && window.__r5.rt.visit.mode === 'inside' && window.__r5.rt.phone.phase === 'closed', target, { timeout: 8000 });
expect('R6 Friends → visit: inside that place for real, phone closed', true);
await openPhone(); await toHome(); await page.click('[data-app=plaza]');
await page.waitForFunction(() => window.__r5.rt.hub.at === 'hub' && window.__r5.rt.phone.phase === 'closed' && !window.__r5.rt.visit.roomId, null, { timeout: 8000 });
expect('R6 shortcut Plaza: left the place (cleanup), in the Plaza, phone closed', (await S()).guests === 0);
await openPhone(); await toHome(); await page.click('[data-app=rooms]');
await page.waitForSelector('.hub-panel .fr-card', { timeout: 5000 });
expect('R6 shortcut Rooms: the friends\' rooms list opens in the Plaza', (await ev(() => window.__r5.rt.phone.phase)) !== 'open');
await page.click('[data-hubback]');
await page.waitForFunction(() => window.__r5.rt.phone.phase === 'closed');
await openPhone(); await toHome(); await page.click('[data-app=games]');
await page.waitForFunction(() => window.__r5.rt.games.here && window.__r5.rt.visit.mode === 'inside', null, { timeout: 8000 });
expect('R6 shortcut Games: in the Game Room', true);
await openPhone(); await toHome(); await page.click('[data-app=house]');
await page.waitForFunction(() => window.__r5.rt.hub.at === 'home' && !window.__r5.rt.visit.roomId, null, { timeout: 8000 });
expect('R6 shortcut Home: back home from the Game Room, nothing left behind', (await S()).guests === 0 && (await S()).scr === 'room');
await ev(() => window.__r5.rt.panel.show()); await wait(100);
const pan = await ev(() => ({ title: document.querySelector('.rbt-pill').title, heads: [...document.querySelectorAll('.rbt-sheet h3')].map((h) => h.textContent), flags: document.querySelector('.rbt-flags').textContent }));
await ev(() => { document.querySelector('.rbt-sheet').hidden = true; });
expect('R6 Reboot panel in English (title, sections, feature names)', /new features/.test(pan.title) && pan.heads.some((h) => /Public room|Miis in the room/.test(h)) && /Several Miis in the room/.test(pan.flags), pan);
// ---- C: friend room → Casa: complete cleanup
await ev((id) => window.__r5.rt.hub.go('friends', id), open); await page.waitForFunction(() => window.__r5.rt.visit.mode === 'inside');
await page.click('.pb-bar [data-go=home]'); await page.waitForFunction(() => window.__r5.rt.hub.at === 'home');
const lc = await ev(() => window.__r5.host.listeners());
const sC = await S();
expect('C friend room → Casa: at home, no guests, no place listeners, capacity back', sC.at === 'home' && sC.guests === 0 && sC.scr === 'room' && (await ev(() => window.__r5.host.cap)) === 3 && (await ev(() => window.__r5.rt.visit.resources.unsubs)) === 0, { sC, lc });
// ---- D: Piazza → Sala Giochi → match → result → Sala Giochi → Piazza
await page.click('.hub-pill'); await page.waitForSelector('.hub-screen:not([hidden])');
await page.click('.hub-card[data-dest=games]'); await page.waitForFunction(() => window.__r5.rt.games.here && window.__r5.rt.visit.mode === 'inside');
await ev(() => { window.__r5.setAuto(false); for (let i = 0; i < 40 && window.__r5.rt.games.freeMiis().length < 2; i++) window.__r5.step(1); window.__r5.setAuto(true); });
await page.waitForSelector('.gr-board');
expect('D0 the Sala Giochi draws a crowd: Miis who are out come by to play', (await ev(() => window.__r5.rt.games.freeMiis().length)) >= 1, await ev(() => window.__r5.host.guests()));
await shot('r5-ui-07-game-room');
await page.click('[data-play=mii-quiz]');
await page.waitForSelector('.gr-match');
const dockDuring = await page.waitForFunction(() => document.querySelector('.mp-dock').hidden, null, { timeout: 2000 }).then(() => true, () => false);
expect('D1 match started from the board; MiiPhone hidden during the match', dockDuring && (await ev(() => window.__r5.rt.games.session.players.length)) >= 2);
await shot('r5-ui-08-quiz');
await ev(() => window.__r5.setAuto(false));
for (let i = 0; i < 400 && await ev(() => !!window.__r5.rt.games.session?.active); i++) {
  const can = await page.locator('.gr-opt:not([disabled])').count();
  if (can) { await page.locator('.gr-opt:not([disabled])').first().click(); }
  await ev(() => window.__r5.step(1));
}
await ev(() => window.__r5.setAuto(true));
await page.waitForSelector('.gr-result');
const res = await ev(() => { const s = window.__r5.rt.games.session; return { state: s.state, players: s.result?.players.length, stats: window.__r5.rt.games.stats.played }; });
expect('D2 match finished with a ranking; stats updated', res.state === 'finished' && res.players >= 2 && res.stats === 1, res);
await shot('r5-ui-09-quiz-result');
await page.click('.gr-result [data-a=back]');
await page.waitForFunction(() => !document.querySelector('.mp-dock').hidden, null, { timeout: 2000 }).catch(() => {});
expect('D3 back to the Sala Giochi (board again, MiiPhone back)', await page.locator('.gr-board').count() === 1 && !(await page.locator('.mp-dock').isHidden()));
await page.click('.pb-bar [data-go=hub]'); await page.waitForFunction(() => window.__r5.rt.hub.at === 'hub');
expect('D4 Sala Giochi → Piazza', (await S()).at === 'hub');
const actPost = await ev(() => window.__r5.rt.feed.feed({ limit: 10 }).then((r) => r.value.items.some((p) => p.kind === 'activity' && p.activity === 'game')));
console.log('   (activity post about the match:', actPost, '— probability, not required)');
await page.click('.hub-card[data-dest=home]'); await page.waitForFunction(() => window.__r5.rt.hub.at === 'home');
// ---- I + H3: reload → posts / reactions / comments / language kept
const before = await ev(() => window.__r5.rt.feed.feed({ limit: 30 }).then((r) => r.value.items.map((p) => ({ id: p.id, r: Object.keys(p.reactions).length, c: p.comments.length }))));
await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === '1'); await wait(300);
const after = await ev(() => window.__r5.rt.feed.feed({ limit: 30 }).then((r) => r.value.items.map((p) => ({ id: p.id, r: Object.keys(p.reactions).length, c: p.comments.length }))));
expect('I persistence: posts, reactions and comments survive a reload', JSON.stringify(after) === JSON.stringify(before) && before.length >= 1, { before, after });
expect('H3 language kept after reload (English)', (await S()).lang === 'en');
const st2 = await ev(() => ({ vol: window.__r5.host.volumes, locale: window.__r5.rt.i18n.locale, confirm: window.__r5.rt.settings.value.confirm }));
expect('R6 settings kept after reload and applied at start (volume, region, confirmations)', Math.abs(st2.vol.music - 0.4) < 1e-9 && st2.locale === 'en-GB' && st2.confirm === false, st2);
await openPhone();
await page.click('[data-app=miinstagram]').catch(() => {});
await page.waitForSelector('.mi-card img', { timeout: 5000 }).catch(() => {});
expect('I photo of the post still there after reload (IndexedDB)', await page.locator('.mi-card img').count() >= 1);
await shot('r5-ui-10-after-reload-en');
// R6: with confirmations off, deleting an own post is immediate; the feed and the store agree
const nDel = await ev(() => window.__r5.rt.feed.count);
await page.locator('.mi-del').first().click(); await page.waitForFunction((n) => window.__r5.rt.feed.count === n - 1, nDel, { timeout: 3000 }).catch(() => {});
expect('R6 delete own post (confirmations off): removed at once', (await ev(() => window.__r5.rt.feed.count)) === nDel - 1, { nDel });
await closePhone();
// ---- responsive: tablet + phone
for (const [name, vw, vh] of [['tablet', 820, 1180], ['phone', 390, 844]]) {
  await page.setViewportSize({ width: vw, height: vh }); await wait(200);
  await openPhone();
  const b = await page.locator('.mp-phone').boundingBox();
  const over = await ev(() => document.documentElement.scrollWidth > innerWidth);
  if (name === 'phone') expect('responsive phone (390×844): MIInstagram takes the whole screen (no tiny phone inside the phone)', b && b.width >= vw - 2 && b.height >= vh - 2 && !over, b);
  else expect('responsive tablet (820×1180): side phone, fits the screen', b && b.width < 420 && b.y >= 0 && b.y + b.height <= vh + 1 && !over, b);
  await page.click('[data-app=miinstagram]').catch(() => {});
  await wait(200); await shot(`r5-ui-11-${name}`);
  await closePhone();
}
await page.setViewportSize({ width: 1400, height: 900 });
// ---- soak: phone 20×, places 10×, 3 matches → listeners / timers / DOM / heap stable
const probe = () => ev(() => { const R = window.__r5.rt, h = window.__r5.host; return { ...h.listeners(), feed: R.feed.listenerCount, i18n: R.i18n.listenerCount, places: R.places.listenerCount, visit: R.visit.listenerCount, phone: R.phone.listenerCount, hub: R.hub.listenerCount, dom: document.getElementsByTagName('*').length, guests: h.guests().length }; });
const heap = async () => { await ev(() => window.gc?.()); await ev(() => window.gc?.()); return ev(() => performance.memory?.usedJSHeapSize ?? 0); };
await ev(() => window.__r5.rt.hub.go('hub')); await ev(() => window.__r5.rt.hub.go('home'));   // warm-up: views rendered once
const p0 = await probe(); const h0 = await heap();
for (let i = 0; i < 20; i++) { await openPhone(); if (i % 2) { await page.click('[data-app=miinstagram]').catch(() => {}); await page.waitForSelector('.mi-app'); } await closePhone(); }
for (let i = 0; i < 10; i++) {
  await ev(() => window.__r5.rt.hub.go('hub'));
  const id = await ev((i) => { const l = window.__r5.rt.places.list('friend').filter((p) => !p.refusal); return l[i % l.length].id; }, i);
  await ev((id) => window.__r5.rt.hub.go('friends', id), id);
  await page.waitForFunction(() => window.__r5.rt.visit.mode === 'inside');
  await ev(() => window.__r5.step(5));
  await ev((i) => window.__r5.rt.hub.go(i % 2 ? 'hub' : 'home'), i);
}
await ev(() => window.__r5.rt.hub.go('hub')); await ev(() => window.__r5.rt.hub.go('games')); await page.waitForFunction(() => window.__r5.rt.visit.mode === 'inside');
await ev(() => window.__r5.setAuto(false));
for (let m = 0; m < 3; m++) {
  await ev(() => window.__r5.step(3));
  await ev(() => window.__r5.rt.games.start('mii-quiz'));
  for (let i = 0; i < 200 && await ev(() => !!window.__r5.rt.games.session?.active); i++) { await ev(() => { const g = window.__r5.rt.games; const v = g.session.logic.view; if (v.phase === 'question' && v.answered.host === null) g.answer(0); window.__r5.step(1); }); }
  await ev(() => window.__r5.rt.games.closeResult());
}
await ev(() => window.__r5.setAuto(true));
await ev(() => window.__r5.rt.hub.go('home')); await page.waitForFunction(() => window.__r5.rt.hub.at === 'home');
await wait(500);
const p1 = await probe(); const h1 = await heap();
const timers = await ev(() => window.__r5.rt.gameView.timers);
expect('soak: listeners back to the start (room clock, guests, feed, i18n, places, visit, phone, hub)', ['tick', 'speech', 'player', 'guest', 'feed', 'i18n', 'places', 'visit', 'phone', 'hub'].every((k) => p1[k] === p0[k]), { p0, p1 });
expect('soak: no guests left, DOM size stable (±60 nodes)', p1.guests === 0 && Math.abs(p1.dom - p0.dom) <= 60, { dom0: p0.dom, dom1: p1.dom });
expect('soak: no match timer left', timers === 0, timers);
expect('soak: heap after GC grows less than 3 MB over 20 phone cycles, 10 room visits and 3 matches', h1 - h0 < 3e6, { h0, h1, d: h1 - h0 });
writeFileSync(`${out}/r5-ui-soak.json`, JSON.stringify({ p0, p1, h0, h1, timers }, null, 1));
await ctx.close();

// ---- J: the real built app — Classic (?reboot=0) never loads Reboot; ?reboot=1 loads it (no game files needed)
for (const [q, want] of [['reboot=0', false], ['reboot=1', true]]) {
  const c = await browser.newContext({ viewport: { width: 1200, height: 800 } }); const p = await c.newPage();
  await p.goto(`http://127.0.0.1:${port}/?${q}`); await p.waitForTimeout(2500);
  const r = await p.evaluate(() => ({ chunks: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /assets\/.*\.js/.test(n)), r5: !!document.querySelector('.r5-layer'), dock: !!document.querySelector('.mp-dock'), on: window.__mtw?.REBOOT_ON }));
  if (!want) expect('J Classic ?reboot=0: no MiiPhone, no R5 layer, only the main chunk downloaded', !r.r5 && !r.dock && r.on === false && r.chunks.length === 1, r);
  else expect('J control ?reboot=1: the Reboot chunk is downloaded and the R5 layer exists', r.r5 && r.dock && r.on === true && r.chunks.length === 2, r);
  await c.close();
}
await browser.close(); server.close();
const relevant = logs.filter((l) => !/favicon|ffl|Failed to load resource/.test(l));
expect('no page errors / warnings during the run', relevant.length === 0, relevant.slice(0, 5));
writeFileSync(`${out}/r5-ui-report.json`, JSON.stringify({ checks, logs }, null, 1));
console.log(fail.length ? `${fail.length} FAILED` : `ALL ${Object.keys(checks).length} PASS`);
process.exit(fail.length ? 1 : 0);
