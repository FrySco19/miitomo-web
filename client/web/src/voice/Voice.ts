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
  speak(text: string, p: VoiceParams): void;
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
class WebTts implements VoiceProvider {
  id = 'web-tts' as const; label = 'Sintesi vocale del browser'; classification: VoiceClass = 'APPROXIMATED_NON_ORIGINAL_TTS';
  private synth(): SpeechSynthesis | null { return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null; }
  voice(): SpeechSynthesisVoice | null {
    const s = this.synth(); if (!s) return null;
    const vs = s.getVoices();
    return vs.find((v) => v.lang?.toLowerCase().startsWith('it') && v.localService) ?? vs.find((v) => v.lang?.toLowerCase().startsWith('it')) ?? null;
  }
  unavailable() {
    if (!this.synth()) return 'questo browser non ha la sintesi vocale (speechSynthesis)';
    if (!this.voice()) return 'nessuna voce italiana installata nel sistema';
    return null;
  }
  speak(text: string, p: VoiceParams) {
    const s = this.synth(), v = this.voice(); if (!s || !v || !text.trim()) return;
    try {
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const t = webTtsSettings(p);
      u.voice = v; u.lang = v.lang; u.pitch = t.pitch; u.rate = t.rate; u.volume = t.volume;
      s.speak(u);
    } catch (e) { console.warn('sintesi vocale non riuscita', e); }   // the dialogue never depends on the voice
  }
  stop() { this.synth()?.cancel(); }
}
class Silent implements VoiceProvider {
  id = 'silent' as const; label = 'Nessuna voce'; classification: VoiceClass = 'SILENT';
  unavailable() { return null; }
  speak() { /* */ }
  stop() { /* */ }
}

export const PROVIDERS: VoiceProvider[] = [new OriginalNuance(), new WebTts(), new Silent()];
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
