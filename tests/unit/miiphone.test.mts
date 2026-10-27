// REBOOT R5 unit tests — MiiPhone model: open / close transitions, app navigation, duplicate open, input during a
// transition, unavailable apps, hidden places, state restoration — and that the phone never touches the location.
// Run from client/web: npx tsx ../../tests/unit/miiphone.test.mts
import { MiiPhone, MiiPhoneApps } from '../../client/web/src/reboot/phone/MiiPhone';
import { SocialHub } from '../../client/web/src/reboot/hub/SocialHub';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };

let mounted = 0, unmounted = 0;
const apps = new MiiPhoneApps();
ok('registry: implemented app registers once; "home" reserved', apps.register({ id: 'miinstagram', titleKey: 'app.miinstagram', icon: '', implemented: true, mount: () => { mounted++; return () => { unmounted++; }; } }) && !apps.register({ id: 'miinstagram', titleKey: '', icon: '', implemented: true, mount: () => () => {} }) && !apps.register({ id: 'home', titleKey: '', icon: '', implemented: true, mount: () => () => {} }));
apps.register({ id: 'future-app', titleKey: 'x', icon: '', implemented: false, mount: () => () => {} });
ok('registry: declared future apps are never shown', apps.visible().map((a) => a.id).join() === 'miinstagram' && apps.declared === 2);

let allowed = true;
const phone = new MiiPhone(apps, () => allowed);
const ev: string[] = []; phone.subscribe((e) => ev.push(e.type === 'state' ? `${e.phase}:${e.app}` : `err:${e.code}`));
// open
ok('open: closed → opening (animation) → open on settle', phone.open().ok && phone.phase === 'opening' && (phone.settle(), phone.phase === 'open') && phone.app === 'home');
ok('duplicate open: refused (ALREADY_OPEN), state unchanged', phone.open().ok === false && ev.at(-1) === 'err:ALREADY_OPEN' && phone.phase === 'open');
// app navigation
ok('launch MIInstagram from home', phone.launch('miinstagram').ok && phone.app === 'miinstagram');
ok('unavailable app (future / unknown): APP_UNAVAILABLE, stays where it was', !phone.launch('future-app').ok && !phone.launch('nope').ok && phone.app === 'miinstagram' && ev.filter((e) => e === 'err:APP_UNAVAILABLE').length === 2);
ok('back: app → home', phone.back().ok && phone.app === 'home');
phone.launch('miinstagram');
// close + transition guard
ok('close: open → closing; input during the transition refused (BUSY)', phone.close().ok && phone.phase === 'closing' && !phone.open().ok && ev.at(-1) === 'err:BUSY' && !phone.launch('miinstagram').ok);
phone.settle();
ok('close: closed after the animation', phone.phase === 'closed');
ok('close twice: ALREADY_CLOSED', !phone.close().ok && ev.at(-1) === 'err:ALREADY_CLOSED');
// restoration
phone.open(); phone.settle();
ok('state restoration: reopening shows the app that was open (MIInstagram)', phone.app === 'miinstagram');
phone.back(); phone.close(); phone.settle(); phone.open(); phone.settle();
ok('state restoration: …or home when home was shown', phone.app === 'home');
ok('open directly on an app (Miifoto shared → composer)', (phone.close(), phone.settle(), phone.open('miinstagram').ok) && phone.app === 'miinstagram');
phone.settle();
// hidden places
allowed = false;
phone.forceClose();
ok('hidden here (a match running, Classic screen): open refused (HIDDEN), forced closed keeps the last app', phone.phase === 'closed' && !phone.open().ok && ev.at(-1) === 'err:HIDDEN');
allowed = true; phone.open(); phone.settle();
ok('…and comes back to that app later', phone.app === 'miinstagram');
ok('counters add up (opens, closes, refusals)', phone.counters.opens === 5 && phone.counters.closes === 3 && phone.counters.refused === 7, phone.counters);

// the phone never changes where the user is: a hub (location owner) stays where it was through 20 open / close cycles
{
  const hub = new SocialHub({ rooms: null, inRoom: () => true, onTick: () => () => {} });
  await hub.go('hub');
  const at0 = hub.at, nav0 = hub.state.counters.navigations;
  for (let i = 0; i < 20; i++) { phone.close(); phone.settle(); phone.open(i % 2 ? 'miinstagram' : undefined); phone.settle(); phone.launch('miinstagram'); phone.back(); }
  ok('location untouched: 20 open / close / app cycles → same location, no navigation', hub.at === at0 && hub.state.counters.navigations === nav0 && phone.phase === 'open');
  ok('phone subscribers stable (no growth)', phone.listenerCount === 1);
}
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
