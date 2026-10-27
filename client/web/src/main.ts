import './style.css';
import * as THREE from 'three';
import { FFLExpression } from 'ffl.js';
import LUTShaderMaterial from 'ffl.js/materials/LUTShaderMaterial.js';
import { MiiEngine, SHADERS, ShaderKind, parseMiiInput, toHex, openMouth } from './mii';
import { importResource, cacheResource, loadCachedResource, clearCachedResource, LoadedResource } from './resource';
import { importZipBytes, saveVfs, loadVfs, clearVfs, openModelPackage, text as vtext, vfs, itemDates, ColdMiss, wantedSource, loadSources, addSources, needsReimport, loadKeepVersion, saveKeepVersion } from './assets/vfs';
import { refreshOriginal, bodyPackage, referenceImageUrl, state as orig, BODY_ID, OriginalStatus } from './assets/original';
import { BodyModel } from './body/BodyModel';
import { computeBodyScale, BodyScale } from './body/BodyScale';
import { accessoryTransform, CATEGORIES, CAT_DIR, CAT_LABEL, Category, Outfit, catalog, itemPackage, resolveOutfit, materialVisible, variantXml, variantStems, clearWardrobeCache, Resolution } from './body/Wardrobe';
import { hasLutShaderSource, setLights, getLights } from './agx/LutMaterial';
import { parseSceneXml } from './agx/xml';
import { buildRoom, roomAvailable, roomSkins, furnitureBoxes, furnitureGroup, rayMesh, RoomBuild, parseRoomXml, RoomCamera } from './room/Room';
import { framedRoomCamera } from './room/RoomFraming';
import { rebootRequested } from './reboot/gate';   // the only static Reboot import (no dependencies)
import { P2PClient } from './p2p/client';
import { withP2P } from './p2p/social';
import type { DesktopApi as LauncherDesktop } from './launcher/Launcher';
import type { RebootHost } from './reboot/host';
import { RoomDirector, DirectorEvent, Interactable, MiiState } from './room/RoomDirector';
import { RoomSound } from './room/RoomSound';
import { RoomUI, MenuItem } from './room/RoomUI';
import { expressionsAvailable, resetExpressions, neededFaces, emotionFace, pickGesture, rulesInText, dominantGenre, FaceTriple, Personality, PERSONALITIES, ruleInfo, gestureInfo } from './room/Expression';
import { sanitizeFriend } from './social/Social';
import { personalityType } from './play/Personality';
import { Effects } from './effects/Effects';
import { buildShop, meshBoxes, shopAvailable, ShopBuild } from './room/Shop';
import { PROVIDERS, resolveVoice, speakable, DEFAULT_VOICE, VoicePref, VoiceParams, VoiceProvider, setWebTtsPrefs } from './voice/Voice';
import { line, label, textsAvailable, clearTextCache } from './room/RoomText';
import { layoutAvailable, clearSpriteCache } from './room/LayoutSprites';
import { Play, PlayApi, GuestSpec } from './play/Play';
import { clearClosetCache } from './play/Closet';

/** PLAY (default) vs Lab (?lab=1, ?debug=1 or /lab): the Lab keeps every developer tool. */
const LAB = (() => { const q = new URLSearchParams(location.search); return q.has('lab') || q.get('debug') === '1' || /\/lab\/?$/.test(location.pathname); })();
if (LAB) document.body.classList.add('lab');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------- Three.js stage ----------------
const canvas = $<HTMLCanvasElement>('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
/** Pixel-ratio cap of the 3D view. Classic: 2 (always). Reboot settings may lower it (quality / light mode). */
let pixelCap = 2;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelCap));
THREE.ColorManagement.enabled = false;               // the game writes shader output straight to the framebuffer
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(15, 1, 10, 6000);
const pivot = new THREE.Group();
scene.add(pivot);

type ViewMode = 'full' | 'head';
type ShadeMode = ShaderKind | 'ab';
const view = { yaw: 0.35, pitch: 0, dist: 1000, autoRotate: true };
const ui = { view: 'full' as ViewMode, shade: 'original' as ShadeMode, pose: '', gender: 2, expression: FFLExpression.NORMAL as number,
  dress: 'outfit' as 'outfit' | 'm5', scaleOn: true, height: null as number | null, build: null as number | null,
  scene: 'lab' as 'lab' | 'room', roomCam: 'original' as 'original' | 'follow' | 'free', wall: '0000', floor: '0000', variant: 0,
  audio: true, showObjects: true };
/** First complete outfit built only from original items (all from the M6 CDN sample, MD5-verified). */
export const OUTFIT_1: Outfit = {
  headwear: { id: '0000', color: 0 }, tops: { id: '0000', color: 8 }, bottomsA: { id: '0001', color: 1 },
  shoes: { id: '0001', color: 2 }, tuck: false
};
const outfit: Outfit = structuredClone(OUTFIT_1);
let lastRes: Resolution | null = null;
let lastScale: BodyScale | null = null;
let lastGender: 'm' | 'f' = 'm';
const cam = () => (ui.view === 'full' ? { y: 88, dist: 1000 } : { y: 32, dist: 520 });
function resetView() { view.yaw = 0.35; view.pitch = 0; view.dist = cam().dist; }

let W = 1, H = 1;
function resize() {
  const r = canvas.parentElement!.getBoundingClientRect();
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  renderer.setSize(W, H, false);
}
new ResizeObserver(resize).observe(canvas.parentElement!);

// ---------------- Slots (A = approx, B = original) ----------------
interface Slot { kind: ShaderKind; root: THREE.Group; head: any | null; headGroup: THREE.Group | null; body: BodyModel | null; parts: BodyModel[]; }
const slots: Record<ShaderKind, Slot> = {
  approx: { kind: 'approx', root: new THREE.Group(), head: null, headGroup: null, body: null, parts: [] },
  original: { kind: 'original', root: new THREE.Group(), head: null, headGroup: null, body: null, parts: [] }
};
pivot.add(slots.approx.root, slots.original.root);

const engine = new MiiEngine(renderer);
let miiData: Uint8Array | null = null;
let status: OriginalStatus | null = null;

function disposeSlot(s: Slot) {
  if (s.headGroup) s.headGroup.removeFromParent();
  try { s.head?.dispose(); } catch { /* */ }
  s.head = null; s.headGroup = null;
  for (const p of s.parts) { p.group.removeFromParent(); p.dispose(); }
  s.parts = []; s.body = null;
}

function canShade(kind: ShaderKind): string | null {
  if (kind === 'original') {
    if (!hasLutShaderSource()) return 'serve l\'APK (shader LUT originale)';
    if (!status?.miiModel) return 'serve asset_env_mii.zip (mii_model.xml)';
    if (!status?.luts) return 'servono le LUT dell\'APK';
  }
  return null;
}

function buildSlot(s: Slot): { ms: number } {
  disposeSlot(s);
  const t0 = performance.now();
  // Resolve the outfit first: a worn headwear switches the head to FFL's hat hair variant.
  const full = ui.view === 'full';
  lastRes = null;
  const wantOutfit = full && ui.dress === 'outfit' && wardrobeCount() > 0;
  const preRes = wantOutfit ? resolveOutfit(outfit, 'm') : null; // gender fixed below once the head is known
  const hat = !!preRes?.parts.some((p) => p.cat === 'headwear');
  // PLAY: also the emotion faces of EmotionExpression (17 masks); falls back to the base set if FFL refuses one.
  let r: ReturnType<typeof engine.build>;
  try { r = engine.build(miiData!, ui.expression, s.kind, hat, LAB ? [] : neededFaces()); }
  catch (e) { console.warn('facce emozione non disponibili', e); r = engine.build(miiData!, ui.expression, s.kind, hat); }
  s.head = engine.current; engine.current = null; // slot owns it
  s.headGroup = r.group;
  const gender = r.gender === 1 ? 'f' : 'm';
  lastGender = gender;
  lastName = r.name;
  const bs = ui.scaleOn ? computeBodyScale(ui.height ?? r.height, ui.build ?? r.build) : null;
  lastScale = bs;
  setSliders(r.height, r.build);
  const skin = new THREE.Vector4(r.skin.r, r.skin.g, r.skin.b, 1);
  const hc = r.hair as THREE.Color | null;
  const hair = hc ? new THREE.Vector4(hc.r, hc.g, hc.b, 1) : new THREE.Vector4(1, 1, 1, 1);
  const addPart = (p: BodyModel) => {
    p.skinColor.copy(skin); p.hairColor.copy(hair); p.bodyScale = bs;
    s.parts.push(p); s.root.add(p.group);
  };
  if (full && ui.dress === 'm5' && status?.body) {
    addPart(new BodyModel(bodyPackage(), BODY_ID, s.kind, LUTShaderMaterial));
  } else if (wantOutfit) {
    const res = resolveOutfit(outfit, gender);
    lastRes = res;
    for (const part of res.parts) {
      const m = new BodyModel(itemPackage(part.cat, part.id), part.stem, s.kind, LUTShaderMaterial, part.color);
      m.setMaterialFilter((mat) => materialVisible(part, mat));
      m.group.userData.part = part.stem;
      if (part.cat === 'acce') m.group.userData.acce = accessoryTransform(part.xml.accessory, bs);
      if (part.cat === 'headwear') {
        // Attached like AFL's "headwear" child of the head node (0x568e9c): same space as the FFL head.
        m.skinColor.copy(skin); m.hairColor.copy(hair);
        m.group.userData.headwear = true;
        s.parts.push(m);
        continue;
      }
      addPart(m);
    }
  }
  const skel = s.parts.find((p) => p.jointFrame('Head') && !p.group.userData.headwear) ?? null;
  s.body = skel;
  if (skel) {
    skel.headAnchor.add(r.group);
    for (const p of s.parts) if (p.group.userData.headwear) {
      // headwear PODs are authored in head units / 10 (bounds: 6.6 wide, top at 7.3 vs FFL hair ~50) -> x10 under the
      // anchor that already carries AFL's S(0.1). INFERRED from the data, see MII.md § M6.
      p.applyPose(null, 0); p.group.scale.setScalar(10); skel.headAnchor.add(p.group);
    }
    s.root.scale.setScalar(ui.scene === 'room' ? 1 : 10); // room: Mii and room share body units (POD Units 0.01)
  } else {
    s.root.add(r.group);
    for (const p of s.parts) if (p.group.userData.headwear) s.root.add(p.group);
    s.root.scale.setScalar(1);
  }
  return { ms: performance.now() - t0 };
}

/** Accessories follow their RootType joint on the skinned body (see Wardrobe.accessoryTransform). */
function placeAccessories(s: Slot) {
  for (const p of s.parts) {
    const a = p.group.userData.acce; if (!a || !s.body) continue;
    const f = s.body.attachFrame(a.root);
    if (!f) { p.group.visible = false; continue; }
    p.group.visible = true;
    p.placeAccessory(f, a.tf, a.s);
  }
}

/**
 * Cold files (item / room-skin packages kept in IndexedDB) that a rebuild needed but were not loaded are recorded by the
 * VFS; they are loaded and the rebuild runs again (at most 4 rounds, each round loads everything it found missing).
 */
let coldWait = false;   // a rebuild is waiting for cold files: later calls are coalesced into it
function rebuild(round = 0) {
  if (coldWait && round === 0) return;
  const want = coldNeeds();
  if (!vfs.ready(want) && round < 12) { coldWait = true; vfs.ensure(want).then(() => rebuild(round + 1)).catch((e) => { coldWait = false; console.warn(e); }); return; }
  vfs.misses.clear();
  rebuildNow();
  if (vfs.misses.size && round < 12) { coldWait = true; const keys = [...vfs.misses]; vfs.ensure(keys).then(() => rebuild(round + 1)).catch((e) => { coldWait = false; console.warn(e); }); return; }
  coldWait = false;
}
/** Cold files a rebuild will certainly read: the outfit items and the room skins. */
function coldNeeds(): string[] {
  const out = Object.entries(outfit).filter(([, v]) => v).map(([c, v]) => `asset/model/character/${CAT_DIR[c as Category]}/output/${CAT_DIR[c as Category]}${(v as { id: string }).id}`);
  if (ui.scene === 'room') out.push(`asset/model/room/roomWall/output/rmWl${ui.wall}`, `asset/model/room/roomFloor/output/rmFl${ui.floor}`);
  return out;
}
function rebuildNow() {
  if (!engine.ready || !miiData) return;
  face.cur = -1;
  const kinds: ShaderKind[] = ui.scene === 'room' ? [ui.shade === 'ab' ? 'original' : ui.shade] : ui.shade === 'ab' ? ['approx', 'original'] : [ui.shade];
  try {
    for (const k of Object.keys(slots) as ShaderKind[]) if (!kinds.includes(k)) disposeSlot(slots[k]);
    let ms = 0;
    for (const k of kinds) {
      const why = canShade(k);
      if (why) throw new Error(`Shader ${SHADERS[k].label}: ${why}.`);
      ms += buildSlot(slots[k]).ms;
    }
    $('stageEmpty').hidden = true;
    const sl = slots[kinds[kinds.length - 1]];
    setDiag('Costruzione', `${ms.toFixed(0)} ms`);
    const tri = sl.parts.reduce((a, p) => a + p.stats.triangles, 0), msh = sl.parts.reduce((a, p) => a + p.stats.meshes, 0);
    setDiag('Corpo', sl.parts.length ? `${sl.parts.length} parti, ${msh} mesh, ${tri} tri` : (ui.view === 'full' ? 'nessun capo/corpo importato' : 'nascosto'));
    setDiag('Proporzioni', lastScale ? `h ${lastScale.height} · b ${lastScale.build} → A(${lastScale.a.x.toFixed(3)}, ${lastScale.a.y.toFixed(3)}) B ${lastScale.b.x.toFixed(3)}` : 'off (FK puro)');
    setDiag('Outfit', ui.dress === 'm5' ? 'bodyAll0400 (M5)' : (lastRes ? lastRes.parts.map((p) => `${p.stem}${p.color ? `·AL${String(p.color).padStart(2, '0')}` : ''}${p.base ? '(base)' : ''}`).join(', ') : '—'));
    setDiag('Esclusioni', lastRes?.removed.length ? lastRes.removed.join('; ') : 'nessuna');
    if (lastRes?.notes.length) setDiag('Note guardaroba', lastRes.notes.join('; '));
    setDiag('Luci', orig.lights.source);
    $('hudInfo').textContent = `${exprName(ui.expression)} · ${ui.shade === 'ab' ? 'A | B' : SHADERS[ui.shade].label} · ${ui.pose || 'bind'}`;
    showError(null);
    if (ui.scene === 'room') setupRoom(slots[kinds[0]]); else teardownRoom();
    applyPose(0);
  } catch (err) {
    if (err instanceof ColdMiss) return;   // loaded and retried by rebuild()
    showError((err as Error).message);
    console.error(err);
  }
}

// ---------------- Pose / animation ----------------
let animT = 0;
function applyPose(dt: number) {
  const clip = ui.pose ? orig.anims.get(ui.pose) ?? null : null;
  if (clip) animT += dt * (clip.fps > 0 && clip.fps <= 120 ? clip.fps : 30);
  for (const s of Object.values(slots)) {
    for (const p of s.parts) if (!p.group.userData.acce) p.applyPose(clip, animT);
    placeAccessories(s);
  }
}

// ---------------- M7 + M8: playable Miitomo room ----------------
const roomGroup = new THREE.Group();
scene.add(roomGroup);
let room: RoomBuild | null = null;
let roomKey = '';
let director: RoomDirector | null = null;
let sound: RoomSound | null = null;
let interactables: Interactable[] = [];
let hoverName = '';
let lastName = '';
let nicknameOverride = '';
let greetings = { welcome: '', goIn: '', seeingOff: '', goHome: '' };
// Empty greeting = the game's default line (System/MiiCommonText default*). Tag map VERIFIED by RoomSceneTalkWords customGreeting* lines.
const greetDef = (k: string, fb: string) => label('System/MiiCommonText.msbt', k, fb).replace(/\s+/g, ' ').trim();
const greetCtx = () => ({ '1.2': greetings.welcome || greetDef('defaultGreetingWelcome', 'Ciao!'), '1.3': greetings.seeingOff || greetDef('defaultGoodByeSeeingOff', 'Torna presto!'), '1.4': greetings.goHome || greetDef('defaultGoodByeGoHome', "È ora di andare."), '1.5': greetings.goIn || greetDef('defaultGreetingGoIn', 'È permesso?') });
const closetCam = { on: false, detail: true };
/**
 * Closet / profile user camera (userData/closet_camera.xml, APK — VERIFIED data): min_scale 0.38 … max_scale 1.0,
 * look-at clamped to min_lookAt (-4,3,0) … max_lookAt (4,17,0), scale_anim_speed 4, rotate_anim_speed 10.
 * DEDUCED: scale = camera distance factor (pinch / wheel), look-at = drag pan inside that box, rotation = drag turns the
 * Mii; the speeds = exponential approach rates per second. Double tap / double click resets.
 */
const CLOSET_CAM = { minScale: 0.38, maxScale: 1, minLook: [-4, 3], maxLook: [4, 17], scaleSpeed: 4, rotSpeed: 10 };
const ccam = { scale: 1, scaleT: 1, look: [0, 8], lookT: [0, 8], yaw: 0, yawT: 0 };
function closetCamReset() { ccam.scaleT = 1; ccam.lookT = [0, 8]; ccam.yawT = 0; }
function closetCamZoom(f: number) { ccam.scaleT = Math.min(CLOSET_CAM.maxScale, Math.max(CLOSET_CAM.minScale, ccam.scaleT * f)); }
function closetCamPan(dx: number, dy: number) {
  const k = 0.05 * ccam.scale;   // screen px → room units (APPROXIMATED)
  ccam.lookT = [Math.min(CLOSET_CAM.maxLook[0], Math.max(CLOSET_CAM.minLook[0], ccam.lookT[0] - dx * k)), Math.min(CLOSET_CAM.maxLook[1], Math.max(CLOSET_CAM.minLook[1], ccam.lookT[1] + dy * k))];
}
function closetCamTick(dt: number) {
  const a = 1 - Math.exp(-CLOSET_CAM.scaleSpeed * dt), b = 1 - Math.exp(-CLOSET_CAM.rotSpeed * dt);
  ccam.scale += (ccam.scaleT - ccam.scale) * a; ccam.look = ccam.look.map((v, i) => v + (ccam.lookT[i] - v) * a); ccam.yaw += (ccam.yawT - ccam.yaw) * b;
}
{
  const pts = new Map<number, { x: number; y: number }>(); let last: { x: number; y: number; d: number } | null = null; let lastTap = 0;
  canvas.addEventListener('wheel', (e) => { if (!closetCam.on || LAB) return; e.preventDefault(); closetCamZoom(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    if (!closetCam.on || LAB) return;
    const now = performance.now(); if (now - lastTap < 300) closetCamReset(); lastTap = now;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); last = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!closetCam.on || !pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId)!; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2) {   // two fingers: pinch = zoom, move = pan
      const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (last) { closetCamZoom(last.d / Math.max(1, d)); closetCamPan(cx - last.x, cy - last.y); }
      last = { x: cx, y: cy, d }; return;
    }
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    if (e.shiftKey || e.buttons === 2 || e.buttons === 4) closetCamPan(dx, dy); else ccam.yawT += dx * 0.012;
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); last = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}
/**
 * Venue (M15): the room, or the shop interior (asset/model/shop/output). In the shop the Mii stands at SHOP_SPOT facing
 * the viewer and the closet camera frames it with the shop as background (the shop layout contains body/closet00.ccbi:
 * try-on uses the closet view — DEDUCED). Spot and use of the closet camera in the shop: APPROXIMATED.
 */
let venue: 'room' | 'shop' = 'room';
const blobUrls = new Map<string, string>();
let shop: ShopBuild | null = null;
const shopGroup = new THREE.Group(); shopGroup.visible = false; scene.add(shopGroup);
const SHOP_SPOT = new THREE.Vector3(0, 0, -6);
function setVenue(v: 'room' | 'shop') {
  if (v === venue) return true;
  if (v === 'shop') {
    if (!shop) { try { shop = buildShop('original', LUTShaderMaterial); shopGroup.add(shop.model.group); } catch (e) { console.warn('negozio non disponibile', e); return false; } }
    roomUi.close(true); effects.clear();
    if (guests.length) disposeGuest();   // the friends go home when the user leaves the room (DEDUCED)
    venue = 'shop'; shopGroup.visible = true; roomGroup.visible = false;
    setLights(shop.lights ?? orig.lights);
    director?.faceViewer();
  } else {
    venue = 'room'; shopGroup.visible = false; roomGroup.visible = true;
    setLights(room?.lights ?? orig.lights);
  }
  return true;
}
const clock = { hour: null as number | null };
const testClock = { paused: false };   // tests: freeze real-time updates, drive time with simRoom()
const hourNow = () => clock.hour ?? new Date().getHours();
const isNight = () => { const h = hourNow(); return h >= 18 || h < 5; };   // threshold APPROXIMATED (not reversed)
const roomUi = new RoomUI(canvas.parentElement!);
roomUi.root.hidden = true;
roomUi.onSound = (k) => sound?.action(k);
// Voice (M13): provider chain original (unavailable on the Web) → web TTS (APPROXIMATED / NON-ORIGINAL) → silent.
let voicePref: VoicePref = 'auto';
let voiceParams: VoiceParams = { ...DEFAULT_VOICE };
let voice: VoiceProvider = resolveVoice('silent');
const voiceLog: { provider: string; classification: string; text: string }[] = [];
let soundSw = { music: true, effects: true, voice: true };
/** REBOOT settings: channel volumes 0..1 (Classic: 1, the original mix). */
let soundLevels = { music: 1, effects: 1 };
/** REBOOT R6: language of a Reboot chat balloon (by label) for the voice; Classic balloons have none (Italian). */
const sayLangs = new Map<string, string>();
roomUi.onVoicePage = (text) => {
  if (!ui.audio || !soundSw.voice) return;
  const t = speakable(text); if (!t) return;
  voice.speak(t, roomUi.speaker === 'guest' && talker ? talker.spec.voice : voiceParams, sayLangs.get(roomUi.openLabel ?? ''));
  voiceLog.push({ provider: voice.id, classification: voice.classification, text: t }); if (voiceLog.length > 50) voiceLog.shift();
};
roomUi.onVoiceStop = () => voice.stop();
/**
 * M13 talking body language: tag rules of the line ({9.3}) + rules found by the Italian word lists in the user's own
 * words → gesture for the Mii's personality; tag emotion ({9.0}/{9.1}) → face for the personality while it talks.
 */
let personality: Personality = 0;
/** M14 particle effects (effect.ptcl): attached to the shown Mii's root, origin = the XML's bone. */
const effects = new Effects();
function playEffect(name: string, target?: THREE.Object3D) {
  const s = slots[ui.shade === 'ab' ? 'original' : ui.shade];
  if (ui.scene !== 'room' || !effects.play(name, target ?? s.root, performance.now())) return false;
  // Sound/Action/effect.msbt: "<set>" at the start, "<set>:N" at frame N (60 fps, APPROXIMATED)
  sound?.action(name);
  for (const f of sound?.timedFrames('Action/effect', name) ?? []) sfxQueue.push({ t: f / 60, key: `${name}:${f}` });
  return true;
}
const sfxQueue: { t: number; key: string }[] = [];
function sfxTick(dt: number) { for (let i = sfxQueue.length - 1; i >= 0; i--) { const q = sfxQueue[i]; q.t -= dt; if (q.t <= 0) { sound?.action(q.key); sfxQueue.splice(i, 1); } } }
let emoFace: FaceTriple | null = null;
const speakLog: { label: string; rules: string[]; gesture: string | null; face: number | null }[] = [];
roomUi.onSpeak = (info) => {
  emitSpeech(info.speaker === 'guest' ? talker?.spec.id ?? null : 'host');
  const rules = [...new Set([...info.rules, ...rulesInText(info.userText)])];
  if (info.speaker === 'guest' && talker) {   // M18: the guest talks with its own personality (gesture, face)
    const g = talker, gp = pickGesture(rules, g.personality);
    g.emo = emotionFace(info.emotion ?? (info.userText ? dominantGenre(rules) : null), g.personality);
    if (gp) for (const fx of gp.gesture.effects) playEffect(fx, g.slot.root);
    if (gp) g.director.gesture({ name: gp.gesture.name, inAnim: gp.gesture.inAnim, anim: gp.gesture.anim, outAnim: gp.gesture.outAnim, min: gp.gesture.min, max: gp.gesture.max });
    speakLog.push({ label: info.label, rules, gesture: gp?.gesture.name ?? null, face: g.emo?.def ?? null, speaker: 'guest' } as any); if (speakLog.length > 50) speakLog.shift();
    return;
  }
  const pick = pickGesture(rules, personality);
  const prevFace = emoFace?.def ?? null;
  emoFace = emotionFace(info.emotion ?? (info.userText ? dominantGenre(rules) : null), personality);
  if (emoFace && emoFace.def !== prevFace && emoFace.label) sound?.action(`face.change.${emoFace.label}`);   // Sound/Action/face.msbt
  if (pick) for (const fx of pick.gesture.effects) playEffect(fx);   // ex_EffectFileName* (Expression.msbt); start with the gesture: DEDUCED
  if (pick && director) director.gesture({ name: pick.gesture.name, inAnim: pick.gesture.inAnim, anim: pick.gesture.anim, outAnim: pick.gesture.outAnim, min: pick.gesture.min, max: pick.gesture.max });
  speakLog.push({ label: info.label, rules, gesture: pick?.gesture.name ?? null, face: emoFace?.def ?? null }); if (speakLog.length > 50) speakLog.shift();
};
let gestured = false;
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => { gestured = true; sound?.unlock(); }, { capture: true });
// destination marker (APPROXIMATED: the game draws none we know of)
const marker = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.75, 40), new THREE.MeshBasicMaterial({ color: 0xf08300, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
marker.rotation.x = -Math.PI / 2; marker.renderOrder = 5; marker.visible = false; scene.add(marker);
const STATE_LABEL: Record<MiiState, string> = { outside: 'Fuori', entering: 'Entra', idle: 'Fermo', walking: 'Cammina', interacting: 'Interagisce', reacting: 'Reagisce', exiting: 'Esce', held: 'Preso in mano' };
const T_ROOM = 'Scene/RoomSceneTalkWords.msbt', T_COMMON = 'System/MiiCommonText.msbt';
const lbl = (rel: string, key: string, fb: string) => { const l = line(rel, key); return { text: l ? label(rel, key, fb) : fb, src: l ? `${l.lang}:${rel}#${key}` : 'PLACEHOLDER' }; };

function teardownRoom() {
  if (room) { room.model.group.removeFromParent(); room.model.dispose(); room = null; roomKey = ''; }
  director = null; interactables = [];
  roomUi.close(true); roomUi.root.hidden = true; marker.visible = false;
  sound?.stopBgm();
  canvas.style.cursor = '';
  setLights(orig.lights);
  for (const s of Object.values(slots)) { s.root.position.set(0, 0, 0); s.root.rotation.set(0, 0, 0); }
  $('roomCard').hidden = ui.scene !== 'room';
}

function setupRoom(s: Slot) {
  $('roomCard').hidden = false;
  if (!roomAvailable()) throw new Error('Stanza: serve asset_model_room_roomBaseComponents.zip (CDN).');
  const key = `${s.kind}/${ui.wall}/${ui.floor}/${ui.variant}`;
  if (key !== roomKey) {
    if (room) { room.model.group.removeFromParent(); room.model.dispose(); }
    room = buildRoom(s.kind, LUTShaderMaterial, ui.wall, ui.floor, ui.variant);
    roomKey = key;
    roomGroup.add(room.model.group);
    room.model.applyPose(null, 0);
  }
  setLights(room!.lights ?? orig.lights);
  pivot.rotation.set(0, 0, 0);
  for (const o of Object.values(slots)) if (o !== s) o.root.visible = false;
  const prev = director;
  roomUi.close(true);
  director = new RoomDirector(orig.anims, lastGender === 'f', room!.doorOpen, room!.doorClose);
  director.boxes = furnitureBoxes(room!.model);
  director.onEvent = onDirectorEvent;
  for (const g of guests) g.director.boxes = director.boxes;
  linkOthers();
  director.idleVariations = !LAB;
  interactables = director.boxes.map((b) => director!.interactable(b)).filter((x): x is Interactable => !!x);
  if (s.body) director.calibrate(s.body);
  if (!sound) { sound = new RoomSound(); if (gestured) sound.unlock(); sound.setEnabled(ui.audio); sound.setLevels(soundLevels.music, soundLevels.effects); sound.setChannels(soundSw.music, soundSw.effects); }
  roomUi.root.hidden = false; roomUi.applySkin();
  roomUi.ctx = { nickname: nicknameOverride || lastName || 'Mii', female: lastGender === 'f', greetings: greetCtx() };
  if (!LAB) ui.roomCam = 'original';
  if (prev && prev.state !== 'outside' && !forceEnter) director.restore(prev.pos, prev.heading, prev.currentClip === director.idleName ? prev.clipTime : 0);
  else director.enter();
  forceEnter = false;
  roomBgm();
  setDiag('Stanza', `roomBase00 + rmWl${ui.wall} + rmFl${ui.floor} (variante ${ui.variant}) · ${room!.model.stats.meshes} mesh`);
  setDiag('Luci', room!.lights?.source ?? orig.lights.source);
  setDiag('Camera', room!.camera ? `${room!.camera.source} · fov ${(room!.camera.fovRad * 180 / Math.PI).toFixed(1)}°` : 'mancante');
  setDiag('Velocità camminata', `${director.walkSpeed.toFixed(2)} u/s (dal ciclo WalkClone)`);
  setDiag('Oggetti interattivi', interactables.map((o) => `${o.name}→${o.clip.replace(/^anim/, '')}`).join(', ') || 'nessuno');
  const tx = textsAvailable();
  setDiag('Testi', tx.lang ? `${tx.lang} · ${tx.files} file MSBT` : 'non importati (PLACEHOLDER)');
  setDiag('Audio', `${sound.tablesLoaded}/${sound.tablesExpected} tabelle · ${sound.filesAvailable} file`);
  setDiag('Layout stanza', layoutAvailable() ? 'texture-room (sprite originali)' : 'non importato (stile CSS)');
  if (room!.notes.length) setDiag('Note stanza', room!.notes.join('; '));
  renderRoomControls();
}

let forceEnter = false;      // next room setup plays the entrance even if the Mii was already in (visits)
let friendHost: Personality | null = null;   // M16: watching a friend's room → BGM_MIIWATCH_FRIEND_<type> (DEDUCED)
/**
 * M17 scene music from the original table (Sound/Action/bgm.msbt): bgm_closetSceneInit, bgm_shopSceneInit,
 * bgm_cameraAppSceneInit (Miifoto), bgm_miiStudioSceneInit, bgm_miiStudioConfirmCharacter<Type>, bgm_CustomRoomScene.
 * null = back to the room music.
 */
let sceneMusic: string | null = null;
function setMusic(key: string | null) {
  sceneMusic = key;
  if (!sound) { sound = new RoomSound(); if (gestured) sound.unlock(); sound.setEnabled(ui.audio); sound.setLevels(soundLevels.music, soundLevels.effects); sound.setChannels(soundSw.music, soundSw.effects); }
  if (key) sound.bgm(key); else roomBgm();
}
function roomBgm() {
  if (sceneMusic && sound) { sound.bgm(sceneMusic); return; }
  if (!sound || !director) return;
  // bgm_room lines: NORMAL_DAY (default), NOBODY, FRIEND_*, NORMAL_NIGHT. NOBODY while the room is empty: DEDUCED.
  if (friendHost !== null && director.state !== 'outside') { sound.bgm('bgm_room', `BGM_MIIWATCH_FRIEND_${PERSONALITIES[friendHost].toUpperCase()}`); return; }
  // M18: a friend visiting the user's room → bgm_room line FRIEND_<guest type> (the native callers pass type + 2: DEDUCED use)
  const g0 = guests.find((g) => g.director.state !== 'outside');   // several friends (Reboot): the first one present sets the line
  if (g0) { sound.bgm('bgm_room', `BGM_MIIWATCH_FRIEND_${PERSONALITIES[g0.personality].toUpperCase()}`); return; }
  sound.bgm('bgm_room', director.state === 'outside' ? 'BGM_MIIWATCH_NOBODY' : isNight() ? 'BGM_MIIWATCH_NORMAL_NIGHT' : undefined);
}

function touchMenu(): MenuItem[] {
  const ask = lbl('Layout/room/parts/layer2/balloonTextBtn02.msbt', 'title00@balloonMenuR', 'Chiedi qualcosa!');
  const recent = lbl('Layout/room/parts/layer2/balloonTextBtn02.msbt', 'title00@balloonMenuL', 'Sai, di recente...');
  const greet = lbl('Layout/room/parts/layer2/iconTextBtnL00.msbt', 'title00@greeting', 'Saluti');
  const closet = lbl('Layout/room/parts/layer2/balloonTextBtn01.msbt', 'title00@goCloset', 'Cambia abbigliamento');
  const stop = lbl('Layout/room/parts/layer1/cmnBtn01.msbt', 'title00@knowledgeOk', 'Interrompi');
  return [
    // offline there are no questions: the game's own "no question left" line (label noQuestion) - mapping DEDUCED
    { id: 'ask', ...ask, action: () => roomUi.show({ kind: 'answer', rel: T_ROOM, label: 'noQuestion', fallback: 'Non ho domande, per ora.', ok: true }) },
    // "Sai, di recente…": the original flow runs; its content (friends' answers) is SERVER DATA MISSING — see Play.openRecent
    { id: 'recent', ...recent, action: () => { roomUi.close(true); if (play && playApi.onRecent) playApi.onRecent(); } },
    { id: 'greet', text: greet.text.replace(/\n/g, ' '), src: greet.src, action: () => { roomUi.close(true); director?.waveReaction(); } },
    { id: 'closet', ...closet, action: () => { roomUi.close(true); if (play) play.openCloset(); else ($('sceneSeg').querySelector('button[data-v="lab"]') as HTMLButtonElement).click(); } },
    { id: 'close', ...stop, action: () => roomUi.close() }
  ];
}

let talkGesture = false;   // a talking gesture keeps the balloon open
function onDirectorEvent(e: DirectorEvent) {
  switch (e.type) {
    case 'clip': sound?.clipStart(e.name); break;
    case 'frame': sound?.clipFrame(e.name, e.frame); break;
    case 'door': doorOwner = director; sound?.action(`doorAnim/${e.name}`); break;
    case 'touch': sound?.play('se_nade01', 'SequenceTouch:se_nade01'); playEffect('arStroke'); break;   // SequenceTouch: animActionStroked + character/arStroke.xml (REVERSED table, M8)   // SequenceTouch table (REVERSED), timing DEDUCED
    case 'grab': roomUi.close(true); sound?.play('se_ui_hand_00', 'SequenceTouch:se_ui_hand_00'); break;   // DEDUCED pairing
    case 'release': sound?.play('se_ui_hand_01', 'SequenceTouch:se_ui_hand_01'); break;
    case 'gesture': talkGesture = true; break;
    case 'state':
      if (e.to === 'idle') talkGesture = false;
      if (e.to !== 'idle' && !talkGesture && (roomUi.openKind === 'touch' || roomUi.openKind === 'answer')) roomUi.close(true);
      if (e.to === 'exiting') roomUi.show({ kind: 'goodbye', rel: T_COMMON, label: 'defaultGoodByeGoHome', fallback: 'È ora di andare.', autoClose: 1.4 });
      if (e.to === 'outside') roomUi.close(true);
      if (e.to === 'outside' || e.from === 'outside') roomBgm();
      break;
    case 'reactionEnd':
      if (e.kind === 'greeting' && play && playApi.onEnterGreeting?.(true)) break;
      if (e.kind === 'greeting') roomUi.show({ kind: 'greeting', rel: T_ROOM, label: isNight() ? 'fixedGreetingNight' : 'fixedGreeting', fallback: 'Ciao!', autoClose: 2.2 });
      if (e.kind === 'touch') roomUi.show({ kind: 'touch', rel: T_ROOM, label: 'mySubMii0', fallback: 'Hai bisogno di qualcosa?', menu: touchMenu() });
      break;
  }
}

let framing: { cam: RoomCamera; aspect: number; position: THREE.Vector3; target: THREE.Vector3; dolly: number; shiftNdc: number } | null = null;
/** PLAY: original camera dollied back to fit the room on a landscape PC window (WEB ADAPTATION, room/RoomFraming.ts). The Lab keeps the raw camera. */
function playFraming(c: RoomCamera) {
  if (LAB) return { cam: c, aspect: W / H, position: c.position, target: c.target, dolly: 0, shiftNdc: 0 };
  if (framing?.cam !== c || framing.aspect !== W / H) framing = { cam: c, aspect: W / H, ...framedRoomCamera(c, W / H) };
  return framing;
}
function roomTick(dt: number) {
  const s = slots[ui.shade === 'ab' ? 'original' : ui.shade];
  const d = director!, r = room!;
  const pose = d.update(dt);
  for (const p of s.parts) if (!p.group.userData.acce) p.applyPose(pose.clip, pose.frame, pose.blend);
  placeAccessories(s);
  effects.update(dt, (bone) => s.body?.jointFrame(bone) ?? null); sfxTick(dt);
  s.root.visible = true;
  s.root.position.copy(d.pos);
  s.root.rotation.set(0, d.heading + (closetCam.on ? ccam.yaw : 0), 0);
  s.root.visible = d.state !== 'outside';
  if (closetCam.on) closetCamTick(dt);
  if (venue === 'shop') { s.root.position.copy(SHOP_SPOT); s.root.rotation.set(0, 0, 0); s.root.visible = true; }
  for (const g of [...guests]) guestTick(g, dt);
  socialTick(dt);
  const dd = doorOwner && guests.some((g) => g.director === doorOwner) ? doorOwner : d;
  r.model.applyPose(dd.door.clip, dd.door.t);
  // camera
  const c = r.camera;
  camera.aspect = W / H;
  if (closetCam.on) {
    // userData/closet_camera.xml (APK): Position (0,8,40), Aim (0,8,0) relative to the Mii, FovY 0.5236, near 5, far 100;
    // closet_camera detail_x -0.55 = Mii shifted left while the detail panel is open (offset interpretation DEDUCED)
    camera.fov = 30; camera.near = 5; camera.far = 100; camera.up.set(0, 1, 0);
    const cp = venue === 'shop' ? SHOP_SPOT : d.pos;
    if (venue === 'shop') camera.far = 200;   // the shop interior is the background
    camera.position.set(cp.x + ccam.look[0], ccam.look[1], cp.z + 40 * ccam.scale); camera.lookAt(cp.x + ccam.look[0], ccam.look[1], cp.z);
    camera.setViewOffset(W, H, (closetCam.detail ? 0.55 : 0) * W / 2, 0, W, H);
  } else if (c && ui.roomCam !== 'free') {
    camera.fov = (c.fovRad * 180) / Math.PI; camera.near = 1; camera.far = 400;   // near/far: APPROXIMATED (POD: 0.1 / 1e4)
    camera.up.copy(c.up);
    if (ui.roomCam === 'original') { const f = playFraming(c); camera.position.copy(f.position); camera.lookAt(f.target); if (f.shiftNdc) camera.setViewOffset(W, H, 0, (f.shiftNdc * H) / 2, W, H); else if (camera.view?.enabled) camera.clearViewOffset(); }
    else { // follow: original camera translated toward the Mii (APPROXIMATED)
      const head = (s.body?.jointPosition('Head')?.y ?? 6) ;
      camera.position.set(c.position.x + d.pos.x * 0.6, c.position.y - 6, c.position.z + d.pos.z * 0.5 - 12);
      camera.lookAt(d.pos.x, head * 0.8, d.pos.z);
    }
  } else {
    camera.fov = 40; camera.near = 1; camera.far = 600; camera.up.set(0, 1, 0);
    const r0 = 90 * view.dist / 1000;
    camera.position.set(Math.sin(view.yaw) * r0, 30 + view.pitch * 60, Math.cos(view.yaw) * r0);
    camera.lookAt(0, 10, 0);
  }
  if (!closetCam.on && !(c && ui.roomCam === 'original' && framing?.shiftNdc) && camera.view?.enabled) camera.clearViewOffset();
  camera.updateProjectionMatrix();
  // M8: destination marker, overlay (status, balloon anchor, object badges)
  marker.visible = !!d.target && d.state !== 'outside';
  if (d.target) { marker.position.set(d.target.x, 0.08, d.target.z); marker.scale.setScalar(1 + 0.12 * Math.sin(performance.now() / 180)); }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
  renderer.clear();
  renderer.render(scene, camera);
  const headY = (s.body?.jointPosition('Head')?.y ?? 6) + 5;
  const spk = roomUi.speaker === 'guest' && talker && guests.includes(talker) ? talker.director : d;
  const a = stagePoint(spk.pos.x, headY, spk.pos.z);
  roomUi.anchor = { x: a.x, y: a.y, visible: spk.state !== 'outside' };
  roomUi.tick(dt);
  faceTick(dt, s);
  roomUi.setStatus(d.state, STATE_LABEL[d.state], d.currentClip.replace(/^anim/, ''), d.intent ? `${d.intent.label} · ${d.intent.clip.replace(/^anim/, '')}` : '');
  roomUi.setBadges(ui.showObjects ? interactables.map((o) => { const p = stagePoint((o.box.min.x + o.box.max.x) / 2, (o.box.top ?? 10) + 2, (o.box.min.y + o.box.max.y) / 2); return { name: o.name, label: o.label, x: p.x, y: p.y, visible: p.inFront && d.state !== 'outside', active: hoverName === o.name || d.intent?.name === o.name }; }) : []);
  $('hudInfo').textContent = `Stanza · ${STATE_LABEL[d.state]} · ${d.currentClip.replace(/^anim/, '')}`;
}
/**
 * Living face (M10): mouth opens/closes while the balloon types (open/closed mouth pairs, fc_OpenedMouth/ClosedMouth
 * in the game data — the lip-sync from the TTS is not available, so the 8 Hz flap is APPROXIMATED) and occasional
 * blinks (BLINK / BLINK_OPEN_MOUTH, timing APPROXIMATED). Only for the six base expressions that have pairs.
 */
const face = { blinkT: 3.2, blinking: 0, cur: -1, mouthT: 0, seed: 7 };
function faceTick(dt: number, s: Slot) {
  const head = s.head as { setExpression?: (e: number) => void } | null; if (!head?.setExpression) return;
  if (emoFace && !roomUi.isOpen) emoFace = null;
  const hostTalking = roomUi.isTalking && roomUi.speaker === 'host';
  if (emoFace) {                                   // emotion face: default / opened / closed mouth from Face.msbt
    let want = emoFace.def;
    if (hostTalking) { face.mouthT += dt; want = Math.floor(face.mouthT * 8) % 2 === 0 ? emoFace.open : emoFace.closed; } else face.mouthT = 0;
    if (want !== face.cur) { try { head.setExpression(want); face.cur = want; } catch { face.cur = want; } }
    return;
  }
  if (ui.expression > 5) return;
  const base = ui.expression; let want = base;
  if (hostTalking) { face.mouthT += dt; if (Math.floor(face.mouthT * 8) % 2 === 0) want = openMouth(base); } else face.mouthT = 0;
  face.blinkT -= dt;
  if (face.blinkT <= 0) { face.blinking = 0.13; face.seed = (face.seed * 9301 + 49297) % 233280; face.blinkT = 2.5 + (face.seed / 233280) * 3; }
  if (face.blinking > 0) { face.blinking -= dt; want = want === base ? 5 : 11; }
  if (want !== face.cur) { try { head.setExpression(want); face.cur = want; } catch { face.cur = want; } }
}
/** Room point -> pixels inside the stage element. */
function stagePoint(x: number, y: number, z: number) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, inFront: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
}

/** Test hook: advances the room simulation by `sec` seconds in fixed steps, then renders one frame. */
function simRoom(sec: number, step = 1 / 30) {
  if (!director) return;
  const s = slots[ui.shade === 'ab' ? 'original' : ui.shade];
  for (let t = 0; t < sec; t += step) { director.update(step); for (const g of [...guests]) guestTick(g, step); socialTick(step); roomUi.tick(step); effects.update(step, (bone) => s.body?.jointFrame(bone) ?? null); sfxTick(step); }
  roomTick(0);
}
/** Projects a room-space point to canvas pixels (tests). */
function projectRoom(x: number, y: number, z: number) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  const r = canvas.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}


// ---------------- M18: a friend in the user's room (two Miis) ----------------
/**
 * A visiting friend (SequenceByeFriendInUserRoom, telop "{1.0} è qui!", greetings 1.5 / 1.2 on arrival and 1.4 / 1.3
 * on leaving — ORIGINAL texts, who-says-what DEDUCED from the Saluti labels). The guest has its own body, head,
 * director (state machine, path, door), faces, gestures, voice settings and sounds; the room, door and furniture are
 * shared. Arrival spot, personal distance, wandering and the visit schedule are APPROXIMATED (server-driven originally).
 */
interface Guest { spec: GuestSpec; slot: Slot; director: RoomDirector; personality: Personality; ctx: RenderCtxT; female: boolean; face: { cur: number; mouthT: number; blinkT: number; blinking: number; seed: number }; emo: FaceTriple | null; leaving: boolean; leaveWanted: boolean; log: string[]; byeT?: number; byeGo?: () => void }
type RenderCtxT = { nickname: string; female: boolean; greetings: Record<string, string> };
/**
 * Visiting Miis in the room. CLASSIC: one friend at a time (guestCap 1 — the original visit flow shows one friend;
 * a second visit while one is there was not observed, APPROXIMATED). REBOOT (MULTI_MII flag) raises the capacity: the same
 * guest machinery runs N times (each guest its own body, director, faces, voice), the door is shared (one Mii through it
 * at a time: arrivals wait their turn).
 */
export const MAX_GUESTS = 7;          // host + 7 = 8 Miis (Reboot target)
const guests: Guest[] = [];
const guestListeners = new Set<(e: { type: 'arrive' | 'leave'; id: string; name: string }) => void>();
function emitGuest(e: { type: 'arrive' | 'leave'; id: string; name: string }) { playApi.onGuest?.(e); for (const l of guestListeners) { try { l(e); } catch (err) { console.warn(err); } } }
let guestCap = 1;
let talker: Guest | null = null;
let guestSerial = 0;      // the guest whose balloon is shown (speaker 'guest')
const waiting: { g: Guest; spot: THREE.Vector3 | null }[] = [];   // built, waiting for the door
/** Every Mii keeps its personal distance from all the others present (host + guests). */
function linkOthers() {
  const present = () => [director, ...guests.map((g) => g.director)].filter((x): x is RoomDirector => !!x && x.state !== 'outside');
  if (director) { const h = director; h.others = () => present().filter((o) => o !== h).map((o) => o.pos); }
  for (const g of guests) { const gd = g.director; gd.others = () => present().filter((o) => o !== gd).map((o) => o.pos); }
}
const doorBusy = () => [director, ...guests.map((g) => g.director)].some((x) => !!x && (x.state === 'entering' || x.state === 'exiting'));
function guestSay(g: Guest, spec: Parameters<RoomUI['show']>[0]) { talker = g; roomUi.show({ ...spec, speaker: 'guest', ctx: g.ctx as any }); }

// ---- Reboot R2b hooks: a read / command surface over the SAME room machinery (no logic of their own) ----
// Used only through RebootHost (reboot/social). In Classic nobody subscribes: every emit is a no-op loop over an empty set.
let guestWanderOn = true;            // built-in M18 wandering; the Reboot social layer turns it off and plans walks itself
const tickListeners = new Set<(dt: number) => void>();
const speechListeners = new Set<(e: { speaker: string | null }) => void>();
const playerListeners = new Set<(e: { id: string; kind: string }) => void>();
function socialTick(dt: number) { if (pendingSays.length) sayWatch(); if (tickListeners.size && dt > 0) for (const l of tickListeners) { try { l(dt); } catch (e) { console.warn(e); } } }
function emitSpeech(speaker: string | null) { for (const l of speechListeners) { try { l({ speaker }); } catch (e) { console.warn(e); } } }
function emitPlayer(id: string, kind: string) { for (const l of playerListeners) { try { l({ id, kind }); } catch (e) { console.warn(e); } } }
function directorOf(id: string): RoomDirector | null { return id === 'host' ? director : guests.find((g) => g.spec.id === id)?.director ?? null; }
function miiViews() {
  const v = (id: string, name: string, p: Personality, d: RoomDirector, extra: { isHost: boolean; leaving: boolean; waiting: boolean }) =>
    ({ id, name, personality: p, x: d.pos.x, z: d.pos.z, heading: d.heading, state: d.state as string, ...extra });
  const out = director ? [v('host', nicknameOverride || lastName || 'Mii', personality, director, { isHost: true, leaving: false, waiting: false })] : [];
  for (const g of guests) out.push(v(g.spec.id, g.spec.name, g.personality, g.director, { isHost: false, leaving: g.leaving, waiting: waiting.some((q) => q.g === g) }));
  return out;
}
let sayN = 0;
const pendingSays: { label: string; done: (r: 'done' | 'interrupted') => void; seen: boolean }[] = [];
/** One Mii says a line in the (single) room balloon. Resolves when it closes, or 'interrupted' if something replaced it. */
function socialSay(id: string, text: string, autoClose: number, lang?: string): Promise<'done' | 'interrupted' | 'busy'> {
  if (roomUi.isOpen || ui.scene !== 'room' || venue !== 'room' || closetCam.on) return Promise.resolve('busy');
  const g = id === 'host' ? null : guests.find((x) => x.spec.id === id) ?? null;
  const d = directorOf(id);
  if (!d || d.state === 'outside' || (id !== 'host' && !g)) return Promise.resolve('busy');
  const label = `reboot:chat:${++sayN}`;
  return new Promise((res) => {
    let settled = false;
    const done = (r: 'done' | 'interrupted') => { if (settled) return; settled = true; sayLangs.delete(label); const i = pendingSays.findIndex((q) => q.label === label); if (i >= 0) pendingSays.splice(i, 1); res(r); };
    if (lang) sayLangs.set(label, lang);
    pendingSays.push({ label, done, seen: false });
    const spec = { kind: 'chat' as const, rel: T_ROOM, label, fallback: text, text, autoClose, onClose: () => done('done') };
    if (g) guestSay(g, spec); else roomUi.show({ ...spec, speaker: 'host' });
  });
}
/** Per frame: a pending chat line whose balloon is no longer the one shown was interrupted (tap, menu, greeting...). */
function sayWatch() { for (const q of [...pendingSays]) { if (roomUi.openLabel === q.label) q.seen = true; else q.done('interrupted'); } }
let doorOwner: RoomDirector | null = null;
const guestLog: string[] = [];
const glog = (m: string) => { guestLog.push(m); if (guestLog.length > 100) guestLog.shift(); };
function guestCtx(sp: GuestSpec, female: boolean): RenderCtxT {
  const g = sp.greetings;
  return { nickname: sp.name, female, greetings: { '1.2': g.welcome || greetDef('defaultGreetingWelcome', 'Ciao!'), '1.3': g.seeingOff || greetDef('defaultGoodByeSeeingOff', 'Torna presto!'), '1.4': g.goHome || greetDef('defaultGoodByeGoHome', "È ora di andare."), '1.5': g.goIn || greetDef('defaultGreetingGoIn', 'È permesso?') } };
}
/** Builds the guest's head + clothes like buildSlot, without touching the host's state. */
function buildGuestSlot(sp: GuestSpec, kind: ShaderKind): { slot: Slot; female: boolean } {
  const s: Slot = { kind, root: new THREE.Group(), head: null, headGroup: null, body: null, parts: [] };
  const pre = resolveOutfit(sp.outfit, 'm');
  const hat = pre.parts.some((p) => p.cat === 'headwear');
  let r: ReturnType<typeof engine.build>;
  const hostHead = engine.current;   // the host's head is owned by its slot (engine.current is null after buildSlot)
  try { r = engine.build(sp.miiData, FFLExpression.NORMAL, kind, hat, neededFaces()); }
  catch { r = engine.build(sp.miiData, FFLExpression.NORMAL, kind, hat); }
  s.head = engine.current; engine.current = hostHead;
  s.headGroup = r.group;
  const gender = r.gender === 1 ? 'f' : 'm';
  const bs = ui.scaleOn ? computeBodyScale(sp.height ?? r.height, sp.build ?? r.build) : null;
  const skin = new THREE.Vector4(r.skin.r, r.skin.g, r.skin.b, 1);
  const hc = r.hair as THREE.Color | null; const hair = hc ? new THREE.Vector4(hc.r, hc.g, hc.b, 1) : new THREE.Vector4(1, 1, 1, 1);
  const res = resolveOutfit(sp.outfit, gender);
  for (const part of res.parts) {
    const m = new BodyModel(itemPackage(part.cat, part.id), part.stem, kind, LUTShaderMaterial, part.color);
    m.setMaterialFilter((mat) => materialVisible(part, mat));
    m.skinColor.copy(skin); m.hairColor.copy(hair); m.bodyScale = bs;
    if (part.cat === 'acce') m.group.userData.acce = accessoryTransform(part.xml.accessory, bs);
    if (part.cat === 'headwear') { m.group.userData.headwear = true; s.parts.push(m); continue; }
    s.parts.push(m); s.root.add(m.group);
  }
  const skel = s.parts.find((p) => p.jointFrame('Head') && !p.group.userData.headwear) ?? null;
  s.body = skel;
  if (skel) {
    skel.headAnchor.add(r.group);
    for (const p of s.parts) if (p.group.userData.headwear) { p.applyPose(null, 0); p.group.scale.setScalar(10); skel.headAnchor.add(p.group); }
  } else s.root.add(r.group);
  s.root.scale.setScalar(1);
  return { slot: s, female: gender === 'f' };
}
/** Removes one guest at once (or all of them). */
function disposeGuest(g?: Guest) {
  const list = g ? [g] : [...guests];
  if (!list.length) return;
  for (const x of list) {
    const i = guests.indexOf(x); if (i < 0) continue;
    guests.splice(i, 1);
    const w = waiting.findIndex((q) => q.g === x); if (w >= 0) waiting.splice(w, 1);
    const e = exitQueue.indexOf(x); if (e >= 0) exitQueue.splice(e, 1);
    const b = byeQueue.indexOf(x); if (b >= 0) byeQueue.splice(b, 1);
    if (byeActive === x) { byeActive = null; nextBye(); }
    disposeSlot(x.slot); x.slot.root.removeFromParent();
    if (doorOwner === x.director) doorOwner = null;
    if (talker === x) { if (roomUi.speaker === 'guest') roomUi.close(true); talker = null; }
  }
  linkOthers();
  roomBgm();
}
/** Free spot next to the host, on the room side of it (APPROXIMATED). */
function arrivalSpot(): THREE.Vector3 {
  const h = director!.pos;
  const taken = [h, ...guests.filter((g) => g.director.state !== 'outside').map((g) => g.director.target ?? g.director.pos)];
  const cands = [new THREE.Vector3(h.x + 7, 0, h.z + 2), new THREE.Vector3(h.x - 7, 0, h.z + 2), new THREE.Vector3(h.x, 0, h.z + 8), new THREE.Vector3(h.x + 5, 0, h.z - 6),
    new THREE.Vector3(h.x - 6, 0, h.z - 6), new THREE.Vector3(h.x + 12, 0, h.z + 9), new THREE.Vector3(h.x - 12, 0, h.z + 9), new THREE.Vector3(h.x, 0, h.z + 15)];
  for (const c of cands) { const q = director!.clampToRoom(c); if (taken.every((t) => q.distanceTo(t) >= RoomDirector.PERSONAL + 0.5)) return q; }
  for (let i = 0; i < 24; i++) { const q = director!.clampToRoom(new THREE.Vector3(-26 + Math.random() * 52, 0, -20 + Math.random() * 46)); if (taken.every((t) => q.distanceTo(t) >= RoomDirector.PERSONAL + 0.5)) return q; }
  return director!.clampToRoom(new THREE.Vector3(8, 0, 4));
}
async function guestArrive(sp: GuestSpec, opts?: { inside?: { x: number; z: number } }): Promise<boolean> {
  const full = () => guests.length >= guestCap || guests.some((g) => g.spec.id === sp.id);
  if (full() || !room || !director || ui.scene !== 'room' || venue !== 'room' || !engine.ready) return false;
  const keys = Object.entries(sp.outfit).filter(([k, v]) => k !== 'tuck' && v).map(([c, v]) => `asset/model/character/${CAT_DIR[c as Category]}/output/${CAT_DIR[c as Category]}${(v as { id: string }).id}`);
  await vfs.ensure(keys);
  if (full() || !room || !director) return false;
  const kind = ui.shade === 'ab' ? 'original' : ui.shade;
  // cold files (base 9999 items the resolver adds, item packages): load what the build missed and try again (like rebuild())
  let built: { slot: Slot; female: boolean } | null = null;
  for (let round = 0; round < 8 && !built; round++) {
    vfs.misses.clear();
    try { built = buildGuestSlot(sp, kind); }
    catch (e) {
      if (!(e instanceof ColdMiss) && !vfs.misses.size) { console.warn('ospite non costruito', e); return false; }
      const keys = [...vfs.misses]; if (!keys.length) { console.warn('ospite non costruito', e); return false; }
      await vfs.ensure(keys);
    }
    if (built && vfs.misses.size) { disposeSlot(built.slot); built = null; await vfs.ensure([...vfs.misses]); }
  }
  if (!built) return false;
  if (full() || !room || !director) { disposeSlot(built.slot); return false; }
  pivot.add(built.slot.root);
  const gd = new RoomDirector(orig.anims, built.female, room.doorOpen, room.doorClose);
  gd.boxes = director.boxes; gd.idleVariations = !LAB; gd.wander = guestWanderOn;
  gd.reseed(++guestSerial);
  if (built.slot.body) gd.calibrate(built.slot.body);
  const n = guests.length;
  const g: Guest = { spec: sp, slot: built.slot, director: gd, personality: personalityType(sp.personality), ctx: guestCtx(sp, built.female), female: built.female, face: { cur: -1, mouthT: 0, blinkT: 2.1 + n * 0.7, blinking: 0, seed: 11 + n * 977 }, emo: null, leaving: false, leaveWanted: false, log: [] };
  guests.push(g);
  gd.onEvent = (e) => onGuestEvent(g, e);
  linkOthers();
  built.slot.root.visible = false;
  if (opts?.inside) {
    // REBOOT places (R5): somebody who was already in that room (the resident, earlier visitors) — no door, no greeting
    const at = director.clampToRoom(new THREE.Vector3(opts.inside.x, 0, opts.inside.z));
    gd.restore(at, Math.atan2(-at.x, 12 - at.z));
    glog(`già dentro ${sp.name}`);
    emitGuest({ type: 'arrive', id: sp.id, name: sp.name });
    roomBgm();
  } else if (doorBusy() || waiting.length) { waiting.push({ g, spot: null }); glog(`in attesa della porta ${sp.name}`); }
  else startArrival(g);
  return true;
}
/** The guest comes through the (shared) door. */
function startArrival(g: Guest) {
  doorOwner = g.director;
  g.director.enter(arrivalSpot());
  glog(`arrivo ${g.spec.name}`);
  emitGuest({ type: 'arrive', id: g.spec.id, name: g.spec.name });
  roomBgm();
}
/** SequenceByeFriendInUserRoom: guest says its goHome (1.4), the host its seeingOff (1.3), the guest leaves. */
function guestLeave(which?: Guest) {
  const g = which ?? guests.find((x) => !x.leaving); if (!g || g.leaving) return false;
  const w = waiting.findIndex((q) => q.g === g);
  if (w >= 0) { waiting.splice(w, 1); disposeGuest(g); emitGuest({ type: 'leave', id: g.spec.id, name: g.spec.name }); return true; }
  if (g.director.state !== 'idle' && g.director.state !== 'walking') { g.leaveWanted = true; return true; }
  g.leaving = true; g.leaveWanted = false;
  glog(`congedo ${g.spec.name}`);
  // several friends leaving at once (Reboot): one goodbye exchange at a time, the others wait their turn
  if (byeActive && byeActive !== g && guests.includes(byeActive)) { byeQueue.push(g); return true; }
  startBye(g);
  return true;
}
let byeActive: Guest | null = null;
const byeQueue: Guest[] = [];
function startBye(g: Guest) {
  byeActive = g; g.byeT = 0;
  roomUi.close(true);
  let done = false;
  const go = () => { if (done) return; done = true; if (byeActive === g) byeActive = null; if (guests.includes(g)) waitDoor(g); nextBye(); };
  g.byeGo = go;
  const hostSay = () => {
    if (!guests.includes(g)) return go();
    if (director && director.state !== 'outside') director.faceToward(g.director.pos, () => roomUi.show({ kind: 'goodbye', rel: T_ROOM, label: 'customGreetingSeeingOff', fallback: 'Torna presto!', autoClose: 1.6, speaker: 'host', onClose: go }));
    else go();
  };
  const toHost = director && director.state !== 'outside' ? director.pos.clone() : new THREE.Vector3(0, 0, 10);
  g.director.faceToward(toHost, () => guestSay(g, { kind: 'goodbye', rel: T_ROOM, label: 'customGreetingGoHome', fallback: "È ora di andare.", autoClose: 1.6, onClose: hostSay }));
}
function nextBye() { while (byeQueue.length) { const n = byeQueue.shift()!; if (guests.includes(n)) { startBye(n); return; } } }
/** Exits through the door when it is free (one Mii through the shared door at a time). */
const exitQueue: Guest[] = [];
function waitDoor(g: Guest) { if (doorBusy() || exitQueue.length) { if (!exitQueue.includes(g)) exitQueue.push(g); } else g.director.exit(); }
/** Door queue: pending arrivals and exits go one at a time. */
function doorTick() {
  if (doorBusy()) return;
  const out = exitQueue.shift(); if (out) { if (guests.includes(out) && !out.director.exit()) exitQueue.push(out); return; }   // busy (e.g. a short reaction): try again next tick
  const w = waiting.shift(); if (w && guests.includes(w.g)) startArrival(w.g);
}
function onGuestEvent(g: Guest, e: DirectorEvent) {
  if (!guests.includes(g)) return;
  switch (e.type) {
    case 'clip': sound?.clipStart(e.name); break;
    case 'frame': sound?.clipFrame(e.name, e.frame); break;
    case 'door': doorOwner = g.director; sound?.action(`doorAnim/${e.name}`); break;
    case 'touch': sound?.play('se_nade01', 'SequenceTouch:se_nade01'); playEffect('arStroke', g.slot.root); break;
    case 'state':
      if (e.to === 'outside' && e.from === 'exiting') { glog(`uscito ${g.spec.name}`); emitGuest({ type: 'leave', id: g.spec.id, name: g.spec.name }); disposeGuest(g); }
      break;
    case 'reactionEnd':
      if (e.kind === 'greeting') {
        // arrival: the guest says its "Saluto (entra nella stanza di qualcuno)" (customGreeting, tag 1.5) while it waves,
        // then the host turns to it and answers with its "Saluto (arriva qualcuno nella stanza)" (customGreetingWelcome, 1.2)
        const hostAnswer = () => {
          if (!guests.includes(g) || !director || director.state === 'outside') return;
          director.faceToward(g.director.pos, () => { roomUi.show({ kind: 'greeting', rel: T_ROOM, label: 'customGreetingWelcome', fallback: 'Ciao!', autoClose: 1.8, speaker: 'host' }); director?.waveReaction(); });
        };
        roomUi.close(true);
        guestSay(g, { kind: 'greeting', rel: T_ROOM, label: 'customGreeting', fallback: 'È permesso?', autoClose: 1.8, onClose: hostAnswer });
      }
      if (e.kind === 'touch') guestSay(g, { kind: 'greeting', rel: T_ROOM, label: isNight() ? 'fixedGreetingNight' : 'fixedGreeting', fallback: 'Ciao!', autoClose: 1.6 });
      break;
  }
}
/** Per frame: the guest's pose, position, face and the shared door. */
function guestTick(g: Guest, dt: number) {
  if (g === guests[0]) doorTick();
  if (waiting.some((q) => q.g === g)) { g.slot.root.visible = false; return; }
  if (g.leaveWanted) guestLeave(g);
  // goodbye watchdog: if its goodbye balloon was replaced (another Mii talked, the player tapped), it still goes
  // and a leaving guest that never got to the door (queue broken) goes anyway after a while
  if (g.leaving && g.director.state === 'idle' && !exitQueue.includes(g)) {
    g.byeT = (g.byeT ?? 0) + dt;
    if (g.byeGo && g.byeT > 8) { const go = g.byeGo; g.byeGo = undefined; go(); }
    else if (g.byeT > 20) { g.byeT = 0; const q = byeQueue.indexOf(g); if (q >= 0) byeQueue.splice(q, 1); if (byeActive === g) byeActive = null; waitDoor(g); nextBye(); }
  }
  const pose = g.director.update(dt);
  for (const p of g.slot.parts) if (!p.group.userData.acce) p.applyPose(pose.clip, pose.frame, pose.blend);
  placeAccessories(g.slot);
  g.slot.root.position.copy(g.director.pos);
  g.slot.root.rotation.set(0, g.director.heading, 0);
  g.slot.root.visible = g.director.state !== 'outside' && venue === 'room' && !closetCam.on;
  const head = g.slot.head as { setExpression?: (e: number) => void } | null;
  if (head?.setExpression) {
    const mine = roomUi.speaker === 'guest' && talker === g;
    const talking = roomUi.isTalking && mine;
    if (g.emo && !(roomUi.isOpen && mine)) g.emo = null;
    let want: number;
    if (g.emo) { want = g.emo.def; if (talking) { g.face.mouthT += dt; want = Math.floor(g.face.mouthT * 8) % 2 === 0 ? g.emo.open : g.emo.closed; } }
    else {
      want = 0;
      if (talking) { g.face.mouthT += dt; if (Math.floor(g.face.mouthT * 8) % 2 === 0) want = openMouth(0); } else g.face.mouthT = 0;
      g.face.blinkT -= dt;
      if (g.face.blinkT <= 0) { g.face.blinking = 0.13; g.face.seed = (g.face.seed * 9301 + 49297) % 233280; g.face.blinkT = 2.5 + (g.face.seed / 233280) * 3; }
      if (g.face.blinking > 0) { g.face.blinking -= dt; if (want === 0) want = 5; }
    }
    if (want !== g.face.cur) { try { head.setExpression(want); } catch { /* */ } g.face.cur = want; }
  }
}

type Pick = { kind: 'door' | 'mii' | 'guest' | 'object' | 'furniture' | 'floor' | 'none'; name: string; point: THREE.Vector3 | null; obj?: Interactable; guestId?: string };
/** What is under the pointer. Same priorities as M7: door when reached first / Mii standing in front of it, then Mii, furniture, floor. */
function roomPick(cx: number, cy: number): Pick {
  const none: Pick = { kind: 'none', name: '', point: null };
  if (!room || !director) return none;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
  const s = slots[ui.shade === 'ab' ? 'original' : ui.shade];
  // Mii: vertical capsule around the root (skinning happens on the GPU, so no triangle raycast)
  const top = (s.body?.jointPosition('Head')?.y ?? 6) + 4;
  const miiHit = (() => {
    if (director.state === 'outside') return Infinity;
    const p = director.pos; let best = Infinity;
    for (let h = 0; h <= top; h += 0.5) { const q = new THREE.Vector3(p.x, h, p.z); const dd = ray.ray.distanceSqToPoint(q); if (dd < (h > top - 5 ? 9 : 4)) best = Math.min(best, ray.ray.origin.distanceTo(q)); }
    return best;
  })();
  // room meshes: box test first, then the real triangles (M8: avoids picking a plant through its leaf bounding box)
  let best = { d: Infinity, name: '', group: null as string | null };
  room.model.group.updateMatrixWorld(true);
  for (const o of room.model.group.children) {
    const m = o as THREE.Mesh; if (!m.isMesh || !m.visible) continue;
    if (!/^(door|doorKnob|doorFrame|shelf|book|chest|light|switch|cushion|planter|leaf|wood|photoframe|stand)/.test(m.name)) continue;
    const a = m.geometry.getAttribute('aPosition') as THREE.BufferAttribute;
    const lb = new THREE.Box3().setFromBufferAttribute(a);
    const b = lb.clone().applyMatrix4(m.matrixWorld);
    if (!ray.ray.intersectBox(b, new THREE.Vector3())) continue;
    const dd = rayMesh(ray.ray, m);
    if (dd !== null && dd < best.d) best = { d: dd, name: m.name, group: furnitureGroup(m.name, lb.min.x) };
  }
  if (best.name.startsWith('door') && (director.state === 'outside' || best.d <= miiHit + 2)) return { kind: 'door', name: best.name, point: null };
  let guestHit = Infinity, guestId = '';
  for (const g of guests) {
    if (g.director.state === 'outside' || !g.slot.root.visible) continue;
    const p = g.director.pos, gt = (g.slot.body?.jointPosition('Head')?.y ?? 6) + 4;
    for (let h = 0; h <= gt; h += 0.5) { const q = new THREE.Vector3(p.x, h, p.z); const dq = ray.ray.distanceSqToPoint(q); if (dq < (h > gt - 5 ? 9 : 4)) { const dd = ray.ray.origin.distanceTo(q); if (dd < guestHit) { guestHit = dd; guestId = g.spec.id; } } }
  }
  if (guestHit < best.d && guestHit < miiHit && guestHit < Infinity) return { kind: 'guest', name: 'guest', point: null, guestId };
  if (miiHit < best.d && miiHit < Infinity) return { kind: 'mii', name: 'mii', point: null };
  if (best.name.startsWith('door')) return { kind: 'door', name: best.name, point: null };
  if (best.name) {
    const hitP = ray.ray.at(best.d, new THREE.Vector3());
    const obj = best.group ? interactables.find((o) => o.name === best.group) : undefined;
    if (obj) return { kind: 'object', name: obj.name, point: hitP, obj };
    return { kind: 'furniture', name: best.name, point: hitP };
  }
  const floorP = new THREE.Vector3();
  if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), floorP)) return { kind: 'floor', name: 'floor', point: floorP };
  return none;
}

/** Click: Mii -> reaction + talk; door -> exit/enter; interactive object -> walk + use it; furniture / floor -> walk. */
/** REBOOT (visited rooms): may the player use this object? null = always (Classic). */
let objectPolicy: ((name: string) => boolean) | null = null;
/** REBOOT Miifoto 2: square JPEG of the current room view (the WebGL buffer is preserved). */
function snapshot(size: number): string | null {
  if (!room || !director || ui.scene !== 'room' || venue !== 'room') return null;
  roomTick(0);
  const s = Math.min(canvas.width, canvas.height); if (!s) return null;
  const out = document.createElement('canvas'); out.width = out.height = Math.max(64, Math.min(1024, Math.round(size)));
  const c = out.getContext('2d')!; c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height);
  c.drawImage(canvas, (canvas.width - s) / 2, (canvas.height - s) / 2, s, s, 0, 0, out.width, out.height);
  try { return out.toDataURL('image/jpeg', 0.85); } catch { return null; }
}
function roomClick(cx: number, cy: number): string {
  if (!room || !director || closetCam.on || venue === 'shop') return 'none';
  const p = roomPick(cx, cy);
  if (p.kind !== 'none') emitPlayer(p.kind === 'guest' ? p.guestId ?? '' : 'host', p.kind);
  if (p.kind !== 'mii' && p.kind !== 'none' && roomUi.isOpen && roomUi.openKind !== 'greeting' && roomUi.openKind !== 'goodbye') roomUi.close(true);
  switch (p.kind) {
    case 'door': director.state === 'outside' ? director.enter() : director.exit(); return 'door';
    case 'mii': director.touch(); return 'mii';
    case 'guest': { const g = guests.find((x) => x.spec.id === p.guestId); if (g && !g.leaving) g.director.touch(); return 'guest'; }   // SequenceTouch on the friend (DEDUCED)
    case 'object': if (objectPolicy && !objectPolicy(p.name)) return 'object-denied:' + p.name; director.interact(p.obj!); return 'object:' + p.name;
    case 'furniture': director.goTo(new THREE.Vector3(p.point!.x, 0, p.point!.z)); return 'furniture:' + p.name;
    case 'floor': director.goTo(p.point!); return 'floor';
  }
  return 'none';
}
function roomHover(cx: number, cy: number) {
  if (!director || ui.roomCam === 'free') { hoverName = ''; canvas.style.cursor = ''; roomUi.setHint(null); return; }
  const p = roomPick(cx, cy);
  hoverName = p.kind === 'object' ? p.name : '';
  const rect = canvas.getBoundingClientRect();
  const hx = cx - rect.left + 14, hy = cy - rect.top + 16;
  if (p.kind === 'mii') { canvas.style.cursor = roomUi.handCursor ? `${roomUi.handCursor}, pointer` : 'pointer'; roomUi.setHint(`${roomUi.ctx.nickname} · ${lbl('Layout/room/parts/layer2/balloonTextBtn00.msbt', 'title00', 'Parla').text}`, hx, hy); }
  else if (p.kind === 'object') { canvas.style.cursor = 'pointer'; roomUi.setHint(`${p.obj!.label} · interagisci`, hx, hy); }
  else if (p.kind === 'door') { canvas.style.cursor = 'pointer'; roomUi.setHint(director.state === 'outside' ? 'Porta · entra' : 'Porta · esci', hx, hy); }
  else { canvas.style.cursor = p.kind === 'floor' || p.kind === 'furniture' ? 'crosshair' : ''; roomUi.setHint(null); }
}

function renderRoomControls() {
  const sk = roomSkins();
  const fill = (id: string, list: string[], cur: string, pre: string) => { const el = $<HTMLSelectElement>(id); el.innerHTML = list.map((x) => `<option value="${x}">${pre}${x}</option>`).join(''); el.value = list.includes(cur) ? cur : list[0] ?? ''; };
  fill('roomWall', sk.walls, ui.wall, 'rmWl'); fill('roomFloor', sk.floors, ui.floor, 'rmFl');
  // variants: number of Wall albedo textures listed in the selected rmWl Mdl_room.xml
  let n = 1;
  try {
    const pkg = openModelPackage(`asset/model/room/roomWall/output/rmWl${ui.wall}`);
    const k = [...pkg.keys()].find((x) => x.endsWith('.Mdl_room.xml'));
    if (k) n = parseRoomXml(vtext(pkg.get(k)!)).materials.get('Wall')?.uAlbedoTexture?.length ?? 1;
  } catch { /* */ }
  const vs = $<HTMLSelectElement>('roomVariant');
  vs.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i}">AL${String(i).padStart(2, '0')}</option>`).join('');
  ui.variant = Math.min(ui.variant, n - 1); vs.value = String(ui.variant);
  $('roomAudio').setAttribute('aria-pressed', String(ui.audio));
  $('roomAudio').textContent = ui.audio ? 'Audio attivo' : 'Audio spento';
}
for (const [id, key] of [['roomWall', 'wall'], ['roomFloor', 'floor'], ['roomVariant', 'variant']] as const) {
  $<HTMLSelectElement>(id).addEventListener('change', (e) => { const v = (e.target as HTMLSelectElement).value; (ui as any)[key] = key === 'variant' ? Number(v) : v; if (key === 'wall') ui.variant = 0; rebuild(); });
}
$('sceneSeg').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  for (const x of $('sceneSeg').querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
  ui.scene = b.dataset.v as 'lab' | 'room'; ui.view = 'full'; resetView(); rebuild();
});
$('roomCamSeg').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  for (const x of $('roomCamSeg').querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
  ui.roomCam = b.dataset.v as 'original' | 'follow' | 'free';
});
$('roomEnterExit').addEventListener('click', () => { if (!director) return; director.state === 'outside' ? director.enter() : director.exit(); });
$('roomWave').addEventListener('click', () => { roomUi.close(true); director?.waveReaction(); });
$('roomAppear').addEventListener('click', () => { roomUi.close(true); director?.appear(); });
$('roomAudio').addEventListener('click', () => { ui.audio = !ui.audio; sound?.unlock(); sound?.setEnabled(ui.audio); renderRoomControls(); });
$<HTMLInputElement>('roomObjects').addEventListener('change', (e) => { ui.showObjects = (e.target as HTMLInputElement).checked; });
void vfs;

/** Original UI font from the APK (assets/asset/layout/font/) for balloon and PLAY UI, if imported. */
let fontLoaded = false;
function loadRoomFont() {
  if (fontLoaded) return;
  // bootRoot00.ccbi names nintendoPSeurat-B003.ttf / -M003.ttf (REVERSED); SeuratPro-B.otf is the M8 fallback
  const b = vfs.get('asset/layout/font/nintendoPSeurat-B003.ttf') ?? vfs.get('asset/layout/font/SeuratPro-B.otf'); if (!b) return;
  fontLoaded = true;
  const f = new FontFace('MiitomoBalloon', b.slice().buffer);
  f.load().then((ff) => { document.fonts.add(ff); document.documentElement.classList.add('font-original'); }).catch((e) => console.warn('font', e));
  // tabBtn00.ccbi labels use nintendoPSeurat-M003.ttf (REVERSED from the ccbi strings)
  const m = vfs.get('asset/layout/font/nintendoPSeurat-M003.ttf');
  if (m) new FontFace('MiitomoUI', m.slice().buffer).load().then((ff) => { document.fonts.add(ff); document.documentElement.style.setProperty('--pl-font', "'MiitomoUI', system-ui, sans-serif"); }).catch((e) => console.warn('font', e));
}

// ---------------- Render loop ----------------
let lastT = performance.now(), frames = 0, fpsT = lastT;
let editView: 'head' | 'full' | null = null;
let editSide: 'left' | 'right' = 'left';   // where the Mii stands (the panel is on the other side)
let drag: { x: number; y: number } | null = null;
function renderSlot(s: Slot, x: number, w: number) {
  for (const o of Object.values(slots)) o.root.visible = o === s;
  renderer.setViewport(x, 0, w, H); renderer.setScissor(x, 0, w, H);
  camera.aspect = w / H; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}
function tick(t: number) {
  const dt = Math.min((t - lastT) / 1000, 0.1); lastT = t;
  if (ui.scene === 'room' && room && director) { roomTick(testClock.paused ? 0 : dt); frames++; if (t - fpsT > 1000) { setDiag('FPS', ((frames * 1000) / (t - fpsT)).toFixed(0)); frames = 0; fpsT = t; } requestAnimationFrame(tick); return; }
  if (camera.fov !== 15) { camera.fov = 15; camera.near = 10; camera.far = 6000; camera.up.set(0, 1, 0); camera.updateProjectionMatrix(); }
  if (view.autoRotate && !drag) view.yaw += dt * 0.5;
  pivot.rotation.set(view.pitch, view.yaw, 0);
  const c = cam();
  // Body scale shrinks the Mii: aim at the scaled body (Head joint, body units x10) instead of the bind height.
  const sk = slots[ui.shade === 'ab' ? 'original' : ui.shade].body;
  const hy = ui.view === 'full' && sk ? (sk.jointPosition('Head')?.y ?? 10.65) * 10 : 0;
  const ty = hy ? hy * 0.83 : c.y;
  camera.position.set(0, ty, view.dist); camera.lookAt(0, ty, 0);
  if (editView && !LAB) camera.setViewOffset(W, H, (editSide === 'left' ? 0.22 : -0.18) * W, 0, W, H); else if (camera.view?.enabled) camera.clearViewOffset();
  if (ui.pose) applyPose(dt);
  renderer.setScissorTest(true);
  renderer.clear();
  if (ui.shade === 'ab') { renderSlot(slots.approx, 0, Math.floor(W / 2)); renderSlot(slots.original, Math.floor(W / 2), W - Math.floor(W / 2)); }
  else renderSlot(slots[ui.shade], 0, W);
  renderer.setScissorTest(false);
  frames++; if (t - fpsT > 1000) { setDiag('FPS', ((frames * 1000) / (t - fpsT)).toFixed(0)); frames = 0; fpsT = t; }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Pointer: drag to rotate (mouse + touch), wheel/pinch to zoom.
const pointers = new Map<number, { x: number; y: number }>();
let pinchStart = 0, pinchDist = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY };
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchStart = Math.hypot(a.x - b.x, a.y - b.y); pinchDist = view.dist; }
});
canvas.addEventListener('pointermove', (e) => {
  if (ui.scene === 'room' && !pointers.size) roomHover(e.clientX, e.clientY);
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  // CAMERA PLAY (M17b, VERIFIED/REVERSED): no free user camera outside the Lab — the PLAY stages are fixed; zoom / rotation
  // exist only where the original has them (closet / profile: closet_camera.xml, profile_camera.xml).
  if (!LAB) return;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchStart > 0) view.dist = THREE.MathUtils.clamp(pinchDist * (pinchStart / d), 150, 2500);
    return;
  }
  if (!drag) return;
  view.yaw += (e.clientX - drag.x) * 0.01;
  view.pitch = THREE.MathUtils.clamp(view.pitch + (e.clientY - drag.y) * 0.005, -0.6, 0.6);
  drag = { x: e.clientX, y: e.clientY };
});
let downAt: { x: number; y: number; t: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  grabCand = ui.scene === 'room' && ui.roomCam !== 'free' && !!director && roomPick(e.clientX, e.clientY).kind === 'mii';
  director?.poke();
});
// M8+: drag the Mii (pick up / drop)
let grabCand = false, grabbing = false;
function floorAt(cx: number, cy: number) {
  const rect = canvas.getBoundingClientRect();
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1), camera);
  const p = new THREE.Vector3(); return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
}
canvas.addEventListener('pointermove', (e) => {
  if (!downAt || !director || ui.scene !== 'room') return;
  if (grabCand && !grabbing && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) >= 8) { grabbing = !!director.grab(); }
  if (grabbing) { const p = floorAt(e.clientX, e.clientY + 40); if (p) director.holdAt(p.x, p.z); canvas.style.cursor = 'grabbing'; }
});
canvas.addEventListener('pointerup', (e) => {
  if (grabbing) { grabbing = false; grabCand = false; director?.release(); downAt = null; canvas.style.cursor = ''; return; }
  grabCand = false;
  if (ui.scene !== 'room' || !downAt) return;
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8 && ui.roomCam !== 'free') roomClick(e.clientX, e.clientY);
  downAt = null;
});
const endPointer = (e: PointerEvent) => { pointers.delete(e.pointerId); if (pointers.size === 0) drag = null; pinchStart = 0; };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.dist = THREE.MathUtils.clamp(view.dist * Math.exp(e.deltaY * 0.001), 150, 2500); }, { passive: false });

// ---------------- Diagnostics ----------------
const diag = $<HTMLDListElement>('diag');
const diagRows = new Map<string, HTMLElement>();
function setDiag(k: string, v: string) {
  let dd = diagRows.get(k);
  if (!dd) { const dt = document.createElement('dt'); dt.textContent = k; dd = document.createElement('dd'); diag.append(dt, dd); diagRows.set(k, dd); }
  dd.textContent = v;
}
const gl = renderer.getContext();
setDiag('WebGL', gl instanceof WebGL2RenderingContext ? 'WebGL 2' : 'WebGL 1');
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
setDiag('GPU', dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).slice(0, 48) : 'n/d');

// ---------------- Import ----------------
let afl: LoadedResource | null = null;
const checklist = $<HTMLUListElement>('checklist');
function renderChecklist() {
  const items: [boolean, string][] = [
    [!!afl, afl ? `Parti Mii: ${afl.fileName}${afl.known ? ' ✓ verificato' : ''}` : 'Parti Mii (AFLResHigh_2_3.dat)'],
    [!!status?.shader, 'Shader LUT originale (APK)'],
    [!!status?.luts, `LUT luce (APK)${status?.luts ? `: ${status.luts}` : ''}`],
    [!!status?.body, `Corpo ${BODY_ID} (APK)`],
    [wardrobeCount() > 0, `Guardaroba CDN: ${wardrobeCount()} pacchetti`],
    [roomAvailable(), `Stanza: roomBaseComponents${roomAvailable() ? ` + ${roomSkins().walls.length} pareti, ${roomSkins().floors.length} pavimenti` : ' (CDN)'}`],
    [!!status?.miiModel, 'Materiali testa mii_model.xml (asset_env_mii.zip)'],
    [status?.scene === 'default_scene.xml', `Luci default_scene.xml (asset_env_scene.zip)`],
    [!!status?.anims.length, `Animazioni${status?.anims.length ? `: ${status.anims.join(', ')}` : ' (zip animation_output)'}`]
  ];
  checklist.innerHTML = '';
  for (const [ok, label] of items) {
    const li = document.createElement('li'); li.className = ok ? 'ok' : 'todo'; li.textContent = label; checklist.append(li);
  }
  const sel = $<HTMLSelectElement>('poseSel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Bind (T-pose del file)</option>' + (status?.anims ?? []).map((a) => `<option value="${a}">${a}</option>`).join('');
  sel.value = (status?.anims ?? []).includes(cur) ? cur : (status?.anims.includes('animWaitMale') && !cur ? 'animWaitMale' : cur);
  ui.pose = sel.value;
  const url = referenceImageUrl();
  const img = $<HTMLImageElement>('refImg');
  if (url) img.src = url;
}

async function onFiles(files: File[]) {
  const msg = $('importMsg');
  const parts: string[] = [];
  for (const f of files) {
    try {
      if (/\.dat$/i.test(f.name) || /AFLRes|character_mii/i.test(f.name)) {
        afl = await importResource(f);
        await engine.init(afl.bytes);
        cacheResource(afl);
        parts.push(`${afl.fileName}`);
      } else {
        const r = importZipBytes(f.name, new Uint8Array(await f.arrayBuffer()));
        await vfs.flushCold();
        parts.push(`${r.source}: ${r.kept} file`);
      }
    } catch (err) { parts.push(`${f.name}: ${(err as Error).message}`); console.error(err); }
  }
  status = refreshOriginal();
  await saveVfs();
  await addSources(files.map((f) => f.name));
  await saveKeepVersion();
  msg.textContent = `Importato: ${parts.join(' · ')}`;
  afterAssets();
}
function afterAssets() {
  clearWardrobeCache();
  clearTextCache(); clearSpriteCache(); clearClosetCache(); resetExpressions(); effects.reset(); sound?.dispose(); sound = null; loadRoomFont();
  renderChecklist();
  renderWardrobe();
  $('forgetRes').hidden = !afl && !status?.shader;
  for (const id of ['randomBtn', 'loadDataBtn', 'shotBtn']) ($<HTMLButtonElement>(id)).disabled = !engine.ready;
  if (engine.ready) { if (!miiData && LAB) randomMii(); else if (miiData) rebuild(); }
}
$<HTMLInputElement>('resFile').addEventListener('change', (e) => { const fl = (e.target as HTMLInputElement).files; if (fl?.length) onFiles([...fl]); });
const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); const fl = (e as DragEvent).dataTransfer?.files; if (fl?.length) onFiles([...fl]); });
$('forgetRes').addEventListener('click', async () => { await clearCachedResource(); await clearVfs(); location.reload(); });

// ---------------- Mii data ----------------
const miiError = $<HTMLParagraphElement>('miiError');
function showError(m: string | null) { miiError.hidden = !m; miiError.textContent = m ?? ''; }
function randomMii() {
  if (!engine.ready) return;
  miiData = engine.randomCharInfo(ui.gender);
  ($<HTMLTextAreaElement>('miiData')).value = '';
  ($<HTMLTextAreaElement>('miiData')).placeholder = `Casuale · FFLiCharInfo ${toHex(miiData.subarray(0, 8))}…`;
  rebuild();
}
$('randomBtn').addEventListener('click', randomMii);
$('loadDataBtn').addEventListener('click', () => {
  try { miiData = parseMiiInput(($<HTMLTextAreaElement>('miiData')).value); rebuild(); } catch (err) { showError((err as Error).message); }
});

function seg(container: HTMLElement, onPick: (v: string) => void) {
  container.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    for (const x of container.querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
    onPick(b.dataset.v!);
  });
}
seg($('genderSeg'), (v) => { ui.gender = Number(v); });
seg($('viewSeg'), (v) => { ui.view = v as ViewMode; resetView(); rebuild(); });
const shaderNote = $('shaderNote');
const updateNote = () => {
  shaderNote.textContent = ui.shade === 'ab' ? 'A sinistra l\'approssimazione FFL.js, a destra lo shader originale dell\'APK, stesso Mii e stessa posa.' : SHADERS[ui.shade].note;
  $('abLabels').hidden = ui.shade !== 'ab';
};
seg($('shaderSeg'), (v) => { ui.shade = v as ShadeMode; updateNote(); rebuild(); });
updateNote();
$<HTMLSelectElement>('poseSel').addEventListener('change', (e) => { ui.pose = (e.target as HTMLSelectElement).value; animT = 0; applyPose(0); $('hudInfo').textContent = $('hudInfo').textContent!.replace(/ · [^·]*$/, ` · ${ui.pose || 'bind'}`); });
$<HTMLInputElement>('autoRotate').addEventListener('change', (e) => { view.autoRotate = (e.target as HTMLInputElement).checked; });
$<HTMLInputElement>('showRef').addEventListener('change', (e) => { $('refImg').hidden = !(e.target as HTMLInputElement).checked; });

// Expressions
const exprNames = new Map<number, string>();
for (const [k, v] of Object.entries(FFLExpression)) if (typeof v === 'number' && v < 70 && !exprNames.has(v)) exprNames.set(v, k);
function exprName(i: number) { return (exprNames.get(i) ?? String(i)).toLowerCase().replace(/_/g, ' '); }
const exprGrid = $('exprGrid');
function renderExpr(filter: string) {
  exprGrid.innerHTML = '';
  for (const [i, name] of exprNames) {
    if (name.startsWith('BLANK') || name.endsWith('DUPLICATE')) continue;
    if (filter === 'ffl' && i > 18) continue;
    if (filter === 'afl' && i <= 18) continue;
    const b = document.createElement('button');
    b.className = 'expr' + (i > 18 ? ' afl' : '');
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(i === ui.expression));
    b.innerHTML = `<span class="expr-id">${i}</span><span class="expr-name">${exprName(i)}</span>`;
    b.addEventListener('click', () => { ui.expression = i; for (const x of exprGrid.children) x.setAttribute('aria-selected', String(x === b)); rebuild(); });
    exprGrid.append(b);
  }
}
renderExpr('all');
$<HTMLSelectElement>('exprGroup').addEventListener('change', (e) => renderExpr((e.target as HTMLSelectElement).value));

if (window.top !== window) $('shotBtn').hidden = true; // sandboxed viewers block downloads
$('shotBtn').addEventListener('click', () => {
  const a = document.createElement('a'); a.download = `mii-${ui.shade}-${ui.expression}.png`; a.href = canvas.toDataURL('image/png'); a.click();
});
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('textarea, input, select')) return;
  if (e.key === 'r' || e.key === 'R') resetView();
  if (ui.scene === 'room' && director) {
    const k = e.key.toLowerCase(), step = 10;
    const dir = ({ arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] } as Record<string, number[]>)[k];
    director.poke();
    if (dir) { e.preventDefault(); if (roomUi.openKind === 'touch' || roomUi.openKind === 'answer') roomUi.close(true); director.goTo(director.pos.clone().add(new THREE.Vector3(dir[0] * step, 0, dir[1] * step))); return; }
    if (e.code === 'Space') { e.preventDefault(); roomUi.close(true); director.waveReaction(); return; }
    if (k === 'e') { director.state === 'outside' ? director.enter() : director.exit(); return; }
  }
  if (e.code === 'Space') { e.preventDefault(); randomMii(); }
});

// ---------------- Wardrobe + proportions ----------------
function wardrobeCount() { let n = 0; for (const l of catalog().values()) n += l.length; return n; }
const wardrobeEl = $('wardrobe');
function renderWardrobe() {
  const cat = catalog();
  wardrobeEl.innerHTML = '';
  for (const c of CATEGORIES) {
    const items = cat.get(c)!.filter((i) => !/^9999/.test(i.id));
    const row = document.createElement('div'); row.className = 'wr-row';
    const lab = document.createElement('label'); lab.className = 'field';
    lab.innerHTML = `<span>${CAT_LABEL[c]} <em class="count">${items.length}</em></span>`;
    const sel = document.createElement('select'); sel.id = `wr-${c}`;
    sel.innerHTML = '<option value="">— nessuno —</option>' + items.map((i) => `<option value="${i.id}">${i.id}</option>`).join('');
    sel.value = outfit[c]?.id ?? '';
    if (sel.value !== (outfit[c]?.id ?? '')) sel.value = '';
    const col = document.createElement('select'); col.id = `wr-${c}-color`; col.className = 'color-sel'; col.setAttribute('aria-label', `Colore ${CAT_LABEL[c]}`);
    const fillColors = () => {
      const id = sel.value; col.innerHTML = ''; col.disabled = !id; col.style.background = '';
      if (!id) return;
      let list: number[][] = [];
      try { const stem = variantStems(c, id)[0]; list = variantXml(c, id, stem).colorList; } catch { /* */ }
      list.forEach((rgb, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${i}`; o.style.background = `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`; col.append(o); });
      col.value = String(Math.min(outfit[c]?.color ?? 0, Math.max(0, list.length - 1)));
      const rgb = list[Number(col.value)]; if (rgb) col.style.background = `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`;
    };
    fillColors();
    sel.addEventListener('change', () => { if (sel.value) outfit[c] = { id: sel.value, color: 0 }; else delete outfit[c]; fillColors(); ui.dress = 'outfit'; syncDressSeg(); rebuild(); });
    col.addEventListener('change', () => { if (outfit[c]) outfit[c]!.color = Number(col.value); fillColors(); rebuild(); });
    lab.append(sel); row.append(lab, col); wardrobeEl.append(row);
  }
}
function syncDressSeg() { for (const b of $('dressSeg').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === ui.dress)); }
$('dressSeg').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  if (b.dataset.v === 'preset') { Object.keys(outfit).forEach((k) => delete (outfit as any)[k]); Object.assign(outfit, structuredClone(OUTFIT_1)); ui.dress = 'outfit'; renderWardrobe(); }
  else ui.dress = b.dataset.v as 'outfit' | 'm5';
  syncDressSeg(); rebuild();
});
$<HTMLInputElement>('tuck').addEventListener('change', (e) => { outfit.tuck = (e.target as HTMLInputElement).checked; rebuild(); });
const hIn = $<HTMLInputElement>('heightIn'), bIn = $<HTMLInputElement>('buildIn');
function setSliders(h: number, b: number) {
  hIn.value = String(ui.height ?? h); bIn.value = String(ui.build ?? b);
  $('heightVal').textContent = hIn.value; $('buildVal').textContent = bIn.value;
}
let sliderT = 0;
const onSlider = () => { ui.height = Number(hIn.value); ui.build = Number(bIn.value); $('heightVal').textContent = hIn.value; $('buildVal').textContent = bIn.value; clearTimeout(sliderT); sliderT = window.setTimeout(rebuild, 120); };
hIn.addEventListener('input', onSlider); bIn.addEventListener('input', onSlider);
$('miiProps').addEventListener('click', () => { ui.height = null; ui.build = null; rebuild(); });
$<HTMLInputElement>('scaleOn').addEventListener('change', (e) => { ui.scaleOn = (e.target as HTMLInputElement).checked; rebuild(); });




/**
 * Miifoto: renders the Mii alone (transparent) with a pose camera into a size×size canvas. Uses the original
 * archCamera_scene.xml lights. The Mii is posed with `clip` at `frame` and rebuilt with `expression` if needed.
 */
async function renderMiiPhoto(p: { clip: string; frame: number; expression: number; cam: { pos: number[]; aim: number[]; up?: number[]; near: number; far: number; fovY: number }; size: number }): Promise<HTMLCanvasElement | null> {
  if (!engine.ready || !miiData) return null;
  if (ui.expression !== p.expression) { ui.expression = p.expression; rebuild(); }
  const s = slots[ui.shade === 'ab' ? 'original' : ui.shade];
  if (!s.parts.length) return null;
  const clip = orig.anims.get(p.clip) ?? null;
  for (const part of s.parts) if (!part.group.userData.acce) part.applyPose(clip, p.frame);
  placeAccessories(s);
  const saved = { pos: s.root.position.clone(), rot: s.root.rotation.clone(), scale: s.root.scale.clone(), pivot: pivot.rotation.clone(), room: roomGroup.visible, marker: marker.visible, others: Object.values(slots).map((o) => o.root.visible), lights: getLights() };
  s.root.position.set(0, 0, 0); s.root.rotation.set(0, 0, 0); s.root.scale.setScalar(1); pivot.rotation.set(0, 0, 0);
  roomGroup.visible = false; marker.visible = false;
  for (const o of Object.values(slots)) o.root.visible = o === s;
  const sc = vfs.get('asset/env/scene/archCamera_scene.xml');
  if (sc) setLights(parseSceneXml(vtext(sc), 'archCamera_scene.xml'));
  const cam = new THREE.PerspectiveCamera((p.cam.fovY * 180) / Math.PI, 1, p.cam.near, p.cam.far);
  cam.position.fromArray(p.cam.pos); if (p.cam.up && p.cam.up.some((v) => v)) cam.up.fromArray(p.cam.up); cam.lookAt(new THREE.Vector3().fromArray(p.cam.aim));
  const rt = new THREE.WebGLRenderTarget(p.size, p.size, { samples: 4 });
  const prevClear = renderer.getClearAlpha();
  renderer.setRenderTarget(rt); renderer.setScissorTest(false); renderer.setViewport(0, 0, p.size, p.size);
  renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
  const px = new Uint8Array(p.size * p.size * 4); renderer.readRenderTargetPixels(rt, 0, 0, p.size, p.size, px);
  renderer.setRenderTarget(null); renderer.setClearAlpha(prevClear); rt.dispose();
  s.root.position.copy(saved.pos); s.root.rotation.copy(saved.rot); s.root.scale.copy(saved.scale); pivot.rotation.copy(saved.pivot);
  roomGroup.visible = saved.room; marker.visible = saved.marker; Object.values(slots).forEach((o, i) => { o.root.visible = saved.others[i]; });
  setLights(saved.lights ?? orig.lights);
  const c = document.createElement('canvas'); c.width = c.height = p.size;
  const id = new ImageData(p.size, p.size);
  for (let y = 0; y < p.size; y++) id.data.set(px.subarray((p.size - 1 - y) * p.size * 4, (p.size - y) * p.size * 4), y * p.size * 4);
  c.getContext('2d')!.putImageData(id, 0, 0);
  return c;
}

// ---------------- PLAY shell (M9) ----------------
function setSceneDirect(v: 'lab' | 'room') {
  for (const x of $('sceneSeg').querySelectorAll('button')) x.setAttribute('aria-checked', String((x as HTMLElement).dataset.v === v));
  if (v !== 'room' && guests.length) disposeGuest();   // M18: the visit ends when the user leaves the room
  ui.scene = v; ui.view = 'full'; resetView(); rebuild();
}
const playApi: PlayApi = {
  ready: () => ({ engine: engine.ready, shader: !!status?.shader, room: roomAvailable(), anims: !!status?.anims.length, wardrobe: wardrobeCount(), texts: textsAvailable().files > 0, expr: expressionsAvailable() }),
  importFiles: (files) => onFiles(files),
  /** Local launcher: fetch + import one file at a time (no 700 MB of blobs in memory), one cache write at the end. */
  importLocal: async (files, progress) => {
    const total = files.reduce((a, f) => a + f.size, 0) || 1; let done = 0;
    for (const f of files) {
      progress(done / total, f.name);
      try {
        const r = await fetch(`local/${encodeURIComponent(f.name)}`); if (!r.ok) continue;
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (/\.dat$/i.test(f.name) || /AFLRes|character_mii/i.test(f.name)) { afl = await importResource(new File([bytes], f.name)); await engine.init(afl.bytes); cacheResource(afl); }
        else importZipBytes(f.name, bytes);
        await vfs.flushCold();          // cold files go to IndexedDB now: memory stays bounded during the import
      } catch (e) { console.warn(f.name, e); }
      done += f.size;
    }
    progress(1, '');
    status = refreshOriginal();
    await saveVfs(); await addSources(files.map((f) => f.name)); await saveKeepVersion();
    afterAssets();
  },
  importedSources: () => loadSources(),
  /** Sources to read again because the keep rules changed since they were imported (KEEP_VERSION). */
  reimportNeeded: async (names) => { const v = await loadKeepVersion(); return names.filter((n) => needsReimport(n, v)); },
  markKeepVersion: () => saveKeepVersion(),
  ensureFiles: async (keys) => { await vfs.ensure(keys); },
  localFiles: async () => {
    try { const r = await fetch('local/list.json', { cache: 'no-store' }); if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return localWanted((await r.json()).files ?? []); } catch { /* */ }
    return [];
  },
  randomMii: (g) => { const d = engine.randomCharInfo(g); return d; },
  parseMii: (t) => parseMiiInput(t),
  setMii: (d, h, b) => { miiData = d; ui.height = h; ui.build = b; if (engine.ready) rebuild(); },
  miiName: () => lastName,
  setScene: (v) => { if (ui.scene !== v) setSceneDirect(v); },
  setRoom: (w, f, v) => { ui.wall = w; ui.floor = f; ui.variant = v; if (ui.scene === 'room') rebuild(); },
  roomSkins: () => roomSkins(),
  skinVariants: (kind, id) => {
    try {
      const pkg = openModelPackage(`asset/model/room/${kind === 'wall' ? 'roomWall/output/rmWl' : 'roomFloor/output/rmFl'}${id}`);
      const k = [...pkg.keys()].find((x) => x.endsWith('.Mdl_room.xml'));
      return k ? Math.max(1, parseRoomXml(vtext(pkg.get(k)!)).materials.get(kind === 'wall' ? 'Wall' : 'Floor')?.uAlbedoTexture?.length ?? 1) : 1;
    } catch { return 1; }
  },
  outfit,
  catalog: () => catalog() as any,
  rebuild: () => rebuild(),
  setVoice: (pref, params) => { voicePref = pref; voiceParams = { ...DEFAULT_VOICE, ...(params ?? {}) }; voice.stop(); voice = resolveVoice(voicePref); },
  voiceStatus: () => ({ active: { id: voice.id, label: voice.label, classification: voice.classification }, providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, classification: p.classification, unavailable: p.unavailable() })) }),
  setPersonality: (levels) => { personality = personalityType(levels); },
  setNickname: (n) => { nicknameOverride = n; roomUi.ctx = { ...roomUi.ctx, nickname: n }; },
  setAudio: (on) => { ui.audio = on; sound?.setEnabled(on); },
  setSoundSwitches: (m, e, v) => { soundSw = { music: m, effects: e, voice: v }; sound?.setChannels(m, e); if (!v) voice.stop(); },
  onEnterGreeting: null,
  onRecent: null,
  showBalloon: (rel, l, fb, autoClose) => roomUi.show({ kind: 'greeting', rel, label: l, fallback: fb, autoClose }),
  closeBalloon: () => roomUi.close(true),
  directorState: () => director?.state ?? null,
  renderMiiPhoto: (p) => renderMiiPhoto(p),
  setMiiExpression: (n) => { if (ui.expression !== n) { ui.expression = n; } },
  enterFresh: () => { forceEnter = true; },
  guestArrive: (sp, o) => guestArrive(sp, o),
  guestLeave: (id?: string) => guestLeave(id ? guests.find((g) => g.spec.id === id) : undefined),
  guestEnd: (id?: string) => disposeGuest(id ? guests.find((g) => g.spec.id === id) : undefined),
  guestState: (id?: string) => { const g = id ? guests.find((x) => x.spec.id === id) : guests[0]; return g ? { id: g.spec.id, name: g.spec.name, state: g.director.state, leaving: g.leaving } : null; },
  guestsState: () => guests.map((g) => ({ id: g.spec.id, name: g.spec.name, state: g.director.state, leaving: g.leaving || g.leaveWanted })),
  setGuestCapacity: (n: number) => { guestCap = Math.max(1, Math.min(MAX_GUESTS, Math.floor(n))); return guestCap; },
  guestCapacity: () => guestCap,
  onGuest: null,
  setMusic: (k) => setMusic(k),
  setEditView: (m, side = 'left') => {
    editSide = side;   // M17 Mii editor: front view (no auto-rotate), head close-up or full body (physique), Mii shifted left of the panel
    editView = m;
    if (m) { view.autoRotate = false; view.yaw = 0; view.pitch = 0; if (ui.view !== m) { ui.view = m; view.dist = cam().dist * (m === 'head' ? 0.62 : 1); rebuild(); } else view.dist = cam().dist * (m === 'head' ? 0.62 : 1); }
    else { view.autoRotate = false; if (ui.view !== 'full') { ui.view = 'full'; resetView(); if (!LAB) { view.yaw = 0; } rebuild(); } }
  },
  charInfo: () => { const h = (slots.original.head ?? slots.approx.head) as any; return h?.charInfoBytes ? new Uint8Array(h.charInfoBytes) : null; },
  verifyMii: (ci) => engine.ready ? engine.verifyCharInfo(ci) : -1,
  canTuck: () => { const t = outfit.tops; if (!t) return false; try { return variantStems('tops', t.id).some((x) => /In$/.test(x)); } catch { return false; } },
  setFriendHost: (t) => { friendHost = t as Personality | null; roomBgm(); },
  setGreetings: (g) => { greetings = { ...g }; roomUi.ctx = { ...roomUi.ctx, greetings: greetCtx() }; },
  setVenue: (v) => setVenue(v),
  itemDates: () => itemDates(),
  vfsKeys: (re) => [...vfs.keys()].filter((k) => re.test(k)),
  blobUrl: (k, type) => { const b = vfs.get(k); if (!b) return null; const u = blobUrls.get(k) ?? URL.createObjectURL(new Blob([b], { type })); blobUrls.set(k, u); return u; },
  shopAvailable: () => shopAvailable(),
  setCloset: (on) => { if (on && !closetCam.on) { closetCamReset(); ccam.scale = 1; ccam.look = [0, 8]; ccam.yaw = 0; } closetCam.on = on; if (on && director) { director.faceViewer(); } }
};
const play: Play | null = LAB ? null : new Play(playApi, OUTFIT_1);

// ---------------- DESKTOP APP (desktop/): launcher + peer-to-peer friends. NEW, not original; off in a plain browser ----
/** The Reboot side of the P2P link (RebootHost.p2p): ids, online friends, data per feature, "came online". */
function p2pBridge(c: P2PClient) {
  return {
    me: () => c.state?.me.id ?? null,
    online: () => (c.state?.friends ?? []).filter((f) => f.online).map((f) => f.id),
    send: (ch: string, data: unknown, to?: string) => { void c.send(ch, data, to); },
    on: (ch: string, cb: (from: string, data: unknown) => void) => c.on(ch, cb),
    onOnline: (cb: (id: string) => void) => { let was = new Set((c.state?.friends ?? []).filter((f) => f.online).map((f) => f.id)); const un = c.onState((s) => { const now = new Set(s.friends.filter((f) => f.online).map((f) => f.id)); for (const id of now) if (!was.has(id)) cb(id); was = now; }); return () => { un(); }; },
  };
}
const LAUNCHER = !LAB && new URLSearchParams(location.search).get('launcher') === '1';
const DESKTOP = (window as unknown as { mtwDesktop?: { isDesktop: true } & LauncherDesktop }).mtwDesktop ?? null;
/** The account's P2P engine (hidden page of the desktop app); its friends join the game's friends. */
const p2p = DESKTOP && play ? new P2PClient() : null;
if (p2p && play) play.social = withP2P(play.social, p2p);
if (LAUNCHER && play) {
  if (DESKTOP) gestured = true;   // the desktop app allows sound without a first click
  void import('./launcher/Launcher').then((m) => m.mountLauncher({
    screen: () => play.currentScreen, logo: () => play.logo, desktop: DESKTOP,
    // the original title music when the user's files have it, else the room music (never bundled with the app)
    music: () => { sound?.unlock(); if (sound?.canPlay('bgm_titleSceneInit')) setMusic('bgm_titleSceneInit'); },
    friends: p2p ? (el) => { let un: (() => void) | null = null, gone = false; void import('./p2p/FriendsPanel').then((f) => { if (!gone) un = f.friendsPanel(p2p)(el); }); return () => { gone = true; un?.(); }; } : null,
  }));
}

// ---------------- MIITOMO REBOOT (new features, not original Nintendo) ----------------
// Loaded only when the gate is open (?reboot=1); Classic never depends on it (docs/reboot/ARCHITECTURE.md).
let reboot: { dispose(): void } | null = null;
const REBOOT_ON = !LAB && !LAUNCHER && !!play && rebootRequested();
if (REBOOT_ON && play) {
  const host: RebootHost = {
    root: canvas.parentElement!,
    screen: () => play.currentScreen,
    visiting: () => play.isVisiting,
    friends: async () => (await play.social.list()).map((f) => ({ id: f.id, name: f.profile.name, personality: personalityType(f.profile.personality), room: { ...f.room }, birthday: f.profile.birthday ? { ...f.profile.birthday } : null, greeting: f.profile.greetings.goIn })),
    guests: () => playApi.guestsState(),
    invite: (id, o) => play.inviteGuest(id, 0, o),
    dismiss: (id) => playApi.guestLeave(id),
    capacity: () => playApi.guestCapacity(),
    setCapacity: (n) => playApi.setGuestCapacity(n),
    onGuest: (cb) => { guestListeners.add(cb); return () => guestListeners.delete(cb); },
    // R2b: social life — reads and commands over the existing movement / turning / animation / balloon machinery
    miis: () => miiViews(),
    objects: () => interactables.map((o) => ({ name: o.name, x: o.spot.x, z: o.spot.z })),
    goTo: (id, x, z) => { const d = directorOf(id); return !!d && d.goTo(new THREE.Vector3(x, 0, z)); },
    face: (id, x, z) => new Promise<boolean>((res) => { const d = directorOf(id); if (!d) return res(false); if (!d.faceToward(new THREE.Vector3(x, 0, z), () => res(true))) res(false); }),
    interact: (id, name) => { const d = directorOf(id), o = interactables.find((x) => x.name === name); return !!d && !!o && d.interact(o); },
    wave: (id) => { const d = directorOf(id); return !!d && d.waveReaction(); },
    say: (id, text, autoClose, lang) => socialSay(id, text, autoClose, lang),
    balloonBusy: () => roomUi.isOpen,
    setGuestWander: (on) => { guestWanderOn = on; for (const g of guests) g.director.wander = on; },
    onTick: (cb) => { tickListeners.add(cb); return () => tickListeners.delete(cb); },
    onSpeech: (cb) => { speechListeners.add(cb); return () => speechListeners.delete(cb); },
    onPlayer: (cb) => { playerListeners.add(cb); return () => playerListeners.delete(cb); },
    // R5: places, photos, profile
    profile: () => ({ name: play.save.profile.name || lastName || 'Mii', personality, birthday: play.save.profile.birthday ? { ...play.save.profile.birthday } : null, greeting: play.save.profile.greetings.goIn }),
    visitPlace: (p) => play.visitPlace(p.id, p.skin, p.friendHost),
    returnHome: () => play.startRoom(true),
    clearGuests: () => disposeGuest(),
    roomSkins: () => ({ ...roomSkins(), own: { ...play.save.room } }),
    setObjectPolicy: (p) => { objectPolicy = p; },
    snapshot: (size) => snapshot(size),
    setPhotoShare: (p) => { play.photoShare = p; },
    openMiifoto: () => { void play.openMiifoto(); },
    // R6: settings applied to the shared infrastructure (Classic never calls them: original mix, full quality)
    setVolumes: (v) => { soundLevels = { music: v.music, effects: v.effects }; sound?.setLevels(v.music, v.effects); setWebTtsPrefs({ level: v.voice }); },
    setRenderQuality: (q) => { pixelCap = q === 'low' ? 1 : q === 'balanced' ? 1.5 : 2; renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelCap)); resize(); },
    p2p: () => (p2p ? p2pBridge(p2p) : null),
    setPlayerName: (name) => { const n = name.trim().slice(0, 10); if (!n) return false; play.save.profile.name = n; playApi.setNickname(n); void play.persist(); return true; },
  };
  import('./reboot/index').then((m) => { reboot = m.bootReboot(host); }).catch((e) => console.warn('Reboot non caricato (Classic continua):', e));
}
if (!LAB) { ui.view = 'full'; view.autoRotate = false; view.yaw = 0; view.pitch = 0; }   // PLAY stage: fixed, front view (no auto-rotate: no evidence)

// Test hooks (tests/e2e)
function shopProbe() {
  const b = buildShop('original', LUTShaderMaterial);
  const meshes = meshBoxes(b.model).map(({ name, box: bb }) => { const c = bb.getCenter(new THREE.Vector3()), z = bb.getSize(new THREE.Vector3()); return { name, c: c.toArray().map((v) => +v.toFixed(1)), s: z.toArray().map((v) => +v.toFixed(1)) }; });
  return { box: [b.box.min.toArray(), b.box.max.toArray()], n: meshes.length, big: meshes.sort((x, y) => y.s[0] * y.s[1] * y.s[2] - x.s[0] * x.s[1] * x.s[2]).slice(0, 25), lights: !!b.lights, build: b };
}
(window as any).__mtw = { get p2p() { return p2p; }, LAUNCHER, listenerCounts: () => ({ tick: tickListeners.size, speech: speechListeners.size, player: playerListeners.size, guest: guestListeners.size, pendingSays: pendingSays.length }), get reboot() { return reboot; }, REBOOT_ON, get framing() { return framing ? { dolly: framing.dolly, shiftNdc: framing.shiftNdc, position: framing.position.toArray(), target: framing.target.toArray() } : null; }, gestureInfo, get guest() { return guests[0] ?? null; }, get guests() { return guests; }, get talker() { return talker; }, guestLog, guestArrive, guestLeave, get doorOwner() { return doorOwner === director ? 'host' : doorOwner ? 'guest' : null; }, get soundSw() { return soundSw; }, ruleInfo, PERSONALITIES, touchMenu, ccam, closetCamZoom, closetCamPan, socialLib: { sanitizeFriend }, get venue() { return venue; }, shopProbe, effects, playEffect, vfs, voiceLog, get voice() { return voice; }, play, playApi, LAB, speakLog, get personality() { return personality; }, get emoFace() { return emoFace; }, floorAt, camera, simRoom, roomPick, testClock, get sound() { return sound; }, roomUi, get interactables() { return interactables; }, clock, stagePoint, get room() { return room; }, get director() { return director; }, roomClick, projectRoom, engine, ui, view, slots, outfit, OUTFIT_1, get lastRes() { return lastRes; }, get lastScale() { return lastScale; }, catalog, applyPose, rebuild, randomMii, onFiles, renderer, orig, get status() { return status; }, get miiData() { return miiData; }, set miiData(v: Uint8Array | null) { miiData = v; } };

// Boot: restore cached files if present.
(async () => {
  const n = await loadVfs();
  status = refreshOriginal();
  const res = await loadCachedResource();
  if (res) { afl = res; try { await engine.init(res.bytes); } catch (e) { console.error(e); } }
  if (n || res) $('importMsg').textContent = 'File ripristinati dalla cache locale.';
  afterAssets();
  if (play) play.boot(); else localServerImport(!(n || res));
})();

/**
 * Local launcher (tools/serve-local.ps1): when the page is served by it, /local/list.json lists the user's own asset
 * files on this PC. They can be imported with one click (or automatically with ?autoload=1 when nothing is cached).
 */
/** Only files that can hold kept entries (by name), each name once (the folder has a few copies at two levels). */
function localWanted<T extends { name: string }>(files: T[]): T[] {
  const seen = new Set<string>();
  return files.filter((f) => { const b = f.name.split(/[\\/]/).pop()!; if (!wantedSource(b) || seen.has(b)) return false; seen.add(b); return true; });
}
async function localServerImport(cacheEmpty: boolean) {
  let list: { files: { name: string; size: number }[] } | null = null;
  try { const r = await fetch('local/list.json', { cache: 'no-store' }); if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) list = await r.json(); } catch { /* not served by the local launcher */ }
  if (list) list.files = localWanted(list.files);
  if (!list?.files.length) return;
  const btn = document.createElement('button');
  btn.className = 'btn small'; btn.id = 'localImport';
  btn.textContent = `Importa dalla cartella MiiTomoWeb (${list.files.length} file)`;
  $('forgetRes').before(btn);
  const run = async () => {
    btn.disabled = true;
    const files: File[] = [];
    let i = 0;
    for (const f of list!.files) {
      $('importMsg').textContent = `Lettura ${++i}/${list!.files.length}: ${f.name}…`;
      const r = await fetch(`local/${encodeURIComponent(f.name)}`);
      if (r.ok) files.push(new File([await r.blob()], f.name));
    }
    await onFiles(files);
    btn.disabled = false;
  };
  btn.addEventListener('click', run);
  const q = new URLSearchParams(location.search).get('autoload');
  if (q === 'force' || (q === '1' && cacheEmpty)) run();
}
