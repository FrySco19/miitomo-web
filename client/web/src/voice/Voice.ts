/**
 * Mii voice (M13) — provider architecture. Decided by the user (2026-10-26): Web = (b) a modern TTS fallback, clearly
 * NON-ORIGINAL; (c) the original engine stays a research goal for a possible native PC build.
 *
 *  original-nuance  Miitomo's own voice: Nuance Vocalizer (lib/armeabi-v7a/libNuanceVocalizer.so + the CDN voice_* data,
 *                   Italian voice "alice"). The engine is native ARM code: UNAVAILABLE on the Web. The data files are
 *                   kept untouched in the user's folder (catalogued in docs/reverse-engineering/VOICE.md); nothing here
 *                   reads, converts or replaces them.
 *  web-tts          the browser's speechSynthesis with an Italian system voice. Classification:
 *                   APPROXIMATED / NON-ORIGINAL TTS — never presented as the Miitomo voice.
 *  silent           final fallback.
 *
 * Decoupling: the balloon typewriter, the mouth flap, gestures and faces run on their own clock (RoomUI / Expression);
 * the voice only receives "this page is shown" / "stop" and may finish earlier or later. Nothing waits for it.
 */
export type VoiceClass = 'ORIGINAL' | 'APPROXIMATED_NON_ORIGINAL_TTS' | 'SILENT';
export interface VoiceParams { pitch: number; speed: number; accent: number; energy: number; depth: number; }   // 0..100 each, 50 = neutral
export const DEFAULT_VOICE: VoiceParams = { pitch: 50, speed: 50, accent: 50, energy: 50, depth: 50 };
export interface VoiceProvider {
  id: 'original-nuance' | 'web-tts' | 'silent';
  label: string;
  classification: VoiceClass;
  /** null = usable; otherwise why not (shown in Settings). */
  unavailable(): string | null;
  /** `lang` (R6, Reboot chat lines): language of the text; omitted = Italian. Providers without languages ignore it. */
  speak(text: string, p: VoiceParams, lang?: string): void;
  stop(): void;
}

class OriginalNuance implements VoiceProvider {
  id = 'original-nuance' as const; label = 'Voce originale Miitomo (Nuance Vocalizer)'; classification: VoiceClass = 'ORIGINAL';
  unavailable() { return 'motore nativo ARM (libNuanceVocalizer.so): non eseguibile nel browser — obiettivo di ricerca per una build nativa PC'; }
  speak() { /* never: see unavailable() */ }
  stop() { /* */ }
}

/** Mapping of the Mii's voice parameters to speechSynthesis — APPROXIMATED (the original synthesis parameters are not known). */
export function webTtsSettings(p: VoiceParams) {
  const n = (v: number) => (Math.max(0, Math.min(100, v)) - 50) / 50;    // -1..1
  return {
    pitch: Math.max(0.1, Math.min(2, 1 + 0.6 * n(p.pitch) - 0.25 * n(p.depth))),
    rate: Math.max(0.5, Math.min(2, 1 + 0.45 * n(p.speed) + 0.1 * n(p.energy))),
    volume: Math.max(0.3, Math.min(1, 0.85 + 0.15 * n(p.energy)))
  };
}
/**
 * REBOOT setting for the browser voice: a volume level (Settings → Mii voices). Classic never changes it (level 1, the
 * behaviour it always had). The voice is Italian, except for Reboot chat lines that say which language they are in.
 */
const webTtsPrefs = { level: 1 };
export function setWebTtsPrefs(p: { level?: number }) {
  if (typeof p.level === 'number' && Number.isFinite(p.level)) webTtsPrefs.level = Math.max(0, Math.min(1, p.level));
}
/**
 * HOTFIX 2026-10-28 — the system voices load ASYNCHRONOUSLY (Windows / Chromium / Electron: getVoices() is [] until
 * the first 'voiceschanged'). The first version asked at start-up, found no voice, and chose "silent" for the whole
 * session. Now: while the list is loading the provider stays usable and a line waits for it (≤ 2.5 s); the voice is
 * picked by the language of the line (Italian for the original dialogue, the Reboot language for Reboot chat lines);
 * a missing voice is reported precisely (voiceReport) instead of silence without a reason.
 */
type VoiceInfo = { name: string; lang: string; local: boolean; isDefault: boolean };
const LOAD_WAIT_MS = 2500;
class WebTts implements VoiceProvider {
  id = 'web-tts' as const; label = 'Sintesi vocale del sistema (non originale)'; classification: VoiceClass = 'APPROXIMATED_NON_ORIGINAL_TTS';
  private list: SpeechSynthesisVoice[] = [];
  private since = typeof performance !== 'undefined' ? performance.now() : 0;
  private hooked = false;
  private waiting: { text: string; p: VoiceParams; lang: string } | null = null;
  private subs = new Set<() => void>();
  lastError: string | null = null;
  lastSpoken: { voice: string; lang: string; at: number } | null = null;
  private synth(): SpeechSynthesis | null { return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null; }
  /** Starts listening to the system voice list (once). */
  private hook() {
    const s = this.synth(); if (!s || this.hooked) return;
    this.hooked = true;
    this.list = s.getVoices();
    s.addEventListener('voiceschanged', () => {
      this.list = s.getVoices();
      for (const cb of this.subs) { try { cb(); } catch (e) { console.warn(e); } }
      const w = this.waiting; this.waiting = null;
      if (w) this.speak(w.text, w.p, w.lang);
    });
  }
  /** 'loading' while the system has not given its voice list yet (it can take a moment after start). */
  get state(): 'no-api' | 'loading' | 'ready' | 'none' {
    const s = this.synth(); if (!s) return 'no-api';
    this.hook();
    if (!this.list.length) this.list = s.getVoices();
    if (this.list.length) return 'ready';
    return performance.now() - this.since < LOAD_WAIT_MS ? 'loading' : 'none';
  }
  onChange(cb: () => void) { this.subs.add(cb); this.hook(); return () => this.subs.delete(cb); }
  /** Best voice for a language: a local one first; null = none installed for that language. */
  voice(lang = 'it'): SpeechSynthesisVoice | null {
    if (this.state !== 'ready') return null;
    const l = /^[a-z]{2}$/.test(lang) ? lang : 'it';
    return this.list.find((v) => v.lang?.toLowerCase().startsWith(l) && v.localService) ?? this.list.find((v) => v.lang?.toLowerCase().startsWith(l)) ?? null;
  }
  voices(): VoiceInfo[] { void this.state; return this.list.map((v) => ({ name: v.name, lang: v.lang, local: v.localService, isDefault: v.default })); }
  unavailable() {
    const st = this.state;
    if (st === 'no-api') return 'questo programma non ha la sintesi vocale (speechSynthesis)';
    if (st === 'none') return 'nessuna voce di sintesi installata nel sistema';
    return null;   // 'loading' counts as usable: the line waits for the list
  }
  speak(text: string, p: VoiceParams, lang = 'it') {
    const s = this.synth(); if (!s || !text.trim()) return;
    const st = this.state;
    if (st === 'loading') { this.waiting = { text, p, lang }; setTimeout(() => { if (this.waiting?.text === text) { this.waiting = null; this.lastError = 'le voci di sistema non si sono caricate in tempo'; } }, LOAD_WAIT_MS); return; }
    const v = this.voice(lang);
    if (!v) { this.lastError = missingVoice(lang, st); return; }
    try {
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const t = webTtsSettings(p);
      u.voice = v; u.lang = v.lang; u.pitch = t.pitch; u.rate = t.rate; u.volume = t.volume * webTtsPrefs.level;
      u.onerror = (e) => { this.lastError = `errore della sintesi vocale: ${(e as SpeechSynthesisErrorEvent).error ?? 'sconosciuto'}`; };
      s.speak(u);
      this.lastError = null; this.lastSpoken = { voice: v.name, lang: v.lang, at: Date.now() };
    } catch (e) { this.lastError = `sintesi vocale non riuscita: ${(e as Error).message}`; }   // the dialogue never depends on the voice
  }
  stop() { this.waiting = null; this.synth()?.cancel(); }
}
/** The message shown when no voice can read a language (Windows: how to add one). */
export function missingVoice(lang: string, state = 'ready') {
  if (state === 'no-api') return 'Sintesi vocale non disponibile in questo programma.';
  const name = lang === 'it' ? 'italiana' : lang === 'en' ? 'inglese' : `"${lang}"`;
  return `Nessuna voce ${name} installata. Su Windows: Impostazioni → Ora e lingua → Voce → Aggiungi voci (${lang === 'it' ? 'Italiano' : lang === 'en' ? 'English' : lang}).`;
}
const webTts = new WebTts();
/** What the voice can do on this computer (diagnostics, audio test). */
export function voiceReport() {
  const st = webTts.state;
  const it = webTts.voice('it'), en = webTts.voice('en');
  return { state: st, voices: webTts.voices(), italian: it?.name ?? null, english: en?.name ?? null, lastError: webTts.lastError, lastSpoken: webTts.lastSpoken,
    italianMissing: st === 'ready' && !it ? missingVoice('it') : null, englishMissing: st === 'ready' && !en ? missingVoice('en') : null };
}
/** Told when the system voice list arrives or changes (the game picks its voice again). */
export const onVoicesChanged = (cb: () => void) => webTts.onChange(cb);
class Silent implements VoiceProvider {
  id = 'silent' as const; label = 'Nessuna voce'; classification: VoiceClass = 'SILENT';
  unavailable() { return null; }
  speak() { /* */ }
  stop() { /* */ }
}

export const PROVIDERS: VoiceProvider[] = [new OriginalNuance(), webTts, new Silent()];
export type VoicePref = 'auto' | VoiceProvider['id'];
/** Chain: preferred → original → web TTS → silent; the first usable provider wins. */
export function resolveVoice(pref: VoicePref): VoiceProvider {
  const order = pref === 'auto' ? ['original-nuance', 'web-tts', 'silent'] : [pref, 'silent'];
  for (const id of order) { const p = PROVIDERS.find((x) => x.id === id); if (p && !p.unavailable()) return p; }
  return PROVIDERS[PROVIDERS.length - 1];
}

/** Text of a balloon page as spoken: no emoticon-only tokens, collapsed spaces. */
export function speakable(text: string) {
  return text.replace(/\s+/g, ' ').replace(/(^|\s)[:;=8xX][-^o']?[)(\][DPp3/\\|]+(?=\s|$)/g, ' ').trim();
}
