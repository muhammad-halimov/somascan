**English** · [Русский](BUILD.ru.md)

# Building and setup

A complete guide: from installing the tools to a signed APK, an iOS build and connecting recognition and storage. A short version is in the [README](../README.md#building).

## Contents

- [Requirements](#requirements)
- [Web part](#web-part)
- [Android SDK from scratch (macOS)](#android-sdk-from-scratch-macos)
- [APK](#apk)
- [Signing](#signing)
- [iOS](#ios)
- [Recognition: API keys and LM Studio](#recognition-api-keys-and-lm-studio)
- [Network drive](#network-drive)
- [Google Drive](#google-drive)
- [Firebase Firestore](#firebase-firestore)
- [Icon, splash screen and screenshots](#icon-splash-screen-and-screenshots)

## Requirements

| Tool | Version |
|---|---|
| Node.js | 22+ |
| JDK | 21 |
| Android SDK | platform 36, build-tools 35 |
| Xcode (iOS, macOS only) | 26+ |
| Docker (optional) | for the local SMB server |

## Web part

```bash
npm install
npm run dev        # web version, http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b` + `vite build` (page) + queue engine build → `dist/upload-engine.js` |
| `npm test` | all checks (`node:test` + `tsx`) |
| `npm run preview` | local preview of the production build |
| `npm run lint` | linter (oxlint) |
| `npm run cap:sync` | web build + `cap sync` to all platforms |
| `npm run cap:android` | build, sync and open the project in Android Studio |
| `npm run cap:ios` | build, sync and open the project in Xcode (macOS) |
| `npm run cap:run:android` | build + run on an Android emulator or device |
| `npm run cap:run:ios` | build + run on the iOS simulator |

After any change to the web code, `npm run build && npx cap sync` is required (all `cap:*` scripts do this themselves). App ID: `com.somascan.app` (`capacitor.config.ts`).

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

**6. `local.properties`** (in `.gitignore`: the SDK path differs between machines)

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

## APK

```bash
npm run build && npx cap sync android && cd android && ./gradlew assembleDebug && cd ..
```

File: `android/app/build/outputs/apk/debug/app-debug.apk`.

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**Installing over Wi-Fi.** On the phone: Developer options → Wireless debugging.

```bash
adb connect 192.168.1.1:5555      # device IP:port
adb devices -l                    # the device must be listed
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
adb -s 192.168.1.1:5555 install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Signing

The app is signed with the shared project key, not with the machine's debug key:

| File | Contents |
|---|---|
| `android/keystore/somascan.jks` | key, alias `somascan` |
| `android/keystore.properties` | passwords |

Both files are **not in git** (`android/.gitignore`). They are copied to another machine manually, and a backup copy is required: with a lost key the installed app cannot be updated, and Google Drive requires a new OAuth client. `app/build.gradle` signs both `assembleDebug` and `assembleRelease` with this key; without `keystore.properties` the debug build is signed with `~/.android/debug.keystore`.

Key SHA-1 (for the Android OAuth client):

```
AA:67:2E:F2:C4:DB:4C:CD:2A:EB:78:15:64:C5:C6:2A:FD:88:87:88
```

Check:

```bash
cd android && ./gradlew signingReport
apksigner verify --print-certs app/build/outputs/apk/debug/app-debug.apk
```

A build with this key cannot be installed over a build signed with another key: the app is removed from the device first, together with its data (settings, API keys, queue).

## iOS

The `ios/` project is in the repository (the app target, the `UploadActivity` extension, local plugins); `npx cap add ios` is not required.

```bash
npm run cap:ios          # build, sync and open the project in Xcode, then Run
npm run cap:run:ios      # build and run on the simulator
```

Xcode 26+ is required (Swift 6.2: the iOS 26 background task, `UploadBackground.swift`). Dependencies come from Swift Package Manager (`CapApp-SPM`, AMSMB2, GoogleSignIn); CocoaPods is not used. Minimum iOS 16.2.

**Live Activity.** The `UploadActivity` extension (bundle ID `com.somascan.app.UploadActivity`) is signed with the same team as the app: Signing & Capabilities of the `UploadActivity` target.

**`simctl` is not found** (`unable to find utility "simctl"`): `xcode-select` points to the Command Line Tools instead of Xcode.

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
xcodebuild -version
xcrun simctl list devices available
```

**Xcode 27: `cap run ios` fails on Simulator.app** (`Simulator.app does not exist`). The build succeeds, but `native-run` looks for `Simulator.app` at the old path. The project is run from Xcode (`npm run cap:ios`, then Run) or built with `xcodebuild` and installed with `xcrun simctl install` / `xcrun simctl launch`.

**`Mach error -308 (server died)`** — CoreSimulator has stopped:

```bash
xcrun simctl shutdown all
```

## Recognition: API keys and LM Studio

- **On-device** (default) requires no setup.
- **Gemini, Claude, OpenAI.** The API key is entered in the app: “Settings → General → Recognition → AI models” (the lock opens on the first tap), provider, “API key” field. The key is not part of the build: the project has no `.env` files, since everything substituted at build time can be read from the APK / IPA. Without a key the list shows a preview of models from [models.dev](https://models.dev); a model is selected after the key is entered.
- **LM Studio.** The server runs in the plant network with an OpenAI-compatible API. In the app: provider LM Studio, server address in short form (`192.168.1.14`; the `http://` scheme and port 1234 are added automatically). Models of type `vlm` are listed; selecting a model loads it into LM Studio. Requests go through the native `NativeHttp` plugin, so CORS and the WebView block of `http://` do not apply.

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

## Google Drive

**Google Cloud (once):**

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project and enable **Google Drive API**.
2. OAuth consent screen: type **Internal** for the company's Google Workspace accounts (no Google verification) or **External** with test users. Scope — `https://www.googleapis.com/auth/drive`: the app needs access to an existing folder, while `drive.file` covers only files created by the app.
3. **Android OAuth client:** package `com.somascan.app` and the SHA-1 of the project key (see [Signing](#signing)). Debug and release are signed with this key, so one client is sufficient. A build signed with a machine's debug key requires its own client; Google Play requires one more client for the Play App Signing key.
4. **iOS OAuth client:** bundle ID `com.somascan.app`. The client ID goes to `ios/App/App/Info.plist` → `GIDClientID`; the reversed ID goes to the same file in `CFBundleURLTypes` → `CFBundleURLSchemes` (`697326360300-xxxx.apps.googleusercontent.com` → `com.googleusercontent.apps.697326360300-xxxx`; in the console — the client's “iOS URL scheme”). With an empty `GIDClientID` sign-in reports that Google sign-in is not configured in this build.
5. **Test users.** While an External consent screen is in “Testing” mode, only accounts from the Test users list can sign in; the warehouse accounts are added there.

**In the app:** “Settings → Storage → Google Drive → Sign in with Google”, then a folder link from the Drive address bar (or its ID; empty — the root of “My Drive”) and the table name. The table must already be in the folder; the `backups` folder is created on the first write.

## Firebase Firestore

Optional. It is used when the log is on a network drive and the phones write into a copy of it in Google Drive: the desktop app Somasync transfers the tags, and Firestore notifies it immediately after a write instead of a check every 15 s. Firestore stores only the time of the last notification.

1. In the [Firebase console](https://console.firebase.google.com/) add Firebase to the Google Cloud project or create a new one.
2. Firestore Database → create a database (Standard) and set the rules:

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

3. “Project settings” → project ID and Web API key (if there is no key, a web app is added to the project). The Web API key is not a secret: access is defined by the rules.
4. On the phones: “Settings → Storage → Google Drive → Firebase Firestore” (behind a lock) — “Somasync notification”, “Firebase project ID”, “Web API key”. In Somasync: “Storage → Phones → Firebase Firestore notifications”.

## Icon, splash screen and screenshots

The icon and the splash screen are generated from `scripts/somaco-logo.png` in all sizes and theme variants:

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
