/**
 * Entry of p2p.html: the account's P2P engine in the desktop app's hidden page. It reads the user's own save (same
 * account storage) to send the Mii profile to friends, signs with the account key through the desktop app, and uses
 * the desktop app's LAN discovery. Outside the desktop app it does nothing.
 */
import { P2PEngine, P2P_CHANNEL, LanApi } from './engine';
import { loadSave, newSave } from '../play/Save';

interface Desktop {
  accounts: { current(): Promise<{ username: string; pub: string; peerId: string; code: string } | null> };
  identity: { sign(t: string): Promise<string | null>; verify(p: string, t: string, s: string): Promise<boolean> };
  lan: LanApi;
}
const D = (window as unknown as { mtwDesktop?: Desktop }).mtwDesktop;

async function main() {
  if (!D) { document.body.textContent = 'P2P: only in the desktop app.'; return; }
  const acct = await D.accounts.current();
  if (!acct) return;
  const profile = async () => {
    const s = await loadSave(newSave({})).catch(() => null);
    if (!s || !s.profile.miiData) return null;
    const { miiData, name, birthday, height, build, personality, greetings, voice } = s.profile;
    return { profile: { miiData, name: name || acct.username.slice(0, 10), birthday, height, build, personality, greetings, voice }, outfit: s.outfit, room: s.room };
  };
  const nameNow = async () => (await profile())?.profile.name ?? acct.username;
  const engine = new P2PEngine({
    me: { id: acct.peerId, pub: acct.pub, code: acct.code, name: String(await nameNow()).slice(0, 16), sign: (t) => D.identity.sign(t), verify: (p, t, s) => D.identity.verify(p, t, s) },
    lan: D.lan, kv: localStorage, channel: new BroadcastChannel(P2P_CHANNEL), profile,
  });
  (window as unknown as { __p2p: P2PEngine }).__p2p = engine;
  await engine.start();
}
void main();
