/**
 * REBOOT R6.0 — the Settings app of the MiiPhone. A view over SettingsStore + I18n: every control changes the stored
 * value at once (no "save" step), and the game applies it at once (volumes while dragging, language and region on the
 * whole Reboot UI, quality and motion on the next frame). The player name goes to the save through the host.
 */
import type { I18n } from '../i18n/i18n';
import { locales, REGIONS } from '../i18n/i18n';
import type { SettingsStore, RebootSettings } from './Settings';
import './settings.css';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function settingsApp(store: SettingsStore, i18n: I18n, player: { name: () => string; rename: (n: string) => boolean }) {
  return (el: HTMLElement) => {
    let msg = '';
    const t = (k: string, v?: Record<string, string | number>) => i18n.t(k, v);
    const regionName = (r: string) => {
      if (r === 'auto') return t('set.region.auto');
      try { return new Intl.DisplayNames([i18n.locale], { type: 'region' }).of(r) ?? r; } catch { return r; }
    };
    const seg = (name: string, cur: string, opts: [string, string][]) => `<div class="r-seg" role="group" aria-label="${esc(t(`set.${name}`))}">${opts.map(([v, label]) => `<button type="button" data-set="${name}" data-v="${esc(v)}" aria-pressed="${cur === v}">${esc(label)}</button>`).join('')}</div>`;
    const toggle = (name: string, on: boolean) => `<label class="r-toggle"><input type="checkbox" data-set="${name}" ${on ? 'checked' : ''} aria-label="${esc(t(`set.${name}`))}"><span></span></label>`;
    const range = (k: keyof RebootSettings['volumes'], v: number) => `<label class="set-vol"><span>${esc(t(`set.vol.${k}`))}</span><input class="r-range" type="range" min="0" max="100" step="5" value="${v}" data-vol="${k}" aria-label="${esc(t(`set.vol.${k}`))}"><output>${v}%</output></label>`;
    const render = () => {
      const s = store.value;
      el.innerHTML = `<div class="ap set">
        <section class="ap-sec" aria-labelledby="set-g"><h3 class="r-sub" id="set-g">${esc(t('set.general'))}</h3>
          <div class="r-card set-card">
            <form class="set-name" data-form="name"><label class="r-field"><span>${esc(t('set.name'))}</span><span class="set-inline"><input type="text" name="n" maxlength="10" value="${esc(player.name())}" autocomplete="off"><button type="submit" class="r-btn primary sm">${esc(t('set.save'))}</button></span></label></form>
            <div class="set-row"><span>${esc(t('set.language'))}</span>${seg('language', i18n.lang, locales().map((l) => [l.id, l.name]))}</div>
            <label class="r-field"><span>${esc(t('set.region'))}</span><select data-set="region">${REGIONS.map((r) => `<option value="${r}" ${s.region === r ? 'selected' : ''}>${esc(regionName(r))}</option>`).join('')}</select></label>
            <p class="r-note">${esc(t('set.regionNote', { date: i18n.date(3, 1) }))}</p>
          </div></section>
        <section class="ap-sec" aria-labelledby="set-a"><h3 class="r-sub" id="set-a">${esc(t('set.audio'))}</h3>
          <div class="r-card set-card">${range('music', s.volumes.music)}${range('effects', s.volumes.effects)}${range('voice', s.volumes.voice)}</div></section>
        <section class="ap-sec" aria-labelledby="set-v"><h3 class="r-sub" id="set-v">${esc(t('set.display'))}</h3>
          <div class="r-card set-card">
            <div class="set-row col"><span>${esc(t('set.quality'))}</span>${seg('quality', s.quality, [['auto', t('set.q.auto')], ['high', t('set.q.high')], ['balanced', t('set.q.balanced')], ['low', t('set.q.low')]])}</div>
            <div class="set-row col"><span>${esc(t('set.motion'))}</span>${seg('motion', s.motion, [['system', t('set.m.system')], ['full', t('set.m.full')], ['reduced', t('set.m.reduced')]])}</div>
            <div class="set-row"><span class="set-lbl"><b>${esc(t('set.light'))}</b><small>${esc(t('set.lightNote'))}</small></span>${toggle('light', s.light)}</div>
          </div></section>
        <section class="ap-sec" aria-labelledby="set-p"><h3 class="r-sub" id="set-p">${esc(t('set.play'))}</h3>
          <div class="r-card set-card">
            <div class="set-row"><span class="set-lbl"><b>${esc(t('set.confirm'))}</b><small>${esc(t('set.confirmNote'))}</small></span>${toggle('confirm', s.confirm)}</div>
            <div class="set-row"><span class="set-lbl"><b>${esc(t('set.notifications'))}</b><small>${esc(t('set.notificationsNote'))}</small></span>${toggle('notifications', s.notifications)}</div>
          </div></section>
        <p class="r-msg" role="status">${esc(msg)}</p>
        <div class="set-foot"><button type="button" class="r-btn ghost sm" data-reset>${esc(t('set.reset'))}</button><p class="r-note">${esc(t('set.storedNote'))}</p></div>
      </div>`;
    };
    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-set][data-v],[data-reset]'); if (!b) return;
      if (b.hasAttribute('data-reset')) { store.reset(); msg = t('set.resetDone'); render(); return; }
      const k = b.dataset.set!, v = b.dataset.v!;
      if (k === 'language') i18n.set(v);
      else store.update({ [k]: v } as never);
    };
    const onChange = (e: Event) => {
      const x = e.target as HTMLInputElement | HTMLSelectElement;
      if (x.dataset.set === 'region') { store.update({ region: x.value as never }); return; }
      if (x instanceof HTMLInputElement && x.type === 'checkbox' && x.dataset.set) store.update({ [x.dataset.set]: x.checked } as never);
    };
    const onInput = (e: Event) => {
      const x = e.target as HTMLInputElement; const k = x.dataset.vol as keyof RebootSettings['volumes'] | undefined; if (!k) return;
      store.update({ volumes: { [k]: Number(x.value) } });
      const out = x.parentElement?.querySelector('output'); if (out) out.textContent = `${x.value}%`;
    };
    const onSubmit = (e: Event) => {
      e.preventDefault();
      const n = (e.target as HTMLFormElement).querySelector<HTMLInputElement>('input[name=n]')!.value;
      msg = player.rename(n) ? t('set.nameSaved') : t('set.nameEmpty'); render();
    };
    el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('input', onInput); el.addEventListener('submit', onSubmit);
    // re-render on outside changes (language, another tab) — but never while the user drags a slider (input keeps focus)
    const refresh = () => { if (!(document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range' && el.contains(document.activeElement))) render(); };
    const unsubs = [store.subscribe(refresh), i18n.subscribe(() => render())];
    render();
    return () => { for (const u of unsubs) u(); el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); el.removeEventListener('input', onInput); el.removeEventListener('submit', onSubmit); el.innerHTML = ''; };
  };
}
