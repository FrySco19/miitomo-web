/**
 * PLAY mode (M9): the game shell. The Lab (?lab=1) keeps every developer tool; PLAY shows only the game.
 *
 * Flow: boot (logo + loading + launch tip) → [first run: import the user's own files] → [no profile: create Mii →
 * name → birthday] → room (enter, greeting / first-entry tutorial line) → bottom bar (Home, Amici, Negozio, Menu,
 * La mia pagina) with Menu → Guardaroba / Modifica Mii / Arreda stanza / Impostazioni.
 *
 * Original data used (all from the user's files, VERIFIED texts):
 *   APK asset/layout/boot (bg00.webp, texture00 logo sprites), message EUit Layout/boot (Caricamento, Consigli per
 *   l'uso di Miitomo), System/LaunchTipsV2 (tips), Layout/tutorial conformBirthday00 / birthdaybtn00 / birthDecideBtn00,
 *   Layout/room tabBtn00 / menuBtn0x labels, RoomSceneTalkWords tutorialFirst (first entry, mapping DEDUCED).
 * Screen composition, order of the offline steps and every control without an original label are APPROXIMATED
 * (Mii Studio, EULA, Nintendo account and server sync are not reproduced: see docs/reverse-engineering/SAVE.md).
 */
import { label, line, render } from '../room/RoomText';
import { vfs } from '../assets/vfs';
import { sprite, BOOT_DIR } from '../room/LayoutSprites';
import { CAT_LABEL, CAT_DIR, Category, Outfit } from '../body/Wardrobe';
import { buildCatalog, arrivalGroups, dayMonth, DISABLED_ECONOMY, ShopItem } from './Shop';
import { CLOSET_ORDER, CLOSET_TABS, ClosetTab, tabIcon, commonIcon, commonTexture, BAR_ICON, itemName, thumb, icon, colours, skinName, skinThumb, thumbKey, itemKey, skinThumbKey, skinVariantCount } from './Closet';
import * as MF from './Miifoto';
import * as MS from './MiiStudio';
import type { Field } from './MiiStudio';
const M_setName = MS.setNickname;
import { LocalProvider, SocialProvider, FriendProfile } from '../social/Social';
import { PRESETS, DEFAULT_LEVELS, AXIS_LABEL, AXIS_FALLBACK, RADAR, BALLOON, levelLabel, personalityType, personalityLabels } from './Personality';
import { PERSONALITIES } from '../room/Expression';
import { SaveData, newSave, loadSave, writeSave, deleteSave, migrate, b64, MAX_COORDINATES } from './Save';

/** M18: a friend visiting the user's room. */
export interface GuestSpec { id: string; name: string; miiData: Uint8Array; outfit: Outfit; height: number | null; build: number | null; personality: number[] | null; greetings: { welcome: string; goIn: string; seeingOff: string; goHome: string }; voice: SaveData['profile']['voice']; female?: boolean; }
export interface PlayApi {
  ready(): { engine: boolean; shader: boolean; room: boolean; anims: boolean; wardrobe: number; texts: boolean; expr: boolean };
  importFiles(files: File[]): Promise<void>;
  importLocal(files: { name: string; size: number }[], progress: (f: number, name: string) => void): Promise<void>;
  importedSources(): Promise<string[]>;
  reimportNeeded(names: string[]): Promise<string[]>;
  markKeepVersion(): Promise<void>;
  /** Loads cold files (models / thumbnails kept in IndexedDB) before a screen needs them synchronously. */
  ensureFiles(keys: string[]): Promise<void>;
  vfsKeys(re: RegExp): string[];
  blobUrl(key: string, type: string): string | null;
  localFiles(): Promise<{ name: string; size: number }[]>;
  randomMii(gender: number): Uint8Array;
  parseMii(text: string): Uint8Array;
  setMii(data: Uint8Array, height: number | null, build: number | null): void;
  miiName(): string;
  setScene(scene: 'lab' | 'room'): void;
  setRoom(wall: string, floor: string, variant: number): void;
  roomSkins(): { walls: string[]; floors: string[] };
  skinVariants(kind: 'wall' | 'floor', id: string): number;
  outfit: Outfit;
  catalog(): Map<Category, { id: string }[]>;
  rebuild(): void;
  setNickname(n: string): void;
  setPersonality(levels: number[] | null): void;
  setVoice(pref: SaveData['settings']['voice'], params: SaveData['profile']['voice']): void;
  voiceStatus(): { active: { id: string; label: string; classification: string }; providers: { id: string; label: string; classification: string; unavailable: string | null }[] };
  setAudio(on: boolean): void;
  /** Settings: Musica / Effetti / Voce (switchNode00 snd00..02). */
  setSoundSwitches(music: boolean, effects: boolean, voice: boolean): void;
  onEnterGreeting: ((firstEntry: boolean) => boolean) | null;
  /** Touch menu "Sai, di recente…" (balloonMenuL). */
  onRecent: (() => void) | null;   // returns true when PLAY handled the greeting
  showBalloon(rel: string, labelName: string, fallback: string, autoClose?: number): void;
  closeBalloon(): void;
  directorState(): string | null;
  setCloset(on: boolean): void;
  /** The worn tops item has a tucked-in variant (In / St stems), so Dentro / Fuori applies. */
  canTuck?(): boolean;
  setVenue(v: 'room' | 'shop'): boolean;
  shopAvailable(): boolean;
  itemDates(): Record<string, string>;
  setGreetings(g: { welcome: string; goIn: string; seeingOff: string; goHome: string }): void;
  /** The shown Mii as FFLiCharInfo (288 B, converted by FFL from whatever format was imported). */
  charInfo(): Uint8Array | null;
  /** Mii editor stage: front view of the head (or the full body for physique); null = normal stage. */
  setEditView(m: 'head' | 'full' | null, side?: 'left' | 'right'): void;
  /** FFLiVerifyCharInfoWithReason: 0 = valid. */
  verifyMii(ci: Uint8Array): number;
  /** Scene music by its original Action/bgm key (e.g. bgm_closetSceneInit); null = room music. */
  setMusic(key: string | null): void;
  /** M18: a friend enters the user's room (two Miis); resolves false if the room is not ready or a guest is there. */
  guestArrive(sp: GuestSpec, opts?: { inside?: { x: number; z: number } }): Promise<boolean>;
  /** M18: the guest says goodbye (1.4 / 1.3) and leaves through the door. */
  guestLeave(id?: string): boolean;
  /** M18: the guest (all guests without id) is removed at once (the user leaves the room). */
  guestEnd(id?: string): void;
  /** First guest (or the one with `id`); null when nobody is visiting. */
  guestState(id?: string): { id: string; name: string; state: string; leaving: boolean } | null;
  /** All guests (Reboot MULTI_MII: several at once; Classic: at most one). */
  guestsState(): { id: string; name: string; state: string; leaving: boolean }[];
  /** How many guests may be in the room together (Classic 1; Reboot sets more). */
  setGuestCapacity(n: number): number;
  guestCapacity(): number;
  onGuest: ((e: { type: 'arrive' | 'leave'; id: string; name: string }) => void) | null;
  /** The next room setup plays the entrance (a visit) even if the Mii was already in. */
  enterFresh(): void;
  /** M16: the room shown is a friend's (personality type → friend-room BGM), null = the user's own room. */
  setFriendHost(type: number | null): void;
  setMiiExpression?(n: number): void;
  renderMiiPhoto(p: { clip: string; frame: number; expression: number; cam: { pos: number[]; aim: number[]; up?: number[]; near: number; far: number; fovY: number }; size: number }): Promise<HTMLCanvasElement | null>;
}

const T = {
  boot: 'Layout/boot/body/bootRoot00.msbt', loading: 'Layout/boot/parts/layer1/loadingText00.msbt', tips: 'System/LaunchTipsV2.msbt',
  birthday: 'Layout/tutorial/body/conformBirthday00.msbt', bbtn: 'Layout/tutorial/parts/layer1/birthdaybtn00.msbt', bok: 'Layout/tutorial/parts/layer1/birthDecideBtn00.msbt',
  tabs: 'Layout/room/parts/layer1/tabBtn00.msbt', menu1: 'Layout/room/parts/layer1/menuBtn01.msbt', menu2: 'Layout/room/parts/layer1/menuBtn02.msbt',
  menu3: 'Layout/room/parts/layer1/menuBtn03.msbt', menu4: 'Layout/room/parts/layer1/menuBtn04.msbt', menu5: 'Layout/room/parts/layer1/menuBtn05.msbt', menu6: 'Layout/room/parts/layer1/menuBtn06.msbt'
};
const CS = 'Layout/common/parts/cmnSection00.msbt', ML = 'Layout/system/parts/layer1/modalListBtn00.msbt', D2 = 'Layout/system/parts/layer1/dialog002.msbt', CB = 'Layout/system/parts/layer2/cmnBtn00.msbt', T_ROOMW = 'Scene/RoomSceneTalkWords.msbt';
const lb = (rel: string, key: string, fb: string) => label(rel, key, fb).replace(/\s+/g, ' ').trim();
const clean = (rel: string, key: string, fb: string) => { const l = line(rel, key); if (!l) return fb; return render(l.nodes, { nickname: '', female: false }).pages.map((p) => p.spans.map((s) => s.text).join('')).join('\n').trim() || fb; };

/**
 * Bottom-bar button base. tabBtn00.ccbi: CCControlButton whose backgroundSpriteFrame is bulletTab00 (bulletTab01 when on),
 * drawn at its preferedSize. A CCControlButton background is a CCScale9Sprite: with no cap insets cocos2d-x splits the
 * frame in thirds, so corners stay at native resolution and only the middle stretches (VERIFIED: ccbi node/property names;
 * insets = default thirds, REVERSED from the cocos2d-x Scale9Sprite behaviour). The 13 x 13 / 19 x 19 frames were
 * previously stretched whole, which blurred the grey edge. Rendered here as a CSS 9-slice (border-image).
 */
function tabBase(on: boolean): string {
  const f = on ? 'bulletTab01.png' : 'bulletTab00.png', u = commonTexture(f);
  if (!u) return '';
  const k = (on ? 19 : 13) / 3;
  return `border:${k.toFixed(2)}px solid transparent;border-image:url(${u}) ${k.toFixed(2)} fill / ${k.toFixed(2)}px stretch;background:none`;
}

export class Play {
  readonly root: HTMLDivElement;
  save: SaveData;
  private screen = '';
  private gender = 2;
  private pending: Uint8Array | null = null;
  readonly log: string[] = [];

  /** M16 friends: the gameplay only talks to the provider (LocalProvider now, our own ServerProvider later). */
  /** The desktop app wraps it to add the peer-to-peer friends (p2p/social.ts). */
  social: SocialProvider = new LocalProvider();
  private visiting: FriendProfile | null = null;
  private makingFriend: SaveData['profile'] | null = null;
  /** The profile the creation screens edit: the user's own, or a new local friend's. */
  private get prof(): SaveData['profile'] { return this.makingFriend ?? this.save.profile; }
  constructor(private api: PlayApi, private defaults: Outfit) {
    this.save = newSave(defaults);
    document.body.classList.add('play');
    this.root = document.createElement('div');
    this.root.id = 'play'; this.root.className = 'play-root';
    document.body.append(this.root);
    api.onEnterGreeting = (first) => this.enterGreeting(first);
    api.onRecent = () => { void this.openRecent(); };
    api.onGuest = (e) => this.onGuest(e);
  }

  // ---------------- boot ----------------
  async boot() {
    const loaded = await loadSave(this.save);
    if (loaded) this.save = loaded;
    this.save.progress.launches++;
    this.api.setAudio(this.save.settings.audio);
    { const sw = this.save.settings.sound; this.api.setSoundSwitches(sw.music, sw.effects, sw.voice); }
    this.showBoot(0);
    await this.waitAssets();
  }
  private bootArt() {
    const bg = vfs.get('asset/layout/boot/Published-iOS/texture-boot/textureWebp00/bg00.webp');
    return bg ? URL.createObjectURL(new Blob([bg], { type: 'image/webp' })) : '';
  }
  private showBoot(pct: number, note = '') {
    this.screen = 'boot';
    const tips = this.tipsList();
    const tip = tips.length ? tips[(this.save.progress.launches + 3) % tips.length] : '';
    const bg = this.bootArt();
    this.root.innerHTML = `<section class="pl-screen pl-boot" ${bg ? `style="--boot-bg:url(${bg})"` : ''}>
      ${this.logoHtml()}
      <div class="pl-loading"><span class="pl-loading-text">${esc(lb(T.loading, 'loadingText', 'Caricamento'))}</span><span class="pl-pct">${Math.round(pct)}%</span><div class="pl-bar"><i style="width:${pct}%"></i></div>${note ? `<p class="pl-note">${esc(note)}</p>` : ''}</div>
      ${tip ? `<div class="pl-tip"><h3>${esc(lb(T.boot, 'text01', 'Consigli per l\'uso di Miitomo'))}</h3><p>${esc(tip)}</p></div>` : ''}
    </section>`;
  }
  /** The launcher shows the same logo (from the user's APK when imported). */
  get logo() { return this.logoHtml(); }
  /** bootRoot00: logo00 (word mark) + logo01 (badge) from the user's APK; plain text otherwise. */
  private logoHtml() {
    const a = sprite('texture00', 'logo00.png', BOOT_DIR), b = sprite('texture00', 'logo01.png', BOOT_DIR);
    if (a) return `<div class="pl-logo original"><img src="${a.url}" alt="Miitomo" width="${a.w / 2}" height="${a.h / 2}" />${b ? `<img class="pl-logo-badge" src="${b.url}" alt="" width="${b.w / 2}" height="${b.h / 2}" />` : ''}<span class="pl-logo-sub">Web</span></div>`;
    return '<div class="pl-logo" aria-label="Miitomo Web"><span class="pl-logo-word">Miitomo</span><span class="pl-logo-sub">Web</span></div>';
  }
  private tipsList() {
    const out: string[] = [];
    for (let i = 1; i < 30; i++) { const k = `Tips${String(i).padStart(2, '0')}`; const l = line(T.tips, k); if (l) out.push(clean(T.tips, k, '')); }
    return out.filter(Boolean);
  }
  private async waitAssets(): Promise<void> {
    const r = this.api.ready();
    if (!(r.engine && r.shader && r.room && r.anims)) {
      // try the local launcher once
      const files = await this.api.localFiles();
      if (files.length && !this.save.profile.miiData && !sessionStorageGet('mtw-autoimport-tried')) {
        sessionStorageSet('mtw-autoimport-tried', '1');
        await this.importLocal(files);
        return this.waitAssets();
      }
      this.showSetup(files);
      return;
    }
    if (await this.updateFromLocal()) return this.waitAssets();
    this.showBoot(100);
    await sleep(350);
    if (!this.save.profile.miiData) this.showCreate();
    else this.startRoom();
  }
  private async importLocal(files: { name: string; size: number }[]) {
    await this.api.importLocal(files, (f, name) => this.showBoot(f * 96, name));
  }
  /** Local launcher: files in the folder that were never imported (e.g. after a new CDN batch) are imported at boot. */
  private async updateFromLocal(): Promise<boolean> {
    const files = await this.api.localFiles(); if (!files.length) return false;
    const have = new Set(await this.api.importedSources());
    // a cache made before this list existed: update only if the M13 data (EmotionExpression) is missing
    const again = new Set(have.size ? await this.api.reimportNeeded(files.filter((f) => have.has(f.name)).map((f) => f.name)) : []);
    const fresh = have.size ? files.filter((f) => !have.has(f.name) || again.has(f.name)) : this.api.ready().expr ? [] : files;
    if (!fresh.length) { await this.api.markKeepVersion(); return false; }
    await this.importLocal(fresh);
    await this.api.markKeepVersion();
    return true;
  }

  // ---------------- first run: user's own files ----------------
  private showSetup(local: { name: string; size: number }[]) {
    this.screen = 'setup';
    const r = this.api.ready();
    const item = (ok: boolean, t: string) => `<li class="${ok ? 'ok' : 'todo'}">${esc(t)}</li>`;
    this.root.innerHTML = `<section class="pl-screen pl-card-screen"><div class="pl-card">
      <h2>Benvenuto in Miitomo Web</h2>
      <p>Miitomo Web usa solo i file originali che possiedi: l'APK di Miitomo 2.4.0 e gli archivi del CDN preservati. Restano su questo dispositivo.</p>
      <ul class="pl-check">${item(r.engine, 'Parti Mii (AFLResHigh_2_3)')}${item(r.shader, 'APK di Miitomo 2.4.0')}${item(r.room, 'Stanza (roomBaseComponents)')}${item(r.anims, 'Animazioni')}${item(r.texts, 'Testi italiani (facoltativo)')}</ul>
      <div class="pl-actions">
        ${local.length ? `<button class="pl-btn" data-a="local">Importa dalla cartella MiiTomoWeb (${local.length} file)</button>` : ''}
        <label class="pl-btn ${local.length ? 'ghost' : ''}">Scegli i file…<input type="file" multiple hidden accept=".apk,.zip,.dat" /></label>
      </div>
      <p class="pl-small"><a href="?lab=1">Apri il Lab</a></p>
    </div></section>`;
    this.root.querySelector('[data-a="local"]')?.addEventListener('click', async () => { await this.importLocal(local); this.waitAssets(); });
    this.root.querySelector('input[type=file]')!.addEventListener('change', async (e) => { const fl = (e.target as HTMLInputElement).files; if (fl?.length) { this.showBoot(50); await this.api.importFiles([...fl]); this.waitAssets(); } });
  }

  // ---------------- profile creation ----------------
  showCreate() {
    this.screen = 'create';
    this.api.setScene('lab');
    this.api.setMusic('bgm_miiStudioSceneInit');
    this.api.setEditView('full', 'right');   // fixed front view, panel on the left
    if (!this.pending) this.roll();
    this.root.innerHTML = `<section class="pl-screen pl-side"><div class="pl-panel">
      <h2>${this.makingFriend ? 'Il Mii del tuo amico' : 'Crea il tuo Mii'}</h2>
      <p>Scegli un Mii casuale o importa i dati di un ${this.makingFriend ? '' : 'tuo '}Mii (3DS / Wii U / Mii Studio).</p>
      <div class="pl-seg" role="radiogroup">${[['2', 'Tutti'], ['0', 'Maschio'], ['1', 'Femmina']].map(([v, t]) => `<button role="radio" aria-checked="${String(this.gender) === v}" data-g="${v}">${t}</button>`).join('')}</div>
      <button class="pl-btn" data-a="roll">Un altro Mii</button>
      <details class="pl-import"><summary>Importa dati Mii</summary><textarea rows="3" spellcheck="false" placeholder="hex o Base64"></textarea><button class="pl-btn ghost" data-a="import">Usa questi dati</button><p class="pl-err" hidden></p></details>
      <div class="pl-actions">${this.makingFriend ? `<button class="pl-btn ghost" data-a="cancel">${esc(lb(CB, 'title00@cancel', 'Annulla'))}</button>` : ''}<button class="pl-btn primary" data-a="next">Avanti</button></div>
      <p class="pl-small">L'editor originale (Mii Studio) arriverà con i suoi file di layout.</p>
    </div></section>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-g]').forEach((b) => b.addEventListener('click', () => { this.gender = Number(b.dataset.g); this.root.querySelectorAll('[data-g]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); this.roll(); }));
    this.on('roll', () => this.roll());
    this.on('import', () => {
      const ta = this.root.querySelector('textarea')!, err = this.root.querySelector<HTMLElement>('.pl-err')!;
      try { this.pending = this.api.parseMii(ta.value); this.api.setMii(this.pending, null, null); err.hidden = true; } catch (e) { err.hidden = false; err.textContent = (e as Error).message; }
    });
    this.on('next', () => this.showName());
    this.on('cancel', () => { this.makingFriend = null; this.pending = null; this.startRoom(); this.openFriends(); });
  }
  private roll() { this.pending = this.api.randomMii(this.gender); this.api.setMii(this.pending, null, null); }
  private showName() {
    this.screen = 'name';
    const cur = this.prof.name || this.api.miiName() || '';
    this.root.innerHTML = `<section class="pl-screen pl-side"><div class="pl-panel">
      <h2>${this.makingFriend ? 'Come si chiama il Mii del tuo amico?' : 'Come si chiama il tuo Mii?'}</h2>
      <input class="pl-input" maxlength="10" value="${esc(cur)}" placeholder="Nome (max 10)" />
      <div class="pl-actions"><button class="pl-btn ghost" data-a="back">Indietro</button><button class="pl-btn primary" data-a="next">Avanti</button></div>
    </div></section>`;
    const inp = this.root.querySelector<HTMLInputElement>('.pl-input')!; inp.focus();
    const next = () => { const n = inp.value.trim(); if (!n) { inp.classList.add('bad'); inp.focus(); return; } this.prof.name = n.slice(0, 10); this.showBirthday(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
    this.on('back', () => this.showCreate()); this.on('next', next);
  }
  private showBirthday() {
    this.screen = 'birthday';
    const months = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    const days = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    this.root.innerHTML = `<section class="pl-screen pl-side"><div class="pl-panel">
      <h2>${esc(lb(T.birthday, 'text00', 'Inserisci il compleanno'))}</h2>
      <p class="pl-pre">${esc(clean(T.birthday, 'text01', 'Inserisci il compleanno del tuo Mii.'))}</p>
      <div class="pl-row"><label>${esc(lb(T.bbtn, 'place_left@birthMonth', 'Mese'))}<select data-k="m"><option value=""></option>${months}</select></label>
      <label>${esc(lb(T.bbtn, 'place_center@birthDay', 'Giorno'))}<select data-k="d"><option value=""></option>${days}</select></label></div>
      <div class="pl-actions"><button class="pl-btn ghost" data-a="back">Indietro</button><button class="pl-btn primary" data-a="ok">${esc(lb(T.bok, 'title00@profile_barithday_decide', 'OK'))}</button></div>
    </div></section>`;
    this.on('back', () => this.showName());
    this.on('ok', async () => {
      const m = Number(this.root.querySelector<HTMLSelectElement>('[data-k=m]')!.value), d = Number(this.root.querySelector<HTMLSelectElement>('[data-k=d]')!.value);
      if (!m || !d || d > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]) { this.root.querySelector('.pl-row')!.classList.add('bad'); return; }
      this.prof.birthday = { month: m, day: d };
      this.prof.miiData = b64.enc(this.pending!);
      if (!this.makingFriend) await this.persist();
      this.showPersonality(true);
    });
  }

  // ---------------- room ----------------
  startRoom(fresh = false) {
    this.screen = 'room';
    this.scheduleGuest();
    this.api.setEditView(null);
    this.visiting = null; this.api.setFriendHost(null); this.api.setMusic(null);
    this.wearOwnMii();
    this.api.setRoom(this.save.room.wall, this.save.room.floor, this.save.room.variant);
    this.api.setScene('room');
    if (fresh) { this.api.enterFresh(); this.api.rebuild(); }   // back from a visit: the user's Mii comes in again
    this.renderBar();
  }
  /** The user's own Mii, name, greetings, personality, voice and outfit on the stage. */
  private wearOwnMii() {
    const p = this.save.profile;
    if (p.miiData) this.api.setMii(b64.dec(p.miiData), p.height, p.build);
    this.api.setNickname(p.name || this.api.miiName() || 'Mii');
    this.api.setGreetings(p.greetings);
    this.api.setPersonality(p.personality);
    this.api.setVoice(this.save.settings.voice, p.voice);
    Object.keys(this.api.outfit).forEach((k) => delete (this.api.outfit as any)[k]);
    Object.assign(this.api.outfit, structuredClone(this.save.outfit));
  }
  /**
   * REBOOT places only (friend rooms, Sala Giochi — R5; Classic never calls it): the room engine shows another room
   * look and the user's own Mii comes in through the door. The Reboot layer draws the place's own bar.
   */
  visitPlace(id: string, skin: { wall: string; floor: string; variant: number }, friendHost: number | null) {
    if (this.screen !== 'room' && !this.screen.startsWith('place:')) return false;
    this.closeSheet();
    this.api.guestEnd(); this.clearGuestTimers();
    this.visiting = null; this.screen = 'place:' + id;
    this.api.setEditView(null); this.api.setMusic(null);
    this.wearOwnMii();
    this.api.setRoom(skin.wall, skin.floor, skin.variant);
    this.api.setFriendHost(friendHost);
    this.api.setScene('room');
    this.api.enterFresh(); this.api.rebuild();
    this.root.innerHTML = '';
    return true;
  }
  /** REBOOT: an extra action on the Miifoto screen ("share on MIInstagram"); null in Classic. */
  photoShare: { label: () => string; share: (dataUrl: string) => void } | null = null;
  /** Greeting after the entrance: first entry plays the tutorial welcome line (pages), then the save remembers it. */
  private enterGreeting(first: boolean): boolean {
    if (this.visiting) {
      // the friend (host) greets the visitor with its own "Saluto (arriva un amico)" (tag 1.2) — DEDUCED from the Saluti labels
      this.api.showBalloon(T_ROOMW, 'customGreetingWelcome', 'Ciao!', 2.6);
      return true;
    }
    if (this.save.progress.firstEntryDone) return false;
    void first;
    this.api.showBalloon('Scene/RoomSceneTalkWords.msbt', 'tutorialFirst', 'Ciao!');
    this.save.progress.firstEntryDone = true;
    this.persist();
    return true;
  }
  private barOn = 'home';
  /** One original tab button: bulletTab00 base (bulletTab01 when selected) + the RoomMenuRootNode icon + tabBtn label. */
  private barBtn(id: string, icon: keyof typeof BAR_ICON, rel: string, key: string, fb: string, attr: string, off?: string) {
    const ic = commonIcon(BAR_ICON[icon]);
    const on = this.barOn === id;
    const base = tabBase(on);
    return `<button class="pl-tab ${on ? 'on' : ''}" ${attr}="${id}" ${off ? `disabled title="${esc(off)}"` : ''} aria-pressed="${on}"><span class="pl-tab-ico ${ic ? 'orig' : ''}" style="${base}" aria-hidden="true">${ic ? `<img src="${ic}" alt="" />` : ''}</span><span class="pl-tab-label">${esc(lb(rel, key, fb))}</span></button>`;
  }
  private renderBar() {
    const shopOff = this.api.shopAvailable() || this.api.catalog().size ? undefined : 'Servono i file del negozio (CDN asset_model_shop_output, layout shop)';
    this.root.innerHTML = `<nav class="pl-nav" aria-label="Menu principale">
      ${this.barBtn('home', 'home', T.tabs, 'title00@home00', 'Home', 'data-tab')}${this.barBtn('page', 'page', T.tabs, 'title00@answer00', 'La mia pagina', 'data-tab')}${this.barBtn('friends', 'friends', T.tabs, 'title00@friendlist00', 'Amici', 'data-tab')}${this.barBtn('shop', 'shop', T.tabs, 'title00@shop00', 'Negozio', 'data-tab', shopOff)}${this.barBtn('menu', 'menu', T.tabs, 'title00@menu00', 'Menu', 'data-tab')}
    </nav><div class="pl-sheet" hidden></div>`;
    this.root.querySelectorAll<HTMLButtonElement>('.pl-tab').forEach((b) => b.addEventListener('click', () => this.openTab(b.dataset.tab!)));
  }
  private setBarOn(id: string) {
    this.barOn = id;
    this.root.querySelectorAll<HTMLButtonElement>('.pl-nav .pl-tab').forEach((b) => {
      const on = (b.dataset.tab ?? b.dataset.ftab) === id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      const base = b.querySelector<HTMLElement>('.pl-tab-ico'); if (base) base.setAttribute('style', tabBase(on));
    });
  }
  private sheet(html: string, onClose?: () => void) {
    const s = this.root.querySelector<HTMLDivElement>('.pl-sheet')!;
    s.className = 'pl-sheet';
    this.api.setCloset(false); this.api.setMusic(null);
    s.innerHTML = `<div class="pl-sheet-card" role="dialog"><button class="pl-close" aria-label="Chiudi">×</button>${html}</div>`;
    s.hidden = false; this.api.closeBalloon();
    s.querySelector('.pl-close')!.addEventListener('click', () => { s.hidden = true; this.setBarOn(this.visiting ? '' : 'home'); this.api.setMusic(null); onClose?.(); });
    return s;
  }
  closeSheet() { const s = this.root.querySelector<HTMLDivElement>('.pl-sheet'); if (s) s.hidden = true; this.api.setCloset(false); this.api.setMusic(null); }
  openTab(id: string) {
    this.setBarOn(id);
    if (id === 'home') { this.closeSheet(); return; }
    if (id === 'menu') return this.openMenu();
    if (id === 'page') return this.openPage();
    if (id === 'shop') return this.openShopTop();
    if (id === 'friends') return this.openFriends();
  }
  private openMenu() {
    const it = (a: string, rel: string, key: string, fb: string, off?: string) => `<button class="pl-mbtn" data-a="${a}" ${off ? `disabled title="${esc(off)}"` : ''}>${esc(lb(rel, key, fb))}</button>`;
    const s = this.sheet(`<h2>${esc(lb(T.tabs, 'title00@menu00', 'Menu'))}</h2><div class="pl-grid">
      ${it('closet', T.menu1, 'title00@changeCloth00', 'Guardaroba')}${it('remake', T.menu1, 'title00@remakeMii00', 'Modifica Mii')}${it('room', T.menu1, 'title00@customRoom00', 'Arreda stanza')}
      ${it('foto', T.menu1, 'title00@miiPhoto00', 'Miifoto', MF.miifotoAvailable() ? undefined : 'Servono i file Miifoto del CDN (archCamera)')}${it('greet', T.menu4, 'title00@greeting00', 'Saluti')}${it('config', T.menu4, 'title00@config00', 'Impostazioni')}
    </div>`);
    s.querySelector('[data-a=closet]')!.addEventListener('click', () => this.openCloset());
    s.querySelector('[data-a=remake]')!.addEventListener('click', () => this.openRemake());
    s.querySelector('[data-a=room]')!.addEventListener('click', () => this.openCustomRoom());
    s.querySelector('[data-a=config]')!.addEventListener('click', () => this.openSettings());
    s.querySelector('[data-a=foto]')!.addEventListener('click', () => this.openMiifoto());
    s.querySelector('[data-a=greet]')!.addEventListener('click', () => this.openGreetings());
  }
  private openPage() {
    const p = this.save.profile;
    const bd = p.birthday ? `${p.birthday.day}/${p.birthday.month}` : '—';
    this.sheet(`<h2>${esc(lb(T.tabs, 'title00@answer00', 'La mia pagina'))}</h2>
      <div class="pl-profile"><div class="pl-name">${esc(p.name)}</div><dl><dt>Compleanno</dt><dd>${esc(bd)}</dd><dt>Risposte</dt><dd>${this.save.answers.length}</dd><dt>Avvii</dt><dd>${this.save.progress.launches}</dd></dl></div>`);
  }
  /**
   * Guardaroba (M17 rebuild): the original closet tabs (CLOSET_TABS, closet_icon_data.xml), icon-only like the original.
   * Per worn item: colour chips + "n/m" counter (colorchipChangeBtn00), Togli / Rimetti (clothTakeOffBtn00),
   * Dentro / Fuori for tops that have a tucked variant (changeClothBtn00; tuck flag REVERSED, see Wardrobe.ts),
   * ★ Preferito (mycoordinateBtn00) saves the outfit in the favourites tab; "Vuoto." for an empty tab (shop/text00).
   */
  private closetTab: ClosetTab = 'tops';
  /** Closet sort (cmnSectionBtn00 shop_closet_new / shop_closet_old) by the VERIFIED delivery dates; default "Nuovo" DEDUCED. */
  private closetSort: 'new' | 'old' = 'new';
  private takenOff: Partial<Record<Category, { id: string; color: number }>> = {};
  async openCloset(tab: ClosetTab | Category = this.closetTab) {
    if (this.visiting) return;   // a friend's outfit is never edited from their room
    const t: ClosetTab = (CLOSET_TABS.find((x) => x.id === tab || x.cats.includes(tab as Category))?.id) ?? 'tops';
    this.closetTab = t;
    const items = this.closetItems(t);
    const worn = Object.entries(this.api.outfit).filter(([k, v]) => k !== 'tuck' && v) as [Category, { id: string; color: number }][];
    await this.api.ensureFiles([...items.slice(0, 240).map((i) => thumbKey(i.cat, i.id, this.api.outfit[i.cat]?.id === i.id ? this.api.outfit[i.cat]!.color : 0)), ...worn.map(([c, v]) => itemKey(c, v.id))]);
    this.renderCloset(t);
  }
  /** Items shown in a tab (base 9xxx bodies excluded). recent = newest delivery date first (VERIFIED dates, meaning DEDUCED). */
  private closetItems(t: ClosetTab): { cat: Category; id: string }[] {
    const all = this.api.catalog();
    const list = (c: Category) => (all.get(c) ?? []).filter((i) => !/^9\d{3}/.test(i.id)).map((i) => ({ cat: c, id: i.id }));
    if (t === 'fav') return [];
    if (t === 'recent') {
      const dates = this.api.itemDates();
      return CLOSET_ORDER.flatMap(list).map((i) => ({ ...i, d: dates[`${CAT_DIR[i.cat]}/${i.id}`] ?? '' })).filter((i) => i.d).sort((a, b) => b.d.localeCompare(a.d) || a.id.localeCompare(b.id)).slice(0, 120);
    }
    const dates = this.api.itemDates();
    const d = (i: { cat: Category; id: string }) => dates[`${CAT_DIR[i.cat]}/${i.id}`] ?? '00000000';   // undated = launch set (oldest)
    const sgn = this.closetSort === 'new' ? -1 : 1;
    return CLOSET_TABS.find((x) => x.id === t)!.cats.flatMap(list).sort((a, b) => sgn * d(a).localeCompare(d(b)) || a.id.localeCompare(b.id) * (this.closetSort === 'new' ? -1 : 1));
  }
  private renderCloset(t: ClosetTab) {
    const items = this.closetItems(t);
    const tabs = CLOSET_TABS.map((x) => { const ic = tabIcon(x.icon); return `<button class="pl-ctab icon ${x.id === t ? 'on' : ''}" data-tab="${x.id}" title="${esc(x.name)}" aria-label="${esc(x.name)}">${ic ? `<img src="${ic}" alt="" />` : `<span>${esc(x.name)}</span>`}</button>`; }).join('');
    const SH = 'Layout/shop/parts/layer2/';
    const cell = (i: { cat: Category; id: string }) => {
      const cur = this.api.outfit[i.cat], on = cur?.id === i.id, nm = itemName(i.cat, i.id), th = thumb(i.cat, i.id, on ? cur!.color : 0);
      return `<button class="pl-citem ${on ? 'on' : ''}" data-cat="${i.cat}" data-id="${i.id}" title="${esc(nm.text)}">${th ? `<img src="${th}" alt="" loading="lazy" />` : '<span class="pl-noimg"></span>'}<span class="pl-cname ${nm.original ? '' : 'raw'}">${esc(nm.text)}</span></button>`;
    };
    // worn items of this tab: colours, counter, Togli / Rimetti
    const tabCats = t === 'recent' || t === 'fav' ? [] : CLOSET_TABS.find((x) => x.id === t)!.cats;
    const wornRows = tabCats.map((c) => {
      const cur = this.api.outfit[c], off = this.takenOff[c];
      if (!cur && !off) return '';
      if (!cur) return `<div class="pl-cur"><b class="pl-cur-off">${esc(itemName(c, off!.id).text)}</b><button class="pl-btn ghost small" data-on="${c}">${esc(lb(SH + 'clothTakeOffBtn00.msbt', 'numberText00@clothe', 'Rimetti'))}</button></div>`;
      const sw = colours(c, cur.id);
      const counter = sw.length > 1 ? `<span class="pl-colnum">${cur.color + 1}/${sw.length}</span>` : '';
      return `<div class="pl-cur"><b>${esc(itemName(c, cur.id).text)}</b>${sw.length > 1 ? `<div class="pl-swatches">${sw.map((col, i) => `<button class="pl-sw ${i === cur.color ? 'on' : ''}" data-cc="${c}" data-col="${i}" style="background:${col}" aria-label="Colore ${i + 1}"></button>`).join('')}</div>` : ''}${counter}<button class="pl-btn ghost small" data-off="${c}">${esc(lb(SH + 'clothTakeOffBtn00.msbt', 'numberText00@unclothe', 'Togli'))}</button></div>`;
    }).join('');
    const tuckable = (t === 'tops') && !!this.api.outfit.tops && this.api.canTuck?.();
    const tuck = tuckable ? `<div class="pl-seg pl-tuck" role="radiogroup">${[[true, 'title00@in', 'Dentro'], [false, 'title00@out', 'Fuori']].map(([v, k, fb]) => `<button role="radio" aria-checked="${!!this.api.outfit.tuck === v}" data-tuck="${v}">${esc(lb(SH + 'changeClothBtn00.msbt', k as string, fb as string))}</button>`).join('')}</div>` : '';
    let grid: string;
    if (t === 'fav') {
      const favs = this.save.coordinates;
      grid = favs.length ? favs.map((o, n) => { const ps = (Object.entries(o).filter(([k, v]) => k !== 'tuck' && v) as [Category, { id: string; color: number }][]); return `<div class="pl-fav"><button class="pl-fav-main" data-fav="${n}">${ps.map(([c, v]) => { const th = thumb(c, v.id, v.color); return th ? `<img src="${th}" alt="" title="${esc(itemName(c, v.id).text)}" />` : `<span class="pl-chipname">${esc(itemName(c, v.id).text)}</span>`; }).join('')}</button><button class="pl-btn ghost small" data-unfav="${n}" aria-label="Rimuovi">×</button></div>`; }).join('')
        : `<p class="pl-pre">${esc(clean('Layout/shop/parts/layer1/text00.msbt', 'text00@noHaveCoordinate', 'Non hai ancora impostato un completo.'))}</p>`;
    } else grid = items.map(cell).join('') || `<p>${esc(lb('Layout/shop/parts/layer1/text00.msbt', 'text00@noHave', 'Vuoto.'))}</p>`;
    const s = this.sheet(`<h2>${esc(lb(T.menu1, 'title00@changeCloth00', 'Guardaroba'))}</h2>
      <div class="pl-ctabs icons">${tabs}</div>
      ${wornRows}${tuck}
      ${t !== 'recent' && t !== 'fav' ? `<div class="pl-seg pl-csort" role="radiogroup">${(['new', 'old'] as const).map((k) => `<button role="radio" aria-checked="${this.closetSort === k}" data-sort="${k}">${esc(lb('Layout/common/parts/cmnSectionBtn00.msbt', `title00@shop_closet_${k}`, k === 'new' ? 'Nuovo' : 'Vecchio'))}</button>`).join('')}</div>` : ''}
      <div class="${t === 'fav' ? 'pl-favs' : 'pl-cgrid'}">${grid}</div>
      <div class="pl-actions"><button class="pl-btn ghost small" data-a="star" ${this.save.coordinates.length >= MAX_COORDINATES ? 'disabled' : ''}>★ ${esc(lb(SH + 'mycoordinateBtn00.msbt', 'title00', 'Preferito'))}</button></div>`, () => { this.api.setCloset(false); this.persist(); });
    s.classList.add('closet');
    this.api.setCloset(true);
    this.api.setMusic('bgm_closetSceneInit');   // Sound/Action/bgm.msbt → BGM_CLOSET
    s.querySelectorAll<HTMLButtonElement>('.pl-ctab').forEach((b) => b.addEventListener('click', () => this.openCloset(b.dataset.tab as ClosetTab)));
    const apply = () => { this.save.outfit = structuredClone(this.api.outfit); this.api.rebuild(); this.persist(); this.openCloset(t); };
    s.querySelectorAll<HTMLButtonElement>('.pl-citem').forEach((b) => b.addEventListener('click', () => { const c = b.dataset.cat as Category; delete this.takenOff[c]; this.api.outfit[c] = { id: b.dataset.id!, color: 0 }; apply(); }));
    s.querySelectorAll<HTMLButtonElement>('.pl-sw').forEach((b) => b.addEventListener('click', () => { const c = b.dataset.cc as Category; if (this.api.outfit[c]) this.api.outfit[c]!.color = Number(b.dataset.col); apply(); }));
    s.querySelectorAll<HTMLButtonElement>('[data-off]').forEach((b) => b.addEventListener('click', () => { const c = b.dataset.off as Category; this.takenOff[c] = this.api.outfit[c]; delete this.api.outfit[c]; apply(); }));
    s.querySelectorAll<HTMLButtonElement>('[data-on]').forEach((b) => b.addEventListener('click', () => { const c = b.dataset.on as Category; if (this.takenOff[c]) this.api.outfit[c] = this.takenOff[c]; delete this.takenOff[c]; apply(); }));
    s.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((b) => b.addEventListener('click', () => { this.closetSort = b.dataset.sort as 'new' | 'old'; this.openCloset(t); }));
    s.querySelectorAll<HTMLButtonElement>('[data-tuck]').forEach((b) => b.addEventListener('click', () => { this.api.outfit.tuck = b.dataset.tuck === 'true'; apply(); }));
    s.querySelectorAll<HTMLButtonElement>('[data-fav]').forEach((b) => b.addEventListener('click', () => { const o = this.save.coordinates[Number(b.dataset.fav)]; if (!o) return; Object.keys(this.api.outfit).forEach((k) => delete (this.api.outfit as any)[k]); Object.assign(this.api.outfit, structuredClone(o)); this.takenOff = {}; apply(); }));
    s.querySelectorAll<HTMLButtonElement>('[data-unfav]').forEach((b) => b.addEventListener('click', () => { this.save.coordinates.splice(Number(b.dataset.unfav), 1); this.persist(); this.openCloset('fav'); }));
    s.querySelector('[data-a=star]')!.addEventListener('click', () => {
      const o = structuredClone(this.api.outfit); const k = JSON.stringify(o);
      if (!this.save.coordinates.some((x) => JSON.stringify(x) === k) && this.save.coordinates.length < MAX_COORDINATES) this.save.coordinates.unshift(o);
      this.persist(); this.openCloset('fav');
    });
  }
  /** "Modifica Mii" opens the Mii Studio editor (M17). */
  private openRemake() { this.closeSheet(); this.openMiiStudio(); }

  // ---------------- Mii Studio editor (M17, see play/MiiStudio.ts) ----------------
  private ms: { ci: Uint8Array; orig: Uint8Array; hist: Uint8Array[]; fut: Uint8Array[]; cat: string; seg: 'parts' | 'color' | 'pos'; err: string; name: string; birthday: SaveData['profile']['birthday']; h: number | null; b: number | null } | null = null;
  openMiiStudio() {
    const ci = this.api.charInfo();
    if (!ci) { this.startRoom(); return; }
    const p = this.save.profile;
    this.ms = { ci, orig: new Uint8Array(ci), hist: [], fut: [], cat: 'face', seg: 'parts', err: '', name: p.name, birthday: p.birthday ? { ...p.birthday } : null, h: p.height, b: p.build };
    this.screen = 'miiStudio';
    this.api.closeBalloon(); this.api.setCloset(false);
    this.api.setScene('lab');
    this.api.setMusic('bgm_miiStudioSceneInit');   // → BGM_MIISTUDIO
    this.api.setEditView('head');
    this.msRender();
  }
  private msApply(next: Uint8Array) {
    const m = this.ms!; const r = this.api.verifyMii(next);
    if (r !== 0) { m.err = `FFL ha rifiutato questa combinazione (codice ${r}).`; this.msRender(); return false; }
    m.hist.push(m.ci); if (m.hist.length > 100) m.hist.shift(); m.fut = []; m.ci = next; m.err = '';
    this.api.setMii(next, m.h, m.b); this.msRender(); return true;
  }
  private msRender() {
    const m = this.ms!; const M = MS; const MSL = 'Layout/miiStudio/parts/layer2/';
    const ui = (f: string) => sprite('ui', f, M.MS_DIR)?.url ?? null;
    const part = (pre: string, id: number) => sprite('miiparts', M.iconName(pre, id), M.MS_DIR)?.url ?? null;
    const chip = (pre: string, id: number) => sprite('colors', M.chipName(pre, id), M.MS_DIR)?.url ?? null;
    const cat = M.CATEGORIES.find((c) => c.id === m.cat);
    const isProfile = m.cat === 'profile';
    const segs: ['parts' | 'color' | 'pos', string, string][] = [['parts', 'title00@parts', 'Elementi'], ['color', 'title00@color', 'Colore'], ['pos', 'title00@edit', 'Posizione']];
    const avail = (k: string) => !cat ? false : k === 'parts' ? cat.parts.length > 0 || !!cat.physique : k === 'color' ? !!cat.color : cat.pos.length > 0;
    if (cat && !avail(m.seg)) m.seg = avail('parts') ? 'parts' : avail('color') ? 'color' : 'pos';
    let body = '';
    if (isProfile) {
      const g = M.get(m.ci, 'gender'), fav = M.get(m.ci, 'favoriteColor');
      const months = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${m.birthday?.month === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('');
      const days = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${m.birthday?.day === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('');
      body = `<label class="pl-field">${esc(lb('Layout/miiStudio/parts/layer1/profileNameEdit00.msbt', 'nickname00@profile', 'Nickname'))}<input class="pl-input" data-ms="name" maxlength="10" value="${esc(m.name)}" placeholder="${esc(clean('Layout/miiStudio/parts/layer1/profileNameEdit00.msbt', 'placeHolder00@nickname', '* Fino a 10 caratteri'))}" /></label>
        <div class="pl-seg" role="radiogroup">${[[0, 'Layout/miiStudio/parts/layer1/maleBtn00.msbt', 'title00@male', 'Maschio'], [1, 'Layout/miiStudio/parts/layer1/femaleBtn00.msbt', 'title00@female', 'Femmina']].map(([v, r, k, fb]) => `<button role="radio" aria-checked="${g === v}" data-gender="${v}">${esc(lb(r as string, k as string, fb as string))}</button>`).join('')}</div>
        <div class="pl-row"><label>${esc(lb(T.bbtn, 'place_left@birthMonth', 'Mese'))}<select data-ms="m"><option value=""></option>${months}</select></label><label>${esc(lb(T.bbtn, 'place_center@birthDay', 'Giorno'))}<select data-ms="d"><option value=""></option>${days}</select></label></div>
        <h4>${esc(lb('Layout/miiStudio/parts/layer1/profileColorEdit00.msbt', 'title00@color', 'Colore'))}</h4>
        <div class="ms-chips">${M.FAVORITE_IDS.map((i) => { const u = chip('favoriteColor', i); return `<button class="ms-chip ${fav === i ? 'on' : ''}" data-set="favoriteColor" data-v="${i}" aria-label="Colore ${i + 1}">${u ? `<img src="${u}" alt="" />` : i}</button>`; }).join('')}</div>
        <div class="pl-actions wrap"><button class="pl-btn ghost" data-a="pers">Personalità</button><button class="pl-btn ghost" data-a="voice">Voce</button><button class="pl-btn ghost" data-a="new">Nuovo Mii…</button></div>`;
    } else if (cat?.physique) {
      const row = (f: 'height' | 'build', lab: string) => `<label class="pl-field">${lab}<input type="range" min="0" max="127" data-phys="${f}" value="${M.get(m.ci, f)}" /></label>`;
      body = row('height', 'Altezza') + row('build', 'Corporatura') + '<p class="pl-small">Altezza e corporatura del Mii (FFLiCharInfo); il corpo usa la scala di Miitomo (M6).</p>';
    } else if (cat && m.seg === 'parts') {
      body = cat.parts.map((g) => { const cur = M.get(m.ci, g.field); return `<div class="ms-grid">${g.ids.map((id) => { const u = part(g.icon, id); return `<button class="ms-part ${cur === id ? 'on' : ''}" data-set="${g.field}" data-v="${id}" aria-label="${id}">${u ? `<img src="${u}" alt="" loading="lazy" />` : `<span>${id}</span>`}</button>`; }).join('')}</div>`; }).join('<hr class="ms-sep" />');
      if (cat.flip) { const fl = M.get(m.ci, 'hairFlip'); const u = ui('hairInvertIcon00.png'); body = `<button class="pl-btn ghost small ms-flip ${fl ? 'on' : ''}" data-set="hairFlip" data-v="${fl ? 0 : 1}" aria-pressed="${!!fl}">${u ? `<img src="${u}" alt="" />` : ''} Inverti</button>` + body; }
    } else if (cat && m.seg === 'color' && cat.color) {
      const c = cat.color, cur = M.get(m.ci, c.field);
      body = `<div class="ms-chips">${c.ids.map((id) => { const u = chip(c.chip, id); return `<button class="ms-chip ${cur === id ? 'on' : ''}" data-set="${c.field}" data-v="${id}" aria-label="Colore ${id + 1}">${u ? `<img src="${u}" alt="" />` : id}</button>`; }).join('')}</div>`;
    } else if (cat && m.seg === 'pos') {
      body = cat.pos.map((pc) => { const v = M.get(m.ci, pc.field), [lo, hi] = M.RANGE[pc.field]!; return `<div class="ms-pos"><span>${esc(pc.label)}</span><button class="pl-btn ghost small" data-step="${pc.field}" data-d="${pc.invert ? 1 : -1}" ${v <= lo && !pc.invert || v >= hi && pc.invert ? 'disabled' : ''}>${pc.invert ? '▼' : '−'}</button><b>${v}</b><button class="pl-btn ghost small" data-step="${pc.field}" data-d="${pc.invert ? -1 : 1}" ${v >= hi && !pc.invert || v <= lo && pc.invert ? 'disabled' : ''}>${pc.invert ? '▲' : '+'}</button></div>`; }).join('');
    }
    const cats = [...M.CATEGORIES.map((c) => { const u = ui(c.button); return `<button class="ms-cat ${c.id === m.cat ? 'on' : ''}" data-cat="${c.id}" title="${esc(c.name)}" aria-label="${esc(c.name)}">${u ? `<img src="${u}" alt="" />` : esc(c.name)}</button>`; }),
      `<button class="ms-cat txt ${isProfile ? 'on' : ''}" data-cat="profile" title="Profilo">${esc(lb('Layout/room/parts/layer1/menuBtn05.msbt', 'title00@profile00:v2_2', 'Profilo'))}</button>`].join('');
    const undo = ui('undoRedoBtnOn00.png');
    this.root.innerHTML = `<section class="pl-screen pl-studio"><aside class="ms-panel" role="dialog" aria-label="Modifica Mii">
      <header class="ms-head"><h2>${esc(lb(T.menu1, 'title00@remakeMii00', 'Modifica Mii'))}</h2>
        <button class="pl-btn ghost small ms-undo" data-a="undo" ${m.hist.length ? '' : 'disabled'} aria-label="Annulla modifica">${undo ? `<img src="${undo}" alt="" />` : '↶'}</button><button class="pl-btn ghost small ms-redo" data-a="redo" ${m.fut.length ? '' : 'disabled'} aria-label="Ripeti">${undo ? `<img src="${undo}" alt="" />` : '↷'}</button>
        <button class="pl-btn ghost small" data-a="reset">${esc(lb(MSL + 'resetBtn00.msbt', 'title00@reset', 'Azzera'))}</button></header>
      <nav class="ms-cats">${cats}</nav>
      ${!isProfile && cat && !cat.physique ? `<div class="pl-seg ms-segs" role="tablist">${segs.map(([k, key, fb]) => `<button role="tab" aria-selected="${m.seg === k}" data-seg="${k}" ${avail(k) ? '' : 'disabled'}>${esc(lb(MSL + 'segment3BtnC01.msbt', key, fb))}</button>`).join('')}</div>` : ''}
      <div class="ms-body">${body}</div>
      ${m.err ? `<p class="pl-err">${esc(m.err)}</p>` : ''}
      <div class="pl-actions"><button class="pl-btn ghost" data-a="cancel">${esc(lb(CB, 'title00@cancel', 'Annulla'))}</button><button class="pl-btn primary" data-a="ok">${esc(lb(CB, 'title00@ok', 'OK'))}</button></div>
    </aside></section>`;
    const q = <T extends Element>(sel: string) => this.root.querySelectorAll<T & HTMLElement>(sel);
    q('[data-cat]').forEach((b) => b.addEventListener('click', () => { m.cat = b.dataset.cat!; this.api.setEditView(m.cat === 'physique' || m.cat === 'profile' ? 'full' : 'head'); this.msRender(); }));
    q('[data-seg]').forEach((b) => b.addEventListener('click', () => { m.seg = b.dataset.seg as typeof m.seg; this.msRender(); }));
    q('[data-set]').forEach((b) => b.addEventListener('click', () => this.msApply(M.set(m.ci, b.dataset.set as Field, Number(b.dataset.v)))));
    q('[data-step]').forEach((b) => b.addEventListener('click', () => { const f = b.dataset.step as Field; const [lo, hi] = M.RANGE[f]!; const v = Math.min(hi, Math.max(lo, M.get(m.ci, f) + Number(b.dataset.d))); this.msApply(M.set(m.ci, f, v)); }));
    q<HTMLInputElement>('[data-phys]').forEach((i) => i.addEventListener('change', () => { const f = i.dataset.phys as 'height' | 'build'; if (f === 'height') m.h = Number(i.value); else m.b = Number(i.value); this.msApply(M.set(m.ci, f, Number(i.value))); }));
    q('[data-gender]').forEach((b) => b.addEventListener('click', () => this.msApply(M.set(m.ci, 'gender', Number(b.dataset.gender)))));
    q<HTMLInputElement>('[data-ms=name]').forEach((i) => i.addEventListener('change', () => { m.name = i.value.trim().slice(0, 10); }));
    q<HTMLSelectElement>('[data-ms=m],[data-ms=d]').forEach((sl) => sl.addEventListener('change', () => { const mm = Number(this.root.querySelector<HTMLSelectElement>('[data-ms=m]')!.value), dd = Number(this.root.querySelector<HTMLSelectElement>('[data-ms=d]')!.value); m.birthday = mm && dd && dd <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1] ? { month: mm, day: dd } : m.birthday; }));
    this.on('undo', () => { const p = m.hist.pop(); if (!p) return; m.fut.push(m.ci); m.ci = p; this.api.setMii(p, m.h, m.b); this.msRender(); });
    this.on('redo', () => { const n = m.fut.pop(); if (!n) return; m.hist.push(m.ci); m.ci = n; this.api.setMii(n, m.h, m.b); this.msRender(); });
    this.on('reset', () => { if (this.msApply(new Uint8Array(m.orig))) { m.h = this.save.profile.height; m.b = this.save.profile.build; } });
    this.on('cancel', () => { this.ms = null; this.api.setEditView(null); this.startRoom(); });
    this.on('pers', () => { this.msSave(false).then(() => { this.api.setEditView(null); this.showPersonality(false); }); });
    this.on('voice', () => { this.msSave(false).then(() => { this.api.setEditView(null); this.startRoom(); this.openVoice(); }); });
    this.on('new', () => { this.ms = null; this.api.setEditView(null); this.root.innerHTML = ''; this.pending = null; this.showCreate(); });
    this.on('ok', () => { this.msSave(true); });
  }
  private async msSave(back: boolean) {
    const m = this.ms!; const p = this.save.profile;
    const name = (this.root.querySelector<HTMLInputElement>('[data-ms=name]')?.value.trim() ?? m.name).slice(0, 10) || m.name || p.name;
    let ci = M_setName(m.ci, name);
    if (m.birthday) { ci = MS.set(MS.set(ci, 'birthMonth', m.birthday.month), 'birthDay', m.birthday.day); }
    if (this.api.verifyMii(ci) !== 0) ci = m.ci;   // name / birthday are kept in the profile anyway
    p.miiData = b64.enc(ci); p.name = name; p.birthday = m.birthday; p.height = m.h; p.build = m.b;
    await this.persist();
    this.ms = null;
    if (back) { this.api.setEditView(null); this.startRoom(); }
  }

  /**
   * Personality (Mii Studio "characterParam"): five axes with eight levels, original labels and level descriptions
   * (radarChart00 / radarchartBalloon00). The type the game derives from them (Personality.ts, REVERSED) picks the
   * gestures / faces. The game's own result texts (mc_* attributes) are not in the user's files: only the internal
   * type name is shown, marked as such. The radar chart drawing is replaced by sliders (APPROXIMATED UI).
   */
  showPersonality(creating: boolean) {
    this.screen = 'personality';
    const lv = [...(this.prof.personality ?? DEFAULT_LEVELS)];
    const row = (a: number) => `<label class="pl-field pl-axis">${esc(lb(RADAR, AXIS_LABEL[a], AXIS_FALLBACK[a]))}
      <input type="range" min="1" max="8" step="1" data-ax="${a}" value="${lv[a]}" /><span class="pl-lv" data-lv="${a}"></span></label>`;
    this.root.innerHTML = `<section class="pl-screen pl-side"><div class="pl-panel">
      <h2>Personalità</h2>
      ${[0, 1, 2, 3, 4].map(row).join('')}
      <div class="pl-ptype" data-a="type"></div>
      <div class="pl-actions"><button class="pl-btn ghost" data-a="preset">Casuale</button><button class="pl-btn primary" data-a="ok">${esc(lb('Layout/miiStudio/parts/layer1/profileNextBtn00.msbt', 'title00@next', 'Avanti'))}</button></div>
    </div></section>`;
    const upd = () => {
      for (let a = 0; a < 5; a++) this.root.querySelector(`[data-lv="${a}"]`)!.textContent = lb(BALLOON, levelLabel(a, lv[a]), String(lv[a]));
      this.root.querySelector('[data-a=type]')!.innerHTML = this.personalityHtml(lv);
      this.api.setMusic(`bgm_miiStudioConfirmCharacter${PERSONALITIES[personalityType(lv)]}`);
      this.api.setPersonality(lv);
    };
    this.root.querySelectorAll<HTMLInputElement>('[data-ax]').forEach((i) => i.addEventListener('input', () => { lv[Number(i.dataset.ax)] = Number(i.value); upd(); }));
    this.on('preset', () => {
      const p = PRESETS[Math.floor(Math.random() * PRESETS.length)];
      p.forEach((v, a) => { lv[a] = v; this.root.querySelector<HTMLInputElement>(`[data-ax="${a}"]`)!.value = String(v); }); upd();
    });
    this.on('ok', async () => {
      this.prof.personality = [...lv];
      if (this.makingFriend) return this.finishFriend();
      await this.persist(); this.root.innerHTML = ''; this.startRoom();
    });
    void creating;
    upd();
  }
  /** Original personality result (characterInfo00 / characterInfoTitle00): group, type name, first impression, description. */
  private personalityHtml(lv: number[] | null) {
    const L = personalityLabels(lv);
    const t = (x: { rel: string; key: string }, fb: string) => esc(clean(x.rel, x.key, fb)).replace(/\n/g, '<br>');
    return `<div class="pl-ptype-head"><span class="pl-ptype-group">${t(L.group, PERSONALITIES[personalityType(lv)])}</span><b class="pl-ptype-name" data-pidx="${L.index}">${t(L.name, '—')}</b></div><p class="pl-ptype-short">${t(L.short, '')}</p><p class="pl-ptype-long">${t(L.long, '')}</p>`;
  }
  private async openCustomRoom(kind: 'wall' | 'floor' = 'wall') {
    const sk = this.api.roomSkins();
    const ids = kind === 'wall' ? sk.walls : sk.floors;
    await this.api.ensureFiles(ids.flatMap((id) => Array.from({ length: Math.max(1, kind === 'wall' ? skinVariantCount(kind, id) : 1) }, (_, v) => skinThumbKey(kind, id, v))));
    this.renderCustomRoom(kind);
  }
  private renderCustomRoom(kind: 'wall' | 'floor' = 'wall') {
    const sk = this.api.roomSkins(), r = this.save.room;
    const ids = kind === 'wall' ? sk.walls : sk.floors;
    const cells = ids.flatMap((id) => {
      const n = kind === 'wall' ? skinVariantCount(kind, id) || this.api.skinVariants(kind, id) : 1;   // floors: the room build applies one variant to both skins; count from thumbnail names
      return Array.from({ length: n }, (_, v) => {
        const on = (kind === 'wall' ? r.wall === id && r.variant === v : r.floor === id && v === 0);
        const nm = skinName(kind, id, v), th = skinThumb(kind, id, v);
        return `<button class="pl-citem ${on ? 'on' : ''}" data-id="${id}" data-v="${v}" title="${esc(nm.text)}">${th ? `<img src="${th}" alt="" loading="lazy" />` : '<span class="pl-noimg"></span>'}<span class="pl-cname ${nm.original ? '' : 'raw'}">${esc(nm.text)}</span></button>`;
      });
    }).join('');
    const s = this.sheet(`<h2>${esc(lb(T.menu1, 'title00@customRoom00', 'Arreda stanza'))}</h2>
      <div class="pl-ctabs"><button class="pl-ctab ${kind === 'wall' ? 'on' : ''}" data-k="wall"><span>Tappezzeria</span></button><button class="pl-ctab ${kind === 'floor' ? 'on' : ''}" data-k="floor"><span>Pavimento</span></button></div>
      <div class="pl-cgrid">${cells || '<p>Nessun pacchetto importato.</p>'}</div>`);
    this.api.setMusic('bgm_CustomRoomScene');   // → BGM_ROOM_CUSTOM
    s.classList.add('closet');
    s.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.addEventListener('click', () => this.openCustomRoom(b.dataset.k as 'wall' | 'floor')));
    s.querySelectorAll<HTMLButtonElement>('.pl-citem').forEach((b) => b.addEventListener('click', async () => {
      if (kind === 'wall') { r.wall = b.dataset.id!; r.variant = Number(b.dataset.v); } else r.floor = b.dataset.id!;
      this.api.setRoom(r.wall, r.floor, r.variant); await this.persist(); this.openCustomRoom(kind);
    }));
  }
  /** "Saluti": the Mii's own greetings (Layout/room greeting00 labels, defaults = MiiCommonText default* lines). */
  private openGreetings() {
    const g = this.save.profile.greetings, G = 'Layout/room/parts/layer1/greeting00.msbt', C = 'System/MiiCommonText.msbt';
    const row = (k: keyof typeof g, lab: string, fbLab: string, def: string) => `<label class="pl-field">${esc(lb(G, lab, fbLab))}<input class="pl-input small" data-g="${k}" maxlength="30" value="${esc(g[k])}" placeholder="${esc(clean(C, def, ''))}" /></label>`;
    const s = this.sheet(`<h2>${esc(lb(T.menu4, 'title00@greeting00', 'Saluti'))}</h2>
      ${row('welcome', 'title00@greetingWelcome', 'Saluto (arriva un amico)', 'defaultGreetingWelcome')}${row('goIn', 'title00@greetingGoIn', 'Saluto (fai visita a un amico)', 'defaultGreetingGoIn')}
      ${row('seeingOff', 'title00@goodByeSeeingOff', "Saluto (l'amico va via)", 'defaultGoodByeSeeingOff')}${row('goHome', 'title00@goodByeGoHome', 'Saluto (sei tu che vai via)', 'defaultGoodByeGoHome')}
      <div class="pl-actions"><button class="pl-btn primary" data-a="gsave">Salva</button></div>`);
    s.querySelector('[data-a=gsave]')!.addEventListener('click', async () => {
      s.querySelectorAll<HTMLInputElement>('[data-g]').forEach((i) => { g[i.dataset.g as keyof typeof g] = i.value.trim().slice(0, 30); });
      this.api.setGreetings(g); await this.persist(); this.closeSheet();
      this.api.showBalloon('Scene/RoomSceneTalkWords.msbt', 'customGreetingWelcome', g.welcome || 'Ciao!', 2.6);   // preview: the Mii says its welcome greeting
    });
  }
  /** Voice providers, with their classification spelled out: the browser TTS is never presented as the original voice. */
  private voiceChoices() {
    const vs = this.api.voiceStatus(), cur = this.save.settings.voice;
    const tag = (c: string) => c === 'ORIGINAL' ? 'originale' : c === 'APPROXIMATED_NON_ORIGINAL_TTS' ? 'NON originale · approssimata' : '';
    const opt = (id: string, label: string, cls: string, why: string | null) => `<label class="pl-voice ${why ? 'off' : ''}"><input type="radio" name="voice" value="${id}" ${cur === id ? 'checked' : ''} ${why ? 'disabled' : ''}/>
      <span><b>${esc(label)}</b>${tag(cls) ? ` <em class="pl-tag ${cls === 'ORIGINAL' ? 'orig' : 'approx'}">${esc(tag(cls))}</em>` : ''}${why ? `<small>${esc(why)}</small>` : ''}</span></label>`;
    return `<div class="pl-voices">${opt('auto', 'Automatica', '', null)}${vs.providers.map((p) => opt(p.id, p.label, p.classification, p.unavailable)).join('')}</div>
      <p class="pl-small" data-a="vact">In uso: <b>${esc(vs.active.label)}</b>${vs.active.classification === 'APPROXIMATED_NON_ORIGINAL_TTS' ? ' — voce sintetica del sistema, <b>non</b> la voce originale di Miitomo.' : ''}</p>`;
  }
  /** Mii Studio voice radar (voiceParam): original axis labels (radarChart00 voice00–04); the value scale is APPROXIMATED. */
  private openVoice() {
    const v = this.save.profile.voice;
    const keys: (keyof typeof v)[] = ['pitch', 'speed', 'accent', 'energy', 'depth'];
    const fb = ['Altezza', 'Velocità', 'Accento', 'Energia', 'Profondità'];
    const s = this.sheet(`<h2>${esc(lb('Layout/miiStudio/parts/layer1/profileVoiceEdit00.msbt', 'text00@profile', 'Voce'))}</h2>
      ${keys.map((k, i) => `<label class="pl-field">${esc(lb(RADAR, `chartLabel0${i}@voice0${i}`, fb[i]))}<input type="range" min="0" max="100" data-v="${k}" value="${v[k]}" /></label>`).join('')}
      <p class="pl-small">${esc(this.api.voiceStatus().active.classification === 'APPROXIMATED_NON_ORIGINAL_TTS' ? 'Anteprima con la voce sintetica del sistema (non originale).' : 'Nessuna voce disponibile: i valori vengono comunque salvati.')}</p>
      <div class="pl-actions"><button class="pl-btn ghost" data-a="try">Prova</button><button class="pl-btn primary" data-a="ok">Salva</button></div>`);
    const read = () => s.querySelectorAll<HTMLInputElement>('[data-v]').forEach((i) => { v[i.dataset.v as keyof typeof v] = Number(i.value); });
    s.querySelector('[data-a=try]')!.addEventListener('click', () => { read(); this.api.setVoice(this.save.settings.voice, v); this.api.showBalloon('System/MiiCommonText.msbt', 'defaultGreetingWelcome', 'Ciao!', 2.5); });
    s.querySelector('[data-a=ok]')!.addEventListener('click', async () => { read(); this.api.setVoice(this.save.settings.voice, v); await this.persist(); this.closeSheet(); });
  }
  /**
   * "Sai, di recente…" (room touch menu, balloonTextBtn02 balloonMenuL): the Mii reports friends' recent answers
   * (KnowledgeHead lead-ins + server answers). Flow kept: loading (loadingText00) → provider → original empty state
   * (Layout/knowledge/parts/layer1/knowledgeNothing text00 "Non ci sono ancora risposte di amici.") with an explicit
   * SERVER DATA MISSING label; a provider error shows the original communication error (System/Error 1450).
   * Nothing is invented: no question, no answer.
   */
  async openRecent() {
    const title = lb('Layout/room/parts/layer2/balloonTextBtn02.msbt', 'title00@balloonMenuL', 'Sai, di recente...');
    const s = this.sheet(`<h2>${esc(title)}</h2><div class="pl-recent" data-state="loading" aria-live="polite"><p class="pl-loading-text">${esc(lb(T.loading, 'loadingText', 'Caricamento'))}…</p></div>`);
    const box = s.querySelector<HTMLElement>('.pl-recent')!;
    let html = '', state = '';
    try {
      const [r] = await Promise.all([this.social.recentAnswers(), sleep(500)]);
      if (r.status === 'server-data-missing' || !r.items.length) {
        state = 'server-data-missing';
        html = `<p class="pl-pre">${esc(clean('Layout/knowledge/parts/layer1/knowledgeNothing.msbt', 'text00', 'Non ci sono ancora risposte di amici.'))}</p>
          <p><em class="pl-tag missing">SERVER DATA MISSING</em></p>
          <p class="pl-small">Questa funzione esiste: il tuo Mii ti raccontava le risposte recenti dei tuoi amici. Quelle risposte erano conservate sul server di Miitomo, chiuso nel 2018, e non sono state preservate. Arriveranno con il server di Miitomo Web.</p>`;
      } else { state = 'ok'; html = ''; }
    } catch {
      state = 'error';
      html = `<p class="pl-pre">${esc(clean('System/Error.msbt', '1450', 'Si è verificato un errore di comunicazione.'))}</p><p><em class="pl-tag missing">SERVER NON DISPONIBILE</em></p>`;
    }
    if (!box.isConnected) return;
    box.dataset.state = state; box.innerHTML = html;
  }

  // ---------------- M18: friends visiting the user's room ----------------
  /**
   * Who visits and when was decided by the server in the original (no client data): here a local friend comes by
   * now and then while the user is in its own room — APPROXIMATED schedule: first visit 25–70 s after entering the room,
   * a visit lasts 70–140 s, the same friend comes back after 10 minutes at the earliest. The arrival telop is original
   * (Layout/system telopWindow00 comeFriend "{1.0} è qui!").
   */
  private guestTimers: number[] = [];
  private guestLast = new Map<string, number>();
  autoGuests = !(typeof navigator !== 'undefined' && navigator.webdriver);   // automated tests drive visits with inviteGuest()
  private clearGuestTimers() { for (const t of this.guestTimers) clearTimeout(t); this.guestTimers = []; }
  private scheduleGuest() {
    this.clearGuestTimers();
    if (!this.autoGuests) return;
    const wait = (25 + Math.random() * 45) * 1000;
    this.guestTimers.push(window.setTimeout(async () => {
      if (this.screen !== 'room' || this.visiting || this.api.guestState()) return;
      const now = Date.now();
      const list = (await this.social.list().catch(() => [] as FriendProfile[])).filter((f) => now - (this.guestLast.get(f.id) ?? 0) > 600_000);
      if (!list.length) return;
      await this.inviteGuest(list[Math.floor(Math.random() * list.length)].id, (70 + Math.random() * 70) * 1000);
    }, wait));
  }
  /** Starts a visit of a local friend (tests / schedule). `stayMs` > 0 makes it leave by itself. */
  async inviteGuest(id: string, stayMs = 0, opts?: { inside?: { x: number; z: number } }) {
    const f = await this.social.get(id); if (!f || !f.profile.miiData) return false;
    const p = f.profile;
    const ok = await this.api.guestArrive({ id: f.id, name: p.name, miiData: b64.dec(p.miiData!), outfit: structuredClone(f.outfit), height: p.height, build: p.build, personality: p.personality, greetings: p.greetings, voice: p.voice }, opts);
    if (!ok) return false;
    this.guestLast.set(f.id, Date.now());
    if (stayMs > 0) this.guestTimers.push(window.setTimeout(() => { if (this.api.guestState(f.id)) this.api.guestLeave(f.id); }, stayMs));
    return true;
  }
  private onGuest(e: { type: 'arrive' | 'leave'; id: string; name: string }) {
    if (e.type === 'arrive') this.telop(line('Layout/system/body/telopWindow00.msbt', 'text00@comeFriend'), [e.name], `${e.name} è qui!`);
    if (e.type === 'leave' && this.screen === 'room') this.scheduleGuest();
  }
  /** Top telop (telopWindow00): original text with Mii names, 3.2 s (duration APPROXIMATED). */
  private telop(l: ReturnType<typeof line>, names: string[], fb: string) {
    const text = l ? render(l.nodes, { nickname: names[0] ?? '', female: false, names }).pages.map((pg) => pg.spans.map((x) => x.text).join('')).join(' ').trim() : fb;
    let t = this.root.querySelector<HTMLElement>('.pl-telop');
    if (!t) { t = document.createElement('div'); t.className = 'pl-telop'; t.setAttribute('role', 'status'); this.root.append(t); }
    t.textContent = text; t.hidden = false;
    t.classList.remove('in'); void t.offsetWidth; t.classList.add('in');
    window.setTimeout(() => { if (t) t.hidden = true; }, 3200);
  }

  // ---------------- friends (M16: local friends now, our own server later — see social/Social.ts) ----------------
  private friendsCache: FriendProfile[] = [];
  /** Lista di amici: original titles; "add" creates a local friend profile (no requests / codes: server-only). */
  async openFriends() {
    let list: FriendProfile[] = [];
    try { list = await this.social.list(); } catch (e) { console.warn(e); }
    this.friendsCache = list;
    const why = this.social.unavailable;
    const count = (() => { const l = line(CS, 'title00@friend'); return l ? render(l.nodes, { nickname: '', female: false }).pages.map((pg) => pg.spans.map((x) => x.text).join('')).join('').trim() + ' ' + list.length : `Amici: ${list.length}`; })();
    const bd = (f: FriendProfile) => f.profile.birthday ? `${f.profile.birthday.day}/${f.profile.birthday.month}` : '';
    const s = this.sheet(`<h2>${esc(lb(CS, 'title00@roomUserFriendList', 'Lista di amici'))}</h2>
      <p class="pl-fcount" data-a="count">${esc(count)}</p>
      <div class="pl-friends">${list.map((f) => `<div class="pl-friend" data-id="${f.id}"><button class="pl-friend-main" data-visit="${f.id}"><b>${esc(f.profile.name)}</b>${bd(f) ? `<small>${esc(bd(f))}</small>` : ''}</button><button class="pl-btn ghost small" data-del="${f.id}">${esc(lb(ML, 'title00@deleteFriend', 'Cancella amico'))}</button></div>`).join('')}</div>
      <div class="pl-actions"><button class="pl-btn primary" data-a="addfriend" ${why ? 'disabled' : ''}>${esc(lb(CS, 'title00@addfriendtopmenu00', 'Aggiungi/invita amico'))}</button></div>
      <p class="pl-small">${esc(why ?? 'Amici locali: profili Mii creati su questo dispositivo. Richieste di amicizia, codici amico, inviti e risposte degli amici erano dati del server Miitomo e arriveranno con il server di Miitomo Web.')}</p>
      <div class="pl-confirm" hidden></div>`);
    s.querySelector('[data-a=addfriend]')!.addEventListener('click', () => this.startFriendCreate());
    s.querySelectorAll<HTMLButtonElement>('[data-visit]').forEach((b) => b.addEventListener('click', () => {
      const f = list.find((x) => x.id === b.dataset.visit)!;
      this.confirm(s, line(D2, 'text00@goToMiiRoom'), [f.profile.name], `Vuoi visitare la stanza di ${f.profile.name}?`, () => this.visitFriend(f));
    }));
    s.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', () => {
      const f = list.find((x) => x.id === b.dataset.del)!;
      this.confirm(s, line('Layout/system/parts/layer1/dialog205.msbt', 'text00@confirmDeleteFriend'), [f.profile.name], 'Vuoi davvero cancellare questo amico?', async () => { await this.social.remove(f.id); this.openFriends(); });
    }));
  }
  /** In-page confirmation (the viewer has no native dialogs): original dialog text + original Sì / No buttons. */
  private confirm(host: HTMLElement, l: ReturnType<typeof line>, names: string[], fb: string, yes: () => void) {
    const box = host.querySelector<HTMLElement>('.pl-confirm') ?? (() => { const d = document.createElement('div'); d.className = 'pl-confirm'; host.querySelector('.pl-sheet-card, .pl-fbar')?.append(d); return d; })();
    const text = l ? render(l.nodes, { nickname: names[0] ?? '', female: false, names }).pages.map((pg) => pg.spans.map((x) => x.text).join('')).join('\n').trim() : fb;
    box.innerHTML = `<p>${esc(text).replace(/\n/g, '<br>')}</p><div class="pl-actions"><button class="pl-btn ghost" data-c="no">${esc(lb(CB, 'title00@no', 'No'))}</button><button class="pl-btn primary" data-c="yes">${esc(lb(CB, 'title00@yes', 'Sì'))}</button></div>`;
    box.hidden = false;
    box.querySelector('[data-c=no]')!.addEventListener('click', () => { box.hidden = true; });
    box.querySelector('[data-c=yes]')!.addEventListener('click', () => { box.hidden = true; yes(); });
  }
  private startFriendCreate() {
    this.closeSheet(); this.root.innerHTML = '';
    const t = newSave(this.defaults).profile;
    this.makingFriend = t; this.pending = null;
    this.showCreate();
  }
  private async finishFriend() {
    const p = this.makingFriend!; this.makingFriend = null; this.pending = null;
    try { await this.social.add({ profile: p, outfit: structuredClone(this.defaults), room: { wall: '0000', floor: '0000', variant: 0 } }); }
    catch (e) { console.warn(e); }
    this.root.innerHTML = '';
    this.startRoom(true);
    this.openFriends();
  }
  /** GoToFriendRoom / SequenceWatchFriend: the friend's Mii, outfit, room, personality, voice and greetings. */
  visitFriend(f: FriendProfile) {
    this.closeSheet();
    this.api.guestEnd(); this.clearGuestTimers();
    const p = f.profile;
    this.visiting = f; this.screen = 'friendRoom';
    if (p.miiData) this.api.setMii(b64.dec(p.miiData), p.height, p.build);
    this.api.setNickname(p.name);
    this.api.setGreetings(p.greetings);
    this.api.setPersonality(p.personality);
    this.api.setVoice(this.save.settings.voice, p.voice);
    Object.keys(this.api.outfit).forEach((k) => delete (this.api.outfit as any)[k]);
    Object.assign(this.api.outfit, structuredClone(f.outfit));
    this.api.setRoom(f.room.wall, f.room.floor, f.room.variant);
    this.api.setFriendHost(personalityType(p.personality));
    this.api.enterFresh();
    this.api.setScene('room'); this.api.rebuild();
    this.social.recordVisit(f.id).catch(() => {});
    this.renderFriendBar();
  }
  /** Friend room tabs (RoomTabWindowFriend*: Profilo, Articoli, Risposte, Lista di amici) + back home. */
  private renderFriendBar(open: string | null = null) {
    const f = this.visiting!; if (!f) return;
    this.barOn = open ?? '';
    const TB1 = 'Layout/room/parts/layer1/tabBtn01.msbt';
    // tabBtn01 (friend room): answer01 Risposte, cloth01 Articoli, friendlist01 Amici, information01 Profilo — order of the msbt
    // labels; icons from the RoomMenuRootNode table (cloth01 has no icon of its own there: the shop icon, DEDUCED)
    this.root.innerHTML = `<nav class="pl-nav pl-fbar" aria-label="Stanza dell'amico">
      <span class="pl-fname">${esc(f.profile.name)}</span>
      ${this.barBtn('knowledge', 'page', TB1, 'title00@answer01', 'Risposte', 'data-ftab')}${this.barBtn('cloth', 'shop', TB1, 'title00@cloth01', 'Articoli', 'data-ftab')}${this.barBtn('flist', 'friends', TB1, 'title00@friendlist01', 'Amici', 'data-ftab')}${this.barBtn('profile', 'profile', TB1, 'title00@information01', 'Profilo', 'data-ftab')}
      ${this.barBtn('fhome', 'home', T.tabs, 'title00@home00', 'Home', 'data-a').replace('data-a="fhome"', 'data-a="home"')}
      <div class="pl-confirm" hidden></div>
    </nav><div class="pl-sheet" hidden></div>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-ftab]').forEach((b) => b.addEventListener('click', () => { this.setBarOn(b.dataset.ftab!); this.openFriendTab(b.dataset.ftab!); }));
    this.on('home', () => this.confirm(this.root.querySelector('.pl-fbar')!, line(D2, 'text00@backToMyRoom'), [], 'Vuoi tornare alla tua stanza?', () => this.leaveFriend()));
  }
  private openFriendTab(id: string) {
    const f = this.visiting!; const p = f.profile;
    if (id === 'profile') {
      const bd = p.birthday ? `${p.birthday.day}/${p.birthday.month}` : '—';
      this.sheet(`<h2>${esc(lb(CS, 'title00@roomFriendProfile', 'Profilo'))}</h2><div class="pl-profile"><div class="pl-name">${esc(p.name)}</div><dl><dt>Compleanno</dt><dd>${esc(bd)}</dd><dt>Personalità</dt><dd>${this.personalityHtml(p.personality)}</dd><dt>Visite</dt><dd>${f.visits}</dd></dl></div>
        <p class="pl-small">Amico locale (su questo dispositivo).</p>`);
    }
    if (id === 'cloth') {
      const worn = Object.entries(f.outfit).filter(([, v]) => v) as [Category, { id: string; color: number }][];
      this.api.ensureFiles(worn.map(([c, v]) => thumbKey(c, v.id, v.color))).then(() => {
        this.sheet(`<h2>${esc(lb(CS, 'title00@roomFriendCloth', 'Articoli'))}</h2><div class="pl-cgrid">${worn.map(([c, v]) => { const nm = itemName(c, v.id), th = thumb(c, v.id, v.color); return `<div class="pl-citem" title="${esc(nm.text)}">${th ? `<img src="${th}" alt="" />` : '<span class="pl-noimg"></span>'}<span class="pl-cname ${nm.original ? '' : 'raw'}">${esc(nm.text)}</span></div>`; }).join('') || '<p>—</p>'}</div>
          <p class="pl-small">Gli articoli indossati da ${esc(p.name)}. Si possono provare nel Negozio (catalogo).</p>`);
      });
    }
    if (id === 'knowledge') this.sheet(`<h2>${esc(lb(CS, 'title00@roomFriendKnowledge', 'Risposte'))}</h2><p>Le risposte degli amici erano conservate sul server Miitomo e non sono state preservate. Gli amici locali non hanno ancora risposte.</p>`);
    if (id === 'flist') this.sheet(`<h2>${esc(lb(CS, 'title00@roomFriendFriendList', 'Lista di amici'))}</h2><p>La lista di amici di un amico era un dato del server: non è disponibile per gli amici locali.</p>`);
  }
  /** SequenceByeFriendInFriendRoom: the host says its "Saluto (l'amico va via)" (tag 1.3), then back to the user's room. */
  private leaveFriend() {
    this.closeSheet();
    this.api.showBalloon(T_ROOMW, 'customGreetingSeeingOff', 'Torna presto!', 2.0);
    this.screen = 'leavingFriend';
    setTimeout(() => { if (this.screen === 'leavingFriend') this.startRoom(true); }, 2300);
  }
  get visitingFriend() { return this.visiting; }

  // ---------------- shop (M15: catalogue only, economy disabled — see play/Shop.ts) ----------------
  private shopItems: ShopItem[] = [];
  private shopTry: Outfit | null = null;
  /** Shop top: the original top-list texts and banners. Banner contents (which items each one promoted) were server data. */
  private openShopTop() {
    this.closeSheet(); this.screen = 'shopTop';
    this.api.guestEnd(); this.clearGuestTimers();   // the shop is its own scene (ShopScene): a visiting friend goes home
    this.api.setMusic('bgm_shopSceneInit');   // → BGM_SHOP_CLOTHING
    const TL = 'Layout/room/parts/layer3/shopTopImageListText00.msbt';
    const banners = [...this.api.vfsKeys(/^asset\/shopBanner2\/[^/]+\.webp$/)].sort().reverse().slice(0, 6);
    const burl = (k: string) => this.api.blobUrl(k, 'image/webp');
    this.root.innerHTML = `<section class="pl-shop-top"><header class="pl-shop-head"><h2>${esc(lb(TL, 'miitomoTitle02', 'Negozio Miitomo'))}</h2><button class="pl-btn ghost" data-a="close">${esc(lb('Layout/shop/parts/layer2/cmnBtn00.msbt', 'title00@btn00', 'Chiudi'))}</button></header>
      <div class="pl-shop-list">
        <button class="pl-shop-entry new" data-a="arrivals">${banners[0] ? `<img src="${burl(banners[0])}" alt="" />` : ''}<span>${esc(lb(TL, 'newStandardTitle00', 'Nuovi articoli di vestiario disponibili!'))}</span></button>
        <button class="pl-shop-entry" data-a="all"><span class="pl-shop-entry-title">${esc(lb(TL, 'shopTitle00', 'Negozio'))}</span></button>
        ${banners.slice(1).map((b) => `<div class="pl-shop-banner"><img src="${burl(b)}" alt="" /></div>`).join('')}
      </div>
      <p class="pl-small pl-shop-note">${esc(DISABLED_ECONOMY.note)}</p></section>`;
    this.on('close', () => this.leaveShop());
    this.on('arrivals', () => this.openShop('arrivals'));
    this.on('all', () => this.openShop('tops'));
  }
  private async openShop(tab: Category | 'arrivals', arrival?: string) {
    if (!this.shopItems.length) this.shopItems = buildCatalog(this.api.catalog() as any, this.api.itemDates(), (c) => CAT_DIR[c]);
    if (!this.shopTry) this.shopTry = structuredClone(this.api.outfit);
    if (!this.api.setVenue('shop')) { /* no interior: the catalogue still works over the room */ }
    this.api.setCloset(true);
    const groups = arrivalGroups(this.shopItems);
    const date = tab === 'arrivals' ? arrival ?? groups[0]?.date : undefined;
    const items = tab === 'arrivals' ? groups.find((g) => g.date === date)?.items ?? [] : this.shopItems.filter((i) => i.cat === tab);
    await this.api.ensureFiles(items.map((i) => thumbKey(i.cat, i.id, 0)));
    this.screen = 'shop';
    const cats = CLOSET_ORDER.filter((c) => this.shopItems.some((i) => i.cat === c));
    const AR = 'Layout/shop/parts/layer2/categoryTextBtn00.msbt';
    const arrLabel = (d: string) => { const x = dayMonth(d); const l = line(AR, 'title00@categoryBtn01');
      if (!l) return `Arrivi ${x.day}/${x.month}`;   // ORIGINAL template "Arrivi {2.2}/{2.1}": tag 2.2 = day, 2.1 = month (DEDUCED)
      return l.nodes.map((n) => typeof n === 'string' ? n : n.kind === 'tag' && n.group === 2 && n.type === 2 ? String(+x.day) : n.kind === 'tag' && n.group === 2 && n.type === 1 ? String(+x.month) : '').join('').replace(/\s+/g, ' ').trim(); };
    const worn = (it: ShopItem) => this.api.outfit[it.cat]?.id === it.id;
    this.root.innerHTML = `<section class="pl-shop">
      <header class="pl-shop-head"><h2>${esc(lb('Layout/shop/parts/layer3/shopTopImageListText00.msbt', 'shopTitle01', 'Negozio'))}</h2>
        <button class="pl-btn ghost" data-a="top">${esc(lb('Layout/shop/parts/layer2/cmnBtn00.msbt', 'title00@btn01', 'Al negozio'))}</button>
        <button class="pl-btn ghost" data-a="close">${esc(lb('Layout/shop/parts/layer2/cmnBtn00.msbt', 'title00@btn00', 'Chiudi'))}</button></header>
      <aside class="pl-shop-panel">
        <div class="pl-ctabs">${groups.length ? `<button class="pl-ctab ${tab === 'arrivals' ? 'on' : ''}" data-cat="arrivals"><span>Novità</span></button>` : ''}${cats.map((c) => { const ic = icon(c); return `<button class="pl-ctab ${c === tab ? 'on' : ''}" data-cat="${c}" title="${esc(CAT_LABEL[c])}">${ic ? `<img src="${ic}" alt="" />` : ''}<span>${esc(CAT_LABEL[c])}</span></button>`; }).join('')}</div>
        ${tab === 'arrivals' ? `<div class="pl-shop-dates">${groups.slice(0, 12).map((g) => `<button class="pl-chip ${g.date === date ? 'on' : ''}" data-date="${g.date}">${esc(arrLabel(g.date))}</button>`).join('')}</div>` : ''}
        <div class="pl-cgrid pl-shop-grid">${items.map((it) => { const th = thumb(it.cat, it.id, 0); return `<button class="pl-citem ${worn(it) ? 'on' : ''}" data-cat="${it.cat}" data-id="${it.id}" title="${esc(it.name)}">${th ? `<img src="${th}" alt="" loading="lazy" />` : '<span class="pl-noimg"></span>'}<span class="pl-cname ${it.nameOriginal ? '' : 'raw'}">${esc(it.name)}</span><span class="pl-price" title="Prezzo: dato del server, non preservato">—</span></button>`; }).join('') || '<p>Nessun articolo in questa sezione.</p>'}</div>
        <p class="pl-small pl-shop-note">${esc(DISABLED_ECONOMY.note)}</p>
      </aside></section>`;
    this.root.querySelectorAll<HTMLButtonElement>('.pl-ctab').forEach((b) => b.addEventListener('click', () => this.openShop(b.dataset.cat as Category | 'arrivals')));
    this.root.querySelectorAll<HTMLButtonElement>('[data-date]').forEach((b) => b.addEventListener('click', () => this.openShop('arrivals', b.dataset.date)));
    this.root.querySelectorAll<HTMLButtonElement>('.pl-shop-grid .pl-citem').forEach((b) => b.addEventListener('click', () => {
      const cat = b.dataset.cat as Category, id = b.dataset.id!;
      if (this.api.outfit[cat]?.id === id) delete this.api.outfit[cat]; else this.api.outfit[cat] = { id, color: 0 };   // try on / Togli (preview only)
      this.api.rebuild(); this.openShop(tab, date);
    }));
    this.on('top', () => this.openShopTop());
    this.on('close', () => this.leaveShop());
  }
  /** Leaving restores the saved outfit (try-on only: nothing is bought, owned or saved). */
  private leaveShop() {
    if (this.shopTry) { Object.keys(this.api.outfit).forEach((k) => delete (this.api.outfit as any)[k]); Object.assign(this.api.outfit, this.shopTry); this.shopTry = null; }
    this.api.setCloset(false); this.api.setVenue('room'); this.api.rebuild(); this.api.setMusic(null);
    this.screen = 'room'; this.renderBar(); this.scheduleGuest();
    this.api.showBalloon('Layout/shop/parts/layer2/shopPromotionText00.msbt', 'text00', 'Arrivederci a presto!', 2.2);
  }
  private openSettings() {
    const st = this.save.settings;
    const s = this.sheet(`<h2>${esc(lb(T.menu4, 'title00@config00', 'Impostazioni'))}</h2>
      <label class="pl-check1"><input type="checkbox" data-k="audio" ${st.audio ? 'checked' : ''}/> Audio</label>
      <div class="pl-switches">${(['music', 'effects', 'voice'] as const).map((k, i) => `<label class="pl-check1"><input type="checkbox" data-snd="${k}" ${st.sound[k] ? 'checked' : ''}/> ${esc(lb('Layout/menu/parts/layer1/switchNode00.msbt', `title00@snd0${i}`, ['Musica', 'Effetti', 'Voce'][i]))}</label>`).join('')}</div>
      <h3>Voce del Mii</h3>${this.voiceChoices()}
      <h3>Salvataggio</h3>
      <div class="pl-actions wrap"><button class="pl-btn" data-a="export">Esporta salvataggio</button><label class="pl-btn ghost">Importa salvataggio…<input type="file" accept=".json,application/json" hidden /></label><button class="pl-btn danger" data-a="reset">Ricomincia da capo</button></div>
      <p class="pl-err" hidden></p>
      <h3>Sviluppo</h3><p class="pl-small"><a href="?lab=1">Apri il Lab</a> (strumenti tecnici, render e debug).</p>`);
    s.querySelectorAll<HTMLInputElement>('[data-snd]').forEach((i) => i.addEventListener('change', async () => { st.sound[i.dataset.snd as 'music' | 'effects' | 'voice'] = i.checked; this.api.setSoundSwitches(st.sound.music, st.sound.effects, st.sound.voice); await this.persist(); }));
    s.querySelector<HTMLInputElement>('[data-k=audio]')!.addEventListener('change', async (e) => { st.audio = (e.target as HTMLInputElement).checked; this.api.setAudio(st.audio); await this.persist(); });
    s.querySelectorAll<HTMLInputElement>('input[name=voice]').forEach((i) => i.addEventListener('change', async () => { st.voice = i.value as typeof st.voice; this.api.setVoice(st.voice, this.save.profile.voice); await this.persist(); this.openSettings(); }));
    s.querySelector('[data-a=export]')!.addEventListener('click', () => this.exportSave());
    s.querySelector('input[type=file]')!.addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      const err = s.querySelector<HTMLElement>('.pl-err')!;
      try { await this.importSave(await f.text()); location.reload(); } catch (x) { err.hidden = false; err.textContent = (x as Error).message; }
    });
    const reset = s.querySelector<HTMLButtonElement>('[data-a=reset]')!;
    reset.addEventListener('click', async () => {
      if (reset.dataset.confirm !== '1') { reset.dataset.confirm = '1'; reset.textContent = 'Conferma: cancella il profilo'; return; }
      await deleteSave(); location.reload();
    });
  }


  // ---------------- Miifoto (M12) ----------------
  photo: MF.Photo = MF.newPhoto();
  private miiLayer: { key: string; canvas: HTMLCanvasElement | null } = { key: '', canvas: null };
  private sel: { kind: 'stamp' | 'text'; i: number } | null = null;
  private mfTab = 'pose';
  async openMiifoto() {
    this.closeSheet();
    this.screen = 'miifoto';
    this.api.setScene('lab');
    this.api.setMusic('bgm_cameraAppSceneInit');   // → BGM_CAMERA
    const L = (k: string, fb: string) => lb('Layout/camera/parts/dummyMiiBtn00.msbt', k, fb);
    const T2 = (k: string, fb: string) => lb('Layout/camera/parts/menuTab00.msbt', k, fb);
    this.root.innerHTML = `<section class="pl-screen pl-foto">
      <div class="pf-stage"><canvas class="pf-canvas" width="${MF.PHOTO}" height="${MF.PHOTO}"></canvas><div class="pf-busy" hidden>…</div></div>
      <aside class="pf-panel">
        <div class="pf-tabs">
          <button data-t="pose">${esc(L('title00@miiAction', 'Animazione'))}</button><button data-t="face">${esc(L('title00@miiFace', 'Espressione'))}</button>
          <button data-t="bg">Sfondo</button><button data-t="stamp">Timbri</button><button data-t="text">${esc(T2('title00@text', 'Testo'))}</button><button data-t="tpl">Modelli</button>
        </div>
        <div class="pf-body"></div>
        <div class="pf-sel"></div>
        <div class="pl-actions wrap"><button class="pl-btn ghost" data-a="random">${esc(lb('Layout/camera/parts/optionBtn00.msbt', 'title00@cameraRetake', 'Posa e sfondo casuali'))}</button><button class="pl-btn primary" data-a="savephoto">Salva Miifoto</button>${this.photoShare ? `<button class="pl-btn primary" data-a="sharephoto">${esc(this.photoShare.label())}</button>` : ''}<button class="pl-btn ghost" data-a="close">Chiudi</button></div>
      </aside></section>`;
    this.root.querySelectorAll<HTMLButtonElement>('.pf-tabs button').forEach((b) => b.addEventListener('click', () => { this.mfTab = b.dataset.t!; this.mfPanel(); }));
    this.on('close', () => { this.api.setMiiExpression?.(0); this.startRoom(); });
    this.on('savephoto', () => this.savePhoto());
    this.on('sharephoto', () => this.sharePhoto());
    this.on('random', () => { const ps = MF.poses(), bs = MF.backgrounds(); const r = (n: number) => Math.floor(Math.random() * n);
      if (ps.length) { const p = ps[r(ps.length)]; this.photo.mii.pose = p.id; this.photo.mii.face = p.face; } if (bs.length) this.photo.bg = bs[r(bs.length)].id; this.mfRender(); this.mfPanel(); });
    this.mfDrag();
    this.mfPanel();
    await this.mfRender();
  }
  private async mfRender() {
    const cv = this.root.querySelector<HTMLCanvasElement>('.pf-canvas'); if (!cv) return;
    const pose = MF.poses().find((p) => p.id === this.photo.mii.pose) ?? MF.poses()[0];
    const pm = this.photo.mii;
    const key = `${pose?.id}/${pm.face}/${JSON.stringify(pm.cam ?? null)}/${pm.frame ?? ''}`;
    if (pose && key !== this.miiLayer.key) {
      const busy = this.root.querySelector<HTMLElement>('.pf-busy'); if (busy) busy.hidden = false;
      await new Promise((r) => setTimeout(r, 20));
      const base = MF.camera(pose.camera) ?? { pos: [1.43, 8.95, 52.38], aim: [0, 8.95, 0], near: 20, far: 80, fovY: 0.384 };
      const cam = pm.cam ? { ...base, pos: pm.cam.pos, aim: pm.cam.aim, up: pm.cam.up } : base;
      this.miiLayer = { key, canvas: await this.api.renderMiiPhoto({ clip: pose.clip, frame: Number.isFinite(pm.frame) ? pm.frame! : pose.frame, expression: pm.face, cam, size: MF.PHOTO }) };
      if (busy) busy.hidden = true;
    }
    const fontsById = new Map(MF.fonts().map((f) => [f.id, f]));
    await MF.compose(cv.getContext('2d')!, this.photo, this.miiLayer.canvas, async (id) => { const f = fontsById.get(id) ?? fontsById.get('default0'); return f ? MF.loadFont(f) : 'sans-serif'; });
    if (this.sel) { const c = cv.getContext('2d')!; const it = this.sel.kind === 'stamp' ? this.photo.stamps[this.sel.i] : this.photo.texts[this.sel.i]; if (it) { c.save(); c.strokeStyle = '#f08300'; c.setLineDash([8, 6]); c.lineWidth = 3; c.strokeRect(it.x - 60, MF.PHOTO - it.y - 60, 120, 120); c.restore(); } }
  }
  private mfPanel() {
    const body = this.root.querySelector<HTMLElement>('.pf-body'); if (!body) return;
    this.root.querySelectorAll('.pf-tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === this.mfTab));
    const t = this.mfTab;
    if (t === 'pose') body.innerHTML = `<div class="pf-list">${MF.poses().map((p) => `<button class="pf-chip ${p.id === this.photo.mii.pose ? 'on' : ''}" data-pose="${p.id}">${esc(p.name)}</button>`).join('')}</div>`;
    if (t === 'face') body.innerHTML = `<div class="pf-list">${MF.faces().map((f) => `<button class="pf-chip ${f.expression === this.photo.mii.face ? 'on' : ''}" data-face="${f.expression}">${esc(f.name)}</button>`).join('')}</div>`;
    if (t === 'bg') body.innerHTML = `<div class="pf-thumbs">${MF.backgrounds().map((b) => `<button class="pf-th ${b.id === this.photo.bg ? 'on' : ''}" data-bg="${b.id}"><img src="${b.thumb()}" alt="" loading="lazy"/></button>`).join('')}</div>`;
    if (t === 'stamp') body.innerHTML = MF.stampCategories().map((c) => `<h4>${esc(c.name)}</h4><div class="pf-thumbs small">${c.stamps.map((st) => `<button class="pf-th" data-stamp="${st.file}"><img src="${st.url()}" alt="" loading="lazy"/></button>`).join('')}</div>`).join('');
    if (t === 'text') {
      const fs = MF.fonts();
      body.innerHTML = `<textarea class="pl-input pf-text" rows="2" placeholder="${esc(lb('Layout/camera/parts/textAddBtn00.msbt', 'title00', 'Aggiungi testo'))}"></textarea>
        <label class="pl-field">${esc(lb('Layout/camera/parts/menuTab00.msbt', 'title00@font', 'Carattere'))}<select class="pf-font">${fs.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label>
        <label class="pl-field">${esc(lb('Layout/camera/parts/menuTab00.msbt', 'title00@color', 'Colore'))}<select class="pf-color">${['black', 'white', 'red', 'blue', 'gray', 'yellow', 'green', 'pink'].map((c) => `<option>${c}</option>`).join('')}</select></label>
        <button class="pl-btn" data-a="addtext">${esc(lb('Layout/camera/parts/textAddBtn00.msbt', 'title00', 'Aggiungi testo'))}</button>`;
      body.querySelector('[data-a=addtext]')!.addEventListener('click', () => {
        const txt = body.querySelector<HTMLTextAreaElement>('.pf-text')!.value.trim(); if (!txt) return;
        this.photo.texts.push({ text: txt, font: body.querySelector<HTMLSelectElement>('.pf-font')!.value, color: body.querySelector<HTMLSelectElement>('.pf-color')!.value, x: 320, y: 520, scale: 0.45, rot: 0 });
        this.sel = { kind: 'text', i: this.photo.texts.length - 1 }; this.mfRender(); this.mfSel();
      });
    }
    if (t === 'tpl') body.innerHTML = `<div class="pf-list">${MF.templates().map((tp) => `<button class="pf-chip" data-tpl="${tp.id}">${tp.id}</button>`).join('')}</div>`;
    body.querySelectorAll<HTMLElement>('[data-pose]').forEach((b) => b.addEventListener('click', () => { const p = MF.poses().find((x) => x.id === b.dataset.pose)!; this.photo.mii.pose = p.id; this.photo.mii.face = p.face; this.photo.mii.cam = undefined; this.photo.mii.frame = undefined; this.mfRender(); this.mfPanel(); }));
    body.querySelectorAll<HTMLElement>('[data-face]').forEach((b) => b.addEventListener('click', () => { this.photo.mii.face = Number(b.dataset.face); this.mfRender(); this.mfPanel(); }));
    body.querySelectorAll<HTMLElement>('[data-bg]').forEach((b) => b.addEventListener('click', () => { this.photo.bg = b.dataset.bg!; this.mfRender(); this.mfPanel(); }));
    body.querySelectorAll<HTMLElement>('[data-stamp]').forEach((b) => b.addEventListener('click', () => { this.photo.stamps.push({ file: b.dataset.stamp!, x: 320 + (this.photo.stamps.length % 4) * 30, y: 420, scale: 0.45, rot: 0, flipX: false }); this.sel = { kind: 'stamp', i: this.photo.stamps.length - 1 }; this.mfRender(); this.mfSel(); }));
    body.querySelectorAll<HTMLElement>('[data-tpl]').forEach((b) => b.addEventListener('click', () => { const tp = MF.templates().find((x) => x.id === b.dataset.tpl)!; this.photo = MF.fromTemplate(tp); this.sel = null; this.mfRender(); this.mfSel(); }));
    this.mfSel();
  }
  private mfSel() {
    const el = this.root.querySelector<HTMLElement>('.pf-sel'); if (!el) return;
    if (!this.sel) { el.innerHTML = ''; return; }
    el.innerHTML = `<span>${this.sel.kind === 'stamp' ? 'Timbro' : 'Testo'} selezionato</span><button class="pl-btn ghost small" data-s="-">−</button><button class="pl-btn ghost small" data-s="+">+</button><button class="pl-btn ghost small" data-s="r">⟳</button><button class="pl-btn danger small" data-s="x">Elimina</button>`;
    el.querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => b.addEventListener('click', () => {
      const arr: (MF.PhotoStamp | MF.PhotoText)[] = this.sel!.kind === 'stamp' ? this.photo.stamps : this.photo.texts; const it = arr[this.sel!.i]; if (!it) return;
      if (b.dataset.s === '+') it.scale *= 1.15; if (b.dataset.s === '-') it.scale /= 1.15; if (b.dataset.s === 'r') it.rot = (it.rot + 15) % 360;
      if (b.dataset.s === 'x') { arr.splice(this.sel!.i, 1); this.sel = null; }
      this.mfRender(); this.mfSel();
    }));
  }
  /** Drag stamps / texts on the photo (nearest element within 90 px, photo coordinates). */
  private mfDrag() {
    const cv = this.root.querySelector<HTMLCanvasElement>('.pf-canvas')!;
    const toPhoto = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * MF.PHOTO, y: MF.PHOTO - ((e.clientY - r.top) / r.height) * MF.PHOTO }; };
    let drag: { kind: 'stamp' | 'text'; i: number; dx: number; dy: number } | null = null;
    cv.addEventListener('pointerdown', (e) => {
      const p = toPhoto(e); let best: { kind: 'stamp' | 'text'; i: number; d: number } | null = null;
      this.photo.stamps.forEach((s, i) => { const d = Math.hypot(s.x - p.x, s.y - p.y); if (d < 90 && (!best || d < best.d)) best = { kind: 'stamp', i, d }; });
      this.photo.texts.forEach((t, i) => { const d = Math.hypot(t.x - p.x, t.y - p.y); if (d < 90 && (!best || d < best.d)) best = { kind: 'text', i, d }; });
      if (!best) { this.sel = null; this.mfRender(); this.mfSel(); return; }
      const b = best as { kind: 'stamp' | 'text'; i: number }; const it = b.kind === 'stamp' ? this.photo.stamps[b.i] : this.photo.texts[b.i];
      this.sel = { kind: b.kind, i: b.i }; drag = { ...this.sel, dx: it.x - p.x, dy: it.y - p.y }; cv.setPointerCapture(e.pointerId); this.mfSel();
    });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; const p = toPhoto(e); const it = drag.kind === 'stamp' ? this.photo.stamps[drag.i] : this.photo.texts[drag.i]; if (!it) return; it.x = p.x + drag.dx; it.y = p.y + drag.dy; this.mfRender(); });
    cv.addEventListener('pointerup', () => { drag = null; });
  }
  miiPixels() { const c = this.miiLayer.canvas; if (!c) return 0; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++; return n; }
  savePhoto() {
    const cv = this.root.querySelector<HTMLCanvasElement>('.pf-canvas'); if (!cv) return;
    this.sel = null;
    this.mfRender().then(() => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `miifoto-${Date.now()}.png`; a.click(); });
  }

  /** REBOOT: the composed photo goes to the share handler (a 480 px JPEG), then back to the room. */
  sharePhoto() {
    const cv = this.root.querySelector<HTMLCanvasElement>('.pf-canvas'); const sh = this.photoShare; if (!cv || !sh) return;
    this.sel = null;
    this.mfRender().then(() => {
      const out = document.createElement('canvas'); out.width = out.height = 480;
      out.getContext('2d')!.drawImage(cv, 0, 0, 480, 480);
      const url = out.toDataURL('image/jpeg', 0.85);
      this.api.setMiiExpression?.(0); this.startRoom();
      sh.share(url);
    });
  }

  // ---------------- save ----------------
  async persist() { return writeSave(this.save); }
  exportJson() { return JSON.stringify(this.save, null, 1); }
  exportSave() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.exportJson()], { type: 'application/json' }));
    a.download = `miitomo-web-${(this.save.profile.name || 'mii').replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async importSave(text: string) {
    const s = migrate(JSON.parse(text), newSave(this.save.outfit));
    this.save = s; await this.persist();
  }
  get currentScreen() { return this.screen; }
  /** true while watching a friend's room (read-only, used by the Reboot layer). */
  get isVisiting() { return !!this.visiting; }

  private on(a: string, fn: () => void) { this.root.querySelector(`[data-a="${a}"]`)?.addEventListener('click', fn); }
}

function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function sessionStorageGet(k: string) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* */ } }
