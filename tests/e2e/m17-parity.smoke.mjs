// M17 parity fixes: closet (original 9 icon tabs, every category, Togli/Rimetti, Dentro/Fuori, Preferito ★, closet camera),
// bottom bar (original icons + selected state), Mii Studio editor (original part icons / colours / grid order, FFL-verified
// edits, save), personality result texts (characterInfo00), "Sai, di recente…" (flow + SERVER DATA MISSING state).
// Usage: node tests/e2e/m17-parity.smoke.mjs <url> <outDir> <file1> [file2...]
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
await page.goto(url);
await screen('setup');
await page.setInputFiles('#play input[type=file]', files);
await screen('create', 300000);
// CAMERA PLAY (VERIFIED/REVERSED: fixed camera): drag / wheel on the PLAY stage change nothing, no auto-rotation
const yaw0 = await ev(() => ({ yaw: window.__mtw.view.yaw, dist: window.__mtw.view.dist, auto: window.__mtw.view.autoRotate }));
await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(900, 500, { steps: 6 }); await page.mouse.up(); await page.mouse.wheel(0, 400); await page.waitForTimeout(400);
const yaw1 = await ev(() => ({ yaw: window.__mtw.view.yaw, dist: window.__mtw.view.dist, auto: window.__mtw.view.autoRotate }));
expect('PLAY stage (creation): fixed front view — no drag rotation, no zoom, no auto-rotate', yaw0.yaw === 0 && yaw1.yaw === 0 && yaw1.dist === yaw0.dist && !yaw1.auto, { yaw0, yaw1 });
await page.click('#play [data-a=next]'); await page.fill('#play .pl-input', 'Kelly'); await page.click('#play [data-a=next]');
await page.selectOption('#play select[data-k=m]', '5'); await page.selectOption('#play select[data-k=d]', '2'); await page.click('#play [data-a=ok]');
await screen('personality', 20000);
// personality: original result texts
await ev(() => { for (const a of [0, 1]) { const i = document.querySelector(`#play [data-ax="${a}"]`); i.value = '8'; i.dispatchEvent(new Event('input')); } });
const pt = await ev(() => ({ name: document.querySelector('.pl-ptype-name')?.textContent, group: document.querySelector('.pl-ptype-group')?.textContent, short: document.querySelector('.pl-ptype-short')?.textContent, long: document.querySelector('.pl-ptype-long')?.textContent }));
expect('personality result: original type / group / descriptions (characterInfo00)', pt.name === 'Intraprendente' && pt.group === 'Deciso' && /orgoglioso/.test(pt.short) && pt.long.length > 20, pt);
await page.click('#play [data-a=ok]');
await page.waitForFunction(() => window.__mtw.director && window.__mtw.play.currentScreen === 'room', null, { timeout: 120000 });
await ev(() => { window.__mtw.testClock.paused = true; window.__mtw.clock.hour = 10; });
await sim(16); await ev(() => window.__mtw.roomUi.close(true));
const camA = await ev(() => window.__mtw.camera.position.toArray().map((v) => +v.toFixed(3)).join());
await page.mouse.move(300, 300); await page.mouse.down(); await page.mouse.move(150, 200, { steps: 6 }); await page.mouse.up(); await page.mouse.wheel(0, -500); await sim(0.5);
const camB = await ev(() => ({ pos: window.__mtw.camera.position.toArray().map((v) => +v.toFixed(3)).join(), mode: window.__mtw.ui.roomCam }));
expect('CAMERA PLAY room: fixed original camera (drag / wheel do not move it)', camA === camB.pos && camB.mode === 'original', { camA, camB });
// ---- bottom bar
const bar = await ev(() => [...document.querySelectorAll('#play .pl-nav .pl-tab')].map((b) => ({ tab: b.dataset.tab, label: b.querySelector('.pl-tab-label')?.textContent, img: !!b.querySelector('.pl-tab-ico img')?.src, base: /url\(/.test(b.querySelector('.pl-tab-ico')?.style.borderImageSource ?? ''), on: b.classList.contains('on') })));
expect('bottom bar: 5 original tabs in table order with original icons + bulletTab base', bar.map((b) => b.label).join('|') === 'Home|La mia pagina|Amici|Negozio|Menu' && bar.every((b) => b.img && b.base), bar);
expect('bottom bar: Home selected at start', bar[0].on && bar.filter((b) => b.on).length === 1, bar.map((b) => b.on));
await page.click('#play .pl-tab[data-tab=menu]');
const sel = await ev(() => [...document.querySelectorAll('#play .pl-nav .pl-tab.on')].map((b) => b.dataset.tab));
expect('bottom bar: the opened tab becomes selected', sel.join() === 'menu', sel);
await page.screenshot({ path: `${out}/m17-01-bar-menu.png` });
// ---- closet
await page.click('#play [data-a=closet]');
await page.waitForSelector('.pl-sheet.closet .pl-ctabs.icons');
const tabs = await ev(() => [...document.querySelectorAll('.pl-ctabs.icons .pl-ctab')].map((b) => ({ id: b.dataset.tab, img: !!b.querySelector('img'), w: b.getBoundingClientRect().width, vis: b.getBoundingClientRect().right <= document.querySelector('.pl-sheet-card').getBoundingClientRect().right + 1 })));
expect('closet: the 9 original icon tabs, all visible (no hidden overflow)', tabs.length === 9 && tabs.every((t) => t.img && t.vis) && tabs.map((t) => t.id).join() === 'recent,fav,tops,all,bottomsA,headwear,bottomsB,shoes,acce', tabs);
const perCat = {};
for (const t of ['tops', 'all', 'bottomsA', 'headwear', 'bottomsB', 'shoes', 'acce']) {
  await page.click(`.pl-ctab[data-tab=${t}]`); await page.waitForTimeout(300);
  const r = await ev(async (t) => {
    const items = [...document.querySelectorAll('.pl-sheet.closet .pl-citem')];
    const b = items.find((x) => !x.classList.contains('on')) ?? items[0]; if (!b) return { n: 0 };
    const cat = b.dataset.cat, id = b.dataset.id; b.click();
    for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 100)); if (window.__mtw.outfit[cat]?.id === id && (window.__mtw.lastRes?.parts.some((p) => p.cat === cat && p.id === id) || window.__mtw.lastRes?.removed.length)) break; }
    return { n: items.length, cat, id, worn: window.__mtw.outfit[cat]?.id === id, built: !!window.__mtw.lastRes?.parts.some((p) => p.cat === cat && p.id === id), removed: window.__mtw.lastRes?.removed ?? [] };
  }, t);
  perCat[t] = r;
}
expect('closet: every category lists items and one item of each is worn and built (or resolved by an exclusion)', Object.values(perCat).every((r) => r.n > 0 && r.worn && (r.built || r.removed.length)), perCat);
const sortL = await ev(() => [...document.querySelectorAll('.pl-csort button')].map((b) => b.textContent));
expect('closet: original sort labels Nuovo / Vecchio', sortL.join() === 'Nuovo,Vecchio', sortL);
const blendW = await ev(() => window.__mtw.director.update(0).blend?.weight ?? 0);
expect('closet changes keep the idle pose (no fade from the bind pose after a rebuild)', blendW < 1e-6, blendW);
const topsHasLong = await ev(async () => { document.querySelector('.pl-ctab[data-tab=tops]').click(); await new Promise((r) => setTimeout(r, 400)); const c = new Set([...document.querySelectorAll('.pl-sheet.closet .pl-citem')].map((b) => b.dataset.cat)); return [...c]; });
expect('closet: tops tab holds tops + topslong (no separate original button)', topsHasLong.includes('tops') && topsHasLong.includes('topslong'), topsHasLong);
// Togli / Rimetti + colour counter
await page.click('.pl-ctab[data-tab=shoes]'); await page.waitForTimeout(400);
const off = await ev(async () => { const b = document.querySelector('[data-off=shoes]'); const lbl = b?.textContent; b?.click(); await new Promise((r) => setTimeout(r, 600)); const on = document.querySelector('[data-on=shoes]'); const r = { lbl, gone: !window.__mtw.outfit.shoes, back: on?.textContent }; on?.click(); await new Promise((r) => setTimeout(r, 600)); r.again = !!window.__mtw.outfit.shoes; r.counter = document.querySelector('.pl-colnum')?.textContent ?? null; return r; });
expect('closet: original Togli / Rimetti put the item back', off.lbl === 'Togli' && off.gone && off.back === 'Rimetti' && off.again, off);
// favourites
await page.click('[data-a=star]'); await page.waitForTimeout(500);
const fav = await ev(() => ({ n: window.__mtw.play.save.coordinates.length, shown: document.querySelectorAll('.pl-fav').length, label: document.querySelector('[data-a=star]')?.textContent }));
expect('closet: ★ Preferito saves the outfit in the favourites tab', fav.n === 1 && fav.shown === 1 && /Preferito/.test(fav.label), fav);
// closet camera (closet_camera.xml)
const cam = await ev(async () => { window.__mtw.closetCamZoom(0.01); await new Promise((r) => setTimeout(r, 50)); const a = window.__mtw.ccam.scaleT; window.__mtw.closetCamZoom(100); const b = window.__mtw.ccam.scaleT; window.__mtw.closetCamPan(-99999, -99999); return { min: a, max: b, look: window.__mtw.ccam.lookT }; });
expect('closet camera: zoom clamped to min_scale 0.38 / max_scale 1, pan clamped to min/max_lookAt', Math.abs(cam.min - 0.38) < 1e-6 && cam.max === 1 && cam.look[0] === 4 && cam.look[1] === 3, cam);
await page.screenshot({ path: `${out}/m17-02-closet.png` });
await page.click('.pl-sheet .pl-close');
// ---- Mii Studio editor
await page.click('#play .pl-tab[data-tab=menu]'); await page.click('#play [data-a=remake]');
await screen('miiStudio', 20000);
const ci0 = await ev(() => Array.from(window.__mtw.playApi.charInfo()));
const cats = await ev(() => [...document.querySelectorAll('.ms-cat')].map((b) => ({ id: b.dataset.cat, img: !!b.querySelector('img') })));
expect('editor: original category buttons (11 + Profilo)', cats.length === 12 && cats.filter((c) => c.img).length === 11, cats);
const per = {};
for (const c of ['face', 'hair', 'eyebrow', 'eye', 'nose', 'mouth', 'mustache', 'beard', 'glass', 'mole']) {
  await page.click(`.ms-cat[data-cat=${c}]`);
  per[c] = await ev(async () => {
    const parts = [...document.querySelectorAll('.ms-part')]; const icons = parts.filter((p) => p.querySelector('img')).length;
    const pick = parts.find((p) => !p.classList.contains('on'));
    const f = pick?.dataset.set, v = Number(pick?.dataset.v); pick?.click(); await new Promise((r) => setTimeout(r, 250));
    const ci = window.__mtw.playApi.charInfo(); const got = ci ? new DataView(ci.buffer).getInt32({ faceType: 4, hairType: 20, eyebrowType: 60, eyeType: 32, noseType: 88, mouthType: 100, beardMustache: 120, beardType: 124, glassType: 140, moleType: 156 }[f], true) : -1;
    return { parts: parts.length, icons, f, v, applied: got === v, err: document.querySelector('.ms-panel .pl-err')?.textContent ?? null, segs: [...document.querySelectorAll('.ms-segs button')].map((b) => b.textContent) };
  });
}
const counts = { face: 36, hair: 132, eyebrow: 24, eye: 60, nose: 18, mouth: 36, mustache: 6, beard: 6, glass: 20, mole: 2 };
expect('editor: every part category shows all original icons (counts = FFL ranges)', Object.entries(counts).every(([k, n]) => per[k].parts === n && per[k].icons === n), Object.fromEntries(Object.entries(per).map(([k, v]) => [k, [v.parts, v.icons]])));
expect('editor: choosing a part rebuilds the Mii with that FFL part id (FFL-verified)', Object.values(per).every((r) => r.applied && !r.err), per);
expect('editor: original segment labels Elementi / Colore / Posizione', per.eye.segs.join('|') === 'Elementi|Colore|Posizione', per.eye.segs);
const hairOrder = await ev(async () => { document.querySelector('.ms-cat[data-cat=hair]').click(); await new Promise((r) => setTimeout(r, 200)); return [...document.querySelectorAll('.ms-part')].slice(0, 6).map((b) => Number(b.dataset.v)); });
expect('editor: original grid order (rodata table): hair starts 33, 47, 40, 37, 32, 48', hairOrder.join() === '33,47,40,37,32,48', hairOrder);
// colour + position + undo
await page.click('.ms-cat[data-cat=eye]'); await page.click('.ms-segs [data-seg=color]');
const col = await ev(async () => { const ch = [...document.querySelectorAll('.ms-chip')]; const b = ch.find((x) => !x.classList.contains('on')); b.click(); await new Promise((r) => setTimeout(r, 250)); return { n: ch.length, imgs: ch.filter((c) => c.querySelector('img')).length, v: Number(b.dataset.v), got: new DataView(window.__mtw.playApi.charInfo().buffer).getInt32(36, true) }; });
expect('editor: original eye colour chips (6) apply', col.n === 6 && col.imgs === 6 && col.got === col.v, col);
await page.click('.ms-segs [data-seg=pos]');
const pos = await ev(async () => { const y0 = new DataView(window.__mtw.playApi.charInfo().buffer).getInt32(56, true); document.querySelector('[data-step=eyeY][data-d="-1"]').click(); await new Promise((r) => setTimeout(r, 250)); const y1 = new DataView(window.__mtw.playApi.charInfo().buffer).getInt32(56, true); document.querySelector('[data-a=undo]').click(); await new Promise((r) => setTimeout(r, 250)); return { y0, y1, undo: new DataView(window.__mtw.playApi.charInfo().buffer).getInt32(56, true) }; });
expect('editor: position step (eye up) and undo', pos.y1 === pos.y0 - 1 && pos.undo === pos.y0, pos);
await page.screenshot({ path: `${out}/m17-03-editor.png` });
await page.click('.ms-cat[data-cat=hair]'); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/m17-03b-editor-hair.png` });
// profile tab: gender + save
await page.click('.ms-cat[data-cat=profile]');
await page.fill('[data-ms=name]', 'Kel'); await page.dispatchEvent('[data-ms=name]', 'change');
await page.click('[data-a=ok]');
await screen('room', 20000);
const saved = await ev(() => { const p = window.__mtw.play.save.profile; return { name: p.name, len: atob(p.miiData).length }; });
const ci1 = await ev(() => Array.from(window.__mtw.playApi.charInfo() ?? []));
expect('editor: OK saves the edited Mii (288-byte CharInfo) and the nickname', saved.name === 'Kel' && saved.len === 288 && ci1.join() !== ci0.join(), saved);
// ---- Settings: the original sound switches Musica / Effetti / Voce (Layout/menu switchNode00)
await page.click('#play .pl-tab[data-tab=menu]'); await page.click('#play [data-a=config]');
const sw = await ev(async () => { const l = [...document.querySelectorAll('[data-snd]')].map((i) => i.parentElement.textContent.trim()); const m = document.querySelector('[data-snd=music]'); m.checked = false; m.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 300)); return { l, state: { ...window.__mtw.soundSw }, saved: window.__mtw.play.save.settings.sound }; });
expect('settings: original switches Musica / Effetti / Voce; Musica off is applied and saved', sw.l.join() === 'Musica,Effetti,Voce' && sw.state.music === false && sw.state.effects && sw.saved.music === false, sw);
await ev(() => { const m = document.querySelector('[data-snd=music]'); m.checked = true; m.dispatchEvent(new Event('change')); });
await page.click('.pl-sheet .pl-close');
// ---- "Sai, di recente…"
await sim(0.5);
const touched = await ev(() => { const s = window.__mtw.stagePoint?.('mii'); return !!s; });
await ev(() => window.__mtw.roomUi.show({ kind: 'touch', rel: 'Scene/RoomSceneTalkWords.msbt', label: 'mySubMii0', fallback: '', menu: window.__mtw.touchMenu ? window.__mtw.touchMenu() : [] }));
for (let i = 0; i < 40 && !(await ev(() => window.__mtw.roomUi.snapshot()?.menu.length)); i++) await sim(0.25);
const recentItem = await ev(() => window.__mtw.roomUi.snapshot()?.menu.find((m) => m.id === 'recent'));
expect('"Sai, di recente…" is in the touch menu with its original label and enabled', recentItem && /Sai, di recente/.test(recentItem.text) && !recentItem.disabled, recentItem);
await ev(() => window.__mtw.roomUi.clickMenu('recent'));
await page.waitForSelector('.pl-recent[data-state="loading"]', { timeout: 3000 }).catch(() => {});
const loading = await ev(() => document.querySelector('.pl-recent')?.dataset.state);
await page.waitForSelector('.pl-recent[data-state="server-data-missing"]', { timeout: 5000 }).catch(async () => console.log('DEBUG', await ev(() => ({ screen: window.__mtw.play.currentScreen, sheet: document.querySelector('.pl-sheet')?.outerHTML.slice(0, 600), snap: window.__mtw.roomUi.snapshot() }))));
const recent = await ev(() => ({ title: document.querySelector('.pl-sheet h2').textContent, text: document.querySelector('.pl-recent .pl-pre')?.textContent, tag: document.querySelector('.pl-recent .pl-tag')?.textContent }));
expect('"Sai, di recente…": loading → original empty state + SERVER DATA MISSING (no invented content)', loading === 'loading' && /Sai, di recente/.test(recent.title) && recent.text === 'Non ci sono ancora risposte di amici.' && recent.tag === 'SERVER DATA MISSING', { loading, recent, touched });
await page.screenshot({ path: `${out}/m17-04-recent.png` });
const errors = logs.filter((l) => /^(error|pageerror)/.test(l));
expect('zero console errors', errors.length === 0, errors);
writeFileSync(`${out}/report.json`, JSON.stringify({ checks, fail, logs }, null, 1));
console.log(JSON.stringify({ passed: Object.values(checks).filter((c) => c.ok).length, total: Object.keys(checks).length, fail }, null, 1));
await browser.close(); process.exit(fail.length ? 1 : 0);
