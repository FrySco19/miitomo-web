/**
 * REBOOT R6 — "Friends" app of the MiiPhone. One row per local friend, closest first:
 *   how close you are   level + progress to the next one (people/levels.ts over the R5 Relations value)
 *   where they are now  read from the places service (their open room, another friend's room, the Sala Giochi, out)
 *   go there            a real move through the Piazza (same path as the Piazza cards); refused places say why
 * The list follows the places live (arrivals / departures) and the language.
 */
import type { I18n } from '../i18n/i18n';
import type { FriendInfo } from '../host';
import type { PlaceError } from '../places/LocalPlacesService';
import { relationLevel } from './levels';
import './people.css';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export type Where = { at: 'home' | 'room' | 'games' | 'private' | 'out' | 'unknown'; placeId: string | null; ownerName: string };
export interface FriendsDeps {
  i18n: I18n;
  me: string;
  friends: () => Promise<FriendInfo[]>;
  closeness: (a: string, b: string) => number;
  /** null = places switched off: no "where" and no visits. */
  places: { whereIs: (id: string) => Where; refusalOf: (placeId: string) => PlaceError | null; current: () => string | null; subscribe: (cb: () => void) => () => void } | null;
  /** Goes to a place (the phone closes on success); the message is already translated. */
  go: (placeId: string) => Promise<{ ok: boolean; message?: string }>;
}

export function friendsApp(d: FriendsDeps) {
  return (el: HTMLElement) => {
    let friends: FriendInfo[] = [], loaded = false, busy = '', msg = '', alive = true;
    const t = (k: string, v?: Record<string, string | number>) => d.i18n.t(k, v);
    const where = (w: Where) => t(w.at === 'room' ? 'where.room' : `where.${w.at}`, { name: w.ownerName });
    const row = (f: FriendInfo) => {
      const l = relationLevel(d.closeness(d.me, f.id));
      const w = d.places?.whereIs(f.id) ?? null;
      const here = !!w?.placeId && d.places!.current() === w.placeId;
      const refusal = w?.placeId && !here ? d.places!.refusalOf(w.placeId) : null;
      const can = !!w?.placeId && !here && !refusal && !busy;
      const btn = !w || !w.placeId || here ? '' : `<button type="button" class="r-btn ${can ? 'primary' : ''} sm" data-go="${esc(w.placeId)}" ${can ? '' : 'disabled'} ${refusal ? `title="${esc(t('place.err.' + refusal))}"` : ''}>${esc(busy === w.placeId ? t('friends.going') : t(w.at === 'home' ? 'friends.visit' : 'friends.join'))}</button>`;
      return `<li class="r-row fa-row" data-id="${esc(f.id)}">
          <span class="r-avatar p${f.personality ?? 2}" aria-hidden="true">${esc((f.name.trim()[0] ?? '?').toUpperCase())}</span>
          <span class="r-grow"><b>${esc(f.name)}</b>
            <small>${w ? esc(where(w)) : esc(t('personality.' + (f.personality ?? 2)))}${refusal ? ` · <span class="fa-why">${esc(t('place.err.' + refusal))}</span>` : ''}</small>
            <span class="fa-lv"><span class="r-chip lv${l.level}">${esc(t('rel.' + l.level))}</span><span class="fa-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(l.progress * 100)}" aria-label="${esc(l.next ? t('rel.next', { pct: Math.round(l.progress * 100), level: t('rel.' + l.next) }) : t('rel.max'))}"><i style="width:${Math.round(l.progress * 100)}%"></i></span></span>
          </span>${btn}</li>`;
    };
    const render = () => {
      if (!alive) return;
      const list = [...friends].sort((a, b) => d.closeness(d.me, b.id) - d.closeness(d.me, a.id));
      el.innerHTML = `<div class="ap fa">
          <p class="r-note">${esc(t('friends.intro'))}</p>
          ${!loaded ? '<span class="r-spin" aria-hidden="true"></span>' : list.length ? `<ul class="r-list">${list.map(row).join('')}</ul>` : `<p class="r-empty">${esc(t('friends.empty'))}</p>`}
          <p class="r-msg" role="status">${esc(msg)}</p>
          <p class="r-note">${esc(t('friends.levelNote'))}</p>
        </div>`;
    };
    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-go]'); if (!b || busy) return;
      busy = b.dataset.go!; msg = ''; render();
      void d.go(busy).then((r) => { busy = ''; msg = r.ok ? '' : r.message ?? ''; render(); });
    };
    el.addEventListener('click', onClick);
    const unsubs: (() => unknown)[] = [d.i18n.subscribe(() => render())];
    if (d.places) unsubs.push(d.places.subscribe(() => render()));
    render();
    void d.friends().then((f) => { friends = f; loaded = true; render(); }, () => { loaded = true; render(); });
    return () => { alive = false; for (const u of unsubs) u(); el.removeEventListener('click', onClick); el.innerHTML = ''; };
  };
}
