/**
 * Launcher → Friends (desktop app): the peer-to-peer friends of this account. Requests, friends (online or not),
 * players nearby on the same network, and invite codes for friends over the internet. Every button does a real
 * operation of the P2P engine; its errors are shown as they come.
 */
import type { P2PClient } from './client';
import type { P2PState } from './engine';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const LANG = (() => { try { const l = localStorage.getItem('mtw.reboot.lang'); if (l) return l === 'it' ? 'it' : 'en'; } catch { /* */ } return /^it\b/i.test(navigator.language) ? 'it' : 'en'; })();
const TX = {
  it: { me: 'Tu', code: 'codice', lanOn: 'Rete locale: attiva', lanOff: 'Rete locale: spenta', lanErr: 'Rete locale non disponibile (porta occupata o bloccata).',
    requests: 'Richieste di amicizia', accept: 'Accetta', decline: 'Rifiuta', friends: 'I tuoi amici', none: 'Ancora nessun amico. Aggiungi chi è sulla tua rete, o scambia un codice d\'invito.',
    online: 'online', offline: 'offline', remove: 'Rimuovi', removeAsk: 'Sicuro?', nearby: 'Sulla tua rete', nobody: 'Nessun altro giocatore sulla rete in questo momento.', add: 'Aggiungi', requested: 'Richiesta inviata',
    internet: 'Amici su internet (codici d\'invito)', internetHelp: 'Crea un codice e mandalo al tuo amico (chat, email). Lui ti rimanda un codice di risposta: incollalo qui. I codici scadono in 15 minuti e contengono il tuo indirizzo di rete: dalli solo ai tuoi amici.',
    create: 'Crea codice d\'invito', copy: 'Copia', copied: 'Copiato.', replyPh: 'Incolla qui il codice di risposta', connect: 'Collega', haveInvite: 'Ho ricevuto un codice', invitePh: 'Incolla il codice d\'invito del tuo amico', makeReply: 'Crea la risposta', replyHint: 'Manda questo codice di risposta al tuo amico:', waiting: 'In attesa della risposta…', cancel: 'Annulla',
    stun: 'Usa un server pubblico per trovare il tuo indirizzo internet (STUN di Google). Nessun dato di gioco passa da lì.', note: 'Peer-to-peer: i dati vanno direttamente da PC a PC, cifrati. Nessun server di Miitomo Web.',
    err: { NO_MII: 'Crea prima il tuo Mii (gioca a Classic o Reboot una volta).', OFFLINE: 'Non è raggiungibile adesso.', NOT_FOUND: 'Non trovato.', ALREADY_FRIENDS: 'Siete già amici.', FORMAT: 'Codice non valido.', KIND: 'È il tipo di codice sbagliato (invito al posto di risposta o viceversa).', EXPIRED: 'Il codice è scaduto: creane uno nuovo.', SELF: 'È il tuo codice.', NO_INVITE: 'Prima crea un codice d\'invito.', FAILED: 'Collegamento non riuscito.', LIMIT: 'Troppe connessioni.', TIMEOUT: 'Il motore P2P non risponde.', UNKNOWN_OP: 'Operazione sconosciuta.' } },
  en: { me: 'You', code: 'code', lanOn: 'Local network: on', lanOff: 'Local network: off', lanErr: 'Local network not available (port in use or blocked).',
    requests: 'Friend requests', accept: 'Accept', decline: 'Decline', friends: 'Your friends', none: 'No friends yet. Add someone on your network, or exchange an invite code.',
    online: 'online', offline: 'offline', remove: 'Remove', removeAsk: 'Sure?', nearby: 'On your network', nobody: 'No other player on the network right now.', add: 'Add', requested: 'Request sent',
    internet: 'Friends over the internet (invite codes)', internetHelp: 'Make a code and send it to your friend (chat, email). They send you back a reply code: paste it here. Codes expire in 15 minutes and contain your network address: give them only to your friends.',
    create: 'Make an invite code', copy: 'Copy', copied: 'Copied.', replyPh: 'Paste the reply code here', connect: 'Connect', haveInvite: 'I got a code', invitePh: 'Paste your friend\'s invite code', makeReply: 'Make the reply', replyHint: 'Send this reply code to your friend:', waiting: 'Waiting for the reply…', cancel: 'Cancel',
    stun: 'Use a public server to find your internet address (Google STUN). No game data goes through it.', note: 'Peer-to-peer: data goes straight from PC to PC, encrypted. No Miitomo Web server.',
    err: { NO_MII: 'Create your Mii first (play Classic or Reboot once).', OFFLINE: 'Not reachable right now.', NOT_FOUND: 'Not found.', ALREADY_FRIENDS: 'You are already friends.', FORMAT: 'Not a valid code.', KIND: 'Wrong kind of code (invite instead of reply or the other way round).', EXPIRED: 'The code expired: make a new one.', SELF: 'That is your own code.', NO_INVITE: 'Make an invite code first.', FAILED: 'Could not connect.', LIMIT: 'Too many connections.', TIMEOUT: 'The P2P engine does not answer.', UNKNOWN_OP: 'Unknown operation.' } },
}[LANG];

export function friendsPanel(p2p: P2PClient) {
  return (el: HTMLElement) => {
    let msg = '', invite = '', reply = '', removing = '', busy = false;
    const err = (code: string) => (TX.err as Record<string, string>)[code] ?? code;
    const run = async (op: string, args: Record<string, unknown> = {}) => {
      busy = true; msg = ''; render();
      const r = await p2p.request(op, args);
      busy = false; if (!r.ok) msg = err(r.code);
      render();
      return r;
    };
    const render = () => {
      const s: P2PState | null = p2p.state;
      if (!s) { el.innerHTML = `<p class="fp-note">${esc(TX.err.TIMEOUT)}</p>`; return; }
      const nearby = s.nearby.filter((n) => !n.friend);
      el.innerHTML = `<div class="fp">
        <p class="fp-me"><b>${esc(TX.me)}: ${esc(s.me.name)}</b> · ${esc(TX.code)} <code>${esc(s.me.code)}</code><br><small>${esc(s.lan === 'on' ? TX.lanOn : s.lan === 'error' ? TX.lanErr : TX.lanOff)}</small></p>
        ${s.incoming.length ? `<h3>${esc(TX.requests)}</h3><ul class="fp-list">${s.incoming.map((r) => `<li><span class="fp-name">${esc(r.name)}</span><span class="fp-acts"><button type="button" class="ln-btn" data-acc="${esc(r.id)}" ${busy ? 'disabled' : ''}>${esc(TX.accept)}</button><button type="button" class="ln-btn ghost" data-dec="${esc(r.id)}" ${busy ? 'disabled' : ''}>${esc(TX.decline)}</button></span></li>`).join('')}</ul>` : ''}
        <h3>${esc(TX.friends)}</h3>
        ${s.friends.length ? `<ul class="fp-list">${s.friends.map((f) => `<li><span class="fp-dot ${f.online ? 'on' : ''}" aria-hidden="true"></span><span class="fp-name">${esc(f.name)}<small>${esc(f.online ? TX.online : TX.offline)}</small></span><button type="button" class="ln-btn ghost" data-rm="${esc(f.id)}">${esc(removing === f.id ? TX.removeAsk : TX.remove)}</button></li>`).join('')}</ul>` : `<p class="fp-note">${esc(TX.none)}</p>`}
        <h3>${esc(TX.nearby)}</h3>
        ${nearby.length ? `<ul class="fp-list">${nearby.map((n) => `<li><span class="fp-name">${esc(n.name)}<small>${esc(n.code)}</small></span>${n.requested ? `<span class="fp-tag">${esc(TX.requested)}</span>` : `<button type="button" class="ln-btn" data-add="${esc(n.id)}" ${busy ? 'disabled' : ''}>${esc(TX.add)}</button>`}</li>`).join('')}</ul>` : `<p class="fp-note">${esc(s.lan === 'on' ? TX.nobody : s.lan === 'error' ? TX.lanErr : TX.lanOff)}</p>`}
        <h3>${esc(TX.internet)}</h3>
        <p class="fp-note">${esc(TX.internetHelp)}</p>
        <div class="fp-codes">
          ${invite ? `<textarea readonly rows="3" data-code>${esc(invite)}</textarea><div class="fp-row"><button type="button" class="ln-btn ghost" data-copy="invite">${esc(TX.copy)}</button><small>${esc(s.invite === 'waiting' ? TX.waiting : '')}</small></div>
            <div class="fp-row"><input data-in="reply" placeholder="${esc(TX.replyPh)}"><button type="button" class="ln-btn" data-a="complete" ${busy ? 'disabled' : ''}>${esc(TX.connect)}</button><button type="button" class="ln-btn ghost" data-a="cancel">${esc(TX.cancel)}</button></div>`
            : `<button type="button" class="ln-btn" data-a="create" ${busy ? 'disabled' : ''}>${esc(TX.create)}</button>`}
          <details ${reply ? 'open' : ''}><summary>${esc(TX.haveInvite)}</summary>
            <div class="fp-row"><input data-in="invite" placeholder="${esc(TX.invitePh)}"><button type="button" class="ln-btn" data-a="accept" ${busy ? 'disabled' : ''}>${esc(TX.makeReply)}</button></div>
            ${reply ? `<p class="fp-note">${esc(TX.replyHint)}</p><textarea readonly rows="3">${esc(reply)}</textarea><button type="button" class="ln-btn ghost" data-copy="reply">${esc(TX.copy)}</button>` : ''}
          </details>
          <label class="fp-check"><input type="checkbox" data-stun ${s.settings.stun ? 'checked' : ''}> ${esc(TX.stun)}</label>
        </div>
        <p class="fp-msg" role="status">${esc(msg)}</p>
        <p class="fp-note">${esc(TX.note)}</p>
      </div>`;
    };
    const val = (k: string) => el.querySelector<HTMLInputElement>(`[data-in="${k}"]`)?.value ?? '';
    const onClick = async (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      const d = b.dataset;
      if (d.acc) await run('accept', { id: d.acc });
      else if (d.dec) await run('decline', { id: d.dec });
      else if (d.add) await run('add', { id: d.add });
      else if (d.rm) { if (removing !== d.rm) { removing = d.rm; render(); return; } removing = ''; await run('unfriend', { id: d.rm }); }
      else if (d.copy) { try { await navigator.clipboard.writeText(d.copy === 'invite' ? invite : reply); msg = TX.copied; } catch { msg = ''; } render(); }
      else if (d.a === 'create') { const r = await run('invite.create'); if (r.ok) { invite = String(r.value); render(); } }
      else if (d.a === 'complete') { const r = await run('invite.complete', { code: val('reply') }); if (r.ok) { invite = ''; render(); } }
      else if (d.a === 'cancel') { invite = ''; await run('invite.cancel'); }
      else if (d.a === 'accept') { const r = await run('invite.accept', { code: val('invite') }); if (r.ok) { reply = String(r.value); render(); } }
    };
    const onChange = (e: Event) => { const x = e.target as HTMLInputElement; if (x.dataset.stun !== undefined) void run('settings', { stun: x.checked }); };
    el.addEventListener('click', onClick); el.addEventListener('change', onChange);
    // live state (a friend comes online, a request arrives) — but do not wipe what is being typed
    const un = p2p.onState(() => { if (!el.contains(document.activeElement) || !(document.activeElement instanceof HTMLInputElement)) render(); });
    render();
    return () => { un(); el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); el.innerHTML = ''; };
  };
}
