/**
 * Launcher → Friends (desktop app): the friends of this account, added ONCE and kept.
 *   my personal code     MTW-XXXX-XXXX-XXXX (copy it, give it to a friend)
 *   add by code          a player nearby → LAN request; otherwise through the presence server (waits if they are offline)
 *   requests             from the LAN or from the server: accept / decline
 *   friends              presence (online / busy / in a room / offline · last seen), the path of the link (LAN, TURN…)
 *                        and the shared-room actions: Invite to my room, Enter their room (mp/MpUi.ts)
 *   nearby               players on the same network
 *   invite codes         one-off codes with no server (alternative)
 *   settings             presence server URL, "busy", public STUN, TURN only (test of the relay path)
 * Every button is a real engine operation; errors are shown as they come. Italian / English (game language).
 */
import type { P2PClient } from './client';
import type { P2PState } from './engine';
import { friendRows, onFriendAction, esc } from '../mp/MpUi';
import { uiLang, onLang } from '../i18n/lang';

const TXS = {
  it: { me: 'Tu', code: 'il tuo codice personale', copyCode: 'Copia il codice', lanOn: 'Rete locale: attiva', lanOff: 'Rete locale: spenta', lanErr: 'Rete locale non disponibile (porte occupate o bloccate).',
    server: { off: 'Server di presenza: non impostato (solo rete locale e codici d\'invito)', connecting: 'Server di presenza: collegamento…', on: 'Server di presenza: collegato', error: 'Server di presenza: non raggiungibile' },
    addTitle: 'Aggiungi un amico', addPh: 'Codice dell\'amico (MTW-XXXX-XXXX-XXXX)', addBtn: 'Aggiungi', addOk: 'Richiesta inviata: l\'amico la vedrà anche se ora è offline.', addHelp: 'Basta una volta: dopo, vi ritrovate da soli (sulla rete locale, o tramite il server di presenza).',
    requests: 'Richieste di amicizia', accept: 'Accetta', decline: 'Rifiuta', viaServer: 'via internet', viaLan: 'stessa rete', friends: 'I tuoi amici', none: 'Ancora nessun amico. Aggiungine uno con il suo codice, o qui sotto se è sulla tua rete.',
    remove: 'Rimuovi', removeAsk: 'Sicuro?', nearby: 'Sulla tua rete', nobody: 'Nessun altro giocatore sulla rete in questo momento.', add: 'Aggiungi', requested: 'Richiesta inviata', pending: 'In attesa di risposta',
    internet: 'Codici d\'invito (alternativa, senza server)', internetHelp: 'Crea un codice e mandalo al tuo amico. Lui ti rimanda un codice di risposta: incollalo qui. I codici scadono in 15 minuti e contengono il tuo indirizzo di rete: dalli solo ai tuoi amici.',
    create: 'Crea codice d\'invito', copy: 'Copia', copied: 'Copiato.', replyPh: 'Incolla qui il codice di risposta', connect: 'Collega', haveInvite: 'Ho ricevuto un codice', invitePh: 'Incolla il codice d\'invito del tuo amico', makeReply: 'Crea la risposta', replyHint: 'Manda questo codice di risposta al tuo amico:', waiting: 'In attesa della risposta…', cancel: 'Annulla',
    settings: 'Impostazioni di collegamento', serverPh: 'wss://indirizzo-del-server/v1', save: 'Salva', busy: 'Occupato (gli amici vedono che non vuoi essere disturbato)', stun: 'Usa un server pubblico per trovare il tuo indirizzo internet (STUN). Nessun dato di gioco passa da lì.', relay: 'Solo TURN (prova del collegamento tramite relay; più lento)',
    note: 'I dati di gioco vanno direttamente da PC a PC, cifrati. Il server di presenza (se impostato) dice solo chi è online e aiuta a collegarsi.',
    err: { NO_MII: 'Crea prima il tuo Mii (gioca a Classic o Reboot una volta).', OFFLINE: 'Non è raggiungibile adesso.', NOT_FOUND: 'Nessun giocatore con questo codice (deve essersi collegato almeno una volta al server).', ALREADY_FRIENDS: 'Siete già amici.', FORMAT: 'Codice non valido.', KIND: 'È il tipo di codice sbagliato.', EXPIRED: 'Il codice è scaduto: creane uno nuovo.', SELF: 'È il tuo codice.', NO_INVITE: 'Prima crea un codice d\'invito.', FAILED: 'Non riuscito.', LIMIT: 'Troppe connessioni.', TIMEOUT: 'Il motore P2P non risponde.', UNKNOWN_OP: 'Operazione sconosciuta.', NO_SERVER: 'Per un amico che non è sulla tua rete serve il server di presenza (Impostazioni di collegamento qui sotto).' } },
  en: { me: 'You', code: 'your personal code', copyCode: 'Copy the code', lanOn: 'Local network: on', lanOff: 'Local network: off', lanErr: 'Local network not available (ports in use or blocked).',
    server: { off: 'Presence server: not set (local network and invite codes only)', connecting: 'Presence server: connecting…', on: 'Presence server: connected', error: 'Presence server: not reachable' },
    addTitle: 'Add a friend', addPh: 'Your friend\'s code (MTW-XXXX-XXXX-XXXX)', addBtn: 'Add', addOk: 'Request sent: your friend will see it even if they are offline now.', addHelp: 'Only once: afterwards you find each other by yourselves (local network, or the presence server).',
    requests: 'Friend requests', accept: 'Accept', decline: 'Decline', viaServer: 'over the internet', viaLan: 'same network', friends: 'Your friends', none: 'No friends yet. Add one with their code, or below if they are on your network.',
    remove: 'Remove', removeAsk: 'Sure?', nearby: 'On your network', nobody: 'No other player on the network right now.', add: 'Add', requested: 'Request sent', pending: 'Waiting for an answer',
    internet: 'Invite codes (alternative, no server)', internetHelp: 'Make a code and send it to your friend. They send you back a reply code: paste it here. Codes expire in 15 minutes and contain your network address: give them only to your friends.',
    create: 'Make an invite code', copy: 'Copy', copied: 'Copied.', replyPh: 'Paste the reply code here', connect: 'Connect', haveInvite: 'I got a code', invitePh: 'Paste your friend\'s invite code', makeReply: 'Make the reply', replyHint: 'Send this reply code to your friend:', waiting: 'Waiting for the reply…', cancel: 'Cancel',
    settings: 'Connection settings', serverPh: 'wss://server-address/v1', save: 'Save', busy: 'Busy (friends see you do not want to be disturbed)', stun: 'Use a public server to find your internet address (STUN). No game data goes through it.', relay: 'TURN only (test of the relayed connection; slower)',
    note: 'Game data goes straight from PC to PC, encrypted. The presence server (if set) only says who is online and helps to connect.',
    err: { NO_MII: 'Create your Mii first (play Classic or Reboot once).', OFFLINE: 'Not reachable right now.', NOT_FOUND: 'No player with this code (they must have connected to the server at least once).', ALREADY_FRIENDS: 'You are already friends.', FORMAT: 'Not a valid code.', KIND: 'Wrong kind of code.', EXPIRED: 'The code expired: make a new one.', SELF: 'That is your own code.', NO_INVITE: 'Make an invite code first.', FAILED: 'Did not work.', LIMIT: 'Too many connections.', TIMEOUT: 'The P2P engine does not answer.', UNKNOWN_OP: 'Unknown operation.', NO_SERVER: 'A friend who is not on your network needs the presence server (Connection settings below).' } },
};

export function friendsPanel(p2p: P2PClient) {
  return (el: HTMLElement) => {
    let msg = '', invite = '', reply = '', removing = '', busy = false;
    const TX = () => TXS[uiLang()];
    const err = (code: string) => (TX().err as Record<string, string>)[code] ?? code;
    const run = async (op: string, args: Record<string, unknown> = {}) => {
      busy = true; msg = ''; render();
      const r = await p2p.request(op, args);
      busy = false; if (!r.ok) msg = err(String(r.code));
      render();
      return r;
    };
    const render = () => {
      const s: P2PState | null = p2p.state, T = TX();
      if (!s) { el.innerHTML = `<p class="fp-note">${esc(T.err.TIMEOUT)}</p>`; return; }
      const nearby = s.nearby.filter((n) => !n.friend);
      const outgoing = s.outgoing.filter((o) => !s.friends.some((f) => f.id === o.id));
      el.innerHTML = `<div class="fp">
        <p class="fp-me"><b>${esc(T.me)}: ${esc(s.me.name)}</b> · ${esc(T.code)} <code data-mycode>${esc(s.me.code)}</code> <button type="button" class="ln-btn ghost" data-copy="code">${esc(T.copyCode)}</button><br>
          <small>${esc(s.lan === 'on' ? T.lanOn : s.lan === 'error' ? T.lanErr : T.lanOff)}</small><small data-server-state="${esc(s.server.state)}">${esc(T.server[s.server.state])}${s.server.state === 'error' && s.server.why ? ` (${esc(s.server.why)})` : ''}</small></p>
        <h3>${esc(T.addTitle)}</h3>
        <div class="fp-row"><input data-in="code" placeholder="${esc(T.addPh)}" autocomplete="off" spellcheck="false"><button type="button" class="ln-btn" data-a="code" ${busy ? 'disabled' : ''}>${esc(T.addBtn)}</button></div>
        <p class="fp-note">${esc(T.addHelp)}</p>
        ${s.incoming.length ? `<h3>${esc(T.requests)}</h3><ul class="fp-list">${s.incoming.map((r) => `<li><span class="fp-name">${esc(r.name)}<small>${esc(r.via === 'server' ? T.viaServer : T.viaLan)}</small></span><span class="fp-acts"><button type="button" class="ln-btn" data-acc="${esc(r.id)}" ${busy ? 'disabled' : ''}>${esc(T.accept)}</button><button type="button" class="ln-btn ghost" data-dec="${esc(r.id)}" ${busy ? 'disabled' : ''}>${esc(T.decline)}</button></span></li>`).join('')}</ul>` : ''}
        <h3>${esc(T.friends)}</h3>
        ${s.friends.length ? friendRows(s, p2p.mp) + `<div class="fp-rm">${s.friends.map((f) => `<button type="button" class="ln-btn ghost small" data-rm="${esc(f.id)}">${esc(removing === f.id ? `${T.removeAsk} (${f.name})` : `${T.remove} ${f.name}`)}</button>`).join('')}</div>` : `<p class="fp-note">${esc(T.none)}</p>`}
        ${outgoing.length ? `<ul class="fp-list">${outgoing.map((o) => `<li><span class="fp-name">${esc(o.name)}<small>${esc(T.pending)} · ${esc(o.via === 'server' ? T.viaServer : T.viaLan)}</small></span></li>`).join('')}</ul>` : ''}
        <h3>${esc(T.nearby)}</h3>
        ${nearby.length ? `<ul class="fp-list">${nearby.map((n) => `<li><span class="fp-name">${esc(n.name)}<small>${esc(n.code)}</small></span>${n.requested ? `<span class="fp-tag">${esc(T.requested)}</span>` : `<button type="button" class="ln-btn" data-add="${esc(n.id)}" ${busy ? 'disabled' : ''}>${esc(T.add)}</button>`}</li>`).join('')}</ul>` : `<p class="fp-note">${esc(s.lan === 'on' ? T.nobody : s.lan === 'error' ? T.lanErr : T.lanOff)}</p>`}
        <details><summary>${esc(T.internet)}</summary>
        <p class="fp-note">${esc(T.internetHelp)}</p>
        <div class="fp-codes">
          ${invite ? `<textarea readonly rows="3" data-code>${esc(invite)}</textarea><div class="fp-row"><button type="button" class="ln-btn ghost" data-copy="invite">${esc(T.copy)}</button><small>${esc(s.invite === 'waiting' ? T.waiting : '')}</small></div>
            <div class="fp-row"><input data-in="reply" placeholder="${esc(T.replyPh)}"><button type="button" class="ln-btn" data-a="complete" ${busy ? 'disabled' : ''}>${esc(T.connect)}</button><button type="button" class="ln-btn ghost" data-a="cancel">${esc(T.cancel)}</button></div>`
            : `<button type="button" class="ln-btn" data-a="create" ${busy ? 'disabled' : ''}>${esc(T.create)}</button>`}
          <details ${reply ? 'open' : ''}><summary>${esc(T.haveInvite)}</summary>
            <div class="fp-row"><input data-in="invite" placeholder="${esc(T.invitePh)}"><button type="button" class="ln-btn" data-a="accept" ${busy ? 'disabled' : ''}>${esc(T.makeReply)}</button></div>
            ${reply ? `<p class="fp-note">${esc(T.replyHint)}</p><textarea readonly rows="3">${esc(reply)}</textarea><button type="button" class="ln-btn ghost" data-copy="reply">${esc(T.copy)}</button>` : ''}
          </details>
        </div></details>
        <details><summary>${esc(T.settings)}</summary>
          <div class="fp-row"><input data-in="server" placeholder="${esc(T.serverPh)}" value="${esc(s.settings.server || '')}"><button type="button" class="ln-btn ghost" data-a="server">${esc(T.save)}</button></div>
          <label class="fp-check"><input type="checkbox" data-set="busy" ${s.settings.busy ? 'checked' : ''}> ${esc(T.busy)}</label>
          <label class="fp-check"><input type="checkbox" data-set="stun" ${s.settings.stun ? 'checked' : ''}> ${esc(T.stun)}</label>
          <label class="fp-check"><input type="checkbox" data-set="relayOnly" ${s.settings.relayOnly ? 'checked' : ''}> ${esc(T.relay)}</label>
        </details>
        <p class="fp-msg" role="status">${esc(msg)}</p>
        <p class="fp-note">${esc(T.note)}</p>
      </div>`;
    };
    const val = (k: string) => el.querySelector<HTMLInputElement>(`[data-in="${k}"]`)?.value ?? '';
    const onClick = async (e: Event) => {
      const fa = await onFriendAction(e, p2p);
      if (fa !== null) { msg = fa; render(); return; }
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      const d = b.dataset, T = TX();
      if (d.acc) await run('accept', { id: d.acc });
      else if (d.dec) await run('decline', { id: d.dec });
      else if (d.add) await run('add', { id: d.add });
      else if (d.rm) { if (removing !== d.rm) { removing = d.rm; render(); return; } removing = ''; await run('unfriend', { id: d.rm }); }
      else if (d.copy) { try { await navigator.clipboard.writeText(d.copy === 'invite' ? invite : d.copy === 'reply' ? reply : p2p.state?.me.code ?? ''); msg = T.copied; } catch { msg = ''; } render(); }
      else if (d.a === 'code') { const r = await run('friend.code', { code: val('code') }); if (r.ok) { msg = T.addOk; render(); } }
      else if (d.a === 'server') await run('settings', { server: val('server') });
      else if (d.a === 'create') { const r = await run('invite.create'); if (r.ok) { invite = String(r.value); render(); } }
      else if (d.a === 'complete') { const r = await run('invite.complete', { code: val('reply') }); if (r.ok) { invite = ''; render(); } }
      else if (d.a === 'cancel') { invite = ''; await run('invite.cancel'); }
      else if (d.a === 'accept') { const r = await run('invite.accept', { code: val('invite') }); if (r.ok) { reply = String(r.value); render(); } }
    };
    const onChange = (e: Event) => { const x = e.target as HTMLInputElement; const k = x.dataset.set; if (k) void run('settings', { [k]: x.checked }); };
    el.addEventListener('click', onClick); el.addEventListener('change', onChange);
    // live state (a friend comes online, a request arrives) — but do not wipe what is being typed
    const typing = () => el.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && document.activeElement.type !== 'checkbox';
    const un = [p2p.onState(() => { if (!typing()) render(); }), p2p.onMp(() => { if (!typing()) render(); }), onLang(() => render())];
    render();
    return () => { for (const u of un) u(); el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); el.innerHTML = ''; };
  };
}
