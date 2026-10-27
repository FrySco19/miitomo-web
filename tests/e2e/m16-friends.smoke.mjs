// M16 friends (LocalProvider): add a local friend through the creation flow → original friend list texts → visit the
// friend's room (original dialog, friend Mii / room / greeting / friend BGM) → friend tabs → back home (original dialog,
// seeing-off greeting) → persistence across reload → delete (original confirm). The user's own save is never touched.
// Usage: node tests/e2e/m16-friends.smoke.mjs <url> <outDir> <file1> [file2...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const logs = []; page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); }); page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const checks = {}; const fail = [];
const expect = (n, ok, info) => { checks[n] = { ok: !!ok, info }; if (!ok) fail.push(`${n}: ${JSON.stringify(info)}`); };
const sim = (s) => page.evaluate((s) => window.__mtw.simRoom(s), s);
const ev = (f, a) => page.evaluate(f, a);
const screen = (n, t = 60000) => page.waitForFunction((n) => window.__mtw.play.currentScreen === n, n, { timeout: t });
const createFlow = async (name, m, d) => {
  await screen('create', 300000); await page.click('#play [data-a=next]'); await page.fill('#play .pl-input', name); await page.click('#play [data-a=next]');
  await page.selectOption('#play select[data-k=m]', String(m)); await page.selectOption('#play select[data-k=d]', String(d)); await page.click('#play [data-a=ok]');
  await screen('personality', 20000);
};
await page.goto(url);
await screen('setup');
await page.setInputFiles('#play input[type=file]', files);
await createFlow('Kelly', 5, 2); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 120000 });
await ev(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
await sim(16); await ev(() => window.__mtw.roomUi.close(true));
const own = await ev(() => ({ mii: Array.from(window.__mtw.miiData).join(','), save: JSON.stringify(window.__mtw.play.save) }));
// friend list (empty)
expect('Amici tab enabled', !(await ev(() => document.querySelector('#play .pl-tab[data-tab=friends]').disabled)), null);
await page.click('#play .pl-tab[data-tab=friends]');
await page.waitForSelector('.pl-sheet:not([hidden]) [data-a=addfriend]');
const l0 = await ev(() => ({ title: document.querySelector('.pl-sheet h2').textContent, count: document.querySelector('.pl-fcount').textContent, add: document.querySelector('[data-a=addfriend]').textContent }));
expect('friend list: original titles (Lista di amici / Amici: / Aggiungi/invita amico)', l0.title === 'Lista di amici' && /^Amici:\s*0$/.test(l0.count) && l0.add === 'Aggiungi/invita amico', l0);
// add a local friend via the creation flow
await page.click('[data-a=addfriend]');
await createFlow('Lucia', 8, 14);
await page.click('#play [data-a=preset]');
const fType = await ev(() => ['Cool', 'Dry', 'Nagomi', 'Nori'][window.__mtw.personality]);   // engine type order (REVERSED, M17b)
await page.click('#play [data-a=ok]');
await page.waitForSelector('.pl-sheet:not([hidden]) [data-visit]', { timeout: 60000 });
const l1 = await ev(() => ({ names: [...document.querySelectorAll('.pl-friend b')].map((b) => b.textContent), count: document.querySelector('.pl-fcount').textContent, saveName: window.__mtw.play.save.profile.name }));
expect('local friend added; own profile untouched', l1.names.join() === 'Lucia' && /1$/.test(l1.count) && l1.saveName === 'Kelly', l1);
await page.screenshot({ path: `${out}/m16-01-list.png` });
// visit
await page.click('[data-visit]');
const dlg = await ev(() => document.querySelector('.pl-sheet .pl-confirm:not([hidden]) p')?.innerText.replace(/\s+/g, ' '));
expect('visit dialog: original text with the friend name', dlg === 'Vuoi visitare la stanza di Lucia?', dlg);
await page.click('.pl-confirm [data-c=yes]');
await screen('friendRoom', 10000);
await page.waitForFunction(() => !!window.__mtw.director, null, { timeout: 60000 });
await ev(() => window.__mtw.sound?.unlock?.());
let greet = null;
for (let i = 0; i < 60 && !greet; i++) { await sim(0.5); greet = await ev(() => window.__mtw.roomUi.snapshot()?.label === 'customGreetingWelcome' ? window.__mtw.roomUi.snapshot() : null); }
const fr = await ev(() => ({ mii: Array.from(window.__mtw.miiData).join(','), nick: window.__mtw.roomUi.ctx.nickname, bgm: window.__mtw.sound.log.filter((l) => l.key === 'bgm_room').map((l) => l.event).slice(-3), bar: [...document.querySelectorAll('.pl-fbar .pl-tab')].map((b) => b.textContent.trim()), name: document.querySelector('.pl-fname')?.textContent }));
await page.screenshot({ path: `${out}/m16-02-friend-room.png` });
expect('friend room: the friend Mii (not the user) with its nickname', fr.mii !== own.mii && fr.nick === 'Lucia' && fr.name === 'Lucia', { nick: fr.nick, same: fr.mii === own.mii });
expect('host greets with its welcome (customGreetingWelcome, tag 1.2 → default "Ciao!")', !!greet && /Ciao/.test(JSON.stringify(greet)), greet);
const want = 'BGM_MIIWATCH_FRIEND_' + fType.toUpperCase();
expect('friend-room BGM for the friend personality type', fr.bgm.some((e) => e.includes(want)), { want, got: fr.bgm });
expect('friend tabs: original labels (tabBtn01)', ['Risposte', 'Articoli', 'Amici', 'Profilo', 'Home'].every((t) => fr.bar.includes(t)), fr.bar);
await page.click('[data-ftab=profile]');
const prof = await ev(() => document.querySelector('.pl-sheet:not([hidden]) .pl-profile')?.textContent);
expect('Profilo shows the friend data', /Lucia/.test(prof) && /14\/8/.test(prof) && /Visite\s*1/.test(prof), prof);
await page.click('[data-ftab=cloth]'); await page.waitForTimeout(400);
const cloth = await ev(() => document.querySelectorAll('.pl-sheet:not([hidden]) .pl-citem').length);
expect('Articoli lists the friend outfit', cloth > 0, cloth);
const closetBlocked = await ev(async () => { await window.__mtw.play.openCloset(); return !document.querySelector('.pl-sheet.closet:not([hidden])'); });
expect('the friend outfit cannot be edited from its room', closetBlocked, null);
// back home
await page.click('.pl-fbar [data-a=home]');
const dlg2 = await ev(() => document.querySelector('.pl-fbar .pl-confirm:not([hidden]) p')?.innerText.replace(/\s+/g, ' '));
expect('back dialog: original text', dlg2 === 'Vuoi tornare alla tua stanza?', dlg2);
await page.click('.pl-fbar .pl-confirm [data-c=yes]');
await sim(0.2);
const bye = await ev(() => window.__mtw.roomUi.snapshot()?.label);
expect('host says its seeing-off greeting (customGreetingSeeingOff)', bye === 'customGreetingSeeingOff', bye);
await screen('room', 10000);
await sim(16);
const back = await ev(() => ({ mii: Array.from(window.__mtw.miiData).join(','), nick: window.__mtw.roomUi.ctx.nickname, save: JSON.stringify({ ...window.__mtw.play.save, updated: '' }), state: window.__mtw.director.state, bgm: window.__mtw.sound.log.filter((l) => l.key === 'bgm_room').map((l) => l.event).slice(-1)[0] }));
const ownSave = JSON.parse(own.save); ownSave.updated = '';
expect('back in the user room: own Mii, own nickname, own BGM', back.mii === own.mii && back.nick === 'Kelly' && back.state !== 'outside' && !/FRIEND/.test(back.bgm), { nick: back.nick, state: back.state, bgm: back.bgm });
expect('user save unchanged by the visit', back.save === JSON.stringify(ownSave), null);
// persistence
await page.reload();
await page.waitForFunction(() => window.__mtw?.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 180000 });
await page.click('#play .pl-tab[data-tab=friends]');
await page.waitForSelector('.pl-sheet:not([hidden]) [data-visit]', { timeout: 20000 });
expect('local friends survive a reload', (await ev(() => [...document.querySelectorAll('.pl-friend b')].map((b) => b.textContent).join())) === 'Lucia', null);
// untrusted storage: a broken record is dropped, not loaded
const sanit = await ev(async () => { const { sanitizeFriend } = window.__mtw.socialLib; return [sanitizeFriend({ id: 'x y', profile: { miiData: 'AAAA' } }), sanitizeFriend({ id: 'ok', profile: { miiData: 'A'.repeat(40), name: '<img onerror=1>abcdefghijk', personality: [9, 9, 9, 9, 9] }, outfit: { tops: { id: '0755', color: 99 }, '__proto__': { id: '1' } } })]; });
expect('stored profiles are validated (bad id rejected, fields clamped)', sanit[0] === null && sanit[1].profile.name.length <= 10 && sanit[1].profile.personality === null && sanit[1].outfit.tops.color === 15, sanit[1] && { name: sanit[1].profile.name, outfit: sanit[1].outfit });
// delete
await page.click('[data-del]');
const dlg3 = await ev(() => document.querySelector('.pl-sheet .pl-confirm:not([hidden]) p')?.innerText.replace(/\s+/g, ' '));
expect('delete dialog: original text', dlg3 === 'Vuoi davvero cancellare questo amico?', dlg3);
await page.click('.pl-confirm [data-c=yes]');
await page.waitForFunction(() => /0$/.test(document.querySelector('.pl-fcount')?.textContent ?? ''), null, { timeout: 10000 });
expect('friend deleted', true, null);
const errors = logs.filter((l) => /^(error|pageerror)/.test(l));
expect('zero console errors', errors.length === 0, errors);
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, logs }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
