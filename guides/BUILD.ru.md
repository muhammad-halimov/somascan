[English](BUILD.md) · **Русский**

# Сборка и настройка

Полное руководство: от клонирования репозитория и получения всех ключей до релизных сборок для Android и iOS. Краткая версия — в [README](../README.ru.md#сборка).

## Оглавление

- [Требования](#требования)
- [Клонирование и первый запуск](#клонирование-и-первый-запуск)
- [Android SDK с нуля (macOS)](#android-sdk-с-нуля-macos)
- [Ключ подписи](#ключ-подписи)
- [Отладочный APK](#отладочный-apk)
- [iOS](#ios)
- [Релизные сборки](#релизные-сборки)
- [Распознавание: API-ключи и LM Studio](#распознавание-api-ключи-и-lm-studio)
- [Сетевой диск](#сетевой-диск)
- [Google Drive: OAuth-клиенты](#google-drive-oauth-клиенты)
- [Firebase Firestore](#firebase-firestore)
- [Иконка, сплэш-экран и скриншоты](#иконка-сплэш-экран-и-скриншоты)
- [Логи и отладка](#логи-и-отладка)

## Требования

| Инструмент | Версия | Для чего |
|---|---|---|
| Node.js | 22+ | всё |
| JDK | 21 | Android |
| Android SDK | платформа 36, build-tools 35 | Android |
| Xcode | 26+ (только macOS) | iOS |
| Apple Developer Program | платный аккаунт | iOS на устройствах, TestFlight, App Store |
| Аккаунт Google | — | Google Cloud (Drive), Firebase, Gemini |
| Docker | необязательно | локальный SMB-сервер для проверок |

## Клонирование и первый запуск

```bash
git clone https://github.com/muhammad-halimov/somascan.git
cd somascan
npm install
npm run dev        # веб-версия, http://localhost:5173
npm test           # все проверки
```

Ветки: `main` — мобильное приложение Somascan; `desktop` — программа для компьютера Somasync (свой README). App ID: `com.somascan.app` (`capacitor.config.ts`).

Файлы, которых **нет в git** и которые создаются на каждой машине:

| Файл | Содержание | Как получить |
|---|---|---|
| `android/local.properties` | путь к Android SDK (в `.gitignore`) | [шаг 6](#android-sdk-с-нуля-macos) |
| `android/keystore/somascan.jks` | ключ подписи (в `android/.gitignore`) | копия ключа проекта или новый, см. [Ключ подписи](#ключ-подписи) |
| `android/keystore.properties` | пароли ключа | там же |

| Команда | Назначение |
|---|---|
| `npm run dev` | dev-сервер Vite |
| `npm run build` | `tsc -b` + `vite build` (страница) + сборка движка очереди (`vite.engine.config.ts`) → `dist/upload-engine.js` |
| `npm test` | все проверки (`node:test` + `tsx`) |
| `npm run preview` | локальный просмотр продакшен-сборки |
| `npm run lint` | линтер (oxlint) |
| `npm run cap:sync` | веб-сборка + `cap sync` во все платформы |
| `npm run cap:android` | сборка, синхронизация и открытие проекта в Android Studio |
| `npm run cap:ios` | сборка, синхронизация и открытие проекта в Xcode (macOS) |
| `npm run cap:run:android` | сборка + запуск на эмуляторе или устройстве Android |
| `npm run cap:run:ios` | сборка + запуск на симуляторе iOS |

После любого изменения веб-кода выполняется `npm run build && npx cap sync` (все скрипты `cap:*` делают это сами).

## Android SDK с нуля (macOS)

На Windows и Linux шаги те же, путь к SDK — из Android Studio (SDK Manager); установка Android Studio устанавливает и SDK.

**1. Инструменты командной строки**

```bash
brew install --cask android-commandlinetools
```

SDK устанавливается в `/opt/homebrew/share/android-commandlinetools`.

**2. Переменные окружения** (в `~/.zshrc`, однократно; затем `source ~/.zshrc`)

```bash
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

**3. Лицензии**

```bash
yes | sdkmanager --licenses --sdk_root="$ANDROID_HOME"
```

**4. Пакеты**

```bash
sdkmanager --sdk_root="$ANDROID_HOME" \
  "platform-tools" \
  "platforms;android-36" \
  "build-tools;35.0.0" \
  "emulator" \
  "system-images;android-35;google_apis;arm64-v8a"
```

`arm64-v8a` — для Apple Silicon; для Intel и Windows нужен `x86_64`. Эмулятор занимает около 1,2 ГБ, образ — около 3,8 ГБ. Проект собирается под Android 16 (`compileSdk` / `targetSdk` 36, `minSdk` 24, `android/variables.gradle`). В образе Android 15 нет полосы из отрезков и Live Update в уведомлении о выгрузке; для них нужен `system-images;android-36;…`.

**5. Эмулятор (AVD)**

```bash
avdmanager create avd -n somascan_pixel7 -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_7 --force
```

**6. `local.properties`**

```bash
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
```

**7. Запуск эмулятора**

```bash
emulator -avd somascan_pixel7 &
adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
```

**8. Сборка и запуск**

```bash
npm run cap:run:android
npx cap run android --target emulator-5554           # конкретное устройство (id из `adb devices`)
adb shell am start -n com.somascan.app/.MainActivity  # вернуть приложение на передний план
```

## Ключ подписи

Отладочная и релизная сборки подписываются одним ключом проекта, поэтому SHA-1 у всех сборок один и достаточно одного OAuth-клиента Android. `android/app/build.gradle` берёт ключ из `android/keystore.properties`; без этого файла отладочная сборка подписывается ключом машины `~/.android/debug.keystore`, а релизная остаётся неподписанной.

**Вариант 1 — существующий ключ проекта.** `android/keystore/somascan.jks` и `android/keystore.properties` получаются у владельца проекта и копируются по тем же путям. SHA-1 ключа:

```
AA:67:2E:F2:C4:DB:4C:CD:2A:EB:78:15:64:C5:C6:2A:FD:88:87:88
```

**Вариант 2 — новый ключ** (форк или отдельная установка). Приложения, подписанные другим ключом, им не обновляются, а для Google Drive нужен новый OAuth-клиент Android с новым SHA-1.

```bash
mkdir -p android/keystore
keytool -genkeypair -v -keystore android/keystore/somascan.jks -alias somascan \
  -keyalg RSA -keysize 2048 -validity 10000
```

`android/keystore.properties` (путь — относительно `android/`):

```properties
storeFile=keystore/somascan.jks
storePassword=<пароль хранилища>
keyAlias=somascan
keyPassword=<пароль ключа>
```

SHA-1 ключа:

```bash
keytool -list -v -keystore android/keystore/somascan.jks -alias somascan | grep SHA1
cd android && ./gradlew signingReport
apksigner verify --print-certs app/build/outputs/apk/debug/app-debug.apk
```

Оба файла хранятся с резервной копией вне репозитория: с утраченным ключом установленное приложение не обновить.

## Отладочный APK

```bash
npm run build && npx cap sync android && cd android && ./gradlew assembleDebug && cd ..
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**Установка по Wi-Fi.** На телефоне: «Для разработчиков → Отладка по Wi-Fi».

```bash
adb connect 192.168.1.1:5555      # IP:порт устройства
adb devices -l                    # устройство должно быть в списке
adb -s 192.168.1.1:5555 install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Сборку с одним ключом нельзя установить поверх сборки с другим ключом: сначала приложение удаляется с устройства вместе с данными (настройки, API-ключи, очередь).

## iOS

Проект `ios/` уже в репозитории (цель приложения, расширение `UploadActivity`, локальные плагины); `npx cap add ios` не требуется. Зависимости — через Swift Package Manager (`CapApp-SPM`, AMSMB2, GoogleSignIn); CocoaPods не используется. Минимальная версия — iOS 16.2; требуется Xcode 26+ (Swift 6.2, фоновая задача iOS 26 в `UploadBackground.swift`).

```bash
npm run cap:ios          # сборка, синхронизация и открытие проекта в Xcode, затем Run
npm run cap:run:ios      # сборка и запуск на симуляторе
```

**Команда подписи.** В проекте указана команда `PD62HNY4L2`. С другим аккаунтом Apple: Xcode → цель `App` и цель `UploadActivity` → Signing & Capabilities → Team. Если bundle ID `com.somascan.app` и `com.somascan.app.UploadActivity` зарегистрированы за другой командой, оба меняются на свои (например, `com.example.somascan` и `com.example.somascan.UploadActivity`), и OAuth-клиент iOS создаётся для нового bundle ID.

**Не находится `simctl`.** `npx cap run ios` сообщает:

```
Unable to retrieve simulator list: xcrun: error: unable to find utility "simctl", not a developer tool or in PATH
```

`xcode-select` указывает на Command Line Tools, а не на Xcode.app. Исправление (нужен пароль) и проверка:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
xcodebuild -version
xcrun simctl list devices available
```

**Xcode 27: `cap run ios` завершается ошибкой на Simulator.app.** Сборка проходит, но в конце:

```
[error] ERR_UNKNOWN: There was an error opening simulator: The file
        /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app does not exist.
```

В Xcode 27 `Simulator.app` больше не лежит по старому пути, и `native-run` падает на вспомогательном шаге; сам симулятор и `xcrun simctl` работают. Проект запускается из Xcode (`npm run cap:ios`, затем Run) или собирается `xcodebuild` и устанавливается через `xcrun simctl install` / `xcrun simctl launch`.

**`Mach error -308 (server died)`** — остановился CoreSimulator: `xcrun simctl shutdown all`, затем повтор; на слабых ноутбуках запускается только один симулятор.

**Расширение Live Activity.** Цель `UploadActivity` в `App.xcodeproj` (`ios/App/UploadActivity/`, встраивается фазой «Embed Foundation Extensions»); общая модель `App/UploadActivityAttributes.swift` входит в обе цели; в `Info.plist` приложения — `NSSupportsLiveActivities`.

## Релизные сборки

**Версия.** Одна версия на всё приложение, меняется в трёх местах одновременно:

| Где | Поле |
|---|---|
| `package.json` | `version` (показывается в «Расширенные → О приложении») |
| `android/app/build.gradle` | `versionName` и `versionCode` (+1 на каждый выпуск) |
| Xcode, цели `App` и `UploadActivity` | `MARKETING_VERSION` и `CURRENT_PROJECT_VERSION` |

**Android.** Нужен [ключ подписи](#ключ-подписи).

```bash
npm run build && npx cap sync android
cd android
./gradlew assembleRelease     # APK: app/build/outputs/apk/release/app-release.apk
./gradlew bundleRelease       # AAB для Google Play: app/build/outputs/bundle/release/app-release.aab
cd ..
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

При Google Play App Signing Google переподписывает приложение своим ключом: для его SHA-1 (Play Console → Test and release → App integrity) нужен ещё один OAuth-клиент Android.

**iOS.**

```bash
npm run build && npx cap sync ios
npm run cap:ios
```

В Xcode: устройство «Any iOS Device (arm64)» → Product → Archive → Distribute App → App Store Connect (TestFlight, App Store), Ad Hoc или Development. Для распространения нужен платный аккаунт Apple Developer Program.

## Распознавание: API-ключи и LM Studio

Распознавание **на устройстве** (по умолчанию) настройки не требует. Для ИИ-моделей ключ получается у провайдера и вводится в приложении.

| Провайдер | Где получить ключ | Куда ввести |
|---|---|---|
| Gemini | [Google AI Studio → API keys](https://aistudio.google.com/apikey) → Create API key | «Настройки → Основные → Распознавание → ИИ-модели → Google → API-ключ» |
| Claude | [Claude Console → Settings → API keys](https://platform.claude.com/settings/keys) → Create Key (начинается с `sk-ant-`) | там же, провайдер Anthropic |
| OpenAI | [OpenAI Platform → API keys](https://platform.openai.com/api-keys) → Create new secret key | там же, провайдер OpenAI |
| LM Studio | не нужен | там же, провайдер LM Studio |

- Вкладка «ИИ-модели» закрыта замком: первое нажатие открывает замок, второе выбирает её. Фото после этого отправляются провайдеру.
- Ключ не входит в сборку: в проекте нет файлов `.env`, так как всё, что подставлено при сборке, читается из APK / IPA.
- Без ключа список показывает предпросмотр моделей из [models.dev](https://models.dev); модель выбирается после ввода ключа.

**LM Studio** (сервер в сети завода, данные не покидают сеть):

1. Установить [LM Studio](https://lmstudio.ai) версии 0.4 или новее на компьютер в сети завода (приложение использует его REST API `/api/v0/models`, `/api/v1/models/load`, `/api/v1/models/unload`).
2. Скачать модель, которая читает изображения (тип `vlm`).
3. Запустить сервер в разделе Developer с доступом из локальной сети (Serve on Local Network); порт по умолчанию — 1234.
4. В приложении: провайдер LM Studio, адрес сервера в коротком виде (`192.168.1.14` дополняется до `http://192.168.1.14:1234/v1`).

Сервер общий для всех телефонов и держит в памяти одну модель, поэтому телефоны отмечаются в хранилище таблицы: папка `somascan-lmstudio` рядом с таблицей на сетевом диске (`<id устройства>.json`), файлы `somascan-lmstudio-<id устройства>` в папке Google Drive. Отметка истекает через минуту; без настроенного хранилища телефоны работают без общей очереди.

Запросы к LM Studio идут через нативный плагин `NativeHttp`, поэтому CORS и блокировка `http://` в WebView не мешают. Для облачных провайдеров или прокси с включённым CORS должны быть разрешены источники приложения: `capacitor://localhost` (iOS) и `https://localhost` (Android); иначе запросы молча завершаются ошибкой (`didFailResourceLoad` в логе WebKit).

## Сетевой диск

«Настройки → Хранилище → Сетевой диск»:

| Поле | Пример |
|---|---|
| Сервер | `10.0.0.5` или `10.0.0.5:445` |
| Общая папка | `Atelier` |
| Путь к таблице | `Probe si Sarje Otel\Probe otel.xlsx` — к существующему журналу |
| Домен | необязательно |
| Пользователь, пароль | учётная запись с правом записи в папку |

Таблица приложением не создаётся. Её наличие проверяется значком в конце поля пути или кнопкой «Проверить подключение».

**Локальный сервер для проверок** (Samba в Docker, `scripts/smb-test-server/`):

```bash
cd scripts/smb-test-server
mkdir -p share
docker run -d --name somascan-smb -p 1445:445 \
  -e NAME=Warehouse -e USER=scanner -e PASS=scanner123 \
  -v "$PWD/share:/storage" \
  -v "$PWD/smb.conf:/etc/samba/smb.conf:ro" \
  dockurr/samba
```

В приложении: сервер `10.0.2.2:1445` (эмулятор Android) или `127.0.0.1:1445` (симулятор iOS), папка `Warehouse`, пользователь `scanner`, пароль `scanner123`. В `share` помещается копия журнала или пустой журнал `tests/fixtures/Probe otel.xlsx`.

## Google Drive: OAuth-клиенты

Для Google Drive API-ключ не нужен: приложение выполняет вход через Google (Android — Google Identity `AuthorizationClient`, iOS — Google Sign-In SDK; плагин `GoogleDriveAuth`), а доступ выдаётся OAuth-клиентам проекта Google Cloud — одному для Android и одному для iOS.

**1. Проект и API.** [Google Cloud Console](https://console.cloud.google.com/) → выбор проекта → New project. Затем APIs & Services → Library → **Google Drive API** → Enable.

**2. Экран согласия** (Google Auth Platform, ранее «OAuth consent screen»):

- Branding: название приложения (Somascan), почта поддержки.
- Audience: **Internal** для аккаунтов Google Workspace компании (без проверки Google) или **External**; для External в режиме «Testing» аккаунты склада добавляются в Test users.
- Data access → Add or remove scopes → `https://www.googleapis.com/auth/drive`. Приложению нужен доступ к уже существующей папке; `drive.file` охватывает только файлы, созданные самим приложением.

**3. Клиент Android.** Google Auth Platform → Clients → Create client (или APIs & Services → Credentials → Create credentials → OAuth client ID):

- Application type: **Android**;
- Package name: `com.somascan.app`;
- SHA-1: SHA-1 [ключа подписи](#ключ-подписи).

В проект ничего копировать не нужно: Google узнаёт приложение по имени пакета и подписи. Сборке с другим ключом (debug-ключ машины, Google Play App Signing) нужен свой клиент Android с её SHA-1.

**4. Клиент iOS.** Там же, Create client:

- Application type: **iOS**;
- Bundle ID: `com.somascan.app` (или свой bundle ID, см. [iOS](#ios)).

После создания консоль показывает **Client ID** (`…apps.googleusercontent.com`) и **iOS URL scheme** (перевёрнутый Client ID, `com.googleusercontent.apps.…`; в скачиваемом `.plist` клиента — `REVERSED_CLIENT_ID`). Оба значения указываются в `ios/App/App/Info.plist`:

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

В репозитории уже указан клиент проекта `697326360300`; для другого проекта оба значения заменяются. При пустом `GIDClientID` вход сообщает, что вход через Google в этой сборке не настроен. `CFBundleName` («Somascan») — имя, которое iOS показывает в запросе «… хочет использовать „accounts.google.com“ для входа».

**5. В приложении:** «Настройки → Хранилище → Google Drive → Войти через Google», затем ссылка на папку из адресной строки Drive (или её ID; пусто — корень «Моего диска») и имя таблицы. Таблица должна уже находиться в папке; папка `backups` создаётся при первой записи.

Проверка без сети и аккаунта: `npm test` выполняет запись через поддельный Drive API (`tests/fakeDrive.ts`).

Программа Somasync использует отдельный клиент типа **Desktop app** в том же проекте: см. README ветки `desktop`.

## Firebase Firestore

Необязательно. Используется, когда журнал находится на сетевом диске, а телефоны пишут в его копию в Google Drive: бирки переносит Somasync, а Firestore уведомляет её сразу после записи вместо проверки раз в 15 с. Firestore хранит только время последнего уведомления. Файлы `google-services.json` и `GoogleService-Info.plist` не нужны: приложение обращается к REST API по ID проекта и Web API key.

1. [Консоль Firebase](https://console.firebase.google.com/) → Create a project → выбрать существующий проект Google Cloud (с OAuth-клиентами) или создать новый. Google Analytics не требуется.
2. Build → Firestore Database → Create database → редакция Standard, расположение рядом с заводом (например, `europe-west3`), production mode.
3. Firestore Database → Rules → заменить правилами ниже → Publish:

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

4. Project settings (значок шестерёнки) → General: **Project ID**. **Web API key** появляется там же после добавления веб-приложения: Your apps → Add app → Web (`</>`) → любое имя, без Firebase Hosting. Web API key не является секретом: доступ задают правила.
5. На телефонах: «Настройки → Хранилище → Google Drive → Firebase Firestore» (под замком) — «Уведомление Somasync», «ID проекта Firebase», «Ключ Web API». В Somasync: «Хранилище → Телефоны → Уведомления Firebase Firestore» с теми же значениями.

Бесплатной квоты Firestore (50 000 чтений и 20 000 записей в день) достаточно с запасом.

## Иконка, сплэш-экран и скриншоты

Иконка и сплэш-экран создаются из `scripts/somaco-logo.png` (знак вырезается из белого фона и перекрашивается в фирменный бирюзовый) и раскладываются во все размеры через `@capacitor/assets`:

| Файл | Назначение |
|---|---|
| `AppIcon-512@2x.png` в `AppIcon.appiconset` (1024 × 1024, белый фон, без прозрачности — требование iOS) | светлая иконка iOS |
| `AppIcon-Dark-512@2x.png`, `AppIcon-Tinted-512@2x.png` | тёмная и тонированная иконки iOS 18+ |
| `mipmap-*/ic_launcher*.png` | обычная и адаптивная иконка Android |
| `mipmap-*/ic_launcher_monochrome.png`, `values-night/ic_launcher_background.xml` | тематическая иконка Android 13+, тёмный фон иконки |
| `Splash.imageset`, `mipmap-*/splash_icon.png`, `drawable*/splash.png` | сплэш-экран: iOS, Android 12+, Android до 12 |

```bash
python3 -m venv .venv && .venv/bin/pip install pillow   # однократно
.venv/bin/python scripts/generate-app-icon.py
```

Скриншоты для README (Google Chrome на macOS; другой браузер задаётся `CHROME`, например Chromium на Linux):

```bash
npm run build && node scripts/screenshots/capture.mjs
CHROME=/usr/bin/chromium node scripts/screenshots/capture.mjs
```

Пустой журнал для тестов пересобирается из настоящего:

```bash
npx tsx --tsconfig tsconfig.app.json scripts/lab-table/make-template.ts "Probe otel.xlsx" "tests/fixtures/Probe otel.xlsx"
```

## Логи и отладка

| Что | Команда |
|---|---|
| Движок выгрузки, Android | `adb logcat -s UploadEngine UploadWork UploadNotification` |
| Движок выгрузки, iOS | Console.app, процесс App, фильтр `[UploadEngine]` |
| Лог приложения, симулятор iOS | `xcrun simctl launch --console-pty <udid> com.somascan.app` |
| Снимок или видео, симулятор iOS | `xcrun simctl io <udid> screenshot` / `recordVideo` |

Продакшен-сборка удаляет вызовы `console`; для логов нужна сборка для разработки: `vite build --mode development`. В сборке для разработки хранилища доступны в консоли браузера как `window.__somascan`. На Android 13+ разрешение на уведомления запрашивается при отправке (один раз за запуск); без него выгрузка работает, но уведомление не показывается. Движок хранит очередь в `files/upload-engine/` (Android) и `Application Support/upload-engine/` (iOS). Проверка без телефона: `npm test` запускает собранный движок в «голом» JS-контексте с поддельным хостом (`tests/engine.test.ts`).
