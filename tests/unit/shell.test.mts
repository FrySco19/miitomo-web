// HOTFIX 0.1.2 — (1) the local import (desktop app, serve-local) must read the zips that hold the closet / shop /
// Arreda stanza thumbnails; (2) in Reboot the shared bottom bar and Menu follow the chosen language, Italian keeps the
// original texts, Classic is never touched. No game files needed.
// Run from client/web: npx tsx ../../tests/unit/shell.test.mts
let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };

const { wantedSource } = await import('../../client/web/src/assets/vfs');
const thumbs = ['20161110a1b2c3webp.zip', '20180405f00dwebp.zip', 'asset_capture2_item.zip'];
ok('thumbnail zips (dated weekly zips, asset_capture2_item) are read by the local import', thumbs.every(wantedSource), thumbs.map((n) => [n, wantedSource(n)]));
ok('the dated "-message" zip (updated clothes names) is read too', wantedSource('20180405abc-message.zip'));
ok('sound zips still read', wantedSource('sound.zip') && wantedSource('sound_BGM_MiiWatch_Friend_Cool_mp3.zip'));
ok('unrelated files of the folder are still skipped', !wantedSource('photo.zip') && !wantedSource('backup_2016.zip') && !wantedSource('asset_layout_v2-0_camera_Published-iOS.zip'));

const { label, setLabelOverride } = await import('../../client/web/src/room/RoomText');
const { I18n } = await import('../../client/web/src/reboot/i18n/i18n');
const { shellLabels, SHELL_LABELS } = await import('../../client/web/src/reboot/i18n/shell');
const TB0 = 'Layout/room/parts/layer1/tabBtn00.msbt';
ok('Classic (no override): the bar label is the original / its Italian fallback', label(TB0, 'title00@answer00', 'La mia pagina') === 'La mia pagina');
ok('Reboot Italian: no override at all (original texts kept)', shellLabels(I18n.fixed('it')) === null);
const en = shellLabels(I18n.fixed('en'))!;
setLabelOverride(en);
ok('Reboot English: bar labels in English', label(TB0, 'title00@answer00', 'La mia pagina') === 'My page' && label(TB0, 'title00@friendlist00', 'Amici') === 'Friends' && label('Layout/room/parts/layer1/menuBtn01.msbt', 'title00@changeCloth00', 'Guardaroba') === 'Closet');
ok('Reboot English: labels outside the shell keep the original text', label('Layout/shop/parts/layer1/text00.msbt', 'text00@noHave', 'Vuoto.') === 'Vuoto.');
const fr = I18n.fixed('en'); const keys = [...new Set(Object.values(SHELL_LABELS))];
ok('every shell key has English and Italian text', keys.every((k) => fr.t(k) !== k && I18n.fixed('it').t(k) !== k), keys.filter((k) => fr.t(k) === k));
setLabelOverride(null);
ok('override removed (Reboot closed): originals again', label(TB0, 'title00@answer00', 'La mia pagina') === 'La mia pagina');

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
