// REBOOT R5 browser harness: the REAL Reboot runtime (bootReboot: hub, places, Sala Giochi, MiiPhone, MIInstagram,
// i18n, persistence in the real localStorage / IndexedDB) on the R5 test double of the room engine. It needs none of
// the user's game files, so the R5 UI can be driven end to end in Chromium (tests/e2e/r5-ui.smoke.mjs).
// The 3D room itself is not here: the real-engine suite is tests/e2e/r5-social.smoke.mjs.
import { FakeHost, makeFriends } from '../../unit/r5-fakehost.mts';
import { bootReboot } from '../../../client/web/src/reboot/index';

const stage = document.getElementById('stage')!;
const host = new FakeHost(makeFriends(Number(new URLSearchParams(location.search).get('friends') ?? 7)));
host.root = stage;
// a real JPEG for "photo of the room" (the engine renders the 3D room; here: a drawn stand-in with the Miis present)
host.snapshot = () => {
  const c = document.createElement('canvas'); c.width = c.height = 480; const g = c.getContext('2d')!;
  g.fillStyle = '#fbe9d4'; g.fillRect(0, 0, 480, 280); g.fillStyle = '#e9c9a4'; g.fillRect(0, 280, 480, 200);
  host.miis().forEach((m, i) => { const x = 90 + i * 75, y = 300; g.fillStyle = ['#5aa9e6', '#7bc96f', '#f2c14e', '#ff7a2f'][m.personality]; g.fillRect(x - 18, y - 10, 36, 70); g.fillStyle = '#ffd9b8'; g.beginPath(); g.arc(x, y - 34, 26, 0, Math.PI * 2); g.fill(); });
  return c.toDataURL('image/jpeg', 0.85);
};
const rt = bootReboot(host, { seed: 7 });
// the room clock: real time unless a test drives it
let auto = true;
setInterval(() => { if (auto) host.step(0.25); }, 250);
(window as any).__r5 = { host, rt, setAuto: (v: boolean) => { auto = v; }, step: (sec: number) => { for (let t = 0; t < sec; t += 0.25) host.step(0.25); } };
document.body.dataset.ready = '1';
