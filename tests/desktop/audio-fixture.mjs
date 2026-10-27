// Synthetic files for the desktop audio tests (NO Nintendo data): a fake "APK" holding the four sound tables in the
// game's MSBT format, and a sound_*.zip with a music track (an MP3 sine tone made with ffmpeg for this test) and an
// effect (a WAV beep generated here). The chain is the real one: Action/bgm → BGM/common → Wave/bgm → sound/<file>.
//   bgm_titleSceneInit → BGM_TITLE → WAVE_TITLE → BGM_TITLE.mp3   (NOT in the zip: the launcher must fall back)
//   bgm_room           → BGM_ROOMDAY → WAVE_ROOMDAY → BGM_TESTROOM.mp3
//   se_test (Wave/common) → se_test.wav
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const req = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'web', 'package.json'));
const { zipSync, strToU8 } = req('fflate');

/** A minimal MSBT (UTF-16LE, LBL1 + TXT2) — the layout parseMSBT reads. */
export function msbt(entries) {
  const pad16 = (b) => { const n = (16 - (b.length % 16)) % 16; return Buffer.concat([b, Buffer.alloc(n, 0xab)]); };
  const keys = Object.keys(entries);
  // LBL1: one bucket holding every label
  const labels = Buffer.concat(keys.map((k, i) => { const nb = Buffer.from(k, 'utf8'); const b = Buffer.alloc(1 + nb.length + 4); b[0] = nb.length; nb.copy(b, 1); b.writeUInt32LE(i, 1 + nb.length); return b; }));
  const lblHead = Buffer.alloc(12); lblHead.writeUInt32LE(1, 0); lblHead.writeUInt32LE(keys.length, 4); lblHead.writeUInt32LE(12, 8);
  const lbl = Buffer.concat([lblHead, labels]);
  // TXT2
  const texts = keys.map((k) => Buffer.from(entries[k] + '\0', 'utf16le'));
  const txtHead = Buffer.alloc(4 + 4 * keys.length); txtHead.writeUInt32LE(keys.length, 0);
  let off = txtHead.length; texts.forEach((t, i) => { txtHead.writeUInt32LE(off, 4 + 4 * i); off += t.length; });
  const txt = Buffer.concat([txtHead, ...texts]);
  const section = (magic, data) => { const h = Buffer.alloc(16); h.write(magic, 0, 'ascii'); h.writeUInt32LE(data.length, 4); return pad16(Buffer.concat([h, data])); };
  const body = Buffer.concat([section('LBL1', lbl), section('TXT2', txt)]);
  const head = Buffer.alloc(0x20); head.write('MsgStdBn', 0, 'ascii'); head[8] = 0xff; head[9] = 0xfe; head[0x0c] = 1; head[0x0d] = 3; head.writeUInt16LE(2, 0x0e); head.writeUInt32LE(0x20 + body.length, 0x12);
  return Buffer.concat([head, body]);
}
/** A short 16-bit PCM WAV beep. */
export function wav(freq = 880, sec = 0.25, rate = 22050) {
  const n = Math.round(sec * rate), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000 * (1 - i / n)), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const MP3 = Buffer.from('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', 'base64');
const T = 'assets/message/Release/Console/JPja/Client/Sound/';

/** Writes the fake APK (folder root) and the sound zip (in `soundDir`, default: the folder root as well). */
export function makeAudioFixture(dir, soundDir = dir) {
  fs.mkdirSync(soundDir, { recursive: true });
  const apk = zipSync({
    'AndroidManifest.xml': strToU8('<manifest/>'),
    [T + 'Action/bgm.msbt']: msbt({ bgm_titleSceneInit: 'BGM_TITLE', bgm_room: 'BGM_ROOMDAY' }),
    [T + 'BGM/common.msbt']: msbt({ BGM_TITLE: 'WAVE_TITLE', BGM_ROOMDAY: 'WAVE_ROOMDAY' }),
    [T + 'Wave/bgm.msbt']: msbt({ WAVE_TITLE: 'BGM_TITLE.mp3', WAVE_ROOMDAY: 'BGM_TESTROOM.mp3' }),
    [T + 'Wave/common.msbt']: msbt({ se_test: 'se_test.wav' }),
  });
  fs.writeFileSync(path.join(dir, 'Miitomo_TEST.apk'), apk);
  fs.writeFileSync(path.join(soundDir, 'sound_TEST_mp3.zip'), zipSync({ 'sound/BGM_TESTROOM.mp3': MP3, 'sound/se_test.wav': wav() }));
}
/** Thumbnail keys of the fake dated weekly zip (closet item + Arreda stanza wall), as the CDN names them. */
export const THUMB_KEYS = ['asset/capture2/small/character/bodyTops/bodyTops0001_00.webp', 'asset/capture2/large/room/roomWall/rmWl0001_AL00.webp'];
/** A fake dated weekly CDN zip holding thumbnails (placeholder bytes: only their import is tested, not their pixels). */
export function makeThumbFixture(dir, name = '20161110testwebp.zip', keys = THUMB_KEYS) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), zipSync(Object.fromEntries(keys.map((k) => [k, strToU8('RIFF-placeholder')]))));
}
