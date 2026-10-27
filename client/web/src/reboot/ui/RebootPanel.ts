/**
 * REBOOT UI entry: a small "Reboot" pill on the room screen that opens a sheet. Visual grammar = Miitomo's (soft white
 * sheet, orange accents, rounded buttons, same font), but always labelled as NEW / not original Nintendo.
 * Classic screens are never modified: this lives in its own layer above them.
 */
import type { RebootHost } from '../host';
import type { RebootFlags, FlagId } from '../flags';
import { MultiMii, MIN_MIIS, MAX_MIIS } from '../multimii/MultiMii';
import type { PublicRoomController } from '../rooms/PublicRoomController';
import './reboot.css';

function evText(e: { type: string; id?: string; info?: string }, name: (id: string) => string): string {
  const n = e.id ? name(e.id) : '';
  switch (e.type) {
    case 'join': return `${n} è entrato`; case 'leave': return `${n} è uscito`; case 'kick': return `${n} è stato allontanato`;
    case 'denied': return /^join:ROOM_FULL/.test(e.info ?? '') ? `${n}: stanza piena` : /^join/.test(e.info ?? '') ? `${n} non può entrare` : `${n} ha provato un'azione da proprietario (negata)`;
    case 'open': return 'Stanza aperta'; case 'closing': return 'Chiusura in corso'; case 'closed': return 'Stanza chiusa'; case 'owner-left': return 'Sei uscito: stanza chiusa';
    default: return e.type;
  }
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export class RebootPanel {
  readonly el: HTMLElement;
  private pill: HTMLButtonElement;
  private sheet: HTMLElement;
  private timer = 0;
  private unsub: () => void;
  private busy = false;
  msg = '';
  private unsubRoom: () => void = () => {};
  constructor(private host: RebootHost, private flags: RebootFlags, private multi: MultiMii | null, private rooms: PublicRoomController | null = null) {
    this.el = document.createElement('div'); this.el.className = 'rbt-layer'; this.el.dataset.reboot = '1';
    this.pill = document.createElement('button'); this.pill.className = 'rbt-pill'; this.pill.type = 'button';
    this.pill.innerHTML = '<span class="rbt-dot"></span>Reboot'; this.pill.title = 'Miitomo Reboot — funzioni nuove, non presenti in Miitomo originale';
    this.sheet = document.createElement('section'); this.sheet.className = 'rbt-sheet'; this.sheet.hidden = true; this.sheet.setAttribute('aria-label', 'Miitomo Reboot');
    this.el.append(this.pill, this.sheet);
    host.root.append(this.el);
    this.pill.addEventListener('click', () => { this.sheet.hidden = !this.sheet.hidden; if (!this.sheet.hidden) void this.render(); });
    this.sheet.addEventListener('click', (e) => void this.onClick(e));
    this.unsub = host.onGuest(() => { if (!this.sheet.hidden) void this.render(); });
    if (rooms) this.unsubRoom = rooms.svc.subscribe(() => { if (!this.sheet.hidden) void this.render(); });
    this.timer = window.setInterval(() => this.sync(), 400);
    this.sync();
  }
  get open() { return !this.sheet.hidden; }
  /** Opens the sheet (e.g. the hub sends the user to the public room: R3 management stays here). */
  show() { this.sheet.hidden = false; void this.render(); }
  /** Only on the user's own room screen. */
  private sync() {
    const show = this.host.screen() === 'room' && !this.host.visiting();
    this.el.hidden = !show;
    if (!show) this.sheet.hidden = true;
  }
  async render() {
    const guests = this.host.guests();
    const friends = this.multi ? await this.host.friends().catch(() => []) : [];
    const inRoom = new Set(guests.map((g) => g.id));
    const cap = this.multi ? this.multi.settings.miis : 1;
    const pub = this.rooms ? await this.publicHtml(friends.length ? friends : await this.host.friends().catch(() => [])) : '';
    const multi = this.rooms?.isPublic ? '' : this.multi ? `
      <h3>Mii nella stanza <span class="rbt-count" data-count>${guests.length + 1}/${cap}</span></h3>
      <div class="rbt-stepper"><button type="button" data-a="less" aria-label="Meno Mii" ${cap <= MIN_MIIS ? 'disabled' : ''}>−</button><b data-cap>${cap}</b><button type="button" data-a="more" aria-label="Più Mii" ${cap >= MAX_MIIS ? 'disabled' : ''}>+</button><span>Mii al massimo (tu compreso)</span></div>
      <ul class="rbt-list">${friends.length ? friends.map((f) => {
        const g = guests.find((x) => x.id === f.id);
        const st = g ? (g.leaving ? 'sta uscendo' : g.state === 'outside' ? 'alla porta' : 'qui') : '';
        return `<li data-id="${esc(f.id)}"><span class="rbt-name">${esc(f.name)}</span><span class="rbt-st">${st}</span>${g ? `<button type="button" data-a="dismiss" data-id="${esc(f.id)}" ${g.leaving ? 'disabled' : ''}>Congeda</button>` : `<button type="button" data-a="invite" data-id="${esc(f.id)}" ${guests.length >= cap - 1 ? 'disabled' : ''}>Invita</button>`}</li>`;
      }).join('') : '<li class="rbt-empty">Nessun amico locale. Aggiungine uno da Amici.</li>'}</ul>
      <div class="rbt-row"><button type="button" class="rbt-main" data-a="inviteAll" ${!friends.some((f) => !inRoom.has(f.id)) || guests.length >= cap - 1 ? 'disabled' : ''}>Invita tutti</button><button type="button" data-a="dismissAll" ${!guests.length ? 'disabled' : ''}>Congeda tutti</button></div>` : '<p class="rbt-off">Più Mii nella stanza è disattivato.</p>';
    const flags = this.flags.list().filter((f) => f.id !== 'REBOOT_ENABLED').map((f) => `<li><span class="rbt-name">${esc(f.label)}</span>${f.implemented ? `<label class="rbt-switch"><input type="checkbox" data-flag="${f.id}" ${f.on ? 'checked' : ''}><span></span></label>` : `<span class="rbt-soon">in arrivo · ${esc(f.phase)}</span>`}</li>`).join('');
    this.sheet.innerHTML = `
      <header><h2>Miitomo Reboot</h2><button type="button" class="rbt-close" data-a="close" aria-label="Chiudi">×</button></header>
      <p class="rbt-badge">NUOVO · funzioni non presenti in Miitomo originale</p>
      ${pub}${multi}
      <h3>Funzioni Reboot</h3><ul class="rbt-list rbt-flags">${flags}</ul>
      <p class="rbt-msg" data-msg role="status">${esc(this.msg)}</p>`;
  }
  private async onClick(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-a],[data-flag]'); if (!t || this.busy) return;
    if (t.dataset.flag) { this.flags.set(t.dataset.flag as Exclude<FlagId, 'REBOOT_ENABLED'>, (t as HTMLInputElement).checked); this.msg = 'Ricarica la pagina per applicare.'; await this.render(); return; }
    const a = t.dataset.a, id = t.dataset.id ?? '';
    this.busy = true;
    try {
      if (a === 'close') { this.sheet.hidden = true; return; }
      if (a && a.startsWith('p') && this.rooms) { this.publicAction(a, id); return; }
      if (!this.multi) return;
      if (a === 'less' || a === 'more') this.multi.setMiis(this.multi.settings.miis + (a === 'more' ? 1 : -1));
      if (a === 'invite') { const okk = await this.host.invite(id); this.msg = okk ? '' : 'Non può entrare adesso (stanza piena o non pronta).'; }
      if (a === 'dismiss') this.host.dismiss(id);
      if (a === 'inviteAll') { const fr = await this.host.friends(); const got = await this.multi.inviteMany(fr.map((f) => f.id)); this.msg = got.length ? `${got.length} in arrivo.` : 'Nessuno può entrare adesso.'; }
      if (a === 'dismissAll') this.multi.dismissAll();
    } finally { this.busy = false; }
    await this.render();
  }
  /** R3: public room block (state, capacity, permissions, visitors, last events, open / close). */
  private async publicHtml(friends: { id: string; name: string }[]) {
    const r = this.rooms!, name = (id: string) => friends.find((f) => f.id === id)?.name ?? id;
    if (!r.isPublic) return `<h3>Stanza pubblica</h3><p class="rbt-off">Apri la tua stanza: gli amici passeranno a trovarti da soli (visitatori simulati in locale finché non c'è il server).</p><div class="rbt-row"><button type="button" class="rbt-main" data-a="popen">Apri come stanza pubblica</button></div>`;
    const info = r.room.info, pres = r.room.presence(), st = r.room.state;
    const label = r.mode === 'closing' ? 'chiusura…' : st === 'full' ? 'piena' : 'aperta';
    const guests = this.host.guests();
    const vis = pres.filter((p) => p.role !== 'owner').map((p) => { const g = guests.find((x) => x.id === p.profileId); const s = !g ? 'arriva' : g.leaving ? 'sta uscendo' : g.state === 'outside' ? 'alla porta' : 'qui';
      return `<li data-id="${esc(p.profileId)}"><span class="rbt-name">${esc(name(p.profileId))}</span><span class="rbt-st">${s}</span><button type="button" data-a="pkick" data-id="${esc(p.profileId)}">Allontana</button></li>`; }).join('') || '<li class="rbt-empty">Ancora nessun visitatore…</li>';
    const ev = r.events.slice(-4).reverse().map((e) => `<li class="rbt-ev">${esc(evText(e, name))}</li>`).join('');
    return `<h3>${esc(info.title)} <span class="rbt-count" data-pstate="${st}">${label} ${pres.length}/${info.capacity}</span></h3>
      <div class="rbt-stepper"><button type="button" data-a="pless" aria-label="Meno posti" ${info.capacity <= 2 ? 'disabled' : ''}>−</button><b data-pcap>${info.capacity}</b><button type="button" data-a="pmore" aria-label="Più posti" ${info.capacity >= 8 ? 'disabled' : ''}>+</button><span>posti (tu compreso)</span></div>
      <div class="rbt-row"><button type="button" data-a="penter" aria-pressed="${info.permissions.whoCanEnter === 'friends'}">${info.permissions.whoCanEnter === 'friends' ? 'Entrano: amici' : 'Entrano: tutti'}</button><button type="button" data-a="pobj">${info.permissions.whoCanInteract === 'owner' ? 'Oggetti: solo io' : 'Oggetti: tutti'}</button></div>
      <ul class="rbt-list" data-visitors>${vis}</ul>
      <ul class="rbt-list rbt-evs">${ev}</ul>
      <div class="rbt-row"><button type="button" class="rbt-main" data-a="pclose" ${r.mode === 'closing' ? 'disabled' : ''}>Chiudi stanza pubblica</button></div>`;
  }
  private publicAction(a: string, id: string) {
    const r = this.rooms!, info = r.room.info;
    let res: { ok: boolean; reason?: string } | { ok: boolean; error?: { message: string } } = { ok: true };
    if (a === 'popen') res = r.open();
    if (a === 'pclose') r.close();
    if (a === 'pkick') res = { ok: r.kick(id) };
    if (a === 'pless' || a === 'pmore') res = r.update({ capacity: info.capacity + (a === 'pmore' ? 1 : -1) });
    if (a === 'penter') res = r.update({ permissions: { ...info.permissions, whoCanEnter: info.permissions.whoCanEnter === 'friends' ? 'public' : 'friends' } });
    if (a === 'pobj') res = r.update({ permissions: { ...info.permissions, whoCanInteract: info.permissions.whoCanInteract === 'owner' ? 'everyone' : 'owner' } });
    this.msg = res.ok ? '' : ('reason' in res && res.reason) || ('error' in res && res.error?.message) || 'Non riuscito.';
  }

  dispose() { clearInterval(this.timer); this.unsub(); this.unsubRoom(); this.el.remove(); }
}
