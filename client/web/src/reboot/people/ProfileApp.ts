/**
 * REBOOT R6 — "My page" app of the MiiPhone. Three tabs over data that already exists on this device:
 *   Me       the user's Mii (name, personality, birthday — day and month only, the save has no year —, greeting),
 *            real counters (posts, friends, matches, wins) and the badges won in the Sala Giochi
 *   Posts    the user's own MIInstagram posts (tap → MIInstagram)
 *   Friends  the closest friends by relationship level (→ the Friends app for all of them)
 * Nothing is invented: a missing fact is shown as "not set", a missing system (feed / games switched off) hides its part.
 */
import type { I18n } from '../i18n/i18n';
import type { FriendInfo } from '../host';
import type { Post } from '../miinstagram/model';
import type { GameStats } from '../games/GameRoomController';
import { relationLevel } from './levels';
import './people.css';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const initial = (n: string) => esc((n.trim()[0] ?? '?').toUpperCase());

export interface ProfileDeps {
  i18n: I18n;
  me: string;
  profile: () => { name: string; personality: 0 | 1 | 2 | 3; birthday: { month: number; day: number } | null; greeting: string };
  friends: () => Promise<FriendInfo[]>;
  closeness: (a: string, b: string) => number;
  /** null = MIInstagram switched off. */
  posts: (() => Post[]) | null;
  photo: (id: string) => Promise<string | null>;
  /** null = Sala Giochi switched off. */
  stats: (() => GameStats) | null;
  openApp: (id: string) => void;
}

export function profileApp(d: ProfileDeps) {
  return (el: HTMLElement) => {
    let tab: 'overview' | 'posts' | 'friends' = 'overview';
    let friends: FriendInfo[] = [];
    let alive = true;
    const t = (k: string, v?: Record<string, string | number>) => d.i18n.t(k, v);
    const tabs = () => `<div class="r-tabs pp-tabs" role="tablist">${(['overview', 'posts', 'friends'] as const).filter((x) => x !== 'posts' || d.posts).map((x) => `<button type="button" role="tab" data-tab="${x}" aria-selected="${tab === x}">${esc(t('profile.tab.' + x))}</button>`).join('')}</div>`;
    const overview = () => {
      const p = d.profile(), st = d.stats?.(), n = d.posts?.().length;
      const stat = (v: number, k: string) => `<div class="pp-stat"><b>${v}</b><span>${esc(t('profile.stat.' + k))}</span></div>`;
      return `<div class="r-card pp-me">
          <span class="r-avatar lg p${p.personality}" aria-hidden="true">${initial(p.name)}</span>
          <h3 class="pp-name">${esc(p.name)}</h3>
          <dl class="pp-facts">
            <div><dt>${esc(t('profile.personality'))}</dt><dd>${esc(t('personality.' + p.personality))}</dd></div>
            <div><dt>${esc(t('profile.birthday'))}</dt><dd>${p.birthday ? esc(d.i18n.date(p.birthday.day, p.birthday.month)) : `<em>${esc(t('profile.none'))}</em>`}</dd></div>
            <div><dt>${esc(t('profile.greeting'))}</dt><dd>${p.greeting.trim() ? `“${esc(p.greeting.trim())}”` : `<em>${esc(t('profile.none'))}</em>`}</dd></div>
          </dl>
        </div>
        <div class="pp-stats">${n !== undefined ? stat(n, 'posts') : ''}${stat(friends.length, 'friends')}${st ? stat(st.played, 'played') + stat(st.wins, 'wins') : ''}</div>
        ${st ? `<section class="ap-sec"><h3 class="r-sub">${esc(t('profile.badges'))}</h3>${st.badges.length ? `<div class="pp-badges">${st.badges.map((b) => `<span class="r-chip accent">${esc(d.i18n.has('reward.' + b) ? t('reward.' + b) : b)}</span>`).join('')}</div>` : `<p class="r-note">${esc(t('profile.noBadges'))}</p>`}</section>` : ''}
        <p class="r-note">${esc(t('profile.note'))}</p>`;
    };
    const posts = () => {
      const list = d.posts?.() ?? [];
      if (!list.length) return `<div class="r-empty"><p>${esc(t('profile.noPosts'))}</p><button type="button" class="r-btn primary" data-open="miinstagram">${esc(t('profile.openFeed'))}</button></div>`;
      return `<div class="pp-grid">${list.map((p) => p.kind === 'photo'
        ? `<button type="button" class="pp-tile" data-open="miinstagram" data-photo="${esc(p.photoId)}" aria-label="${esc(p.caption || t('feed.photoAlt'))}"></button>`
        : `<button type="button" class="pp-tile txt" data-open="miinstagram"><span>${esc(p.kind === 'activity' ? d.i18n.line(p.line) : p.answer)}</span></button>`).join('')}</div>`;
    };
    const closest = () => {
      if (!friends.length) return `<p class="r-empty">${esc(t('friends.empty'))}</p>`;
      const top = [...friends].sort((a, b) => d.closeness(d.me, b.id) - d.closeness(d.me, a.id)).slice(0, 5);
      return `<section class="ap-sec"><h3 class="r-sub">${esc(t('profile.closest'))}</h3><ul class="r-list pp-close">${top.map((f) => { const l = relationLevel(d.closeness(d.me, f.id));
        return `<li class="r-row"><span class="r-avatar p${f.personality ?? 2}" aria-hidden="true">${initial(f.name)}</span><span class="r-grow"><b>${esc(f.name)}</b></span><span class="r-chip lv${l.level}">${esc(t('rel.' + l.level))}</span></li>`; }).join('')}</ul></section>
        <button type="button" class="r-btn" data-open="friends">${esc(t('profile.allFriends'))}</button>`;
    };
    const render = () => {
      if (!alive) return;
      el.innerHTML = `<div class="ap pp">${tabs()}<div class="pp-body">${tab === 'overview' ? overview() : tab === 'posts' ? posts() : closest()}</div></div>`;
      el.querySelectorAll<HTMLElement>('[data-photo]').forEach((b) => {
        const id = b.dataset.photo!; b.removeAttribute('data-photo');
        void d.photo(id).then((url) => { if (url && b.isConnected) b.style.backgroundImage = `url("${url}")`; });
      });
    };
    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab],[data-open]'); if (!b) return;
      if (b.dataset.tab) { tab = b.dataset.tab as typeof tab; render(); return; }
      d.openApp(b.dataset.open!);
    };
    el.addEventListener('click', onClick);
    const unLang = d.i18n.subscribe(() => render());
    render();
    void d.friends().then((f) => { friends = f; render(); }, () => { /* keep empty */ });
    return () => { alive = false; unLang(); el.removeEventListener('click', onClick); el.innerHTML = ''; };
  };
}
