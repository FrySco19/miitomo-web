// Unit checks for the MSBT reader + text renderer (M8). Needs the user's own extracted CDN message zip.
// Run: node --experimental-strip-types tests/unit/msbt.test.mts <dir containing message/Release/Console/EUit/Client>
import { readFileSync } from 'node:fs';
import { parseMSBT, plain, debugText } from '../../client/web/src/formats/msbt.ts';
const root = process.argv[2];
let fail = 0;
const ok = (name: string, c: boolean, info?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${name}${c ? '' : ' ' + JSON.stringify(info)}`); if (!c) fail++; };
const load = (rel: string) => parseMSBT(new Uint8Array(readFileSync(`${root}/message/Release/Console/EUit/Client/${rel}`)));
const room = load('Scene/RoomSceneTalkWords.msbt');
ok('fixedGreeting tags', debugText(room.get('fixedGreeting')!) === '{9.3:01cd}Ciao{/}!', debugText(room.get('fixedGreeting')!));
ok('noQuestion plain text', plain(room.get('noQuestion')).startsWith('Ti sembrerà strano... ma ho finito le domande!'), plain(room.get('noQuestion')));
ok('mySubMii0', plain(room.get('mySubMii0')) === 'Hai bisogno di qualcosa?');
const common = load('System/MiiCommonText.msbt');
ok('defaultGoodByeGoHome', plain(common.get('defaultGoodByeGoHome')) === 'È ora di andare.', plain(common.get('defaultGoodByeGoHome')));
const btn = load('Layout/room/parts/layer2/balloonTextBtn02.msbt');
ok('balloonMenuR label', plain(btn.get('title00@balloonMenuR')) === 'Chiedi qualcosa!');
console.log(fail ? `${fail} FAIL` : 'ALL PASS'); process.exit(fail ? 1 : 0);
