# Contributing

Thank you for your interest. This is a preservation and research project with a few firm rules. Please read them
before opening an issue or a pull request.

## Ground rules

1. **No Nintendo assets in the repository.** Do not commit, attach or link APKs, CDN zips, models, textures, sounds,
   fonts, texts (MSBT), layouts or screenshots of decoded assets beyond what the README already shows. The game
   reads these files from the user's own copy at runtime. `.gitignore` blocks the common formats; it is not a
   substitute for checking what you add.
2. **No Nintendo services.** Never contact Nintendo servers, use Nintendo authentication or reuse credentials found
   in the APK (for example `assets/npf.json`).
3. **No leaked or stolen code, no DRM circumvention.** Only clean interoperability research on files the user owns.
4. **Do not invent original content.** Something that is missing from the original files must stay marked as
   missing. A replacement must be clearly labelled as new and never presented as Nintendo's.
5. **Keep Classic and Reboot apart.** Classic code must not import Reboot modules, except `reboot/gate` and the
   `RebootHost` type; `tests/unit/reboot.test.mts` checks this. Every new feature belongs to Reboot, behind a
   feature flag.
6. **No real-money features.**

## Classifying your change

Every change to the original port carries a class, recorded in [`docs/CLASSIFICATION.md`](docs/CLASSIFICATION.md):
ORIGINAL, REVERSED, DEDUCED, APPROXIMATED, SERVER DATA MISSING or WEB ADAPTATION. Reverse-engineering findings need
reproducible evidence: a file, an address or a command. Reboot changes are documented in `docs/reboot/`.

## Development setup

You need Node.js 20 or later and your own copy of the game files (see the README).

```bash
cd client/web
npm ci             # also copies the FFL WebAssembly module into public/ffl
npm run dev        # http://localhost:5173
npm run build      # type check + production build into dist/
```

## Tests

Unit tests that need no game files (these run in CI):

```bash
cd client/web
for t in bodyscale framing personality reboot social rooms hub i18n friendrooms gameroom miiphone miinstagram; do npx tsx ../../tests/unit/$t.test.mts; done
```

End-to-end tests drive the real build in headless Chromium with Playwright. They need your own game files, passed
on the command line, so they do not run in CI:

```bash
(cd tests && npm install --no-save playwright && npx playwright install chromium)
(cd client/web && npm run build && npx vite preview --port 4173) &
node tests/e2e/r4-hub.smoke.mjs http://localhost:4173/ out/r4 <your files…>
```

One end-to-end suite needs **no** game files: `tests/e2e/r5-ui.smoke.mjs` drives the real Reboot R5 runtime (Piazza,
friends' rooms, Sala Giochi, MiiPhone, MIInstagram, languages) on a test double of the room engine, and checks on the
real build that Classic never loads Reboot:

```bash
(cd client/web && npm run build) && node tests/e2e/r5-ui.smoke.mjs out/r5-ui
```

Every pull request must keep all Classic suites green. Do not change a test to make it pass; fix the cause, or
explain in the pull request why the test itself was wrong.

## Pull requests

- Keep each pull request focused on one change.
- Describe what changed, why, which mode it affects (Classic, Reboot or both) and how you tested it.
- Use readable commit messages, for example `fix(room): keep personal distance near the door`.

## Reporting bugs

Use the bug report form. Say whether the problem is in Classic or Reboot, and give your browser, the steps, and
what you expected and saw. Please leave personal information out of screenshots and logs.

By contributing you agree that your contribution is licensed under the project licence, AGPL-3.0-only.
