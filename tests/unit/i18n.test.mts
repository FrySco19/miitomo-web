// REBOOT R5 unit tests — i18n: English, Italian, browser detection, English fallback, persisted choice, plurals,
// nested values, both tables complete, every key used by the Reboot code present, and no language branches in it.
// Run from client/web: npx tsx ../../tests/unit/i18n.test.mts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { I18n, detect, LANG_KEY } from '../../client/web/src/reboot/i18n/i18n';
import { STRINGS } from '../../client/web/src/reboot/i18n/strings';
import { kv } from './r5-fakehost.mts';

let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };

ok('detect: it-IT → Italiano, en-GB → English', detect(['it-IT']) === 'it' && detect(['en-GB', 'it']) === 'en');
ok('detect: unsupported browser languages → English fallback', detect(['de-DE', 'fr']) === 'en' && detect([]) === 'en' && detect(undefined) === 'en');
ok('detect: first supported language in the browser list wins', detect(['de', 'it-CH', 'en']) === 'it');
const s = kv();
const a = new I18n({ storage: s, languages: ['it-IT'] });
ok('auto: Italian browser → Italian texts', a.lang === 'it' && a.t('hub.title') === 'Piazza' && a.t('fr.enter') === 'Entra');
ok('English texts', I18n.fixed('en').t('hub.title') === 'Plaza' && I18n.fixed('en').t('fr.enter') === 'Go in');
const seen: string[] = []; a.subscribe((l) => seen.push(l));
ok('manual choice: applied at once and announced', a.set('en') && a.lang === 'en' && a.t('hub.title') === 'Plaza' && seen.join() === 'en');
ok('manual choice: persisted (mtw.reboot.lang)', s.getItem(LANG_KEY) === 'en');
ok('persisted choice wins over the browser language after a reload', new I18n({ storage: s, languages: ['it-IT'] }).lang === 'en');
ok('unknown language refused, nothing changes', !a.set('xx') && a.lang === 'en' && s.getItem(LANG_KEY) === 'en');
const bad = kv(); bad.setItem(LANG_KEY, 'klingon');
ok('corrupt stored value → browser detection', new I18n({ storage: bad, languages: ['it'] }).lang === 'it');
const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
const b = new I18n({ storage: broken, languages: ['it'] });
ok('storage refused (private mode): works for the session, no crash', b.lang === 'it' && b.set('en') && b.lang === 'en');
ok('placeholders filled', I18n.fixed('it').t('fr.roomOf', { name: 'Lucia' }) === 'Stanza di Lucia' && I18n.fixed('en').t('fr.roomOf', { name: 'Lucia' }) === 'Lucia\'s room');
ok('plurals (one / other)', I18n.fixed('it').tn('feed.allComments', 1) === 'Mostra 1 commento' && I18n.fixed('it').tn('feed.allComments', 4) === 'Mostra tutti i 4 commenti' && I18n.fixed('en').tn('feed.allComments', 4) === 'Show all 4 comments');
ok('nested values ("@key") are translated too', I18n.fixed('en').t('quiz.q.personality', { type: '@personality.3' }) === 'Whose personality is outgoing?' && I18n.fixed('it').t('quiz.q.personality', { type: '@personality.0' }) === 'Chi ha un carattere riservato?');
ok('missing key: English fallback, then the key itself (visible, never a crash)', (() => { const i = I18n.fixed('it'); (STRINGS.en as any)['__only.en'] = 'EN only'; const r = i.t('__only.en'); delete (STRINGS.en as any)['__only.en']; return r === 'EN only' && i.t('no.such.key') === 'no.such.key'; })());
ok('relative time in both languages', I18n.fixed('it').ago(new Date(Date.now() - 120_000).toISOString()) === '2 min fa' && I18n.fixed('en').ago(new Date(Date.now() - 7_200_000).toISOString()) === '2 h ago');

// tables: same keys in both languages, nothing empty
const en = Object.keys(STRINGS.en), it = Object.keys(STRINGS.it);
const onlyEn = en.filter((k) => !(k in STRINGS.it)), onlyIt = it.filter((k) => !(k in STRINGS.en));
ok('tables: every key exists in English AND Italian', !onlyEn.length && !onlyIt.length, { onlyEn, onlyIt });
ok('tables: no empty text', [...Object.values(STRINGS.en), ...Object.values(STRINGS.it)].every((v) => v.trim().length > 0));
const ph = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
const phDiff = en.filter((k) => ph(STRINGS.en[k]) !== ph(STRINGS.it[k]));
ok('tables: same placeholders in both languages', !phDiff.length, phDiff);

// code: every static key used by the Reboot code exists; dynamic families are complete; no language branches
const src = join(process.cwd(), 'src', 'reboot');
const files: string[] = []; const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n)) files.push(p); } }; walk(src);
const code = files.filter((f) => !f.endsWith('strings.ts')).map((f) => [relative(src, f), readFileSync(f, 'utf8')] as const);
const used = new Set<string>();
for (const [, t] of code) for (const m of t.matchAll(/\b(?:t|tn|i18n\.t|this\.t)\(\s*'([a-zA-Z0-9._-]+)'/g)) used.add(m[1]);
for (const [, t] of code) for (const m of t.matchAll(/(?:titleKey|descKey|rulesKey|key): '([a-z0-9._-]+)'/g)) used.add(m[1]);
const statics = [...used].filter((k) => !k.endsWith('.'));          // 'x.' + something = a dynamic family (below)
const missing = statics.filter((k) => !(k in STRINGS.en) && !(k + '.one' in STRINGS.en));
ok('code: every static i18n key used by Reboot exists', !missing.length && statics.length > 100, { missing, n: statics.length });
const families: Record<string, string[]> = {
  'place.err.': ['NOT_FOUND', 'CLOSED', 'PRIVATE', 'FULL', 'BLOCKED', 'DENIED', 'UNAVAILABLE', 'ALREADY_IN', 'BUSY', 'SCENE', 'TIMEOUT'],
  'place.evicted.': ['CLOSED', 'REMOVED', 'KICKED'], 'fr.status.': ['open', 'full', 'closed', 'private', 'unavailable'], 'place.activity.': ['chat', 'relax', 'party', 'games'],
  'feed.err.': ['INVALID_POST', 'IMAGE_UNAVAILABLE', 'PERSISTENCE', 'DUPLICATE_REACTION', 'NOT_FOUND', 'RATE_LIMITED', 'FORBIDDEN', 'DUPLICATE'],
  'phone.err.': ['APP_UNAVAILABLE', 'ALREADY_OPEN', 'ALREADY_CLOSED', 'BUSY', 'HIDDEN'], 'game.aborted.': ['INTERRUPTED', 'INVALID_RESULT', 'NO_PLAYERS'],
  'game.err.': ['NOT_IN_ROOM', 'SESSION_ACTIVE', 'NOT_ENOUGH_PLAYERS', 'GAME_UNAVAILABLE', 'GAME_UNAVAILABLE.UNKNOWN', 'GAME_UNAVAILABLE.NOT_ENOUGH_DATA', 'GAME_UNAVAILABLE.NOT_ENOUGH_PLAYERS'],
  'game.unavailable.': ['NOT_ENOUGH_DATA', 'NOT_ENOUGH_PLAYERS'], 'hub.open.': ['ALREADY_OPEN', 'NOT_IN_ROOM', 'GUESTS_IN', 'REFUSED'],
  'react.': ['like', 'haha', 'wow', 'cute'], 'feed.kind.': ['photo', 'activity', 'answer'], 'role.': ['owner', 'moderator', 'visitor'], 'personality.': ['0', '1', '2', '3'],
  'pb.denied.': ['useObjects', 'interact', 'kick', 'changeSettings', 'close', 'invite', 'enter'], 'act.': ['meet', 'game.win', 'game.lost', 'visit'], 'reward.': ['quiz-star'], 'lang.': ['en', 'it', 'label'],
  // R6 Settings
  'set.': ['language', 'region', 'quality', 'motion', 'light', 'confirm', 'notifications'], 'set.vol.': ['music', 'effects', 'voice'],
  'set.q.': ['auto', 'high', 'balanced', 'low'], 'set.m.': ['system', 'full', 'reduced'],
  // R6 Reboot panel, MiiPhone apps, chat lines
  'rbt.ev.': ['join', 'leave', 'kick', 'full', 'cantJoin', 'denied', 'open', 'closing', 'closed', 'owner-left'],
  'flag.': ['MULTI_MII_ENABLED', 'SOCIAL_LIFE_ENABLED', 'PUBLIC_ROOMS_ENABLED', 'HUB_ENABLED', 'FRIEND_ROOMS_ENABLED', 'MIIPHONE_ENABLED', 'MIINSTAGRAM_ENABLED', 'MINIGAMES_ENABLED', 'EVENTS_ENABLED', 'REWARDS_ENABLED', 'NOTIFICATIONS_ENABLED', 'MIIFOTO2_ENABLED', 'SHOP_ENABLED'],
  'rel.': ['0', '1', '2', '3'], 'where.': ['home', 'private', 'out', 'room', 'games', 'unknown'], 'profile.tab.': ['overview', 'posts', 'friends'],
  'profile.stat.': ['posts', 'friends', 'played', 'wins', 'coins'], 'shop.tab.': ['cover', 'card', 'frame', 'wallet'], 'shop.err.': ['UNKNOWN', 'OWNED', 'NOT_OWNED', 'INSUFFICIENT'], 'chat.': ['open.0', 'reply.0', 'follow.0', 'close.0', 'closeReply.0'], 'tpl.': ['lounge'],
};
const famMissing = Object.entries(families).flatMap(([p, ks]) => ks.map((k) => p + k)).filter((k) => !(k in STRINGS.en));
const cm = [0, 1, 2, 3].flatMap((p) => ['photo', 'activity', 'answer'].flatMap((k) => [0, 1, 2].map((n) => `cm.${p}.${k}.${n}`))).filter((k) => !(k in STRINGS.en));
ok('code: every dynamic key family is complete (errors, statuses, reactions, comments by personality…)', !famMissing.length && !cm.length, { famMissing, cm });
const branches = code.filter(([f, t]) => !f.startsWith('i18n') && /(lang|language)\s*===\s*['"](en|it)['"]/.test(t)).map(([f]) => f);
ok('code: no `if (language === …)` branches outside the i18n module', !branches.length, branches);
const r5 = ['places', 'games', 'phone', 'miinstagram', 'settings', 'people', 'ui', 'shop'];
const hard = code.filter(([f]) => r5.some((d) => f.startsWith(d))).flatMap(([f, t]) => [...t.matchAll(/innerHTML\s*=\s*`[^`]*>([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ,'!]{6,})</g)].map((m) => `${f}: ${m[1]}`)).filter((x) => !x.endsWith(': Miitomo Reboot'));   // the brand name stays
ok('code: no hard-coded sentences in the new R5 / R6 views (texts come from i18n)', !hard.length, hard);
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
