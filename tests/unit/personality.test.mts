// Personality classifier (REVERSED from libcocos2dcpp.so 0x5be42c / 0x5be454). No data files needed.
import { personalityType, personalityIndex, personalityLabels, PRESETS } from '../../client/web/src/play/Personality.ts';
let fail = 0;
const t = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) fail++; };
t('default 4,4,4,4 → type 0 (Cool / Riservato)', personalityType([4, 4, 4, 4, 4]) === 0);
t('8,8,4,4 → type 1 (Dry / Deciso)', personalityType([8, 8, 4, 4, 4]) === 1);
t('2,2,8,8 → type 2 (Nagomi / Tranquillo)', personalityType([2, 2, 8, 8, 4]) === 2);
t('8,8,8,8 → type 3 (Nori / Espansivo)', personalityType([8, 8, 8, 8, 4]) === 3);
t('originality ignored', personalityType([8, 8, 8, 8, 1]) === personalityType([8, 8, 8, 8, 8]));
t('unset levels (0) score 50 each → A = B = 100 → index 5', personalityIndex([0, 0, 0, 0, 0]) === 5);
t('boundary: 5+5 (60+65=125) → A=2 → type 1 (Dry)', personalityType([5, 5, 4, 4, 4]) === 1);
t('boundary: 4+4 (40+35=75) → A=1 → type 0 (Cool)', personalityType([4, 4, 4, 4, 4]) === 0);
t('16 presets cover all four types', new Set(PRESETS.map((p) => personalityType(p))).size === 4);
// M17b: engine type order 0 Cool, 1 Dry, 2 Nagomi, 3 Nori (REVERSED: 0x95d0b0 table [2,3,4,5], 0x98b934 switch, 0x10edd8c)
const ORDER = ['Cool', 'Dry', 'Nagomi', 'Nori'];
t('type order: group text n = type + 1 (characterInfoTitle00 Riservato=cool, Deciso=dry, Tranquillo=nagomi, Espansivo=nori)', [[4,4,4,4,4],[8,8,4,4,4],[2,2,8,8,4],[8,8,8,8,4]].every((lv, i) => personalityLabels(lv).group.key === `textForResize00@type01_text_0${i + 1}` && ORDER[personalityType(lv)] === ORDER[i]));
t('result text index = personalityIndex + 1', personalityLabels([8, 8, 4, 4, 4]).name.key === 'textForResize00@type02_text_08');
console.log(fail ? `${fail} FAIL` : 'ALL PASS'); process.exit(fail ? 1 : 0);
