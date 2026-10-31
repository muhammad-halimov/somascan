**English** · [Русский](README.ru.md)

# <img src="src/assets/favicon.ico" alt="Somaco" height="40" align="middle"> Somascan

A mobile app for **Somaco (Holcim), Romania**: it reads the tags of incoming reinforcing steel and writes them into the steel sample log `Probe otel.xlsx` on a Windows network drive or in Google Drive.

**Interface:** <img src="docs/flags/gb.svg" height="14" alt=""> English · <img src="docs/flags/ro.svg" height="14" alt=""> Română · <img src="docs/flags/tj.svg" height="14" alt=""> Тоҷикӣ · <img src="docs/flags/ru.svg" height="14" alt=""> Русский  
**Stack:** Vite · React 19 · TypeScript · Capacitor 8 (Android / iOS) · oxlint

## Screenshots

**Android** (Material 3)

<img src="docs/screenshots/android/overview.en.webp" alt="Android: main screen, recognized tag, editing, tag without a photo, grid, Uploads, model, network drive, Google Drive, Advanced">

**iPhone** (iOS 26, Liquid Glass)

<img src="docs/screenshots/ios/overview.en.webp" alt="iPhone: main screen, recognized tag, editing, tag without a photo, grid, Uploads, model, network drive, Google Drive, Advanced">

```bash
npm run build && node scripts/screenshots/capture.mjs   # retake the screenshots
```

## Contents

- [How it works](#how-it-works)
- [Recognition](#recognition)
- [Steel sample log](#steel-sample-log)
- [Writing to the log](#writing-to-the-log)
- [Development](#development)
- [Building](#building)
- [Structure](#structure)
- [Known risks](#known-risks)
- [License](#license)
- [AI disclosure](#ai-disclosure)

## How it works

```mermaid
flowchart LR
  photo["Tag photo"] --> device["On device<br/>ML Kit / Vision + field rules"]
  photo --> model["AI model<br/>Gemini · Claude · OpenAI · LM Studio"]
  device --> fields["Fields<br/>check and edit"]
  model --> fields
  fields --> queue["Queue<br/>written in the background"]
  queue --> smb[("Probe otel.xlsx<br/>network drive")]
  queue --> drive[("Probe otel.xlsx<br/>Google Drive")]
```

- The main screen holds up to nine tags (3 × 3 grid). A tag is sent with “Next” once its form (coil or bar) is chosen and the required fields are filled.
- Each heat number is accepted once (on by default): a repeat on screen, in “Uploads” or in the log is an error.
- A tag can be added without a photo and filled in by hand.

## Recognition

| Provider | Where it runs | Note |
|---|---|---|
| **On-device** (default) | the phone: ML Kit (Android), Apple Vision (iOS) | offline, no keys; fields by rules |
| **Gemini**, **Claude**, **OpenAI** | the provider's cloud | API key, entered in the app |
| **LM Studio** | a server in the plant network | data stays in the network |

- **On-device.** The phone reads the text lines; rules in `recognition/ocr/` find the fields by their captions in any language (Heat, Șarjă, Adag, Плавка…) and by the shape of the value. The captions are edited in “Advanced → Rules”. Tested on real readings of tags from 11 mills (`tests/fixtures/ocr/`).
- **AI models** are behind a lock in “General → Recognition”. Model lists come from the provider's API or [models.dev](https://models.dev). LM Studio is shared by all phones: a model switch waits until nobody is recognizing.
- **Photo quality.** Blur, glare, darkness and a missing tag are reported; a one-line hint on the photo says what to do (“Rotate the photo”, “Move closer to the tag”).
- **Advanced:** prompt, rules, fields to read, known suppliers (export and import as JSON), backup period, photo size.

## Steel sample log

Tags are written to `Probe otel.xlsx`, the log the workshop keeps: one sheet per year, header in rows 4–6, data from row 7. Columns are found by header text, so they can be moved.

| Column | Value |
|---|---|
| Nr. Crt. | previous number + 1 |
| Cantitatea | weight, `8126Kg` |
| Data intrare | write date, `DD.MM.YYYY` |
| Sarja | heat number |
| Producator | mill |
| Bobina / Bara | diameter in the column of the form |
| Doc. de calitate | quality document (optional field) |

- **The app does not create the table.** A missing log is a `tableNotFound` error until the path is fixed; check it with the icon at the end of the path field.
- **Strict structure** (on by default): only a sheet with all the log columns in order is written.
- **Hidden sheet `somascan-journal`** keeps every written record, so an interrupted write is not duplicated.
- An empty log for tests: `tests/fixtures/Probe otel.xlsx`.

## Writing to the log

“Next” puts tags into a queue that survives a restart and is written in the background, one at a time; the state is in “Uploads”. On a phone the queue is written by an engine outside the screen (`src/engine`): Android — WorkManager with a notification, iOS — background task, Live Activity before iOS 26.

One write (`TableWriter`), the same for both storages:

1. Lock `<table>.lock`; a lock older than 5 minutes is removed.
2. Read the log anew, append the row, check that all previous values stay in place.
3. Replace the file atomically; the previous version goes to `backups/` (kept 7 days by default).
4. Read back and check the written row.

Temporary failures (no network, table open in Excel) are retried with a growing pause up to every 15 minutes; permanent ones (wrong password, no table, wrong structure) wait for the settings to change.

**Network drive** — “Settings → Storage → Network share”: server, shared folder, path to an existing log, domain, user, password. SMB: [smbj](https://github.com/hierynomus/smbj) on Android, [AMSMB2](https://github.com/amosavian/AMSMB2) on iOS.

**Google Drive** — sign in with Google, a folder link and the table name. Google Cloud setup (once):

1. In [Google Cloud Console](https://console.cloud.google.com/) enable **Google Drive API**; consent screen Internal (Workspace) or External with test users; scope `https://www.googleapis.com/auth/drive`.
2. Android client: package `com.somascan.app`, SHA-1 of the project key (see [Signing](#signing)).
3. iOS client: bundle ID `com.somascan.app`; the client ID goes to `ios/App/App/Info.plist` → `GIDClientID`, the reversed ID — to `CFBundleURLSchemes`.

## Development

```bash
npm install
npm run dev        # web version, http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run build` | type check, page and engine build |
| `npm test` | all checks (`node:test` + `tsx`) |
| `npm run lint` | oxlint |
| `npm run cap:sync` | build and `cap sync` |
| `npm run cap:run:android` / `cap:run:ios` | build and run on an emulator or device |

After a change in the web code run `npm run build && npx cap sync`. A local SMB server for tests (Samba in Docker) is in `scripts/smb-test-server/`.

## Building

### Android

Android SDK (Android Studio or `android-commandlinetools`), JDK 21; `compileSdk` 36, `minSdk` 24. Put `sdk.dir=…` into `android/local.properties`.

```bash
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### Signing

Debug and release are signed with the project key `android/keystore/somascan.jks`, passwords in `android/keystore.properties`. Both files are **not in git**: copy them by hand and keep a backup — without the key installed apps cannot be updated. SHA-1: `AA:67:2E:F2:C4:DB:4C:CD:2A:EB:78:15:64:C5:C6:2A:FD:88:87:88`.

### iOS

macOS with Xcode 26+; minimum iOS 16.2. Dependencies come from Swift Package Manager.

```bash
npm run cap:ios          # open in Xcode, then Run
```

If `simctl` is not found: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.

## Structure

```
src/
  app/                  root component, header
  components/           shared UI
  features/
    recognition/        providers, model lists, tag fields, on-device rules, photos
    workspace/          main screen: tags, grid, result card, editing
    settings/           settings and their tabs
    uploads/            queue, log (xlsx), network drive (smb), Google Drive
  engine/               background upload engine
  lib/, hooks/          infrastructure without business logic
  locales/              texts en / ro / tj / ru
tests/                  checks and fixtures
android/, ios/          native projects and plugins
```

Conventions: imports through `@/`; texts only through `t()` and `locales/`; colours only from `styles/tokens.css`; comments in Russian; risky places are marked `РИСК:`.

## Known risks

| What | Consequence |
|---|---|
| Undocumented parts of ExcelJS (`excelInternals.ts`) | after updating `exceljs` run `npm test` and compare a real log before and after a write |
| Duplicate protection lives on the hidden `somascan-journal` sheet | if the sheet is lost, a retry may append the row again |
| Sheet year and date come from the phone clock | a wrong date gives the wrong sheet |
| Locks are judged by the clocks of different devices | clocks more than 5 minutes apart can break locking |
| API keys and the SMB password are stored unencrypted | move to Keychain / Keystore before wider distribution |

## License

[Apache License 2.0](LICENSE) © 2026 Muhammad Halimov ([NOTICE](NOTICE)). The names and logos of Somaco, Holcim and the services are trademarks of their owners.

## AI disclosure

The author is responsible for the code, design decisions and maintenance. AI tools were involved in the development of this app.
