/**
 * Room audio driven by the game's own sound tables (M8). Nothing is synthesised: if a table or a file is missing the
 * event is logged as missing and stays silent.
 *
 * Tables (APK: assets/message/Release/Console/JPja/Client/Sound/, MSBT "key -> value", first line = default): VERIFIED (data)
 *   Action/anim.msbt    clip name or "clip:frame"  -> sound event   (animWalkClone:2 = se_walk_nori_00, ...)
 *   Action/common.msbt  layout / model keys        -> sound event   (doorAnim/doorAnimOpen = se_door_open01,
 *                       decide_asset/layout/room/.../roomTouchBody00.ccbi_roomTouchBtn00 = se_button_orange_decide, ...)
 *   Action/bgm.msbt     bgm_room -> BGM_MIIWATCH_NORMAL_DAY (+ alternatives on the next lines)
 *   BGM/common.msbt     BGM_* -> WAVE_*            Wave/bgm.msbt  WAVE_* -> file.mp3
 *   Wave/{common,emotion,bundle}.msbt   sound event -> file.wav (se_animation_up/down/move live in Wave/emotion)
 * Files: sound/<file> from the CDN sound.zip (or the APK's assets/sound/).                                 VERIFIED (data)
 * Mixing (volumes), BGM day/night switch by local hour, and the moment se_nade01 starts are APPROXIMATED / DEDUCED.
 * murmursound_NN.raw (Mii "voice"): 16-bit PCM without a header - the sample rate is not reversed, so it is NOT played.
 */
import { vfs } from '../assets/vfs';
import { parseMSBT, plain } from '../formats/msbt';

const TABLE_DIR = 'message/Release/Console/JPja/Client/Sound/';
type Table = Map<string, string[]>;
const TABLES = ['Action/anim', 'Action/common', 'Action/effect', 'Action/face', 'Action/bgm', 'BGM/common', 'Wave/bgm', 'Wave/common', 'Wave/emotion', 'Wave/bundle'];
/** Wave tables searched for a sound event, in order. */
const WAVES = ['Wave/common', 'Wave/emotion', 'Wave/bundle'];

export interface SoundLogEntry { t: number; key: string; event: string | null; file: string | null; played: boolean; why?: string; }

export class RoomSound {
  private tables = new Map<string, Table>();
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private bgmNode: AudioBufferSourceNode | null = null;
  private bgmGain: GainNode | null = null;
  private seGain: GainNode | null = null;
  bgmKey = '';
  enabled = true;
  /** M17b: the original three switches (Layout/menu switchNode00 snd00 Musica, snd01 Effetti; Voce is the voice provider). */
  music = true;
  effects = true;
  /** REBOOT settings: volume of each channel, 0..1, on top of the switches (Classic keeps 1 = the mix it always had). */
  levels = { music: 1, effects: 1 };
  setChannels(music: boolean, effects: boolean) {
    this.music = music; this.effects = effects;
    if (this.bgmGain) this.bgmGain.gain.value = music ? 0.45 * this.levels.music : 0;
    if (this.seGain) this.seGain.gain.value = effects ? 0.9 * this.levels.effects : 0;
  }
  setLevels(music: number, effects: number) {
    const c = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);
    this.levels = { music: c(music), effects: c(effects) };
    this.setChannels(this.music, this.effects);
  }
  readonly log: SoundLogEntry[] = [];
  readonly missing = new Set<string>();

  constructor() {
    for (const t of TABLES) {
      const b = vfs.get(`${TABLE_DIR}${t}.msbt`); if (!b) continue;
      try {
        const m = parseMSBT(b); const tab: Table = new Map();
        for (const [k, v] of m) tab.set(k, plain(v).split('\n').map((s) => s.trim()).filter(Boolean));
        this.tables.set(t, tab);
      } catch (e) { console.warn(`tabella suoni ${t}: ${(e as Error).message}`); }
    }
  }
  get tablesLoaded() { return this.tables.size; }
  get filesAvailable() { return [...vfs.keys()].filter((k) => /^sound\/[^/]+\.(wav|mp3)$/.test(k)).length; }
  private first(t: string, k: string) { return this.tables.get(t)?.get(k)?.[0] ?? null; }

  /** Sound event -> file name (Wave/common). */
  waveFile(event: string): string | null { for (const t of WAVES) { const f = this.first(t, event); if (f) return f; } return null; }
  get tablesExpected() { return TABLES.length; }
  /** Action key (clip, clip:frame, layout key) -> sound event; '' / SE_SILENT mean "no sound". */
  actionEvent(key: string): string | null {
    for (const t of ['Action/anim', 'Action/common', 'Action/effect', 'Action/face']) { const v = this.tables.get(t)?.get(key); if (v) return v[0] ?? ''; }
    return null;
  }
  hasAction(key: string) { return this.actionEvent(key) !== null; }
  /** Frames N of the "key:N" entries of a table (timed sounds, e.g. Action/effect arCry:17). */
  timedFrames(table: string, key: string): number[] {
    const out: number[] = []; for (const k of this.tables.get(table)?.keys() ?? []) { const m = k.startsWith(key + ':') ? /:(\d+)$/.exec(k) : null; if (m) out.push(Number(m[1])); }
    return out;
  }

  /** Must be called from a user gesture (autoplay policy). */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      this.ctx = new AC();
      this.seGain = this.ctx.createGain(); this.seGain.gain.value = this.effects ? 0.9 * this.levels.effects : 0; this.seGain.connect(this.ctx.destination);   // APPROXIMATED mix
      this.bgmGain = this.ctx.createGain(); this.bgmGain.gain.value = this.music ? 0.45 * this.levels.music : 0; this.bgmGain.connect(this.ctx.destination);
      this.resumeBgm();
    } catch (e) { this.ctx = null; console.warn('WebAudio non disponibile', e); }
  }
  get unlocked() { return !!this.ctx && this.ctx.state !== 'closed'; }

  private buffer(file: string): Promise<AudioBuffer | null> {
    // M17: BGM tracks are cold (IndexedDB): load the file first, then decode
    if (!this.buffers.has(file) && vfs.has(`sound/${file}`) && !vfs.ready([`sound/${file}`])) {
      return vfs.ensure([`sound/${file}`]).then(() => this.buffer(file), () => null);
    }
    if (!this.buffers.has(file)) {
      const bytes = vfs.get(`sound/${file}`);
      const p = !bytes || !this.ctx ? Promise.resolve(null)
        : this.ctx.decodeAudioData(bytes.slice().buffer).then((b) => b, () => { this.missing.add(`${file} (decodifica)`); return null; });
      if (!bytes) this.missing.add(file);
      if (bytes && !this.ctx) return p; // not cached: retry once the context exists
      this.buffers.set(file, p);
    }
    return this.buffers.get(file)!;
  }

  private record(key: string, event: string | null, file: string | null, why?: string) {
    const played = !why && this.enabled && !!this.ctx;
    this.log.push({ t: performance.now(), key, event, file, played, why: why ?? (!this.enabled ? 'muto' : !this.ctx ? 'audio non sbloccato' : undefined) });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  /** Plays a sound event (Wave/common name). */
  play(event: string, key = event) {
    if (!event || event === 'SE_SILENT') { this.record(key, event, null, 'silenzio da tabella'); return; }
    const file = this.waveFile(event);
    if (!file) { this.missing.add(`evento ${event}`); this.record(key, event, null, 'evento non in Wave/common'); return; }
    if (!vfs.has(`sound/${file}`)) { this.missing.add(file); this.record(key, event, file, 'file non importato'); return; }
    this.record(key, event, file);
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, out = this.seGain!;
    this.buffer(file).then((b) => { if (!b || !this.enabled) return; const s = ctx.createBufferSource(); s.buffer = b; s.connect(out); s.start(); });
  }
  /** Looks an action key up (Action/anim, Action/common) and plays the event it names. */
  action(key: string) {
    const ev = this.actionEvent(key);
    if (ev === null) return false;
    this.play(ev, key);
    return true;
  }
  /** Animation hooks: clip start (frame 0 -> key = clip name) and integer frames ("clip:N"). */
  clipStart(clip: string) { this.action(clip); }
  clipFrame(clip: string, frame: number) { if (frame > 0) this.action(`${clip}:${frame}`); }

  /** Background music: Action/bgm key -> BGM_* -> WAVE_* -> mp3 (loop). `alt` picks a later line (e.g. night). */
  bgm(key: string, alt?: string) {
    const lines = this.tables.get('Action/bgm')?.get(key) ?? [];
    const bgmId = (alt && lines.includes(alt)) ? alt : lines[0];
    const wave = bgmId ? this.first('BGM/common', bgmId) : null;
    const file = wave ? this.first('Wave/bgm', wave) : null;
    const id = `${key}/${bgmId}`;
    if (this.bgmKey === id && this.bgmNode) return file;
    this.stopBgm();
    this.bgmKey = id;
    if (!file) { this.record(key, bgmId ?? null, null, 'catena BGM incompleta'); return null; }
    if (!vfs.has(`sound/${file}`)) { this.missing.add(file); this.record(key, bgmId, file, 'file non importato'); return file; }
    this.record(key, bgmId, file);
    if (!this.ctx || !this.enabled) return file;
    const ctx = this.ctx;
    this.buffer(file).then((b) => {
      if (!b || this.bgmKey !== id || !this.enabled || this.bgmNode) return;
      const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.connect(this.bgmGain!); s.start(); this.bgmNode = s;
    });
    return file;
  }
  /** Launcher: whether a BGM key resolves to a music file that the user imported (nothing is played). */
  canPlay(key: string) {
    const id = this.tables.get('Action/bgm')?.get(key)?.[0];
    const wave = id ? this.first('BGM/common', id) : null;
    const file = wave ? this.first('Wave/bgm', wave) : null;
    return !!file && vfs.has(`sound/${file}`);
  }
  stopBgm() { try { this.bgmNode?.stop(); } catch { /* */ } this.bgmNode?.disconnect(); this.bgmNode = null; }
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.stopBgm();
    else this.resumeBgm();
  }
  private resumeBgm() { if (!this.bgmKey) return; const [k, alt] = this.bgmKey.split('/'); this.bgmKey = ''; this.stopBgm(); this.bgm(k, alt); }
  dispose() { this.stopBgm(); }
}
