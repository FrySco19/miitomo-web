/**
 * MIITOMO REBOOT — entry point (loaded with a dynamic import only when reboot/gate.ts is open).
 * Everything under src/reboot/ is REBOOT: new features, NOT original Nintendo content (docs/reboot/CLASSIC-VS-REBOOT.md).
 */
import './ui/tokens.css';            // R6 design system: first, so every Reboot stylesheet can use it
import type { RebootHost, FriendInfo } from './host';
import { RebootFlags } from './flags';
import { MultiMii } from './multimii/MultiMii';
import { RebootPanel } from './ui/RebootPanel';
import { SocialLife } from './social/SocialLife';
import { LocalRoomService } from './rooms/LocalRoomService';
import { PublicRoomController } from './rooms/PublicRoomController';
import { SocialHub } from './hub/SocialHub';
import { HubScreen } from './hub/HubScreen';
import { createLocalProvider, createServerProvider } from './api/provider';
import type { RebootApi } from './api/contracts';
import { I18n, safeKv } from './i18n/i18n';
import { LocalPlacesService, GAMES_ID } from './places/LocalPlacesService';
import { PlaceVisit } from './places/PlaceVisit';
import { PlaceBar, friendRoomsPanel } from './places/PlaceViews';
import { GameRegistry } from './games/GameRegistry';
import { MII_QUIZ } from './games/MiiQuiz';
import { GameRoomController } from './games/GameRoomController';
import { GameRoomView } from './games/GameRoomView';
import { MiiPhone, MiiPhoneApps } from './phone/MiiPhone';
import { MiiPhoneView } from './phone/MiiPhoneView';
import { LocalSocialService } from './miinstagram/LocalSocialService';
import { LazyPhotoStore } from './miinstagram/PhotoStore';
import { Relations } from './miinstagram/relations';
import { FeedSimulator } from './miinstagram/FeedSimulator';
import { MIInstagramApp, MIINSTAGRAM_ICON } from './miinstagram/MIInstagramApp';
import { SettingsStore } from './settings/Settings';
import { settingsApp } from './settings/SettingsApp';

const SETTINGS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/></svg>';

export interface RebootRuntime {
  flags: RebootFlags; multi: MultiMii | null; social: SocialLife | null; rooms: PublicRoomController | null; hub: SocialHub | null; hubScreen: HubScreen | null; panel: RebootPanel; api: RebootApi;
  /** R5 */
  i18n: I18n; places: LocalPlacesService | null; visit: PlaceVisit | null; games: GameRoomController | null; phone: MiiPhone | null; phoneView: MiiPhoneView | null;
  feed: LocalSocialService | null; feedSim: FeedSimulator | null; miinstagram: MIInstagramApp | null; relations: Relations; placeBar: PlaceBar | null; gameView: GameRoomView | null;
  /** R6 */
  settings: SettingsStore;
  dispose(): void;
}

/** `serverUrl` = OUR backend (R10); until it exists the local provider simulates it. */
export function bootReboot(host: RebootHost, opts: { serverUrl?: string | null; seed?: number } = {}): RebootRuntime {
  const flags = new RebootFlags(true);
  const multi = flags.on('MULTI_MII_ENABLED') ? new MultiMii(host) : null;
  if (!multi) host.setCapacity(1);
  const local = createLocalProvider();
  const api = opts.serverUrl ? createServerProvider(opts.serverUrl) : local;
  const social = flags.on('SOCIAL_LIFE_ENABLED') ? new SocialLife(host, opts.seed) : null;
  // R3: the user's room can be opened as a public room; visitors come from the local service (our server from R10)
  const rooms = flags.on('PUBLIC_ROOMS_ENABLED') ? new PublicRoomController(host, new LocalRoomService({ blocked: () => local.safety().blocked }), { multi, social, seed: opts.seed }) : null;
  const panel = new RebootPanel(host, flags, multi, rooms);
  // R5: one language table for every new text (stored choice → browser → English)
  const i18n = new I18n({ storage: safeKv() });
  // R6: Reboot settings (one record, applied below once every system exists, then on every change)
  const settings = new SettingsStore(safeKv());
  // R4: Social Hub — a model over R3 (events in, open / close requests out) + its view
  const inRoom = () => host.screen() === 'room' && !host.visiting();
  const hub = flags.on('HUB_ENABLED') ? new SocialHub({ rooms, inRoom, onTick: (cb) => host.onTick(cb), showRoomPanel: () => panel.show(), i18n }) : null;

  // ---------------- R5: friends' rooms, Sala Giochi, MiiPhone + MIInstagram ----------------
  const kv = safeKv();
  const relations = new Relations(kv);
  social?.setAffinity((a, b) => relations.get(a, b));
  let friendCache: FriendInfo[] = [];
  const friends = async () => { try { friendCache = await host.friends(); } catch { /* keep the last list */ } return friendCache; };
  void friends();
  const nameOf = (id: string) => (id === 'host' ? host.profile().name : friendCache.find((f) => f.id === id)?.name ?? null);
  const layer = document.createElement('div'); layer.className = 'r5-layer'; layer.dataset.reboot = 'r5';
  host.root.append(layer);

  const wantFriends = flags.on('FRIEND_ROOMS_ENABLED'), wantGames = flags.on('MINIGAMES_ENABLED');
  const places = wantFriends || wantGames ? new LocalPlacesService({ friends, blocked: () => local.safety().blocked }, opts.seed ?? 17) : null;
  const visit = places ? new PlaceVisit(host, places, {
    social,
    sceneOf: (id) => {
      const p = places.place(id); if (!p) return null;
      if (p.kind === 'friend') return { id, skin: p.skin ?? host.roomSkins().own, friendHost: p.owner?.personality ?? null };
      // the Sala Giochi: a room look the user's own room does not have (from the user's files)
      const sk = host.roomSkins(), pick = (list: string[], own: string) => list.filter((x) => x !== own).pop() ?? own;
      return { id, skin: { wall: pick(sk.walls, sk.own.wall), floor: pick(sk.floors, sk.own.floor), variant: 0 }, friendHost: null };
    },
  }) : null;
  const registry = new GameRegistry(); registry.register(MII_QUIZ);
  const games = wantGames && visit ? new GameRoomController(host, visit, registry, { social, i18n, friends, affinity: (a, b) => relations.get(a, b), kv, seed: opts.seed }) : null;

  if (hub && places && visit) {
    if (wantFriends) hub.register({
      id: 'friends', phase: 'R5', panel: true,
      title: () => i18n.t('hub.dest.friends.title'),
      subtitle: () => i18n.t('hub.dest.friends.sub', { n: places.list('friend').filter((p) => !p.refusal).length }),
      available: () => ({ ok: true, reason: '' }),
      go: async (roomId) => { if (!roomId) return { ok: false, code: 'NOT_FOUND' }; await places.refresh(); const r = await visit.enter(roomId, visit.inside); return { ok: r.ok, code: r.code }; },
      here: () => !!visit.roomId && places.place(visit.roomId)?.kind === 'friend',
      leave: () => visit.leave('user'),
    });
    if (games) hub.register({
      id: 'games', phase: 'R5',
      title: () => i18n.t('hub.dest.games.title'),
      subtitle: () => i18n.t('hub.dest.games.sub', { n: places.get(GAMES_ID)?.presence().filter((p) => p.profileId !== 'host').length ?? 0 }),
      available: () => ({ ok: true, reason: '' }),
      go: async () => { await places.refresh(); const r = await games.enter(); return { ok: r.ok, code: r.code }; },
      here: () => games.here,
      leave: () => games.leave(),
    });
    void places.refresh();
  }
  const hubScreen = hub ? new HubScreen(hub, panel.el, inRoom, { i18n, panels: places && hub ? { friends: friendRoomsPanel(places, hub, i18n) } : {} }) : null;
  const placeBar = visit && places && hub ? new PlaceBar(visit, places, hub, i18n, layer, (id) => nameOf(id) ?? '', { confirm: () => settings.value.confirm, notify: () => settings.value.notifications }) : null;
  const gameView = games ? new GameRoomView(games, i18n, layer) : null;

  // MIInstagram (domain + autonomous Miis) and the MiiPhone it lives in
  const wantFeed = flags.on('MIINSTAGRAM_ENABLED');
  const feed = wantFeed ? new LocalSocialService(new LazyPhotoStore(), kv) : null;
  const feedSim = feed ? new FeedSimulator(feed, { friends, relations, onTick: (cb) => host.onTick(cb), seed: opts.seed, userName: () => host.profile().name }) : null;
  const unsubs: (() => void)[] = [];
  if (feedSim && social) unsubs.push(social.subscribe((e) => { if (e.type === 'convo.end' && e.why === 'done') feedSim.conversation(e.a, e.b, e.lines); }));
  if (feedSim && games) unsubs.push(games.subscribe((e) => { if (e.type === 'session' && e.e.type === 'finished') feedSim.game(e.e.result, '@' + e.session.def.titleKey); }));
  if (visit) unsubs.push(visit.subscribe((e) => {
    if (e.type === 'evicted' && hub) hub.evicted(places!.place(e.roomId)?.kind === 'games' ? 'games' : 'friends', e.code);
    if (e.type === 'entered' && feedSim) { const p = places!.place(e.roomId); if (p?.kind === 'friend' && p.owner) feedSim.visit(p.owner.id, host.profile().name); }
  }));
  const apps = new MiiPhoneApps();
  const phoneAllowed = () => {
    const sc = host.screen();
    return (sc === 'room' && !host.visiting()) || (sc.startsWith('place:') && visit?.mode === 'inside') ? !games?.sessionActive : false;
  };
  const phone = flags.on('MIIPHONE_ENABLED') ? new MiiPhone(apps, phoneAllowed) : null;
  const miinstagram = feed && phone ? new MIInstagramApp({
    svc: feed, i18n, me: 'host',
    directory: () => ({ name: nameOf, personality: (id) => (id === 'host' ? host.profile().personality : friendCache.find((f) => f.id === id)?.personality ?? 2) }),
    snapshot: () => (flags.on('MIIFOTO2_ENABLED') ? host.snapshot(480) : null),
    openMiifoto: flags.on('MIIFOTO2_ENABLED') ? () => host.openMiifoto() : null,
    closePhone: () => phone.forceClose(),
    confirm: () => settings.value.confirm,
  }) : null;
  if (miinstagram) apps.register({ id: 'miinstagram', titleKey: 'app.miinstagram', icon: MIINSTAGRAM_ICON, color: 'linear-gradient(150deg, var(--r-pink), var(--r-accent-hi))', implemented: true, badge: () => (settings.value.notifications ? miinstagram.unseen : 0), mount: (el) => { void friends(); return miinstagram.mount(el); } });
  apps.register({
    id: 'settings', titleKey: 'app.settings', icon: SETTINGS_ICON, color: 'var(--r-ink-3)', implemented: true,
    mount: settingsApp(settings, i18n, { name: () => host.profile().name, rename: (n) => host.setPlayerName(n) }),
  });
  const phoneView = phone ? new MiiPhoneView(phone, i18n, layer) : null;
  if (miinstagram && phoneView) unsubs.push(miinstagram.onUnseen((n) => phoneView.notify(settings.value.notifications ? n : 0)));

  // R6: apply the settings now and on every change (volumes, 3D quality, motion, date region, light mode)
  const osReduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const baseTurnover = places ? structuredClone(places.turnover) : null, baseSim = feedSim ? { ...feedSim.config } : null;
  const applySettings = () => {
    const e = settings.effective(osReduced());
    host.setVolumes(e.volumes);
    host.setRenderQuality(e.quality);
    document.documentElement.dataset.motion = e.reducedMotion ? 'reduced' : 'full';
    i18n.setRegion(e.region);
    // light mode: a calmer simulated world (arrivals twice as far apart, half the autonomous posts)
    if (places && baseTurnover) places.turnover = e.calmWorld ? { gap: [baseTurnover.gap[0] * 2, baseTurnover.gap[1] * 2], stay: baseTurnover.stay } : structuredClone(baseTurnover);
    if (feedSim && baseSim) feedSim.config = e.calmWorld ? { ...baseSim, maxPostsPerHour: Math.max(1, Math.floor(baseSim.maxPostsPerHour / 2)), meetChance: baseSim.meetChance / 2 } : { ...baseSim };
    if (!settings.value.notifications) phoneView?.notify(0);
  };
  applySettings();
  unsubs.push(settings.subscribe(applySettings));
  if (games && phoneView) unsubs.push(games.subscribe((e) => { if (e.type !== 'session' || e.e.type === 'aborted' || e.e.type === 'finished') phoneView.sync(); }));
  if (miinstagram && phone && flags.on('MIIFOTO2_ENABLED')) {
    // Miifoto 2: the Miifoto screen gets "share on MIInstagram"; the photo becomes the draft of a post on the phone
    host.setPhotoShare({ label: () => i18n.t('miifoto.share'), share: (url) => { miinstagram.setDraft(url, 'miifoto'); phone.open('miinstagram'); } });
  }

  return {
    flags, multi, social, rooms, hub, hubScreen, panel, api, i18n, places, visit, games, phone, phoneView, feed, feedSim, miinstagram, relations, placeBar, gameView, settings,
    dispose() {
      for (const u of unsubs) u();
      delete document.documentElement.dataset.motion; host.setVolumes({ music: 1, effects: 1, voice: 1 }); host.setRenderQuality('high');
      host.setPhotoShare(null);
      phoneView?.dispose(); feedSim?.dispose(); gameView?.dispose(); games?.dispose(); placeBar?.dispose(); visit?.dispose();
      layer.remove();
      hubScreen?.dispose(); hub?.dispose(); rooms?.dispose(); social?.dispose(); panel.dispose(); host.setCapacity(1);
    },
  };
}
