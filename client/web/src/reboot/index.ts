/**
 * MIITOMO REBOOT — entry point (loaded with a dynamic import only when reboot/gate.ts is open).
 * Everything under src/reboot/ is REBOOT: new features, NOT original Nintendo content (docs/reboot/CLASSIC-VS-REBOOT.md).
 */
import type { RebootHost } from './host';
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

export interface RebootRuntime { flags: RebootFlags; multi: MultiMii | null; social: SocialLife | null; rooms: PublicRoomController | null; hub: SocialHub | null; hubScreen: HubScreen | null; panel: RebootPanel; api: RebootApi; dispose(): void; }

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
  // R4: Social Hub — a model over R3 (events in, open / close requests out) + its view
  const inRoom = () => host.screen() === 'room' && !host.visiting();
  const hub = flags.on('HUB_ENABLED') ? new SocialHub({ rooms, inRoom, onTick: host.onTick, showRoomPanel: () => panel.show() }) : null;
  const hubScreen = hub ? new HubScreen(hub, panel.el, inRoom) : null;
  return { flags, multi, social, rooms, hub, hubScreen, panel, api, dispose() { hubScreen?.dispose(); hub?.dispose(); rooms?.dispose(); social?.dispose(); panel.dispose(); host.setCapacity(1); } };
}
