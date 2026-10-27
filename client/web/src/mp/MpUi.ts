/**
 * SHARED ROOM — the parts of the interface every page shows (launcher, Classic, Reboot MiiPhone):
 *   friendRows / onFriendAction   the friend list with presence (online / busy / in a room / offline) and the two
 *                                 actions: Invite (to my room) and Enter (their room). Every button is a real engine op.
 *   mountMpOverlay                always on screen in a game page: invitations and requests to enter (accept /
 *                                 decline), what I am waiting for, the shared-room bar (who is here, their link,
 *                                 Wave, Leave) and what just happened (declined, expired, host left…).
 */
import './mp.css';
import type { P2PClient } from '../p2p/client';
import type { P2PState } from '../p2p/engine';
import type { MpView } from '../p2p/session';
import { uiLang, onLang } from '../i18n/lang';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const TX = {
  it: {
    online: 'online', offline: 'offline', busy: 'occupato', inRoom: 'in una stanza', inMyRoom: 'nella tua stanza', inHisRoom: 'nella sua stanza', seen: 'visto', ago: 'fa',
    invite: 'Invita', enter: 'Entra nella stanza', invited: 'Invito inviato', knocked: 'Richiesta inviata', here: 'È qui',
    invites: '{name} ti invita nella sua stanza', knocks: '{name} vuole entrare nella tua stanza', join: 'Entra', letIn: 'Fai entrare', no: 'No',
    waitingInv: 'Aspetto la risposta di {name}…', waitingJoin: 'Entro nella stanza di {name}…', waitingKnock: 'Ho chiesto a {name} di entrare…',
    shared: 'Stanza di {name}', mine: 'La tua stanza', with: 'con', alone: 'Aspetta i tuoi amici', reconnecting: 'Collegamento perso: riprovo…', lost: 'collegamento perso',
    wave: 'Saluta', leave: 'Esci', close: 'Chiudi la stanza', ms: 'ms',
    last: { denied: '{name} non ti ha fatto entrare', declined: '{name} ha detto di no', ended: 'La stanza è stata chiusa', left: 'Sei uscito dalla stanza', expired: '{name} non ha risposto', error: 'Errore' },
    why: { HOST_LEFT: '{name} ha chiuso la stanza', HOST_LOST: 'Collegamento con {name} perso', REMOVED: 'Non sei più nella stanza', SEAT_LOST: 'La stanza non c\'è più', EXPIRED: 'L\'invito era scaduto', FULL: 'La stanza è piena', DECLINED: '{name} ha detto di no', NOT_INVITED: 'Invito non valido', NO_SESSION: 'La stanza non c\'è più', CROSSED: 'Vi siete invitati a vicenda: entri da {name}', LOGOUT: '{name} è uscito dal gioco' },
    err: { NOT_FRIEND: 'Non siete amici.', OFFLINE: 'Non è collegato adesso.', NOT_HOST: 'Solo chi ospita la stanza può invitare.', NO_INVITE: 'L\'invito è scaduto.', NO_KNOCK: 'La richiesta è scaduta.', NO_SESSION: 'Non sei in una stanza condivisa.', FULL: 'La stanza è piena.', NO_MII: 'Crea prima il tuo Mii.', TIMEOUT: 'Il motore P2P non risponde.', FAILED: 'Non riuscito.' },
  },
  en: {
    online: 'online', offline: 'offline', busy: 'busy', inRoom: 'in a room', inMyRoom: 'in your room', inHisRoom: 'in their room', seen: 'seen', ago: 'ago',
    invite: 'Invite', enter: 'Enter their room', invited: 'Invitation sent', knocked: 'Request sent', here: 'Here',
    invites: '{name} invites you to their room', knocks: '{name} wants to enter your room', join: 'Enter', letIn: 'Let in', no: 'No',
    waitingInv: 'Waiting for {name} to answer…', waitingJoin: 'Entering {name}\'s room…', waitingKnock: 'Asked {name} to come in…',
    shared: '{name}\'s room', mine: 'Your room', with: 'with', alone: 'Waiting for your friends', reconnecting: 'Connection lost: trying again…', lost: 'connection lost',
    wave: 'Wave', leave: 'Leave', close: 'Close the room', ms: 'ms',
    last: { denied: '{name} did not let you in', declined: '{name} said no', ended: 'The room was closed', left: 'You left the room', expired: '{name} did not answer', error: 'Error' },
    why: { HOST_LEFT: '{name} closed the room', HOST_LOST: 'Lost the connection to {name}', REMOVED: 'You are no longer in the room', SEAT_LOST: 'The room is gone', EXPIRED: 'The invitation had expired', FULL: 'The room is full', DECLINED: '{name} said no', NOT_INVITED: 'Not a valid invitation', NO_SESSION: 'The room is gone', CROSSED: 'You invited each other: you go to {name}\'s', LOGOUT: '{name} left the game' },
    err: { NOT_FRIEND: 'You are not friends.', OFFLINE: 'Not connected right now.', NOT_HOST: 'Only the room\'s host can invite.', NO_INVITE: 'The invitation expired.', NO_KNOCK: 'The request expired.', NO_SESSION: 'You are not in a shared room.', FULL: 'The room is full.', NO_MII: 'Create your Mii first.', TIMEOUT: 'The P2P engine does not answer.', FAILED: 'Did not work.' },
  },
};
export const mpText = () => TX[uiLang()];
const fill = (s: string, name: string) => s.replace('{name}', name);
const ago = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} g`;
};
export function mpError(code: string) { return (mpText().err as Record<string, string>)[code] ?? code; }

/** Presence of one friend in words (and a css class). */
export function presenceOf(f: P2PState['friends'][number], mp: MpView | null) {
  const t = mpText();
  if (mp?.session?.members.some((m) => m.id === f.id)) return { cls: 'here', text: t.here };
  if (f.presence === 'in-room') return { cls: 'room', text: f.room?.host === mp?.me ? t.inMyRoom : f.room?.host === f.id ? t.inHisRoom : t.inRoom };
  if (f.presence === 'busy') return { cls: 'busy', text: t.busy };
  if (f.online || f.presence === 'online') return { cls: 'on', text: t.online };
  return { cls: 'off', text: f.lastSeen ? `${t.offline} · ${t.seen} ${ago(f.lastSeen)} ${uiLang() === 'it' ? t.ago : t.ago}` : t.offline };
}
/** The friend list with presence and the shared-room actions. */
export function friendRows(s: P2PState, mp: MpView | null, cls = 'mp-friends') {
  const t = mpText();
  if (!s.friends.length) return '';
  const pend = (kind: string, id: string) => mp?.pending.some((p) => p.kind === kind && p.to === id);
  const iAmGuest = mp?.session?.role === 'guest';
  return `<ul class="${cls}">${s.friends.map((f) => {
    const p = presenceOf(f, mp), here = p.cls === 'here';
    const canInvite = f.online && !here && !iAmGuest, canEnter = f.online && !here && f.presence !== 'busy';
    return `<li data-friend="${esc(f.id)}"><span class="mp-dot ${p.cls}" aria-hidden="true"></span><span class="mp-fname">${esc(f.name)}<small>${esc(p.text)}${f.route ? ` · ${esc(f.route === 'relay' ? 'TURN' : f.route === 'host' ? 'LAN' : f.route)}` : ''}</small></span>
      <span class="mp-acts">${pend('inv', f.id) ? `<span class="mp-tag">${esc(t.invited)}</span>` : canInvite ? `<button type="button" class="mp-btn" data-mp-invite="${esc(f.id)}">${esc(t.invite)}</button>` : ''}${pend('knock', f.id) ? `<span class="mp-tag">${esc(t.knocked)}</span>` : canEnter && f.presence !== 'in-room' || (canEnter && f.room?.host === f.id) ? `<button type="button" class="mp-btn ghost" data-mp-knock="${esc(f.id)}">${esc(t.enter)}</button>` : ''}</span></li>`;
  }).join('')}</ul>`;
}
/** Click on a friend-list action; returns the error text (or ''). */
export async function onFriendAction(e: Event, p2p: P2PClient): Promise<string | null> {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return null;
  const d = b.dataset;
  const op = d.mpInvite ? ['mp.invite', d.mpInvite] : d.mpKnock ? ['mp.knock', d.mpKnock] : null;
  if (!op) return null;
  b.setAttribute('disabled', '');
  const r = await p2p.request(op[0], { to: op[1] });
  b.removeAttribute('disabled');
  return r.ok ? '' : mpError(r.code);
}

/** The overlay of a game page. `wave` = my Mii waves (the room adapter sends it to the others). */
export function mountMpOverlay(root: HTMLElement, p2p: P2PClient, opts: { wave?: () => void } = {}) {
  const el = document.createElement('div'); el.className = 'mp-overlay'; el.setAttribute('aria-live', 'polite');
  root.append(el);
  let note = '', noteAt = 0, lastSeen = 0, shown = '';
  const nameOf = (id: string | null) => (id && (p2p.state?.friends.find((f) => f.id === id)?.name ?? p2p.mp?.session?.members.find((m) => m.id === id)?.name)) || '…';
  const render = () => {
    const v = p2p.mp, t = mpText(); if (!v) { el.innerHTML = ''; shown = ''; return; }
    if (v.last && v.last.at > lastSeen) { lastSeen = v.last.at; const who = nameOf(v.last.who); note = fill((t.why as Record<string, string>)[v.last.why] ?? (t.last as Record<string, string>)[v.last.kind] ?? v.last.why, who); noteAt = Date.now(); }
    const s = v.session;
    const parts: string[] = [];
    for (const i of v.invites) parts.push(`<div class="mp-card" data-inv="${esc(i.sid)}"><p>${esc(fill(t.invites, i.name))}</p><div><button type="button" class="mp-btn" data-mp-accept="${esc(i.sid)}">${esc(t.join)}</button><button type="button" class="mp-btn ghost" data-mp-decline="${esc(i.sid)}">${esc(t.no)}</button></div></div>`);
    for (const k of v.knocks) parts.push(`<div class="mp-card" data-knock="${esc(k.from)}"><p>${esc(fill(t.knocks, k.name))}</p><div><button type="button" class="mp-btn" data-mp-admit="${esc(k.from)}">${esc(t.letIn)}</button><button type="button" class="mp-btn ghost" data-mp-refuse="${esc(k.from)}">${esc(t.no)}</button></div></div>`);
    for (const p of v.pending) if (p.kind !== 'inv' || !s) parts.push(`<div class="mp-card wait"><p>${esc(fill(p.kind === 'inv' ? t.waitingInv : p.kind === 'join' ? t.waitingJoin : t.waitingKnock, nameOf(p.to)))}</p></div>`);
    if (s) {
      const others = s.members.filter((m) => m.id !== v.me);
      const title = s.role === 'host' ? t.mine : fill(t.shared, nameOf(s.host));
      parts.push(`<div class="mp-bar ${s.state}" data-session="${esc(s.sid)}"><b>${esc(title)}</b>
        <span class="mp-who">${others.length ? `${esc(t.with)} ${others.map((m) => `<span class="mp-member ${m.conn}" data-member="${esc(m.id)}">${esc(m.name)}${m.conn === 'lost' ? ` (${esc(t.lost)})` : m.rtt !== null ? ` <small>${m.rtt} ${t.ms}</small>` : ''}</span>`).join(', ')}` : esc(t.alone)}</span>
        ${s.state === 'reconnecting' ? `<span class="mp-warn">${esc(t.reconnecting)}</span>` : ''}
        ${opts.wave ? `<button type="button" class="mp-btn ghost" data-mp-wave>${esc(t.wave)}</button>` : ''}
        <button type="button" class="mp-btn ghost" data-mp-leave>${esc(s.role === 'host' ? t.close : t.leave)}</button></div>`);
    }
    if (note && Date.now() - noteAt < 6000) parts.push(`<div class="mp-note" role="status">${esc(note)}</div>`);
    // only when something changed: a re-render under the pointer would eat a click
    const html = parts.join(''); if (html !== shown) { shown = html; el.innerHTML = html; }
  };
  const onClick = async (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    const d = b.dataset;
    let r: { ok: boolean; code?: string } | null = null;
    if (d.mpAccept) r = await p2p.request('mp.accept', { sid: d.mpAccept });
    else if (d.mpDecline) r = await p2p.request('mp.decline', { sid: d.mpDecline });
    else if (d.mpAdmit) r = await p2p.request('mp.admit', { from: d.mpAdmit });
    else if (d.mpRefuse) r = await p2p.request('mp.refuse', { from: d.mpRefuse });
    else if (d.mpLeave !== undefined) r = await p2p.request('mp.leave', {});
    else if (d.mpWave !== undefined) { opts.wave?.(); return; }
    if (r && !r.ok) { note = mpError(String(r.code)); noteAt = Date.now(); render(); }
  };
  el.addEventListener('click', onClick);
  const un = [p2p.onMp(render), p2p.onState(render), onLang(render)];
  const tick = window.setInterval(render, 2000);   // timers (expiry, notes)
  render();
  return () => { for (const u of un) u(); clearInterval(tick); el.removeEventListener('click', onClick); el.remove(); };
}
