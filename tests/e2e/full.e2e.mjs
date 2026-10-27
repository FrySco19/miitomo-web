// Full E2E (roadmap phase 17): boot → profile → room → movement → Mii → question → (answer: no original question
// database, the game's own "no question" line) → wardrobe → room → greetings / voice → save → reload → restored.
// Usage: node tests/e2e/full.e2e.mjs <url> <outDir> <file1> [file2...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [url, out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const logs = []; page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); }); page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const steps = []; const fail = [];
const step = (n, ok, info) => { steps.push({ n, ok: !!ok, info }); if (!ok) fail.push(`${n}: ${JSON.stringify(info)}`); };
const shot = (n) => page.screenshot({ path: `${out}/${String(steps.length).padStart(2, '0')}-${n}.png` });
const ev = (f, a) => page.evaluate(f, a);
const sim = (s) => ev((s) => window.__mtw.simRoom(s), s);
const simUntil = async (pred, max = 20, st = 0.25) => { for (let t = 0; t < max; t += st) { if (await page.evaluate(pred)) return true; await sim(st); } return page.evaluate(pred); };
const clickAt = (x, y, z) => ev(([x, y, z]) => { const p = window.__mtw.stagePoint(x, y, z); const r = document.querySelector('canvas').getBoundingClientRect(); return window.__mtw.roomClick(r.left + p.x, r.top + p.y); }, [x, y, z]);
// boot + import
await page.goto(url);
await page.waitForFunction(() => window.__mtw?.play?.currentScreen === 'setup', null, { timeout: 60000 });
step('boot: setup screen (no files yet)', true, null);
await page.setInputFiles('#play input[type=file]', files);
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'create', null, { timeout: 300000 });
step('import: user files accepted', await ev(() => { const r = window.__mtw.playApi.ready(); return r.engine && r.room && r.anims && r.expr && window.__mtw.effects.available(); }), await ev(() => window.__mtw.playApi.ready()));
// profile
await page.click('#play [data-a=roll]'); await page.click('#play [data-a=next]');
await page.fill('#play .pl-input', 'Kelly'); await page.click('#play [data-a=next]');
await page.selectOption('#play select[data-k=m]', '7'); await page.selectOption('#play select[data-k=d]', '21'); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.play.currentScreen === 'personality', null, { timeout: 20000 });
await ev(() => { for (const [a, v] of [[0, 7], [1, 7], [2, 2], [3, 2], [4, 6]]) { const i = document.querySelector(`#play [data-ax="${a}"]`); i.value = String(v); i.dispatchEvent(new Event('input')); } });
await shot('personality'); await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 120000 });
await ev(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
step('profile: name / birthday / personality (Nori)', await ev(() => window.__mtw.personality === 1 && window.__mtw.play.save.profile.name === 'Kelly'), null);
// room: first entry talks with a gesture
await simUntil(() => window.__mtw.speakLog.length > 0, 25);
await sim(0.6); await shot('first-entry');
step('room: first-entry line with a personality gesture', await ev(() => !!window.__mtw.speakLog[0]?.gesture && window.__mtw.roomUi.snapshot()?.label === 'tutorialFirst'), await ev(() => window.__mtw.speakLog[0]));
await ev(() => window.__mtw.roomUi.close(true)); await simUntil(() => window.__mtw.director.state === 'idle', 15);
// movement
step('movement: click on the floor walks there', (await clickAt(-10, 0, -14)) === 'floor' && await simUntil(() => window.__mtw.director.state === 'idle', 12), await ev(() => window.__mtw.director.pos.toArray()));
// Mii: touch → stroke reaction + effect + menu
const mp = await ev(() => window.__mtw.director.pos.toArray());
await clickAt(mp[0], 4, mp[2]);
await simUntil(() => window.__mtw.roomUi.snapshot()?.kind === 'touch' && window.__mtw.roomUi.snapshot().menu.length > 0, 15);
await shot('touch-menu');
step('Mii: touch → original reaction, arStroke effect, menu', await ev(() => window.__mtw.effects.log.some((e) => e.name === 'arStroke') && window.__mtw.roomUi.snapshot()?.label === 'mySubMii0'), await ev(() => window.__mtw.effects.log.map((e) => e.name)));
// question (original line; no question database exists in the user's files)
await ev(() => window.__mtw.roomUi.clickMenu('ask'));
await simUntil(() => window.__mtw.roomUi.snapshot()?.label === 'noQuestion', 10);
step('question: original "noQuestion" line (questions were server-only)', await ev(() => window.__mtw.roomUi.snapshot()?.label === 'noQuestion'), null);
await ev(() => window.__mtw.roomUi.close(true)); await simUntil(() => window.__mtw.director.state === 'idle', 10);
// wardrobe
await page.click('#play .pl-tab[data-tab=menu]'); await page.click('#play .pl-mbtn[data-a=closet]');
await page.waitForSelector('#play .pl-citem');
const top = await ev(() => { const b = [...document.querySelectorAll('#play .pl-citem')].find((x) => !x.classList.contains('on')); b?.click(); return { id: b?.dataset.id, cat: b?.dataset.cat }; });
await page.waitForFunction((t) => window.__mtw.lastRes?.parts.some((p) => p.cat === t.cat && p.id === t.id), top, { timeout: 30000 });
await shot('wardrobe');
step('wardrobe: item equipped (cold package loaded on demand)', true, top);
await page.click('#play .pl-close');
// room skin
await page.click('#play .pl-tab[data-tab=menu]'); await page.click('#play .pl-mbtn[data-a=room]');
await page.waitForSelector('#play .pl-citem');
const wall = await ev(() => { const b = [...document.querySelectorAll('#play .pl-citem')].find((x) => x.dataset.id !== '0000'); b?.click(); return b?.dataset.id; });
await page.click('#play .pl-close'); await page.waitForFunction((w) => window.__mtw.ui.wall === w, wall, { timeout: 30000 });
step('room: wall changed', true, wall);
// greetings + voice preference
await page.click('#play .pl-tab[data-tab=menu]'); await page.click('#play .pl-mbtn[data-a=greet]');
await page.fill('#play [data-g=welcome]', 'Ciao amico!'); await page.click('#play [data-a=gsave]');
await sim(1.2); await shot('greeting-gesture');
// expected: the effects of the Joy gesture of this Mii's personality (rule data, engine type order M17b)
const joyFx = await ev(() => { const g = window.__mtw.ruleInfo('Joy').expr[window.__mtw.personality]; return { g, fx: window.__mtw.gestureInfo(g)?.effects ?? [], log: window.__mtw.effects.log.map((e) => e.name), last: window.__mtw.speakLog.at(-1) }; });
step('greetings: own words → word-list gesture (Joy) + its original effect', joyFx.last?.rules.includes('Joy') && joyFx.last.gesture === joyFx.g && (joyFx.fx.length === 0 || joyFx.fx.some((f) => joyFx.log.includes(f))), joyFx);
await ev(() => window.__mtw.roomUi.close(true));
await page.click('#play .pl-tab[data-tab=menu]'); await page.click('#play .pl-mbtn[data-a=config]');
await page.check('#play input[name=voice][value=silent]'); await page.waitForTimeout(300); await page.click('#play .pl-close').catch(() => {});
const saved = await ev(() => JSON.parse(window.__mtw.play.exportJson()));
step('save: everything in the versioned save', saved.format === 'miitomo-web-save' && saved.profile.personality?.[4] === 6 && saved.profile.greetings.welcome === 'Ciao amico!' && saved.outfit[top.cat]?.id === top.id && saved.room.wall === wall && saved.settings.voice === 'silent' && saved.profile.birthday?.month === 7, { p: saved.profile, r: saved.room, s: saved.settings });
// reload → restored
await page.reload();
await page.waitForFunction(() => window.__mtw?.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 300000 });
await ev(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
await simUntil(() => window.__mtw.roomUi.snapshot()?.kind === 'greeting', 25); await sim(1);
await shot('restored');
const st = await ev(() => ({ name: window.__mtw.roomUi.ctx.nickname, p: window.__mtw.personality, tops: Object.fromEntries(Object.entries(window.__mtw.outfit).map(([k, v]) => [k, v?.id])), wall: window.__mtw.ui.wall, voice: window.__mtw.voice.id, greet: window.__mtw.roomUi.ctx.greetings?.['1.2'], label: window.__mtw.roomUi.snapshot()?.label }));
step('reload: restored without the creation flow', st.name === 'Kelly' && st.p === 1 && st.tops[top.cat] === top.id && st.wall === wall && st.voice === 'silent' && st.greet === 'Ciao amico!' && st.label === 'fixedGreeting', st);
// export / import
const rt = await ev(async () => { const p = window.__mtw.play; const j = p.exportJson(); await p.importSave(j); return p.save.profile.name; });
step('export / import round trip', rt === 'Kelly', rt);
const errors = logs.filter((l) => /^(error|pageerror)/.test(l));
step('zero console errors', errors.length === 0, errors);
writeFileSync(`${out}/report.json`, JSON.stringify({ steps, fail, logs }, null, 1));
console.log(JSON.stringify({ passed: steps.filter((c) => c.ok).length, total: steps.length, fail }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
