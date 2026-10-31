[English](BUILD.md) · **Русский**

# Сборка и настройка

Полное руководство: от установки инструментов до подписанного APK, сборки iOS и подключения распознавания и хранилищ. Краткая версия — в [README](../README.ru.md#сборка).

## Оглавление

- [Требования](#требования)
- [Веб-часть](#веб-часть)
- [Android SDK с нуля (macOS)](#android-sdk-с-нуля-macos)
- [APK](#apk)
- [Подпись](#подпись)
- [iOS](#ios)
- [Распознавание: API-ключи и LM Studio](#распознавание-api-ключи-и-lm-studio)
- [Сетевой диск](#сетевой-диск)
- [Google Drive](#google-drive)
- [Firebase Firestore](#firebase-firestore)
- [Иконка, сплэш-экран и скриншоты](#иконка-сплэш-экран-и-скриншоты)
- [Логи и отладка](#логи-и-отладка)

## Требования

| Инструмент | Версия |
|---|---|
| Node.js | 22+ |
| JDK | 21 |
| Android SDK | платформа 36, build-tools 35 |
| Xcode (iOS, только macOS) | 26+ |
| Docker (необязательно) | для локального SMB-сервера |

## Веб-часть

```bash
npm install
npm run dev        # веб-версия, http://localhost:5173
```

| Команда | Назначение |
|---|---|
| `npm run dev` | dev-сервер Vite |
| `npm run build` | `tsc -b` + `vite build` (страница) + сборка движка очереди → `dist/upload-engine.js` |
| `npm test` | все проверки (`node:test` + `tsx`) |
| `npm run preview` | локальный просмотр продакшен-сборки |
| `npm run lint` | линтер (oxlint) |
| `npm run cap:sync` | веб-сборка + `cap sync` во все платформы |
| `npm run cap:android` | сборка, синхронизация и открытие проекта в Android Studio |
| `npm run cap:ios` | сборка, синхронизация и открытие проекта в Xcode (macOS) |
| `npm run cap:run:android` | сборка + запуск на эмуляторе или устройстве Android |
| `npm run cap:run:ios` | сборка + запуск на симуляторе iOS |

После любого изменения веб-кода выполняется `npm run build && npx cap sync` (все скрипты `cap:*` делают это сами). App ID: `com.somascan.app` (`capacitor.config.ts`).

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

**6. `local.properties`** (в `.gitignore`: путь к SDK на каждой машине свой)

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

## APK

```bash
npm run build && npx cap sync android && cd android && ./gradlew assembleDebug && cd ..
```

Файл: `android/app/build/outputs/apk/debug/app-debug.apk`.

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**Установка по Wi-Fi.** На телефоне: «Для разработчиков → Отладка по Wi-Fi».

```bash
adb connect 192.168.1.1:5555      # IP:порт устройства
adb devices -l                    # устройство должно быть в списке
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
adb -s 192.168.1.1:5555 install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Подпись

Приложение подписывается общим ключом проекта, а не debug-ключом машины:

| Файл | Содержание |
|---|---|
| `android/keystore/somascan.jks` | ключ, alias `somascan` |
| `android/keystore.properties` | пароли |

Оба файла **не входят в git** (`android/.gitignore`). Они переносятся на другую машину вручную, резервная копия обязательна: с утраченным ключом установленное приложение не обновить, а для Google Drive потребуется новый OAuth-клиент. `app/build.gradle` подписывает этим ключом и `assembleDebug`, и `assembleRelease`; без `keystore.properties` debug подписывается `~/.android/debug.keystore`.

SHA-1 ключа (для OAuth-клиента Android):

```
AA:67:2E:F2:C4:DB:4C:CD:2A:EB:78:15:64:C5:C6:2A:FD:88:87:88
```

Проверка:

```bash
cd android && ./gradlew signingReport
apksigner verify --print-certs app/build/outputs/apk/debug/app-debug.apk
```

Сборку с этим ключом нельзя установить поверх сборки с другим ключом: сначала приложение удаляется с устройства вместе с данными (настройки, API-ключи, очередь).

## iOS

Проект `ios/` уже в репозитории (цель приложения, расширение `UploadActivity`, локальные плагины); `npx cap add ios` не требуется.

```bash
npm run cap:ios          # сборка, синхронизация и открытие проекта в Xcode, затем Run
npm run cap:run:ios      # сборка и запуск на симуляторе
```

Требуется Xcode 26+ (Swift 6.2: фоновая задача iOS 26, `UploadBackground.swift`). Зависимости — через Swift Package Manager (`CapApp-SPM`, AMSMB2, GoogleSignIn); CocoaPods не используется. Минимальная версия — iOS 16.2.

**Live Activity.** Расширение `UploadActivity` (bundle ID `com.somascan.app.UploadActivity`) подписывается той же командой, что и приложение: Signing & Capabilities цели `UploadActivity`.

**Не находится `simctl`** (`unable to find utility "simctl"`): `xcode-select` указывает на Command Line Tools, а не на Xcode.

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
xcodebuild -version
xcrun simctl list devices available
```

**Xcode 27: `cap run ios` завершается ошибкой на Simulator.app** (`Simulator.app does not exist`). Сборка проходит, но `native-run` ищет `Simulator.app` по старому пути. Проект запускается из Xcode (`npm run cap:ios`, затем Run) или собирается `xcodebuild` и устанавливается через `xcrun simctl install` / `xcrun simctl launch`.

**`Mach error -308 (server died)`** — остановился CoreSimulator:

```bash
xcrun simctl shutdown all
```

## Распознавание: API-ключи и LM Studio

Распознавание **на устройстве** (по умолчанию) настройки не требует. Для ИИ-моделей ключ получается у провайдера и вводится в приложении.

| Провайдер | Где получить ключ | Куда ввести |
|---|---|---|
| Gemini | [Google AI Studio → API keys](https://aistudio.google.com/apikey) | «Настройки → Основные → Распознавание → ИИ-модели → Google → API-ключ» |
| Claude | [Claude Console → Settings → API keys](https://platform.claude.com/settings/keys) (ключ начинается с `sk-ant-`) | там же, провайдер Anthropic |
| OpenAI | [OpenAI Platform → API keys](https://platform.openai.com/api-keys) | там же, провайдер OpenAI |
| LM Studio | ключ не нужен (необязательно, если сервер его требует) | там же, провайдер LM Studio |

- Вкладка «ИИ-модели» закрыта замком: первое нажатие открывает замок, второе выбирает её. Фото после этого отправляются провайдеру.
- Ключ не входит в сборку: в проекте нет файлов `.env`, так как всё, что подставлено при сборке, читается из APK / IPA. Ключ показывается значком глаза в поле.
- Без ключа список показывает предпросмотр моделей из [models.dev](https://models.dev); модель выбирается после ввода ключа.

**LM Studio** (сервер в сети завода, данные не покидают сеть):

1. Установить [LM Studio](https://lmstudio.ai) версии 0.4 или новее на компьютер в сети завода (приложение использует его REST API `/api/v0/models`, `/api/v1/models/load`, `/unload`).
2. Скачать модель, которая читает изображения (тип `vlm`).
3. Запустить сервер в разделе Developer с доступом из локальной сети (Serve on Local Network); порт по умолчанию — 1234.
4. В приложении: провайдер LM Studio, адрес сервера в коротком виде (`192.168.1.14`; схема `http://` и порт 1234 добавляются автоматически). В списке моделей загруженная модель отмечена зелёной точкой; выбранная модель загружается в LM Studio.

Запросы к LM Studio идут через нативный плагин `NativeHttp`, поэтому CORS и блокировка `http://` в WebView не мешают. Для облачных провайдеров или прокси с включённым CORS должны быть разрешены источники приложения: `capacitor://localhost` (iOS) и `https://localhost` (Android); иначе запросы молча завершаются ошибкой.

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

## Google Drive

**Google Cloud (однократно):**

1. В [Google Cloud Console](https://console.cloud.google.com/) создать проект и включить **Google Drive API**.
2. Экран согласия OAuth: тип **Internal** для аккаунтов Google Workspace компании (без проверки Google) или **External** с тестовыми пользователями. Доступ — `https://www.googleapis.com/auth/drive`: приложению нужен доступ к уже существующей папке, а `drive.file` охватывает только файлы, созданные самим приложением.
3. **OAuth-клиент Android:** пакет `com.somascan.app` и SHA-1 ключа проекта (см. [Подпись](#подпись)). Debug и release подписаны этим ключом, поэтому достаточно одного клиента. Сборке с debug-ключом машины нужен свой клиент; для Google Play — ещё один клиент для ключа Play App Signing.
4. **OAuth-клиент iOS:** bundle ID `com.somascan.app`. Client ID указывается в `ios/App/App/Info.plist` → `GIDClientID`, перевёрнутый ID — в том же файле в `CFBundleURLTypes` → `CFBundleURLSchemes` (`697326360300-xxxx.apps.googleusercontent.com` → `com.googleusercontent.apps.697326360300-xxxx`; в консоли — поле клиента «iOS URL scheme»). При пустом `GIDClientID` вход сообщает, что вход через Google в этой сборке не настроен. `CFBundleName` («Somascan») — имя, которое iOS показывает в запросе «… хочет использовать „accounts.google.com“ для входа».
5. **Тестовые пользователи.** Пока экран External в режиме «Testing», войти могут только аккаунты из списка Test users; туда добавляются аккаунты склада.

**В приложении:** «Настройки → Хранилище → Google Drive → Войти через Google», затем ссылка на папку из адресной строки Drive (или её ID; пусто — корень «Моего диска») и имя таблицы. Таблица должна уже находиться в папке; папка `backups` создаётся при первой записи.

## Firebase Firestore

Необязательно. Используется, когда журнал находится на сетевом диске, а телефоны пишут в его копию в Google Drive: бирки переносит программа Somasync, а Firestore уведомляет её сразу после записи вместо проверки раз в 15 с. Firestore хранит только время последнего уведомления.

1. В [консоли Firebase](https://console.firebase.google.com/) добавить Firebase в проект Google Cloud или создать новый.
2. Firestore Database → создать базу (Standard) и задать правила:

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

3. «Project settings» → ID проекта и Web API key (если ключа нет, в проект добавляется веб-приложение). Web API key не является секретом: доступ задают правила.
4. На телефонах: «Настройки → Хранилище → Google Drive → Firebase Firestore» (под замком) — «Уведомление Somasync», «ID проекта Firebase», «Ключ Web API». В Somasync: «Хранилище → Телефоны → Уведомления Firebase Firestore».

Бесплатной квоты Firestore (50 000 чтений и 20 000 записей в день) достаточно с запасом.

## Иконка, сплэш-экран и скриншоты

Иконка и сплэш-экран создаются из `scripts/somaco-logo.png` во всех размерах и вариантах тем:

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

Продакшен-сборка удаляет вызовы `console`; для логов нужна сборка для разработки: `vite build --mode development`. В сборке для разработки (`npm run dev`, `vite build --mode development`) хранилища доступны в консоли браузера как `window.__somascan`. На Android 13+ разрешение на уведомления запрашивается при отправке (один раз за запуск); без него выгрузка работает, но уведомление не показывается.
