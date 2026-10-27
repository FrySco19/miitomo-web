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
import { shellLabels } from './i18n/shell';
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
import { P2PFeedSync } from './miinstagram/P2PFeedSync';
import { SettingsStore } from './settings/Settings';
import { settingsApp } from './settings/SettingsApp';
import { profileApp } from './people/ProfileApp';
import { friendsApp } from './people/FriendsApp';
import { relationLevel } from './people/levels';
import { Wallet } from './economy/Wallet';
import { Inventory } from './shop/Inventory';
import { itemById } from './shop/catalog';
import { shopApp, COIN_ICON } from './shop/ShopApp';

const ico = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const APP_ICONS = {
  profile: ico('<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>'),
  friends: ico('<circle cx="8.5" cy="9" r="3"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M3 19c.6-3 2.8-4.6 5.5-4.6S13.4 16 14 19M14.5 14.6c2.6-.4 5 .9 5.8 4.4"/>'),
  plaza: ico('<path d="M4 20h16M6 20v-7M18 20v-7M3 13l9-7 9 7"/><circle cx="12" cy="14.5" r="2"/>'),
  home: ico('<path d="M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z"/>'),
  rooms: ico('<rect x="3.5" y="5" width="7.5" height="14" rx="1.5"/><rect x="13" y="5" width="7.5" height="14" rx="1.5"/><path d="M9 12h.01M15 12h.01"/>'),
  games: ico('<path d="M7 8h10a4.5 4.5 0 0 1 0 9l-2-2H9l-2 2a4.5 4.5 0 0 1 0-9z"/><path d="M8.5 11v3M7 12.5h3M16 12h.01"/>'),
  shop: ico('<path d="M5 9h14l-1.2 10.5H6.2z"/><path d="M9 9V7.5a3 3 0 0 1 6 0V9"/>'),
};
const SETTINGS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/></svg>';

export interface RebootRuntime {
  flags: RebootFlags; multi: MultiMii | null; social: SocialLife | null; rooms: PublicRoomController | null; hub: SocialHub | null; hubScreen: HubScreen | null; panel: RebootPanel; api: RebootApi;
  /** R5 */
  i18n: I18n; places: LocalPlacesService | null; visit: PlaceVisit | null; games: GameRoomController | null; phone: MiiPhone | null; phoneView: MiiPhoneView | null;
  feed: LocalSocialService | null; feedSim: FeedSimulator | null; miinstagram: MIInstagramApp | null; relations: Relations; placeBar: PlaceBar | null; gameView: GameRoomView | null;
  /** R6 */
  settings: SettingsStore; wallet: Wallet | null; inventory: Inventory | null;
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
  // R5: one language table for every new text (stored choice → browser → English)
  const i18n = new I18n({ storage: safeKv() });
  const panel = new RebootPanel(host, flags, multi, rooms, i18n);
  // R6: the Miis' chat lines follow the Reboot language (the voice is told which language each line is in)
  social?.setLanguage(i18n);
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
  // 0.2: the simulated places are for the LOCAL friends only. A real friend (desktop P2P, id p2p-…) is never
  // simulated (no fake room, no fake whereabouts): their presence and room are real (MiiPhone Friends → shared room).
  const localFriends = async () => (await friends()).filter((f) => !f.id.startsWith('p2p-'));
  const places = wantFriends || wantGames ? new LocalPlacesService({ friends: localFriends, blocked: () => local.safety().blocked }, opts.seed ?? 17) : null;
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
  // desktop app: MIInstagram with the REAL friends connected peer-to-peer (their posts, our reactions and comments)
  const p2p = host.p2p();
  const feedSync = feed && p2p ? new P2PFeedSync(feed, p2p) : null;
  if (feedSync) unsubs.push(() => feedSync.dispose());
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
  // R6.0b: coins earned by playing (NEW economy) and the Reboot shop's inventory
  const wallet = flags.on('SHOP_ENABLED') ? new Wallet(kv) : null;
  const inventory = wallet ? new Inventory(kv, wallet) : null;
  const look = (kind: 'cover' | 'card' | 'frame') => { const it = inventory ? itemById(inventory.equipped(kind)) : null; return it && !it.starter ? { a: it.a, b: it.b } : null; };
  const miinstagram = feed && phone ? new MIInstagramApp({
    svc: feed, i18n, me: 'host',
    directory: () => ({ name: nameOf, personality: (id) => (id === 'host' ? host.profile().personality : friendCache.find((f) => f.id === id)?.personality ?? 2) }),
    snapshot: () => (flags.on('MIIFOTO2_ENABLED') ? host.snapshot(480) : null),
    openMiifoto: flags.on('MIIFOTO2_ENABLED') ? () => host.openMiifoto() : null,
    closePhone: () => phone.forceClose(),
    confirm: () => settings.value.confirm,
    frame: () => look('frame'),
  }) : null;
  // ---- R6: the MiiPhone as the hub of Reboot. Order = home screen order. Shortcuts move for real through the Piazza.
  const relationsOf = (a: string, b: string) => relations.get(a, b);
  apps.register({
    id: 'profile', titleKey: 'app.profile', icon: APP_ICONS.profile, color: 'var(--r-blue)', implemented: true,
    mount: profileApp({
      i18n, me: 'host', profile: () => host.profile(), friends, closeness: relationsOf,
      posts: feed ? () => feed.postsBy('host') : null, photo: (id) => feed?.photo(id) ?? Promise.resolve(null),
      stats: games ? () => games.stats : null, openApp: (id) => { phone?.launch(id); },
      card: () => look('card'), coins: wallet ? () => wallet.balance : null,
    }),
  });
  /** A move started from the phone: through the Piazza model, with its own errors (already translated). */
  const move = async (to: string, arg?: string) => {
    if (!hub) return { ok: false, message: i18n.t('hub.err.UNAVAILABLE') };
    const r = await hub.go(to, arg);
    return r.ok || r.code === 'ALREADY_THERE' ? { ok: true } : { ok: false, message: r.message };
  };
  apps.register({
    id: 'friends', titleKey: 'app.friends', icon: APP_ICONS.friends, color: 'var(--r-green)', implemented: true,
    mount: friendsApp({
      i18n, me: 'host', friends, closeness: relationsOf,
      online: p2p ? () => p2p.online() : null,
      real: p2p?.rooms ?? null,
      places: places && visit ? { whereIs: (id) => places.whereIs(id), refusalOf: (id) => places.refusalOf(id), current: () => places.current, subscribe: (cb) => places.subscribe(() => cb()) } : null,
      go: async (placeId) => {
        const r = await move(placeId === GAMES_ID ? 'games' : 'friends', placeId === GAMES_ID ? undefined : placeId);
        if (r.ok && phone?.phase === 'open') phone.close();
        return r;
      },
    }),
  });
  if (miinstagram) apps.register({ id: 'miinstagram', titleKey: 'app.miinstagram', icon: MIINSTAGRAM_ICON, color: 'linear-gradient(150deg, var(--r-pink), var(--r-accent-hi))', implemented: true, badge: () => (settings.value.notifications ? miinstagram.unseen : 0), mount: (el) => { void friends(); return miinstagram.mount(el); } });
  if (hub) {
    apps.register({ id: 'plaza', titleKey: 'app.plaza', icon: APP_ICONS.plaza, color: 'var(--r-accent)', implemented: true, action: () => move('hub') });
    apps.register({ id: 'house', titleKey: 'app.home', icon: APP_ICONS.home, color: '#b5651d', implemented: true, action: () => move('home') });
    if (wantFriends && places && hubScreen) apps.register({
      id: 'rooms', titleKey: 'app.rooms', icon: APP_ICONS.rooms, color: 'var(--r-pink)', implemented: true,
      action: async () => { if (hub.at !== 'hub') { const r = await move('hub'); if (!r.ok) return r; } void places.refresh(); hubScreen.openPanel('friends'); return { ok: true }; },
    });
    if (games) apps.register({ id: 'games', titleKey: 'app.games', icon: APP_ICONS.games, color: 'var(--r-purple)', implemented: true, action: () => move('games') });
  }
  if (wallet && inventory) apps.register({
    id: 'shop', titleKey: 'app.shop', icon: APP_ICONS.shop, color: 'linear-gradient(150deg, #ffc83d, #e08a00)', implemented: true,
    mount: shopApp({ i18n, wallet, inventory, confirm: () => settings.value.confirm, previewCover: (id) => applyCover(id) }),
  });
  apps.register({
    id: 'settings', titleKey: 'app.settings', icon: SETTINGS_ICON, color: 'var(--r-ink-3)', implemented: true,
    mount: settingsApp(settings, i18n, { name: () => host.profile().name, rename: (n) => host.setPlayerName(n) }),
  });
  const phoneView = phone ? new MiiPhoneView(phone, i18n, layer) : null;
  if (miinstagram && phoneView) unsubs.push(miinstagram.onUnseen((n) => phoneView.notify(settings.value.notifications ? n : 0)));

  // R6.0b: the cover in use (or tried in the shop) colours the MiiPhone; coins are earned by real events
  function applyCover(tryId: string | null = null) {
    const it = itemById(tryId ?? inventory?.equipped('cover') ?? '');
    for (const [k, v] of [['--mp-a', it && !it.starter ? it.a : ''], ['--mp-b', it && !it.starter ? it.b : ''], ['--mp-shadow', it && !it.starter ? `color-mix(in srgb, ${it.b} 70%, #000)` : '']]) {
      if (v) layer.style.setProperty(k, v); else layer.style.removeProperty(k);
    }
  }
  if (wallet && inventory) {
    applyCover();
    unsubs.push(inventory.subscribe(() => applyCover()));
    let toastTimer = 0;
    unsubs.push(wallet.subscribe((e) => {
      if (e.type !== 'earned' || !settings.value.notifications) return;
      let el = layer.querySelector<HTMLElement>('.r-toast.wallet');
      if (!el) { el = document.createElement('p'); el.className = 'r-toast wallet'; el.setAttribute('role', 'status'); layer.append(el); }
      el.innerHTML = `${COIN_ICON}<span></span>`; el.querySelector('span')!.textContent = i18n.t('wallet.toast', { n: e.entry.amount, why: i18n.t(e.entry.reason, e.entry.vars) });
      el.hidden = false; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { if (el) el.hidden = true; }, 2800);
    }));
    unsubs.push(() => clearTimeout(toastTimer));
    wallet.earn('welcome', { once: 'welcome' });
    wallet.earn('daily');
    if (games) unsubs.push(games.subscribe((e) => {
      if (e.type !== 'session' || e.e.type !== 'finished') return;
      const me = e.e.result.players.find((p) => p.id === 'host'); if (!me) return;
      wallet.earn('game.played');
      if (me.rank === 1 && me.score > 0) wallet.earn('game.win');
      // the controller records the badge when the match ends: read it right after
      queueMicrotask(() => { for (const b of games.stats.badges) wallet.earn('game.badge', { once: 'badge:' + b, vars: { name: '@reward.' + b } }); });
    }));
    if (feed) unsubs.push(feed.subscribe((e) => { if (e.type === 'post.created' && e.post.authorId === 'host' && e.post.kind === 'photo') wallet.earn('post.photo'); }));
    if (visit && places) unsubs.push(visit.subscribe((e) => {
      if (e.type !== 'entered') return;
      const p = places.place(e.roomId); if (p?.kind !== 'friend' || !p.owner) return;
      wallet.earn('visit.friend', { once: `visit:${p.owner.id}:${new Date().toDateString()}`, vars: { name: p.owner.name } });
    }));
    unsubs.push(relations.subscribe((a, b, before, after) => {
      const other = a === 'host' ? b : b === 'host' ? a : null; if (!other) return;
      const lv = relationLevel(after).level;
      if (lv > relationLevel(before).level) wallet.earn('friend.level', { once: `level:${other}:${lv}`, vars: { name: nameOf(other) ?? '', level: `@rel.${lv}` } });
    }));
  }

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
  // the shared bottom bar / Menu follow the Reboot language (Italian = the original texts)
  host.setShellLabels(shellLabels(i18n));
  unsubs.push(i18n.subscribe(() => host.setShellLabels(shellLabels(i18n))), () => host.setShellLabels(null));
  if (games && phoneView) unsubs.push(games.subscribe((e) => { if (e.type !== 'session' || e.e.type === 'aborted' || e.e.type === 'finished') phoneView.sync(); }));
  if (miinstagram && phone && flags.on('MIIFOTO2_ENABLED')) {
    // Miifoto 2: the Miifoto screen gets "share on MIInstagram"; the photo becomes the draft of a post on the phone
    host.setPhotoShare({ label: () => i18n.t('miifoto.share'), share: (url) => { miinstagram.setDraft(url, 'miifoto'); phone.open('miinstagram'); } });
  }

  return {
    flags, multi, social, rooms, hub, hubScreen, panel, api, i18n, places, visit, games, phone, phoneView, feed, feedSim, miinstagram, relations, placeBar, gameView, settings, wallet, inventory,
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
