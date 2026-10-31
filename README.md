**English** · [Русский](README.ru.md)

# <img src="docs/favicon.ico" alt="Somaco" height="40" align="middle"> Somasync

A desktop app (Windows and macOS) for **Somaco (Holcim), Romania**: it accounts reinforcing steel by heat.

The app watches the monthly Consum report. When an operator saves it, the app splits each element's consumption over heats, writes the element blocks into Sarjele and fills used-up heats yellow in Probe — work that used to be done by hand. It also moves into Probe the tags that phones without the company network write into a copy of Probe in Google Drive.

**Interface:** <img src="docs/flags/gb.svg" height="14" alt=""> English · <img src="docs/flags/ro.svg" height="14" alt=""> Română · <img src="docs/flags/tj.svg" height="14" alt=""> Тоҷикӣ · <img src="docs/flags/ru.svg" height="14" alt=""> Русский  
**Stack:** Electron 44 · React 19 · TypeScript · Vite 8 · ExcelJS · i18next

## Screenshots

Dark theme, English interface; demo data — projects, elements and heats are made up.

<img src="docs/screenshots/overview.en.webp" alt="Home with the journal, network drive, Phones, Google Drive, Links, Advanced">

```bash
npm run build && node scripts/screenshots/capture.mjs   # retake the screenshots
```

## Contents

- [How it works](#how-it-works)
  - [Files](#files)
  - [A run](#a-run)
  - [Journal](#journal)
  - [Data safety](#data-safety)
- [Table storage](#table-storage)
  - [This computer and the network drive](#this-computer-and-the-network-drive)
  - [Google Drive](#google-drive)
  - [Phones](#phones)
- [In practice](#in-practice)
  - [Starting and runs](#starting-and-runs)
  - [Watching](#watching)
  - [Consum](#consum)
  - [Links](#links)
  - [Heats](#heats)
  - [Writing and service data](#writing-and-service-data)
- [Manual links: links.json](#manual-links-linksjson)
- [Development](#development)
- [Building](#building)
- [Structure](#structure)
- [Known risks](#known-risks)
- [License](#license)
- [AI disclosure](#ai-disclosure)

## How it works

```
Consum (Decont Lunar) ──► engine ──► Sarjele (element blocks, ID registry)
        ▲                        └─► Probe (yellow heats, sync-journal)
        └── element IDs (hidden column “ID sync”)
storage: this computer | network drive | Google Drive
```

### Files

Reinforcing steel goes into the elements (beams, walls, columns) of construction projects. It arrives in heats: each has a number, a diameter (Ø), a form — bar (Bara) or coil (Bobina) — and a weight.

| File | Contents |
|---|---|
| **Consum** (sheet “Decont Lunar”) | consumption for the month: projects, elements and kg of steel per material code; filled in by the operators |
| **Sarjele din elemente** | a sheet per project, a block per element: which heats and how many kg it was made from |
| **Probe otel** | delivery log: which heats arrived and how much; a used-up heat is filled yellow |

To recognise an element from month to month, the app gives it an ID (`NI-0004`) — in a hidden column of Consum and next to the block in Sarjele.

### A run

1. **Watching.** Every few seconds the app compares the modification time and size of Consum; after a change it waits a moment and starts the engine.
2. **Reading.** The engine (a separate process) reads Probe (delivered per heat), Sarjele (already written off) and Consum (elements, consumption, IDs, month).
3. **Links.** Each Consum element looks for its Sarjele block: by ID, by the registry, by a manual link, by a similar name. None found — a new block with a new ID.
4. **Plan.** What is left of a heat = delivered in Probe minus written off in Sarjele; it is recalculated on every run. Consumption is split over heats of the right Ø and form.
5. **Write:** backup, Sarjele, Probe, IDs into Consum, then a check.

### Journal

The Home tab shows app events in one line and every engine run as a card: what started it, the mode and the outcome — Written, Plan only, No changes, Postponed, Error. Inside are the Sarjele blocks, element IDs, heats filled or cleared in Probe, steel shortages, elements that need attention and the check after writing. “Details” is the engine's technical output in the interface language; `log.txt` gets the same text.

Settings, `log.txt` and `links.json` live in the app data folder: `%APPDATA%\Somasync\` on Windows, `~/Library/Application Support/Somasync/` on Mac.

### Data safety

- **Trial mode** writes nothing.
- **A backup** before every write; restore from the Advanced tab.
- **Open files.** If Sarjele or Probe is open in an editor, the write is postponed and retried once the file is closed (otherwise saving from the editor would overwrite it). If only Consum is open, the IDs wait. Turned off in Advanced → “Do not write to open files”.
- **Writes** go through a temporary file and are checked afterwards.
- **Locally.** Everything runs on this computer; files go nowhere except your own Google Drive, and only when it is the chosen storage (Sarjele is confidential).

## Table storage

The tables must already exist — the app does not create them. Each storage has its own set of files; switching it on the Storage tab switches the set. Every table field is locked against accidental edits; the check icon at its end shows whether the file is there and which sheets it has. The Probe sheet is the current year's by default; while it is empty, the previous year is read too.

### This computer and the network drive

- **This computer** — paths to the tables, picked with the folder icon.
- **Network drive** (SMB share) — account (domain, user, password) and location (server, shared folder). “Test connection” connects the share with system tools: `net use \\server\share` on Windows, `mount volume smb://…` on macOS. The password is stored encrypted (DPAPI / Keychain).

### Google Drive

The engine works with files, so Drive tables live in a local copy (`<app data>/drive/<folder id>/`). The code is in `host/drive/`.

- **Sign-in** opens the Google page in the system browser (OAuth for desktop apps, PKCE). The access key is stored encrypted and never reaches the window.
- **Folder and tables** — a folder link or ID and the table names in it.
- **Download** — before every run, only tables that changed (by Drive version and MD5).
- **Lock** — the same `<table>.lock` files as in the mobile app, so the phone and the computer do not overwrite Probe for each other.
- **Upload** — after a run with writing: the previous version goes to `backups` on the server, the new one is checked by MD5. A table changed in Drive during the run is not overwritten — the next run recalculates.

**Google Cloud setup (once):**

1. In [Google Cloud Console](https://console.cloud.google.com/) enable **Google Drive API** (the mobile app's project is fine).
2. Create an OAuth client of the **Desktop app** type. Scope — `https://www.googleapis.com/auth/drive`.
3. Put the client's JSON into the app data folder as `google-oauth.json`, or build with it: `SOMASYNC_GOOGLE_CLIENT_ID=… SOMASYNC_GOOGLE_CLIENT_SECRET=… npm run dist:win`.
4. While the consent screen is in “Testing”, add the warehouse accounts to Test users.

### Phones

When the tables are on this computer or a network drive and the phones cannot reach the company network, the mobile app writes tags into a **copy of Probe in Google Drive**, and Somasync moves them into Probe. Turned on in “Storage → Phones”; the account and folder are those of the Google Drive storage. On the phones — Google Drive storage with the same folder and name. The code is `host/PhoneBridge.ts` and the engine command `--bridge` (`engine/ProbeBridge.ts`).

- **When.** While watching with writing, at most once in 15 s: the app compares the copy's MD5.
- **The copy changed.** Under the phones' lock `Probe otel.xlsx.lock` the copy is downloaded, and the tags Probe does not have yet (by the hidden sheet `somascan-journal`) are appended as the same row the phone would write (`engine/lab/` repeats the mobile app). Then Probe is uploaded in place of the copy. The journal shows a “Tags from phones” card.
- **Only Probe changed** — Probe is uploaded in place of the copy. No copy — it is created.
- **Not moved:** the heat is already in Probe, the sheet is missing, a record without the tag — skipped with the reason in the card.
- **Probe is open in Excel** — the transfer waits (“Transfer postponed: Probe is open”); the copy is not replaced.
- **Safety:** a backup of Probe, a check of the new workbook before writing, the previous copy in Drive goes to `backups`. The synced state is kept in `bridge.json`.

**Firebase Firestore (optional, behind a lock).** After writing, the phone updates the document `somascan-bells/<channel>` (SHA-256 of “folder id/copy name”); the window listens to it (`app/bellListener.ts`) and starts a check at once. Firestore keeps only the time of the last ring. Checking the copy stays as the fallback. Under the switch — “Firestore: connected” or the error.

Setup (once):

1. In the [Firebase console](https://console.firebase.google.com/) add Firebase to the Google Cloud project or create a new one.
2. Firestore Database → create a database (Standard), set the rules below.
3. “Project settings” → project ID and Web API key (no key — add a web app). The key is not a secret: the rules set the access.
4. Enter the ID and the key here and on the phones (“Settings → Storage → Google Drive → Firebase Firestore”).

The free quota (50,000 reads and 20,000 writes a day) is more than enough.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /somascan-bells/{channel} {
      allow get: if channel.size() == 64;
      allow create, update: if channel.size() == 64 && request.resource.data.keys().hasOnly(['at']);
    }
  }
}
```

## In practice

### Starting and runs

- Trial mode writes nothing. To write: “Write to files” on the Home tab or “Actual run” on the Advanced tab.
- “Start” turns watching on; it continues after a restart.
- **Run** (Advanced → Actions) — one full pass over Consum on demand. “Trial run” shows the plan, “Actual run” writes (with a backup).
- **Migration** — a one-time move of an old, hand-kept Sarjele under the app: existing blocks get IDs (next to the block, in `sync-registry` and in “ID sync” of Consum); nothing is split over heats. Order: trial migration → sort out “Need attention” on the Links tab → actual migration → normal work.

### Watching

- Only saving Consum starts a run; edits in Sarjele or Probe do not.
- On a slow network share increase the pause after a change.
- A missing file is shown as “unavailable” and “available again” in the journal.
- The app's own ID write into Consum does not start another run.
- A crashed editor may leave its lock file (`~$…` or `.~lock.…#`) and postpone writes; its path is in the journal.

### Consum

- Sheet `Decont Lunar`. Columns are found by their headers: ELEMENT (rows 7–9), “ID sync” (rows 1–9).
- Consumption — columns AK…AZ: code in row 9, Ø in row 7, form in row 8 (“bob” — Bobina, otherwise Bara).
- Projects — merged cells in column A; a project with all rows hidden is not used.
- Rows from 10 on; “TOTAL…” and “PIERDERI…” are skipped; kilograms are rounded.
- Formulas give their saved result: a file saved without recalculation gives empty consumption.
- The ID column accepts only `NI-0004`; other text or a repeated ID skips the row.
- **New month.** The month comes from `LUNA <MONTH> <YEAR>`. A new Consum is a copy of the previous one; IDs move to it if the old file was removed from Storage or the new month is later.

### Links

- Projects — a table “Consum project → Sarjele sheet”. The sheet is locked; open the lock to choose it by hand.
- A project that is not set up is not processed. With “Connect new projects automatically” it is connected and gets a sheet by itself.
- Several similar blocks or one block for several rows — the element is skipped; choose the block in “Elements and blocks”.
- Manual links — `links.json`, see [below](#manual-links-linksjson).

### Heats

- “From the last one used” starts from the heat written last; older open heats are listed in the journal.
- Not enough steel — the plan shows “— NO STOCK —”, which is not written.
- No free rows under a block — the element is skipped.
- Yellow is removed only from heats the app filled itself (hidden `sync-journal` sheet in Probe).

### Writing and service data

- Before a write all files are copied to `backups/` next to them. Restore: Advanced → “Restore from backup”.
- A leftover `<file>.lock` folder after a crash is removed automatically.
- In Consum only the hidden “ID sync” column changes; formulas and formatting stay. Its letter is in “Details”.
- In Sarjele the “Model ID” column (codes and block ID) is hidden, or its text is invisible (`;;;`) when the column is shared.
- All IDs are on the hidden `sync-registry` sheet in Sarjele.

## Manual links: links.json

The file tells the app which Sarjele block to use for a Consum element when it cannot decide or decides wrongly. The drop-down next to an element on the Links tab writes to the same file. Open it from Advanced → “Manual links (links.json)”; each computer has its own.

```json
{
  "PETRA DATE|ST_100": "ST_100.110",
  "PETRA DATE|ST_110": "@new",
  "NORD INFRA|GRINDA 7": "@skip"
}
```

The key is `PROJECT|element`: the project name in the app and the name from the ELEMENT column; case and extra spaces do not matter.

| Value | What it does | Applies |
|---|---|---|
| `"block title"` | write to this block (one without an ID) | until the element gets an ID |
| `"@new"` | create a new block | until the element gets an ID |
| `"@skip"` | never process the element | always |

**Search order:** `@skip` → ID in Consum → registry in Sarjele → links.json → old block with a similar name → new block.

**Mistakes:**

- Invalid JSON stops runs with an Error card (reason and position); the app never overwrites a broken file.
- An unknown block or command — the element is skipped under “Need attention”.
- A key without `|` or a non-text value — the line is skipped with a warning.
- The same element twice — the last line applies; one block — one element.
- A BOM and an empty file are accepted.

## Development

```bash
npm install
npm start          # build and run from the project folder
```

| Command | What it does |
|---|---|
| `npm start` | build and run |
| `npm run build` | type check, window (`dist/`), engine (`dist-engine/`), main process (`dist-host/`) |
| `npm test` | all checks (`node:test` + `tsx`) |
| `npm run dist` | macOS (Apple Silicon) → `release/` |
| `npm run dist:x64` | macOS (Intel) |
| `npm run dist:win` | Windows x64 → `release/Somasync-<version>-win-x64.zip` |

**Tests** run on small synthetic workbooks and the mobile app's empty log `tests/fixtures/Probe otel.xlsx`: plan, write, repeated run, open file, restore, locks, backups, heats, settings, links.json, translations, Google Drive on a fake server and the phone bridge with the real engine. The plant's real files are not in the project; before releasing a new engine, compare the old and new versions on copies of them.

## Building

- **Windows:** unzip into any folder and run `Somasync\Somasync.exe`; no installation needed. The build can be made on Linux or macOS too.
- **macOS:** unzip, quit Somasync (Cmd+Q) and run `install-macos.command` next to `Somasync.app` (first time: right-click → Open). It copies the app to Applications, removes the quarantine flag and signs it locally.

## Structure

```
src/
  main.tsx              window entry point
  app/                  App (tabs, title bar, theme), state, i18n, bellListener (Firestore)
  features/             tabs: run/ (Home, journal), storage/, links/, settings/ (Advanced)
  components/           shared UI: icons/, ui/
  locales/<language>/   texts: common, run, storage, links, settings, messages
  shared/               shared by window, main process and engine: protocol, settings, messages, Store
  host/                 Electron main process: HostServices, SettingsStore, Journal, SyncService,
                        LinksService, StorageService, PhoneBridge, drive/, MainWindow, TrayMenu
  engine/               engine (dist-engine/sync.mjs), without Electron or React:
                        SyncEngine, ProbeBridge, lab/, Workspace, planning/, books/, SyncWriter, FileGuard
tests/                  tests
scripts/                generate-app-icon.py, screenshots/capture.mjs
assets/, build/         tray icons, app icon
docs/                   README screenshots and flags
```

### Conventions

- The engine talks to the app only through arguments, environment variables, the exit code (0 — done, 1 — error, 3 — postponed) and a JSON file (`JSON_OUT`).
- Texts from the engine and the main process are message codes; the window translates them. A new text is a key in all four `locales/<language>/`; tests compare keys and parameters.
- The window talks to the main process only through `window.api`.
- Imports via `@/`; comments in Russian; risks are marked `РИСК:`.
- No database: the data lives in the files themselves, so manual edits count and there is one source of truth.

## Known risks

| What | Where | Consequence |
|---|---|---|
| A Sarjele block is recognised by its header (Model / ø / KG) | `engine/books/SarjeleBook.ts` | a renamed header loses the block and its consumption |
| Probe columns are found by header words | `engine/books/ProbeBook.ts` | a renamed header turns the sheet off |
| The form in Consum comes from “bob” in row 8 | `engine/books/ConsumBook.ts` | a typo changes the form |
| IDs in Consum are written by editing the XML | `engine/books/ConsumIdPatcher.ts` | in an unusual file the IDs may not land (with a warning) |
| Table look around the hidden “Model ID” column | `engine/books/SarjeleWriter.ts` | check the real Sarjele after styling changes |
| An empty hidden sheet is taken for a new project | `engine/books/SarjeleWriter.ts` | such a sheet is renamed and shown |
| A crashed editor's lock file | `engine/FileGuard.ts` | writes wait until the lock is deleted |
| An abandoned lock is judged by the clock | `engine/FileGuard.ts` | clocks more than 10 minutes apart may cause an error |
| Pause after a Consum change | `host/ConsumWatcher.ts` | on a slow network a half-written file may be read |
| Network share password and Google key when system encryption is unavailable | `host/SettingsStore.ts` | stored in `state.json` as base64 (`raw:`), readable by anyone with access to the file |
| A Drive table changed during a run | `host/drive/DriveMirror.ts` | not uploaded; the next run recalculates |
| Probe open in Excel all day | `host/PhoneBridge.ts` | tags from phones wait in the copy |
| A tag's year sheet comes from the phone clock | `engine/lab/LabelWorkbook.ts` | a wrong date gives the wrong sheet |
| Writing a tag repeats the mobile app | `engine/lab/` | change together with `features/uploads/xlsx/` in main |

## License

[Apache License 2.0](LICENSE) © 2026 Muhammad Halimov. Keep the authorship and license notice ([NOTICE](NOTICE)) and mark modified files. The names and logos of Somaco and Holcim are trademarks of their owners and are not covered by the license. Third-party libraries keep their own licenses (Electron, React, ExcelJS, i18next — MIT; JSZip — MIT or GPL-3.0, used under MIT).

## AI disclosure

The author is responsible for the code, design decisions and maintenance. AI tools were involved in the development of this app.
