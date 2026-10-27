// HOTFIX 2026-10-28 — system voice (fallback TTS, NOT the original Miitomo voice). Windows / Chromium / Electron give
// the voice list asynchronously ([] until 'voiceschanged'): the game must not decide "silent" at start, must pick the
// voice by the line's language, and must say clearly when no voice can read it. Fake speechSynthesis here.
// Run from client/web: npx tsx ../../tests/unit/voice.test.mts
let fails = 0; const ok = (n: string, c: unknown, i?: unknown) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(i)}`); if (!c) fails++; };
type V = { name: string; lang: string; localService: boolean; default: boolean };
let voices: V[] = [];
const spoken: { text: string; voice: string; lang: string; volume: number }[] = [];
const listeners: (() => void)[] = [];
const synth = { getVoices: () => voices, addEventListener: (_: string, cb: () => void) => listeners.push(cb), speak: (u: any) => spoken.push({ text: u.text, voice: u.voice.name, lang: u.lang, volume: u.volume }), cancel: () => {} };
(globalThis as any).window = { speechSynthesis: synth };
(globalThis as any).SpeechSynthesisUtterance = class { text: string; voice: any; lang = ''; pitch = 1; rate = 1; volume = 1; onerror: any; constructor(t: string) { this.text = t; } };
const changed = (list: V[]) => { voices = list; for (const l of listeners) l(); };

const { resolveVoice, voiceReport, PROVIDERS, missingVoice, DEFAULT_VOICE } = await import('../../client/web/src/voice/Voice');
const tts = PROVIDERS.find((p) => p.id === 'web-tts')!;
ok('start (list still empty, as on Windows): the system voice is NOT ruled out → "auto" picks it, not silent', resolveVoice('auto').id === 'web-tts' && voiceReport().state === 'loading', voiceReport().state);
tts.speak('Ciao a tutti!', DEFAULT_VOICE, 'it');
ok('a line asked while the list loads waits (nothing spoken yet, no error)', spoken.length === 0 && !voiceReport().lastError);
changed([{ name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, default: true }, { name: 'Microsoft Elsa - Italian (Italy)', lang: 'it-IT', localService: true, default: false }]);
ok('the voices arrive: the waiting line is spoken with the ITALIAN voice', spoken.length === 1 && spoken[0].voice.includes('Elsa') && spoken[0].lang === 'it-IT', spoken);
tts.speak('Hello there!', DEFAULT_VOICE, 'en');
ok('an English line (Reboot in English) gets the English voice', spoken.at(-1)!.voice.includes('Zira') && spoken.at(-1)!.lang === 'en-US', spoken.at(-1));
tts.speak('Senza lingua', DEFAULT_VOICE);
ok('no language given (original Italian dialogue) → Italian voice', spoken.at(-1)!.voice.includes('Elsa'));
const r1 = voiceReport();
ok('report: state ready, both voices named, nothing missing', r1.state === 'ready' && /Elsa/.test(r1.italian ?? '') && /Zira/.test(r1.english ?? '') && !r1.italianMissing && r1.voices.length === 2, r1);
// an English-only Windows: Italian lines cannot be read — say so, do not read Italian with an English voice
changed([{ name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true, default: true }]);
const n = spoken.length;
tts.speak('Ciao!', DEFAULT_VOICE, 'it');
const r2 = voiceReport();
ok('no Italian voice: nothing spoken, a clear message with how to add one (Windows settings)', spoken.length === n && /Nessuna voce italiana/.test(r2.lastError ?? '') && /Impostazioni → Ora e lingua → Voce/.test(r2.italianMissing ?? ''), r2);
ok('the message names the language asked', /inglese/.test(missingVoice('en')) && /italiana/.test(missingVoice('it')));
// no voices at all after the wait: the provider says why and "auto" falls back to silent
changed([]);
await new Promise((r) => setTimeout(r, 2600));
ok('no system voice at all (after waiting): the provider is unavailable with a reason; auto → silent', /nessuna voce/.test(tts.unavailable() ?? '') && resolveVoice('auto').id === 'silent', tts.unavailable());
ok('the original Miitomo voice is never claimed (unavailable: native engine)', !!PROVIDERS.find((p) => p.id === 'original-nuance')!.unavailable());
if (fails) { console.log(`${fails} FAILED`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
