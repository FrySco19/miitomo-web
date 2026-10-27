// REBOOT R6.0 unit tests — Settings model (validation, persistence, effects), i18n locale registry + region, MiiPhone
// shortcut apps and badges, and the settings applied to a running Reboot through the FakeHost.
// Run from client/web: npx tsx ../../tests/unit/settings.test.mts
import { SettingsStore, sanitizeSettings, effective, DEFAULT_SETTINGS, SETTINGS_KEY } from '../../client/web/src/reboot/settings/Settings';
import { I18n, LANGS, LOCALE_NAMES, locales, coverage, detect } from '../../client/web/src/reboot/i18n/i18n';
import { MiiPhone, MiiPhoneApps } from '../../client/web/src/reboot/phone/MiiPhone';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

// ---------------- validation ----------------
ok('sanitize: nothing stored → defaults', JSON.stringify(sanitizeSettings(null)) === JSON.stringify(DEFAULT_SETTINGS));
const bad = sanitizeSettings({ region: 'XX', volumes: { music: 250, effects: -3, voice: 'loud' }, motion: 'wild', quality: 'ultra', light: 'yes', confirm: 0, notifications: false });
ok('sanitize: unknown values fall back, volumes clamped 0–100, valid ones kept', bad.region === 'auto' && bad.volumes.music === 100 && bad.volumes.effects === 0 && bad.volumes.voice === 100 && bad.motion === 'system' && bad.quality === 'auto' && bad.light === false && bad.confirm === true && bad.notifications === false, bad);
ok('sanitize: fractional volume rounded', sanitizeSettings({ volumes: { music: 42.6 } }).volumes.music === 43);

// ---------------- store ----------------
const kv = mem();
const st = new SettingsStore(kv);
const seen: number[] = []; const un = st.subscribe((s) => seen.push(s.volumes.music));
st.update({ volumes: { music: 30 } });
ok('update: persisted, announced, other volumes untouched', JSON.parse(kv.m.get(SETTINGS_KEY)!).volumes.music === 30 && seen.join() === '30' && st.value.volumes.effects === DEFAULT_SETTINGS.volumes.effects);
st.update({ volumes: { music: 30 } });
ok('update: same value = no write, no event', seen.length === 1);
st.update({ quality: 'nonsense' as never });
ok('update: an invalid value is refused (kept the valid one)', st.value.quality === 'auto' && seen.length === 1);
const copy = st.value; copy.volumes.music = 99;
ok('value: a copy (callers cannot change the stored record)', st.value.volumes.music === 30);
ok('reload: a new store reads the saved record', new SettingsStore(kv).value.volumes.music === 30);
kv.m.set(SETTINGS_KEY, '{broken json');
ok('reload: corrupt record → defaults, no crash', new SettingsStore(kv).value.volumes.music === DEFAULT_SETTINGS.volumes.music);
const full = { getItem: () => null, setItem: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } };
const st2 = new SettingsStore(full); st2.update({ light: true });
ok('storage full: the change still applies this session, the error is kept', st2.value.light === true && st2.lastError === 'QuotaExceededError');
ok('no storage at all (private mode): works in memory', (() => { const s = new SettingsStore(null); s.update({ confirm: false }); return s.value.confirm === false; })());
st.reset();
ok('reset: back to defaults, announced', JSON.stringify(st.value) === JSON.stringify(DEFAULT_SETTINGS) && seen.at(-1) === DEFAULT_SETTINGS.volumes.music);
un();
ok('unsubscribe: no listeners left', st.listenerCount === 0);

// ---------------- effects ----------------
const e0 = effective(DEFAULT_SETTINGS, false);
ok('effective: volumes as 0..1', e0.volumes.music === 0.8 && e0.volumes.effects === 0.9 && e0.volumes.voice === 1);
ok('effective: quality auto = high; light mode → low; explicit choice wins over light', e0.quality === 'high' && effective({ ...DEFAULT_SETTINGS, light: true }, false).quality === 'low' && effective({ ...DEFAULT_SETTINGS, light: true, quality: 'balanced' }, false).quality === 'balanced');
ok('effective: motion — system follows the OS; full ignores it; reduced / light always reduce',
  !e0.reducedMotion && effective(DEFAULT_SETTINGS, true).reducedMotion && !effective({ ...DEFAULT_SETTINGS, motion: 'full' }, true).reducedMotion
  && effective({ ...DEFAULT_SETTINGS, motion: 'reduced' }, false).reducedMotion && effective({ ...DEFAULT_SETTINGS, light: true, motion: 'full' }, false).reducedMotion);
ok('effective: light mode calms the simulated world', effective({ ...DEFAULT_SETTINGS, light: true }, false).calmWorld && !e0.calmWorld);

// ---------------- i18n: locale registry + region ----------------
ok('locales: offered = languages with a table (en, it), native names ready for es/fr/de/pt/ja', LANGS.join() === 'en,it' && ['es', 'fr', 'de', 'pt', 'ja'].every((l) => LOCALE_NAMES[l]) && locales().map((l) => l.name).join() === 'English,Italiano');
ok('locales: en and it are complete', coverage('en') === 1 && coverage('it') === 1);
ok('detect: a language without a table falls back to English', detect(['ja-JP', 'fr']) === 'en' && detect(['pt-BR', 'it-IT']) === 'it');
const i18 = new I18n({ storage: null, lang: 'en', languages: ['en-US'] });
ok('region auto: the browser region for the language (en-US writes month/day)', i18.locale === 'en-US' && i18.date(3, 1) === '1/3');
let told = 0; i18.subscribe(() => told++);
ok('region: GB writes day/month and tells the views', i18.setRegion('GB') && i18.locale === 'en-GB' && i18.date(3, 1) === '03/01' && told === 1);
ok('region: unknown refused, same region = no event', !i18.setRegion('XX') && i18.setRegion('GB') && told === 1);
const it = new I18n({ storage: null, lang: 'it', languages: ['it-IT'] });
const q = it.t('quiz.q.birthday', { date: '#date:1-3' });   // 3 January, day first in Italy (ICU may pad: 03/01)
ok('#date: values follow the region (quiz birthday, it-IT: day first)', /^Chi compie gli anni il 0?3\/0?1\?$/.test(q), q);

// ---------------- MiiPhone: shortcut apps + badges ----------------
const apps = new MiiPhoneApps();
ok('register: an app needs a screen (mount) or an action', !apps.register({ id: 'empty', titleKey: 'x', icon: '', implemented: true }));
let go = { ok: true } as { ok: boolean; error?: string }, ran = 0;
apps.register({ id: 'plaza', titleKey: 'hub.title', icon: '', implemented: true, action: async () => { ran++; return go; } });
apps.register({ id: 'notes', titleKey: 'x', icon: '', implemented: true, mount: () => () => {}, badge: () => 3 });
const phone = new MiiPhone(apps, () => true);
const ev: string[] = []; phone.subscribe((e) => ev.push(e.type === 'state' ? `${e.phase}:${e.app}` : `err:${e.code}:${e.info ?? ''}`));
phone.open(); phone.settle();
phone.launch('plaza'); await new Promise((r) => setTimeout(r, 0));
ok('shortcut: runs the move and closes the phone (no screen pushed)', ran === 1 && phone.phase === 'closing' && !ev.some((e) => e.endsWith(':plaza')));
phone.settle();
ok('reopen after a shortcut: home, not the shortcut', phone.open().ok && phone.app === 'home');
phone.settle();
go = { ok: false, error: 'hub.err.NOT_IN_ROOM' };
phone.launch('plaza'); await new Promise((r) => setTimeout(r, 0));
ok('shortcut refused: phone stays open, error carries the i18n key', phone.phase === 'open' && ev.at(-1) === 'err:APP_UNAVAILABLE:hub.err.NOT_IN_ROOM');
phone.close(); phone.settle();
ok('open(shortcut) refused: a shortcut has no screen to open on', !phone.open('plaza').ok && phone.phase === 'closed' && ev.at(-1) === 'err:APP_UNAVAILABLE:plaza');
ok('badge: read from the app', apps.get('notes')!.badge!() === 3);

if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
