/**
 * REBOOT UI entry: a small "Reboot" pill on the room screen that opens a sheet. Visual grammar = Miitomo's (soft white
 * sheet, orange accents, rounded buttons, same font), but always labelled as NEW / not original Nintendo.
 * Classic screens are never modified: this lives in its own layer above them.
 */
import type { RebootHost } from '../host';
import type { RebootFlags, FlagId } from '../flags';
import { MultiMii, MIN_MIIS, MAX_MIIS } from '../multimii/MultiMii';
import type { PublicRoomController } from '../rooms/PublicRoomController';
import { I18n } from '../i18n/i18n';
import { roomTitle } from '../rooms/templates';
import './reboot.css';

function evText(e: { type: string; id?: string; info?: string }, name: (id: string) => string, i18n: I18n): string {
  const v = { name: e.id ? name(e.id) : '' };
  if (e.type === 'denied') return i18n.t(/^join:ROOM_FULL/.test(e.info ?? '') ? 'rbt.ev.full' : /^join/.test(e.info ?? '') ? 'rbt.ev.cantJoin' : 'rbt.ev.denied', v);
  return i18n.has(`rbt.ev.${e.type}`) ? i18n.t(`rbt.ev.${e.type}`, v) : e.type;
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
  private unsubLang: () => void;
  /** `i18n` (R6): the sheet's texts; default Italian (what R2–R4 shipped). */
  constructor(private host: RebootHost, private flags: RebootFlags, private multi: MultiMii | null, private rooms: PublicRoomController | null = null, private i18n: I18n = I18n.fixed('it')) {
    this.el = document.createElement('div'); this.el.className = 'rbt-layer'; this.el.dataset.reboot = '1';
    this.pill = document.createElement('button'); this.pill.className = 'rbt-pill'; this.pill.type = 'button';
    this.pill.innerHTML = '<span class="rbt-dot"></span>Reboot';
    this.sheet = document.createElement('section'); this.sheet.className = 'rbt-sheet'; this.sheet.hidden = true; this.sheet.setAttribute('aria-label', 'Miitomo Reboot');
    this.relabel();
    this.unsubLang = i18n.subscribe(() => { this.relabel(); if (!this.sheet.hidden) void this.render(); });
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
  private relabel() { this.pill.title = this.i18n.t('rbt.pill.title'); }
  private t = (k: string, v?: Record<string, string | number>) => this.i18n.t(k, v);
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
    const t = this.t;
    const multi = this.rooms?.isPublic ? '' : this.multi ? `
      <h3>${esc(t('rbt.miis'))} <span class="rbt-count" data-count>${guests.length + 1}/${cap}</span></h3>
      <div class="rbt-stepper"><button type="button" data-a="less" aria-label="${esc(t('rbt.less'))}" ${cap <= MIN_MIIS ? 'disabled' : ''}>−</button><b data-cap>${cap}</b><button type="button" data-a="more" aria-label="${esc(t('rbt.more'))}" ${cap >= MAX_MIIS ? 'disabled' : ''}>+</button><span>${esc(t('rbt.maxMiis'))}</span></div>
      <ul class="rbt-list">${friends.length ? friends.map((f) => {
        const g = guests.find((x) => x.id === f.id);
        const st = g ? t(g.leaving ? 'rbt.st.leaving' : g.state === 'outside' ? 'rbt.st.door' : 'rbt.st.here') : '';
        return `<li data-id="${esc(f.id)}"><span class="rbt-name">${esc(f.name)}</span><span class="rbt-st">${esc(st)}</span>${g ? `<button type="button" data-a="dismiss" data-id="${esc(f.id)}" ${g.leaving ? 'disabled' : ''}>${esc(t('rbt.dismiss'))}</button>` : `<button type="button" data-a="invite" data-id="${esc(f.id)}" ${guests.length >= cap - 1 ? 'disabled' : ''}>${esc(t('rbt.invite'))}</button>`}</li>`;
      }).join('') : `<li class="rbt-empty">${esc(t('rbt.noFriends'))}</li>`}</ul>
      <div class="rbt-row"><button type="button" class="rbt-main" data-a="inviteAll" ${!friends.some((f) => !inRoom.has(f.id)) || guests.length >= cap - 1 ? 'disabled' : ''}>${esc(t('rbt.inviteAll'))}</button><button type="button" data-a="dismissAll" ${!guests.length ? 'disabled' : ''}>${esc(t('rbt.dismissAll'))}</button></div>` : `<p class="rbt-off">${esc(t('rbt.multiOff'))}</p>`;
    const flags = this.flags.list().filter((f) => f.id !== 'REBOOT_ENABLED').map((f) => `<li><span class="rbt-name">${esc(this.i18n.has(`flag.${f.id}`) ? t(`flag.${f.id}`) : f.label)}</span>${f.implemented ? `<label class="rbt-switch"><input type="checkbox" data-flag="${f.id}" ${f.on ? 'checked' : ''}><span></span></label>` : `<span class="rbt-soon">${esc(t('rbt.soon', { phase: f.phase }))}</span>`}</li>`).join('');
    this.sheet.innerHTML = `
      <header><h2>Miitomo Reboot</h2><button type="button" class="rbt-close" data-a="close" aria-label="${esc(t('rbt.close'))}">×</button></header>
      <p class="rbt-badge">${esc(t('rbt.badge'))}</p>
      ${pub}${multi}
      <h3>${esc(t('rbt.features'))}</h3><ul class="rbt-list rbt-flags">${flags}</ul>
      <p class="rbt-msg" data-msg role="status">${esc(this.msg)}</p>`;
  }
  private async onClick(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-a],[data-flag]'); if (!t || this.busy) return;
    if (t.dataset.flag) { this.flags.set(t.dataset.flag as Exclude<FlagId, 'REBOOT_ENABLED'>, (t as HTMLInputElement).checked); this.msg = this.t('rbt.reload'); await this.render(); return; }
    const a = t.dataset.a, id = t.dataset.id ?? '';
    this.busy = true;
    try {
      if (a === 'close') { this.sheet.hidden = true; return; }
      if (a && a.startsWith('p') && this.rooms) { this.publicAction(a, id); return; }
      if (!this.multi) return;
      if (a === 'less' || a === 'more') this.multi.setMiis(this.multi.settings.miis + (a === 'more' ? 1 : -1));
      if (a === 'invite') { const okk = await this.host.invite(id); this.msg = okk ? '' : this.t('rbt.inviteFail'); }
      if (a === 'dismiss') this.host.dismiss(id);
      if (a === 'inviteAll') { const fr = await this.host.friends(); const got = await this.multi.inviteMany(fr.map((f) => f.id)); this.msg = got.length ? this.t('rbt.coming', { n: got.length }) : this.t('rbt.nobody'); }
      if (a === 'dismissAll') this.multi.dismissAll();
    } finally { this.busy = false; }
    await this.render();
  }
  /** R3: public room block (state, capacity, permissions, visitors, last events, open / close). */
  private async publicHtml(friends: { id: string; name: string }[]) {
    const r = this.rooms!, name = (id: string) => friends.find((f) => f.id === id)?.name ?? id, t = this.t;
    if (!r.isPublic) return `<h3>${esc(t('rbt.pub.title'))}</h3><p class="rbt-off">${esc(t('rbt.pub.intro'))}</p><div class="rbt-row"><button type="button" class="rbt-main" data-a="popen">${esc(t('rbt.pub.open'))}</button></div>`;
    const info = r.room.info, pres = r.room.presence(), st = r.room.state;
    const label = t(r.mode === 'closing' ? 'rbt.pub.closing' : st === 'full' ? 'rbt.pub.full' : 'rbt.pub.opened');
    const guests = this.host.guests();
    const vis = pres.filter((p) => p.role !== 'owner').map((p) => { const g = guests.find((x) => x.id === p.profileId); const s = t(!g ? 'rbt.st.coming' : g.leaving ? 'rbt.st.leaving' : g.state === 'outside' ? 'rbt.st.door' : 'rbt.st.here');
      return `<li data-id="${esc(p.profileId)}"><span class="rbt-name">${esc(name(p.profileId))}</span><span class="rbt-st">${esc(s)}</span><button type="button" data-a="pkick" data-id="${esc(p.profileId)}">${esc(t('rbt.pub.kick'))}</button></li>`; }).join('') || `<li class="rbt-empty">${esc(t('rbt.pub.none'))}</li>`;
    const ev = r.events.slice(-4).reverse().map((e) => `<li class="rbt-ev">${esc(evText(e, name, this.i18n))}</li>`).join('');
    return `<h3>${esc(roomTitle(info, this.i18n))} <span class="rbt-count" data-pstate="${st}">${esc(label)} ${pres.length}/${info.capacity}</span></h3>
      <div class="rbt-stepper"><button type="button" data-a="pless" aria-label="${esc(t('rbt.pub.lessSeats'))}" ${info.capacity <= 2 ? 'disabled' : ''}>−</button><b data-pcap>${info.capacity}</b><button type="button" data-a="pmore" aria-label="${esc(t('rbt.pub.moreSeats'))}" ${info.capacity >= 8 ? 'disabled' : ''}>+</button><span>${esc(t('rbt.pub.seats'))}</span></div>
      <div class="rbt-row"><button type="button" data-a="penter" aria-pressed="${info.permissions.whoCanEnter === 'friends'}">${esc(t(info.permissions.whoCanEnter === 'friends' ? 'rbt.pub.enterFriends' : 'rbt.pub.enterAll'))}</button><button type="button" data-a="pobj">${esc(t(info.permissions.whoCanInteract === 'owner' ? 'rbt.pub.objOwner' : 'rbt.pub.objAll'))}</button></div>
      <ul class="rbt-list" data-visitors>${vis}</ul>
      <ul class="rbt-list rbt-evs">${ev}</ul>
      <div class="rbt-row"><button type="button" class="rbt-main" data-a="pclose" ${r.mode === 'closing' ? 'disabled' : ''}>${esc(t('rbt.pub.close'))}</button></div>`;
  }
  private publicAction(a: string, id: string) {
    const r = this.rooms!, info = r.room.info;
    let res: { ok: boolean; reason?: string; code?: string } | { ok: boolean; error?: { message: string } } = { ok: true };
    if (a === 'popen') res = r.open();
    if (a === 'pclose') r.close();
    if (a === 'pkick') res = { ok: r.kick(id) };
    if (a === 'pless' || a === 'pmore') res = r.update({ capacity: info.capacity + (a === 'pmore' ? 1 : -1) });
    if (a === 'penter') res = r.update({ permissions: { ...info.permissions, whoCanEnter: info.permissions.whoCanEnter === 'friends' ? 'public' : 'friends' } });
    if (a === 'pobj') res = r.update({ permissions: { ...info.permissions, whoCanInteract: info.permissions.whoCanInteract === 'owner' ? 'everyone' : 'owner' } });
    this.msg = res.ok ? '' : ('code' in res && res.code && this.i18n.has(`hub.open.${res.code}`) ? this.t(`hub.open.${res.code}`) : '') || ('reason' in res && res.reason) || ('error' in res && res.error?.message) || this.t('rbt.failed');
  }

  dispose() { clearInterval(this.timer); this.unsub(); this.unsubRoom(); this.unsubLang(); this.el.remove(); }
}
