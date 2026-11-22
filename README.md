**English** · [Русский](README.ru.md)

# <img src="docs/favicon.ico" alt="Somaco" height="40" align="middle"> Somasync

A desktop app (Windows and macOS) for **Somaco (Holcim), Romania** — accounting of reinforcing steel by heat: distribution of element consumption from the monthly Consum report over heats, element blocks in Sarjele and marking of used-up heats in Probe.

**Interface:** <img src="docs/flags/gb.svg" height="14" alt=""> English · <img src="docs/flags/ro.svg" height="14" alt=""> Română · <img src="docs/flags/tj.svg" height="14" alt=""> Тоҷикӣ · <img src="docs/flags/ru.svg" height="14" alt=""> Русский  
**Stack:** Electron 44 · React 19 · TypeScript · Vite 8 · ExcelJS · i18next

## Screenshots

Demo data: projects, elements and heats are fictitious.

<img src="docs/screenshots/overview.en.webp" alt="Home with the journal, network drive, Devices, Google Drive, Links, Advanced">

```bash
npm run build && node scripts/screenshots/capture.mjs   # retake the screenshots
```

## Contents

- [How it works](#how-it-works)
- [Workplaces](#workplaces)
- [Table storage](#table-storage)
- [Devices](#devices)
- [Rules of operation](#rules-of-operation)
- [Manual links: links.json](#manual-links-linksjson)
- [Development](#development)
- [Structure](#structure)
- [Known risks](#known-risks)
- [License](#license)
- [AI disclosure](#ai-disclosure)

## How it works

```mermaid
flowchart LR
  consum@{ shape: doc, label: "Consum<br/>monthly consumption" } --> engine["Engine"]
  delivered@{ shape: doc, label: "Probe otel<br/>heats delivered" } --> engine
  phones@{ shape: doc, label: "Probe copy in Google Drive<br/>tags from phones" } --> engine
  engine --> sarjele@{ shape: doc, label: "Sarjele<br/>element blocks by heat" }
  engine --> used@{ shape: doc, label: "Probe otel<br/>used-up heats, tags" }
  engine --> ids@{ shape: doc, label: "Consum<br/>element IDs" }
```

| File | Contents |
|---|---|
| **Consum** (sheet “Decont Lunar”) | consumption for the month: projects, elements, kg of steel per material code |
| **Sarjele din elemente** | a sheet per project, a block per element: heats and kg |
| **Probe otel** | delivery log; a used-up heat is filled yellow |

Run sequence:

1. **Watching.** A saved Consum (change of time and size) starts the engine.
2. **Reading.** The engine reads deliveries from Probe, write-offs from Sarjele and consumption from Consum.
3. **Linking.** Each element is matched to its Sarjele block: by ID (`NI-0004`), registry, manual link or similar name; otherwise a new block is created.
4. **Plan.** Remainder of a heat = delivered minus written off; consumption is distributed over heats of the matching Ø and form.
5. **Writing:** backup, Sarjele, Probe, IDs in Consum, check.

Each run is shown on the Home tab as a card with the outcome: Written, Plan only, No changes, Postponed, Error. Settings, `log.txt` and `links.json` are stored in `%APPDATA%\Somasync\` (Windows) or `~/Library/Application Support/Somasync/` (macOS).

**Data safety:** trial mode without writing; a backup before every write with restore from the Advanced tab; writing through a temporary file with a check; a file open in an editor is not written — the write is postponed until it is closed. All processing is local; files are transferred only to Google Drive, and only when it is the selected storage.

## Workplaces

Tabs at the top of Home (the selected one is remembered): **Atelier**, **Laborator**, **Calitate**.

| | Atelier | Laborator | Calitate |
|---|---|---|---|
| Tables | Consum, Sarjele, Probe | Laborator.xlsx (coefficient table) | Calitate.xlsx (no processing yet) |
| Storage | this computer, network drive, Google Drive, Devices | this computer, network drive | this computer, network drive |
| Links, rules, manual links | yes | no | no |
| Signature (Advanced) | foreman | lab technician | inspector |
| Watching (Start) | Consum → Sarjele and Probe | reading the latest entry of Laborator.xlsx | not yet |
| Migration | IDs of Sarjele blocks | Nr.bul. and Data into their own columns | no |
| Table check in Storage | sheets: Decont Lunar, the year sheet, project sheets | header: Rc decofr., Nr.bul., Data (table split) | the file exists and reads |

Laborator and Calitate have their own storage and table; the network drive account and location are shared. The workplace cannot change while watching. “Write to files” exists only for Atelier: Laborator only reads its table.

**Laborator watching** (`engine/laborator/LaboratorReader.ts`): on Start and on every change of `Laborator.xlsx` the table is copied to `backup/Laborator` (always, although it is not changed), then the journal gets the latest entry — the bottom row below the header with “Rc decofr.”, “Nr.bul.” or “Data” filled (pre-filled rows below without results are skipped) — and the lab technician’s signature. A table in the old layout (not split by the migration) is an error with a hint. Once — Advanced → “Read the table”.

**Signatures** (Advanced of each workplace — foreman, lab technician, inspector; `host/SignatureService.ts`): a PNG with a transparent background; an image without transparency is rejected. Transparent margins around the signature are trimmed, an oversized image is scaled down, the copy is kept in the app data folder (`signatures/`). The preview is on a white checkered sheet in any theme. The lab technician’s signature is passed to the engine when the table is read (`SIGNATURE`).

**Laborator migration** (`engine/laborator/`, Advanced → “Trial / Actual migration”): the bulletin number and the date from the “Rc decofr.” cells (`32.8↵1B/09.01.2026`) and from the “Nr.bul./Data” column to the right of “Rc 28 zile” (`1B/05.02.2026`) move into new “Nr.bul.” and “Data” columns; the strength becomes a number, the date an Excel date (`dd.mm.yyyy`). Merges, widths, the filter and the print area move with the columns. Cells with typos (“37..5”, “18.08.02026”) stay as they are and are listed under “Need attention”. The new workbook is checked before writing; the original stays next to it as `Laborator Orig.xlsx` (if that file already exists, the migration is not run), a backup goes to `backup/Laborator`. A table that is already split is not changed again.

## Table storage

The tables must already exist; the app does not create them. Each storage has its own set of files.

- **This computer** — paths to the tables.
- **Network drive** (SMB, `host/SmbShare.ts`) — account (domain, user, password) and location (server, shared folder). “Test connection” connects the share with system tools: Windows — `net use \\server\share` (paths `\\server\share\…`), macOS — `mount volume smb://…` (the share appears in `/Volumes`, the mount point is taken from `mount`); then the tables are picked with the folder icon. The password is stored encrypted (DPAPI / Keychain).
  - The server is required and, without “Without authorization”, so are the user and password; the shared folder is not: without it the folder comes from the table paths, and if there are no paths yet Windows signs in to the server (`\\server\IPC$`) and macOS offers its own folder picker.
  - While the drive is not connected, the tables on it are unavailable (paths, file picking, check); the state is checked when the tab opens and after the server or folder is edited.
  - Before connecting, the app checks that the server responds (TCP 445/139 or the port from `server:port`). Errors are plain text by the system error number (Windows and macOS, e.g. “The server refused the connection — check the address, port and share” instead of “-5014”); an unknown number gives a general phrase with the number.
  - The tables are read with system tools, as ordinary files. If Windows already has access to the share (domain sign-in, saved credentials, open access), no account is needed in the program.
  - “Without authorization” — connection without a user name and password, with the current system account.
  - Before watching starts, the program connects the share itself if the tables on it are unavailable (for example, after a system restart).
- **Google Drive** — Google account sign-in in the system browser (OAuth for desktop apps: the answer returns to `http://127.0.0.1:<port>`, PKCE; the result page is in English, closes after 5 s and the Somasync window comes to the front), a folder link and table names. Without an OAuth client, “Sign in with Google” reports that Google Drive is not set up. The tables are processed in a local copy (`<app data>/drive/<folder id>/`): only changed tables are downloaded, the same `<table>.lock` locks as in the mobile app are used, the previous version is saved to `backups` on the server. A table changed in Drive during a run is not overwritten.

Google Cloud setup (one-time; the project and the consent screen are the same as for the mobile app, see its [build guide](https://github.com/muhammad-halimov/somascan/blob/main/guides/BUILD.md#google-drive-oauth-clients)):

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Library → **Google Drive API** → Enable.
2. Google Auth Platform → Data access → scope `https://www.googleapis.com/auth/drive`; Audience → Test users for an External screen in “Testing” mode.
3. Google Auth Platform → Clients → Create client → type **Desktop app** → Create → Download JSON.
4. The JSON is placed into the project root as `google-oauth.json` (not part of the repository) — the build embeds the client into the app. Alternatives: the variables `SOMASYNC_GOOGLE_CLIENT_ID=… SOMASYNC_GOOGLE_CLIENT_SECRET=… npm run dist:win` (they take priority), or `google-oauth.json` in the app data folder of an already built app.

## Devices

If the tables are on this computer or a network drive and the phones have no access to the company network, the mobile app writes tags into a **copy of Probe in Google Drive**, and Somasync transfers them into Probe (“Storage → Devices”; code — `host/PhoneBridge.ts`, `engine/ProbeBridge.ts`).

- “Tags from Google Drive” is on by default; the switch, the folder and the copy name are locked against accidental changes.
- The copy is checked every 15 s during watching with writing (by MD5).
- New tags (by the hidden sheet `somascan-journal`) are appended to Probe as the same row the phone would write; then Probe replaces the copy.
- While Probe is open in Excel, the transfer is postponed and the copy is not replaced.
- A tag whose heat is already in Probe is skipped with the reason shown in the journal.

**Firebase Firestore** (optional, behind a lock) — instant transfer: after writing, the phone updates the document `somascan-bells/<channel>` (the channel is the SHA-256 of “folder id/copy name”, the same on the phone and in the app without a separate setting), and the app starts a check immediately. Firestore stores only the time of the last notification. Checking the copy remains the fallback.

Setup (one-time; details with screens — in the [build guide of the mobile app](https://github.com/muhammad-halimov/somascan/blob/main/guides/BUILD.md#firebase-firestore)):

1. [Firebase console](https://console.firebase.google.com/) → add Firebase to the Google Cloud project or create a new one.
2. Firestore Database → create a database (Standard) → Rules: the rules below → Publish.
3. Project settings → General: project ID and Web API key (without a key — Add app → Web). The Web API key is not a secret: access is defined by the rules.
4. The ID and the key are entered on the computer (“Storage → Devices → Firebase Firestore notifications”) and on the phones (“Settings → Storage → Google Drive → Firebase Firestore”).

The free quota (50,000 reads and 20,000 writes a day) is more than sufficient.

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

## Rules of operation

- **Modes.** Trial mode writes nothing; writing is enabled by “Write to files” on the Home tab or “Actual run” on the Advanced tab. “Start” enables watching.
- **Migration** (one-time, for a Sarjele kept by hand): existing blocks receive IDs without distribution over heats. Order: trial migration → “Need attention” on the Links tab → actual migration.
- **Consum.** Sheet `Decont Lunar`; columns are identified by headers (ELEMENT, “ID sync”); consumption — columns AK…AZ (code in row 9, Ø in row 7, form in row 8: “bob” — Bobina, otherwise Bara); data from row 10. Formulas are read by their saved result.
- **New month.** The month is taken from `LUNA <MONTH> <YEAR>`; a new Consum is a copy of the previous one, and IDs move to it.
- **Projects.** A project is processed only when linked to a Sarjele sheet (Links tab) or with “Connect new projects automatically”.
- **Heats.** “From the last one used” starts from the heat written last. Insufficient steel is shown as “— NO STOCK —” and is not written. Yellow is removed only from heats filled by the app (hidden sheet `sync-journal`).
- **Service data.** The “ID sync” column in Consum and the “Model ID” column in Sarjele are hidden; all IDs are on the hidden sheet `sync-registry` in Sarjele.
- **Backups** are saved next to the tables in `backup/`, each workplace in its own folder: `backup/Atelier/Consum`, `backup/Atelier/Probe`, `backup/Atelier/Sarjele`, `backup/Laborator`, `backup/Calitate`. Restore: Advanced → “Restore from backup”, for the tables of the selected workplace. Backups of earlier versions (`backups/`) stay in the restore list.

## Manual links: links.json

Overrides the block of a Consum element when automatic linking is impossible or wrong. The drop-down on the Links tab writes to the same file; it is opened from Advanced → “Manual links (links.json)”.

```json
{
  "PETRA DATE|ST_100": "ST_100.110",
  "PETRA DATE|ST_110": "@new",
  "NORD INFRA|GRINDA 7": "@skip"
}
```

| Value | Action |
|---|---|
| `"block title"` | write to this block (until the element receives an ID) |
| `"@new"` | create a new block (until the element receives an ID) |
| `"@skip"` | never process the element |

The key is `PROJECT|element`; case and extra spaces are ignored. Search order: `@skip` → ID in Consum → registry in Sarjele → links.json → similar name → new block. Invalid JSON stops runs with an error; the file is never overwritten by the app.

## Development

```bash
npm install
npm start          # build and run from the project folder
```

| Command | Purpose |
|---|---|
| `npm run build` | `tsc -b` + window (`dist/`) + engine (`dist-engine/`) + main process (`dist-host/`) |
| `npm test` | all checks (`node:test` + `tsx`) |
| `npm run dist` / `dist:x64` | macOS (Apple Silicon / Intel) → `release/` |
| `npm run dist:win` | Windows x64 → `release/Somasync-<version>-win-x64.zip` |

- **Windows:** the archive is unpacked into any folder, the app is started with `Somasync\Somasync.exe`; no installation is required.
- **macOS:** after unpacking, Somasync is closed (Cmd+Q) and `install-macos.command` next to `Somasync.app` is started (the first time: right-click → Open); it copies the app to Applications, removes the quarantine flag and signs it locally — with the persistent “Somasync Local Signing” key (created once in the login keychain). With it, the app's access to the network drive password and the Google sign-in in the keychain is allowed once (“Always Allow”), not after every install; if they cannot be decrypted, the journal says so and the password is entered again. Changes in the project reach the installed app only this way.

Tests run on synthetic workbooks (`tests/fixtures.ts`) and the empty log of the mobile app (`tests/fixtures/Probe otel.xlsx`); Google Drive is tested on a fake server, sign-in — through `127.0.0.1` with a fake token server (`tests/drive.test.ts`), the phone bridge — with the real engine (`tests/phoneBridge.test.ts`, `tests/bridge.test.ts`). The plant's real files are not part of the project: before releasing a new engine version, the old and new versions are run on copies of the real files and the journal and the result are compared.

## Structure

```
src/
  app/                  window: tabs, theme, state, Firestore listener
  features/             tabs: run (Home), storage, links, settings (Advanced)
  locales/              texts en / ro / tj / ru
  shared/               shared by window, main process and engine
  host/                 Electron main process: settings, journal, watching, network drive, Google Drive, phones, signature
  engine/               engine without Electron or React: planning, books, writing, lab (tags), laborator (laboratory table)
tests/                  checks
```

Conventions: the engine communicates only through arguments, the exit code (0 — done, 1 — error, 3 — postponed) and a JSON file; texts are passed as message codes and translated by the window; imports through `@/`; comments in Russian; risky places are marked `РИСК:`.

## Known risks

| What | Consequence |
|---|---|
| Sarjele blocks and Probe columns are identified by header text | a renamed header excludes the block or the sheet |
| The form in Consum is taken from “bob” in row 8 | a typo changes the form |
| IDs in Consum are written by editing the XML | in an unusual file the IDs may not be written (with a warning) |
| A lock file of a crashed editor | writing is postponed until the lock is deleted |
| The pause after a Consum change | on a slow network a partially written file may be read |
| Password and Google key without system encryption | stored in `state.json` in base64 (`raw:`) |
| Laborator table columns are found by header text (“decofr”, “28 zile”, “Nr.bul”, “Data”) | a renamed header — the migration and reading are not run (with the reason) |
| The latest Laborator entry is the bottom filled row | an entry inserted above the last one is not taken as the latest |
| A Laborator backup on every change | the `backup/Laborator` folder grows within the backup retention period |
| The network drive server check (TCP) | on macOS 15+ the app may ask for Local Network access; without it the check is skipped |
| Writing a tag duplicates the logic of the mobile app (`engine/lab/`) | changes are made together with `features/uploads/xlsx/` in main |

## License

[Apache License 2.0](LICENSE) © 2026 Muhammad Halimov ([NOTICE](NOTICE)). The names and logos of Somaco and Holcim are trademarks of their owners.

## AI disclosure

The author is responsible for the code, design decisions and maintenance. AI tools were involved in the development of this app.
