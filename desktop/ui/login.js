/* Desktop login / register (local accounts on this PC; the main process does the crypto). */
(() => {
  const D = window.mtwDesktop;
  const lang = /^it\b/i.test(navigator.language) ? 'it' : 'en';
  const T = {
    it: { sub: 'Il tuo Miitomo, Classic e Reboot, su questo PC.', login: 'Accedi', register: 'Registrati', user: 'Nome utente', pass: 'Password', pass2: 'Ripeti la password',
      note: 'Account locale: resta su questo PC. Ogni account ha il suo salvataggio e i suoi amici (peer-to-peer). Nessun account Nintendo.',
      goLogin: 'Entra', goRegister: 'Crea account', mismatch: 'Le password non coincidono.',
      err: { WRONG: 'Nome utente o password sbagliati.', TAKEN: 'Questo nome utente esiste già.', BAD_USERNAME: 'Nome utente: 3–16 caratteri, lettere, numeri, _ . -', BAD_PASSWORD: 'La password deve avere almeno 6 caratteri.', CORRUPT: 'L\'account non si apre (dati danneggiati).', DENIED: 'Non permesso.' } },
    en: { sub: 'Your Miitomo, Classic and Reboot, on this PC.', login: 'Log in', register: 'Sign up', user: 'Username', pass: 'Password', pass2: 'Repeat the password',
      note: 'Local account: it stays on this PC. Each account has its own save and its own (peer-to-peer) friends. No Nintendo account.',
      goLogin: 'Enter', goRegister: 'Create account', mismatch: 'The passwords do not match.',
      err: { WRONG: 'Wrong username or password.', TAKEN: 'This username already exists.', BAD_USERNAME: 'Username: 3–16 characters, letters, digits, _ . -', BAD_PASSWORD: 'The password needs at least 6 characters.', CORRUPT: 'The account cannot be opened (damaged data).', DENIED: 'Not allowed.' } },
  }[lang];
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i]')) el.textContent = T[el.dataset.i];

  // animated background: speech bubbles rising, a row of round Miis bobbing (CSS only)
  const bub = document.querySelector('.bubbles');
  for (let i = 0; i < 14; i++) { const b = document.createElement('i'); const s = 40 + Math.random() * 70; Object.assign(b.style, { left: `${Math.random() * 100}%`, width: `${s}px`, height: `${s * .7}px`, animationDuration: `${14 + Math.random() * 16}s`, animationDelay: `${-Math.random() * 30}s` }); b.style.setProperty('--r', `${(Math.random() * 16 - 8).toFixed(1)}deg`); bub.append(b); }
  const crowd = document.querySelector('.crowd'), colors = ['#5aa9e6', '#7bc96f', '#f2c14e', '#ff7a2f', '#c58cf2', '#ff6f91'];
  for (let i = 0; i < 6; i++) { const m = document.createElement('b'); m.style.setProperty('--c', colors[i]); m.style.setProperty('--d', `${-i * .45}s`); m.append(document.createElement('i')); crowd.append(m); }

  const f = document.getElementById('f'), msg = f.querySelector('.msg'), go = f.querySelector('.go');
  let mode = 'login';
  const setMode = (m) => {
    mode = m; f.classList.toggle('register', m === 'register'); msg.textContent = '';
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === m));
    go.textContent = m === 'login' ? T.goLogin : T.goRegister;
    f.p.autocomplete = m === 'login' ? 'current-password' : 'new-password';
  };
  document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setMode(b.dataset.tab); });
  D.accounts.list().then(({ accounts, last }) => {
    document.getElementById('known').innerHTML = accounts.map((a) => `<option value="${a.username.replace(/"/g, '')}">`).join('');
    if (!accounts.length) setMode('register'); else { setMode('login'); if (last) { f.u.value = last; f.p.focus(); } }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); msg.textContent = '';
    if (mode === 'register' && f.p.value !== f.p2.value) { msg.textContent = T.mismatch; return; }
    go.disabled = true;
    const r = await D.accounts[mode](f.u.value, f.p.value).catch(() => ({ ok: false, code: 'DENIED' }));
    go.disabled = false;
    if (!r.ok) { msg.textContent = T.err[r.code] ?? r.code; f.p.select(); }
  });
  setMode('login');
})();
