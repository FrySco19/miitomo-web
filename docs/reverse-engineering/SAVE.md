# SAVE.md — local profile and save (M9, 2026-10-25)

Classification as in STATUS.md. The original game kept the profile on Nintendo's servers (Sakasho / Nintendo Account); those services are gone, so the offline save is **our design (APPROXIMATED)**. No cloud sync.

## Storage
- IndexedDB database `miitomo-web` (version 3): stores `resources` (AFL file), `vfs` (the user's imported asset files), `save` (key `slot0`).
- Format: JSON object, `format: "miitomo-web-save"`, `version: 1`. `migrate()` (client/web/src/play/Save.ts) fills missing fields from defaults and refuses unknown formats or newer versions.
- Export: Menu → Impostazioni → *Esporta salvataggio* (JSON file). Import: *Importa salvataggio…* (validated + migrated, then reload). *Ricomincia da capo* deletes the save (two clicks).

## Fields (v1)
| Field | Content |
|---|---|
| profile.miiData | base64 of the Mii data (FFLiCharInfo from the random generator, or the imported StoreData / Mii Studio data) |
| profile.name | Miitomo nickname (max 10 characters) |
| profile.birthday | { month, day } — asked with the original tutorial texts (conformBirthday00) |
| profile.height / build | null = the Mii's own values, otherwise 0–127 |
| profile.personality | reserved (null) until the original parameters are reversed |
| outfit | equipped items per category + colour index (same structure as the Wardrobe module) |
| room | wall / floor / variant (rmWl / rmFl ids) |
| settings | audio, language (EUit) |
| progress | firstEntryDone (first-entry tutorial line shown), launches |
| inventory | coins, items (reserved for the shop phase; empty) |
| answers | reserved for the questions phase |

## Boot flow (PLAY)
| Step | Status | Source |
|---|---|---|
| Boot screen: bg00.webp + logo00/logo01 + "Caricamento" + percentage | VERIFIED art/texts, layout APPROXIMATED | APK asset/layout/boot (bootRoot00.ccbi names these sprites and fonts nintendoPSeurat-B003/M003) |
| Launch tip "Consigli per l'uso di Miitomo" | VERIFIED texts | APK System/LaunchTipsV2.msbt (Tips01–08; some describe online features) |
| First run: import of the user's own files | APPROXIMATED (ours) | required by the legal model: nothing is bundled |
| EULA / country / language / age / Nintendo Account | **not reproduced** | their texts exist (Layout/tutorial) but they refer to an agreement and services that no longer exist; showing an "Accetto" would be fake |
| Mii creation | APPROXIMATED | random Mii or imported data; the original editor (Mii Studio layouts, CDN) comes in a later phase |
| Name | APPROXIMATED screen | — |
| Birthday | VERIFIED texts | Layout/tutorial conformBirthday00 / birthdaybtn00 / birthDecideBtn00 |
| First room entry: tutorialFirst line instead of the greeting | VERIFIED text, mapping DEDUCED | RoomSceneTalkWords `tutorialFirst` (4 pages, uses the Mii nickname) |
| Bottom bar Home / Amici / Negozio / Menu / La mia pagina | VERIFIED labels | Layout/room tabBtn00 |
| Menu: Guardaroba, Modifica Mii, Arreda stanza, Miifoto, Saluti, Impostazioni | VERIFIED labels | Layout/room menuBtn01 / menuBtn04 |
