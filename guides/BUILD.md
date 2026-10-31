**English** · [Русский](BUILD.ru.md)

# Building and setup

A complete guide: from cloning the repository and obtaining all keys to release builds for Android and iOS. A short version is in the [README](../README.md#building).

## Contents

- [Requirements](#requirements)
- [Cloning and first run](#cloning-and-first-run)
- [Android SDK from scratch (macOS)](#android-sdk-from-scratch-macos)
- [Signing key](#signing-key)
- [Debug APK](#debug-apk)
- [iOS](#ios)
- [Release builds](#release-builds)
- [Recognition: API keys and LM Studio](#recognition-api-keys-and-lm-studio)
- [Network drive](#network-drive)
- [Google Drive: OAuth clients](#google-drive-oauth-clients)
- [Firebase Firestore](#firebase-firestore)
- [Icon, splash screen and screenshots](#icon-splash-screen-and-screenshots)
- [Logs and debugging](#logs-and-debugging)

## Requirements

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22+ | everything |
| JDK | 21 | Android |
| Android SDK | platform 36, build-tools 35 | Android |
| Xcode | 26+ (macOS only) | iOS |
| Apple Developer Program | paid account | iOS on devices, TestFlight, App Store |
| Google account | — | Google Cloud (Drive), Firebase, Gemini |
| Docker | optional | local SMB server for tests |

## Cloning and first run

```bash
git clone https://github.com/muhammad-halimov/somascan.git
cd somascan
npm install
npm run dev        # web version, http://localhost:5173
npm test           # all checks
```

Branches: `main` — the mobile app Somascan; `desktop` — the desktop app Somasync (its own README). App ID: `com.somascan.app` (`capacitor.config.ts`).

Files that are **not in git** and are created on each machine:

| File | Contents | How to obtain |
|---|---|---|
| `android/local.properties` | path to the Android SDK (in `.gitignore`) | [step 6](#android-sdk-from-scratch-macos) |
| `android/keystore/somascan.jks` | signing key (in `android/.gitignore`) | copy of the project key or a new one, see [Signing key](#signing-key) |
| `android/keystore.properties` | key passwords | the same |

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b` + `vite build` (page) + queue engine build (`vite.engine.config.ts`) → `dist/upload-engine.js` |
| `npm test` | all checks (`node:test` + `tsx`) |
| `npm run preview` | local preview of the production build |
| `npm run lint` | linter (oxlint) |
| `npm run cap:sync` | web build + `cap sync` to all platforms |
| `npm run cap:android` | build, sync and open the project in Android Studio |
| `npm run cap:ios` | build, sync and open the project in Xcode (macOS) |
| `npm run cap:run:android` | build + run on an Android emulator or device |
| `npm run cap:run:ios` | build + run on the iOS simulator |

After any change to the web code, `npm run build && npx cap sync` is required (all `cap:*` scripts do this themselves).

## Android SDK from scratch (macOS)

On Windows and Linux the steps are the same with the SDK path from Android Studio (SDK Manager); installing Android Studio installs the SDK as well.

**1. Command-line tools**

```bash
brew install --cask android-commandlinetools
```

The SDK is installed into `/opt/homebrew/share/android-commandlinetools`.

**2. Environment variables** (in `~/.zshrc`, once; then `source ~/.zshrc`)

```bash
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

**3. Licenses**

```bash
yes | sdkmanager --licenses --sdk_root="$ANDROID_HOME"
```

**4. Packages**

```bash
sdkmanager --sdk_root="$ANDROID_HOME" \
  "platform-tools" \
  "platforms;android-36" \
  "build-tools;35.0.0" \
  "emulator" \
  "system-images;android-35;google_apis;arm64-v8a"
```

`arm64-v8a` is for Apple Silicon; Intel and Windows require `x86_64`. The emulator is about 1.2 GB, the image about 3.8 GB. The project targets Android 16 (`compileSdk` / `targetSdk` 36, `minSdk` 24, `android/variables.gradle`). The Android 15 image lacks the segmented progress bar and Live Update of the upload notification; they require `system-images;android-36;…`.

**5. Emulator (AVD)**

```bash
avdmanager create avd -n somascan_pixel7 -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_7 --force
```

**6. `local.properties`**

```bash
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
```

**7. Starting the emulator**

```bash
emulator -avd somascan_pixel7 &
adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
```

**8. Build and run**

```bash
npm run cap:run:android
npx cap run android --target emulator-5554           # a specific device (id from `adb devices`)
adb shell am start -n com.somascan.app/.MainActivity  # bring the app back to the foreground
```

## Signing key

Debug and release builds are signed with one project key, so its SHA-1 is the same for every build and one Android OAuth client is sufficient. `android/app/build.gradle` reads the key from `android/keystore.properties`; without this file the debug build is signed with the machine's `~/.android/debug.keystore` and the release build is unsigned.

**Option 1 — the existing project key.** `android/keystore/somascan.jks` and `android/keystore.properties` are obtained from the owner of the project and copied into the same paths. Key SHA-1:

```
AA:67:2E:F2:C4:DB:4C:CD:2A:EB:78:15:64:C5:C6:2A:FD:88:87:88
```

**Option 2 — a new key** (a fork or a separate installation). Apps signed with another key cannot be updated with it, and Google Drive requires a new Android OAuth client with the new SHA-1.

```bash
mkdir -p android/keystore
keytool -genkeypair -v -keystore android/keystore/somascan.jks -alias somascan \
  -keyalg RSA -keysize 2048 -validity 10000
```

`android/keystore.properties` (the path is relative to `android/`):

```properties
storeFile=keystore/somascan.jks
storePassword=<keystore password>
keyAlias=somascan
keyPassword=<key password>
```

SHA-1 of the key:

```bash
keytool -list -v -keystore android/keystore/somascan.jks -alias somascan | grep SHA1
cd android && ./gradlew signingReport
apksigner verify --print-certs app/build/outputs/apk/debug/app-debug.apk
```

Both files are kept with a backup copy outside the repository: with a lost key the installed app cannot be updated.

## Debug APK

```bash
npm run build && npx cap sync android && cd android && ./gradlew assembleDebug && cd ..
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**Installing over Wi-Fi.** On the phone: Developer options → Wireless debugging.

```bash
adb connect 192.168.1.1:5555      # device IP:port
adb devices -l                    # the device must be listed
adb -s 192.168.1.1:5555 install -r android/app/build/outputs/apk/debug/app-debug.apk
```

A build with one key cannot be installed over a build signed with another key: the app is removed from the device first, together with its data (settings, API keys, queue).

## iOS

The `ios/` project is in the repository (the app target, the `UploadActivity` extension, local plugins); `npx cap add ios` is not required. Dependencies come from Swift Package Manager (`CapApp-SPM`, AMSMB2, GoogleSignIn); CocoaPods is not used. Minimum iOS 16.2; Xcode 26+ is required (Swift 6.2, iOS 26 background task in `UploadBackground.swift`).

```bash
npm run cap:ios          # build, sync and open the project in Xcode, then Run
npm run cap:run:ios      # build and run on the simulator
```

**Signing team.** The project uses team `PD62HNY4L2`. With another Apple account: Xcode → target `App` and target `UploadActivity` → Signing & Capabilities → Team. If the bundle IDs `com.somascan.app` and `com.somascan.app.UploadActivity` are registered to another team, both are changed to own ones (for example `com.example.somascan` and `com.example.somascan.UploadActivity`), and the iOS OAuth client is created for the new bundle ID.

**`simctl` is not found.** `npx cap run ios` reports:

```
Unable to retrieve simulator list: xcrun: error: unable to find utility "simctl", not a developer tool or in PATH
```

`xcode-select` points to the Command Line Tools instead of Xcode.app. Fix (requires a password) and check:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
xcodebuild -version
xcrun simctl list devices available
```

**Xcode 27: `cap run ios` fails on Simulator.app.** The build succeeds, but at the end:

```
[error] ERR_UNKNOWN: There was an error opening simulator: The file
        /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app does not exist.
```

In Xcode 27 `Simulator.app` is no longer at the old path, and `native-run` fails on a helper step; the simulator itself and `xcrun simctl` work. The project is run from Xcode (`npm run cap:ios`, then Run) or built with `xcodebuild` and installed with `xcrun simctl install` / `xcrun simctl launch`.

**`Mach error -308 (server died)`** — CoreSimulator has stopped: `xcrun simctl shutdown all`, then a retry; on weak laptops only one simulator is kept running.

**Live Activity extension.** Target `UploadActivity` in `App.xcodeproj` (`ios/App/UploadActivity/`, embedded by the “Embed Foundation Extensions” phase); the shared model `App/UploadActivityAttributes.swift` belongs to both targets; the app's `Info.plist` contains `NSSupportsLiveActivities`.

## Release builds

**Version.** One version for the whole app, changed in three places together:

| Where | Field |
|---|---|
| `package.json` | `version` (shown in “Advanced → About”) |
| `android/app/build.gradle` | `versionName` and `versionCode` (+1 for every release) |
| Xcode, targets `App` and `UploadActivity` | `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` |

**Android.** Requires the [signing key](#signing-key).

```bash
npm run build && npx cap sync android
cd android
./gradlew assembleRelease     # APK: app/build/outputs/apk/release/app-release.apk
./gradlew bundleRelease       # AAB for Google Play: app/build/outputs/bundle/release/app-release.aab
cd ..
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

With Google Play App Signing, Google re-signs the app with its own key: its SHA-1 (Play Console → Test and release → App integrity) requires one more Android OAuth client.

**iOS.**

```bash
npm run build && npx cap sync ios
npm run cap:ios
```

In Xcode: device “Any iOS Device (arm64)” → Product → Archive → Distribute App → App Store Connect (TestFlight, App Store), Ad Hoc or Development. Distribution requires a paid Apple Developer Program account.

## Recognition: API keys and LM Studio

**On-device** recognition (default) requires no setup. For AI models the key is obtained from the provider and entered in the app.

| Provider | Where to get the key | Where to enter it |
|---|---|---|
| Gemini | [Google AI Studio → API keys](https://aistudio.google.com/apikey) → Create API key | “Settings → General → Recognition → AI models → Google → API key” |
| Claude | [Claude Console → Settings → API keys](https://platform.claude.com/settings/keys) → Create Key (starts with `sk-ant-`) | the same, provider Anthropic |
| OpenAI | [OpenAI Platform → API keys](https://platform.openai.com/api-keys) → Create new secret key | the same, provider OpenAI |
| LM Studio | not required | the same, provider LM Studio |

- The “AI models” tab is behind a lock: the first tap opens it, the second selects it. Photos are then sent to the provider.
- The key is not part of the build: the project has no `.env` files, since everything substituted at build time can be read from the APK / IPA.
- Without a key the list shows a preview of models from [models.dev](https://models.dev); a model is selected after the key is entered.

**LM Studio** (a server in the plant network, data stays in the network):

1. Install [LM Studio](https://lmstudio.ai) 0.4 or later on a computer in the plant network (the app uses its REST API `/api/v0/models`, `/api/v1/models/load`, `/api/v1/models/unload`).
2. Download a vision model (type `vlm`).
3. Start the server in the Developer section with access from the local network (Serve on Local Network); default port 1234.
4. In the app: provider LM Studio, server address in short form (`192.168.1.14` is expanded to `http://192.168.1.14:1234/v1`).

The server is shared by all phones and holds one model in memory, so phones mark themselves in the table storage: a `somascan-lmstudio` folder next to the table on the network drive (`<device id>.json`), `somascan-lmstudio-<device id>` files in the Google Drive folder. A mark expires after a minute; without configured storage the phones work without the shared queue.

Requests to LM Studio go through the native `NativeHttp` plugin, so CORS and the WebView block of `http://` do not apply. For cloud providers or a proxy with CORS enabled, the app origins must be allowed: `capacitor://localhost` (iOS) and `https://localhost` (Android); otherwise requests fail silently (`didFailResourceLoad` in the WebKit log).

## Network drive

“Settings → Storage → Network share”:

| Field | Example |
|---|---|
| Server | `10.0.0.5` or `10.0.0.5:445` |
| Shared folder | `Atelier` |
| Table path | `Probe si Sarje Otel\Probe otel.xlsx` — to an existing log |
| Domain | optional |
| User, password | the account with write access to the folder |

The table is not created by the app. Its presence is checked with the icon at the end of the path field or with “Test connection”.

**Local server for tests** (Samba in Docker, `scripts/smb-test-server/`):

```bash
cd scripts/smb-test-server
mkdir -p share
docker run -d --name somascan-smb -p 1445:445 \
  -e NAME=Warehouse -e USER=scanner -e PASS=scanner123 \
  -v "$PWD/share:/storage" \
  -v "$PWD/smb.conf:/etc/samba/smb.conf:ro" \
  dockurr/samba
```

In the app: server `10.0.2.2:1445` (Android emulator) or `127.0.0.1:1445` (iOS simulator), folder `Warehouse`, user `scanner`, password `scanner123`. A copy of the log or the empty log `tests/fixtures/Probe otel.xlsx` is placed into `share`.

## Google Drive: OAuth clients

Google Drive needs no API key: the app signs in with Google (Android — Google Identity `AuthorizationClient`, iOS — Google Sign-In SDK; plugin `GoogleDriveAuth`), and access is granted to OAuth clients of a Google Cloud project — one for Android and one for iOS.

**1. Project and API.** [Google Cloud Console](https://console.cloud.google.com/) → project selector → New project. Then APIs & Services → Library → **Google Drive API** → Enable.

**2. Consent screen** (Google Auth Platform, formerly “OAuth consent screen”):

- Branding: app name (Somascan), support e-mail.
- Audience: **Internal** for the company's Google Workspace accounts (no Google verification) or **External**; for External in “Testing” mode the warehouse accounts are added to Test users.
- Data access → Add or remove scopes → `https://www.googleapis.com/auth/drive`. The app needs access to an existing folder; `drive.file` covers only files created by the app itself.

**3. Android client.** Google Auth Platform → Clients → Create client (or APIs & Services → Credentials → Create credentials → OAuth client ID):

- Application type: **Android**;
- Package name: `com.somascan.app`;
- SHA-1: the SHA-1 of the [signing key](#signing-key).

Nothing is copied into the project: Google identifies the app by the package name and the signature. A build signed with another key (the machine's debug key, Google Play App Signing) requires its own Android client with that SHA-1.

**4. iOS client.** The same place, Create client:

- Application type: **iOS**;
- Bundle ID: `com.somascan.app` (or the own bundle ID, see [iOS](#ios)).

After creation the console shows the **Client ID** (`…apps.googleusercontent.com`) and the **iOS URL scheme** (the reversed client ID, `com.googleusercontent.apps.…`; in the downloadable `.plist` of the client — `REVERSED_CLIENT_ID`). Both go into `ios/App/App/Info.plist`:

```xml
<key>GIDClientID</key>
<string>697326360300-xxxx.apps.googleusercontent.com</string>
...
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>com.googleusercontent.apps.697326360300-xxxx</string>
    </array>
  </dict>
</array>
```

The repository already contains the client of project `697326360300`; with another project both values are replaced. With an empty `GIDClientID` sign-in reports that Google sign-in is not configured in this build. `CFBundleName` (“Somascan”) is the name iOS shows in the “… Wants to Use ‘accounts.google.com’ to Sign In” prompt.

**5. In the app:** “Settings → Storage → Google Drive → Sign in with Google”, then a folder link from the Drive address bar (or its ID; empty — the root of “My Drive”) and the table name. The table must already be in the folder; the `backups` folder is created on the first write.

Testing without network or an account: `npm test` runs writing through a fake Drive API (`tests/fakeDrive.ts`).

The desktop app Somasync uses a separate client of type **Desktop app** in the same project: see the README of the `desktop` branch.

## Firebase Firestore

Optional. It is used when the log is on a network drive and the phones write into a copy of it in Google Drive: Somasync transfers the tags, and Firestore notifies it immediately after a write instead of a check every 15 s. Firestore stores only the time of the last notification. No `google-services.json` or `GoogleService-Info.plist` is needed: the app uses the REST API with a project ID and a Web API key.

1. [Firebase console](https://console.firebase.google.com/) → Create a project → select the existing Google Cloud project (the one with the OAuth clients) or create a new one. Google Analytics is not required.
2. Build → Firestore Database → Create database → edition Standard, a location close to the plant (for example `europe-west3`), production mode.
3. Firestore Database → Rules → replace with the rules below → Publish:

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

4. Project settings (gear icon) → General: **Project ID**. The **Web API key** is shown there after a web app is added: Your apps → Add app → Web (`</>`) → any name, without Firebase Hosting. The Web API key is not a secret: access is defined by the rules.
5. On the phones: “Settings → Storage → Google Drive → Firebase Firestore” (behind a lock) — “Somasync notification”, “Firebase project ID”, “Web API key”. In Somasync: “Storage → Phones → Firebase Firestore notifications” with the same values.

The free Firestore quota (50,000 reads and 20,000 writes a day) is more than sufficient.

## Icon, splash screen and screenshots

The icon and the splash screen are generated from `scripts/somaco-logo.png` (the mark is cut out of the white background and recoloured in the brand turquoise) and laid out in all sizes by `@capacitor/assets`:

| File | Purpose |
|---|---|
| `AppIcon-512@2x.png` in `AppIcon.appiconset` (1024 × 1024, white background, no transparency — an iOS requirement) | light iOS icon |
| `AppIcon-Dark-512@2x.png`, `AppIcon-Tinted-512@2x.png` | dark and tinted iOS 18+ icons |
| `mipmap-*/ic_launcher*.png` | regular and adaptive Android icon |
| `mipmap-*/ic_launcher_monochrome.png`, `values-night/ic_launcher_background.xml` | Android 13+ themed icon, dark icon background |
| `Splash.imageset`, `mipmap-*/splash_icon.png`, `drawable*/splash.png` | splash screen: iOS, Android 12+, Android before 12 |

```bash
python3 -m venv .venv && .venv/bin/pip install pillow   # once
.venv/bin/python scripts/generate-app-icon.py
```

Screenshots for the README (Google Chrome on macOS; another browser is set with `CHROME`, for example Chromium on Linux):

```bash
npm run build && node scripts/screenshots/capture.mjs
CHROME=/usr/bin/chromium node scripts/screenshots/capture.mjs
```

An empty log for tests is rebuilt from the real one:

```bash
npx tsx --tsconfig tsconfig.app.json scripts/lab-table/make-template.ts "Probe otel.xlsx" "tests/fixtures/Probe otel.xlsx"
```

## Logs and debugging

| What | Command |
|---|---|
| Upload engine, Android | `adb logcat -s UploadEngine UploadWork UploadNotification` |
| Upload engine, iOS | Console.app, process App, filter `[UploadEngine]` |
| App log, iOS simulator | `xcrun simctl launch --console-pty <udid> com.somascan.app` |
| Screenshot or video, iOS simulator | `xcrun simctl io <udid> screenshot` / `recordVideo` |

The production build removes `console` calls; logs require a development build: `vite build --mode development`. In a development build the stores are available in the browser console as `window.__somascan`. On Android 13+ the notification permission is requested when sending (once per launch); without it the upload works, but the notification is hidden. The engine keeps the queue in `files/upload-engine/` (Android) and `Application Support/upload-engine/` (iOS). Testing without a phone: `npm test` runs the built engine in a bare JS context with a fake host (`tests/engine.test.ts`).
