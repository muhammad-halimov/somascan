# Somascan

Мобильное приложение для **Somaco (Holcim), Румыния** — OCR-сканирование этикеток (накладных) входящих материалов на заводе.

Сотрудник фотографирует этикетку (арматура, катанка в бунтах и т. п.), приложение распознаёт её с помощью ИИ, извлекает поля и дописывает строку в таблицу `.xlsx`. Таблица хранится на сетевом диске Windows либо в Google Drive.

**Стек:** Vite · React 19 · TypeScript · Capacitor 8 (Android / iOS) · oxlint.

---

## Как это работает

```
Фото этикетки ──► OCR / распознавание (Gemini | Claude | LM Studio)
              ──► структурированные поля ──► строка в .xlsx
              ──► хранилище: сетевой диск Windows | Google Drive
```

### Провайдеры распознавания

| Провайдер | Где работает | Примечание |
|---|---|---|
| **Gemini** | облако (Google) | нужен API-ключ |
| **Claude** | облако (Anthropic) | нужен API-ключ |
| **LM Studio** | локально, в сети завода | OpenAI-совместимый локальный сервер, данные не уходят наружу |

### Хранилище таблицы `.xlsx`

- **Сетевой диск Windows** (SMB-шара) — таблица лежит на файловом сервере завода.
- **Google Drive** — таблица в общем каталоге Drive.

### Какие этикетки обрабатываются

Этикетки разных производителей отличаются по формату, языку (EN / RO / HU / EL) и качеству печати. Они часто ржавые, поцарапанные, перекошенные и снимаются под углом, поэтому распознавание должно быть устойчивым к этому. Примеры:

| Производитель | Типичные поля |
|---|---|
| Greek rebar (Sovel) | Date, Time, Size (mm), Weight (Kg), Heat No, Shift No, Code, технич. соглашение (`AT 016-01/…`) |
| Suez Steel Co | P.Date, Heat number, Size, Grade, Standard, Weight (Ton), N. of bars, Work Order, Technical agreement no., Customer, Serial Number |
| OAM Ózdi Acélművek (Hungary) | Charge, Diameter (mm), Weight (kg), Package, Grade, Date, Standard, Technical doc. |
| ArcelorMittal Kryvyi Rih | Contract, Destination, Size, Grade, Standard, Heat (SARJA), Batch / № of coil, Weight, Comparator ref. |

Общие для всех поля, которые попадают в таблицу: **производитель, номер плавки (heat/charge), диаметр, марка стали (напр. B500C), стандарт / технич. соглашение (AT), вес, дата, номер партии/бунта/пачки**. Точный набор колонок будет определён вместе с заказчиком.

> Статус: проект на начальной стадии — сейчас это каркас (React + Capacitor). Сканирование, экспорт в xlsx и интеграции с хранилищами будут добавляться поэтапно.

---

## Быстрый старт

```bash
npm install
npm run dev        # веб-версия, http://localhost:5173
```

| Команда | Что делает |
|---|---|
| `npm run dev` | dev-сервер Vite |
| `npm run build` | `tsc -b` + `vite build` в `dist/` |
| `npm run preview` | локальный просмотр prod-сборки |
| `npm run lint` | линтер (oxlint) |
| `npm run cap:sync` | сборка веба + `cap sync` во все платформы |
| `npm run cap:android` | сборка, sync и открытие проекта в Android Studio |
| `npm run cap:ios` | сборка, sync и открытие проекта в Xcode (macOS) |
| `npm run cap:run:android` | сборка + запуск на эмуляторе/устройстве Android |
| `npm run cap:run:ios` | сборка + запуск на iOS-симуляторе |

После любого изменения веб-кода нужен `npm run build && npx cap sync` (все `cap:*`-скрипты делают это сами).

Идентификатор приложения: `com.somascan.app` (`capacitor.config.ts`).

---

# Мобильная сборка

## Android — установка SDK с нуля (macOS)

### 1. Установить cask

```bash
brew install --cask android-commandlinetools
```

SDK ставится в `/opt/homebrew/share/android-commandlinetools` (только `cmdline-tools`).

### 2. Переменные окружения

В `~/.zshrc` (один раз):

```bash
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

затем `source ~/.zshrc`.

На Windows/Linux — то же самое, но с путём к SDK из Android Studio (`SDK Manager`), либо поставьте Android Studio, и SDK подтянется сам.

### 3. Принять лицензии

```bash
yes | sdkmanager --licenses --sdk_root="$ANDROID_HOME"
```

### 4. Поставить пакеты

```bash
sdkmanager --sdk_root="$ANDROID_HOME" \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0" \
  "emulator" \
  "system-images;android-35;google_apis;arm64-v8a"
```

`arm64-v8a` — для Apple Silicon; на Intel / Windows нужен `x86_64`. Качается долго: эмулятор ~1.2 GB, образ ~3.8 GB.

### 5. Создать AVD

```bash
avdmanager create avd -n somascan_pixel7 -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_7 --force
```

### 6. `local.properties`

Файл `android/local.properties` в `.gitignore` — у каждого свой путь к SDK:

```bash
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
```

### 7. Запустить эмулятор

```bash
emulator -avd somascan_pixel7 &
adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
```

### 8. Собрать и запустить

```bash
npm run cap:run:android
```

Если несколько устройств — выберите нужное (id из `adb devices`):

```bash
npx cap run android --target emulator-5554
```

Если приложение свернулось:

```bash
adb shell am start -n com.somascan.app/.MainActivity
```

> **Камера.** Для сканирования понадобится плагин камеры и разрешение `CAMERA` в `AndroidManifest.xml` / `NSCameraUsageDescription` в `Info.plist` — добавляется вместе с самой функцией сканирования.

## Сборка APK

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
```

Файл: `android/app/build/outputs/apk/debug/app-debug.apk`.

Debug-сборка подписана дефолтным debug-ключом — годится для установки на устройство/эмулятор (`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`), но не для публикации.

### Установка на устройство по Wi-Fi

Телефон: Параметры разработчика → Отладка по Wi-Fi. Затем:

```bash
adb connect 192.168.1.1:5555      # IP:порт устройства
adb devices -l                    # устройство должно быть в списке
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
adb -s 192.168.1.1:5555 install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### Релизная сборка

Для `./gradlew assembleRelease` нужен подписывающий ключ:

```bash
keytool -genkey -v -keystore somascan-release.keystore -alias somascan -keyalg RSA -keysize 2048 -validity 10000
```

и `signingConfigs` в `android/app/build.gradle`, указывающий на keystore. Пароли — через переменные окружения; **keystore в репозиторий не коммитить**.

## iOS (только macOS)

Платформа iOS добавляется один раз на Mac:

```bash
npx cap add ios
npm run cap:ios          # откроет проект в Xcode, дальше Run на симуляторе
# или
npm run cap:run:ios
```

Нужны: Xcode, CocoaPods (или SPM — по умолчанию в Capacitor 8).

### Если `simctl` не находится

Ошибка при `npx cap run ios`:

```
Unable to retrieve simulator list: xcrun: error: unable to find utility "simctl", not a developer tool or in PATH
```

`xcode-select` указывает на Command Line Tools, а не на Xcode.app. Лечится (нужен пароль):

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
```

Проверка:

```bash
xcodebuild -version
xcrun simctl list devices available
```

### Xcode 27: `cap run ios` падает на Simulator.app

Сборка проходит, а в конце:

```
[error] ERR_UNKNOWN: There was an error opening simulator: The file
        /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app does not exist.
```

В Xcode 27 `Simulator.app` по старому пути нет, и `native-run` падает на вспомогательном шаге. Сам симулятор и `xcrun simctl` работают. Обходной путь: собрать и запустить проект из Xcode (`npm run cap:ios`, затем Run) либо собрать `xcodebuild` и поставить/запустить через `xcrun simctl install` / `xcrun simctl launch`.

Если `simctl` отвечает `Mach error -308 (server died)` — упал CoreSimulator: `xcrun simctl shutdown all` и повторите; на слабых ноутбуках держите запущенным один симулятор.

### Безопасные зоны и статус-бар

Веб-вью на iOS рисуется на весь экран: без учёта вырезов шапка уходит под Dynamic Island, а нижняя панель — под «домашнюю полоску». Что нужно сделать, когда появится UI:

- в `capacitor.config.ts` задать `ios.contentInset: 'never'`;
- добавить `viewport-fit=cover` в meta viewport и использовать `env(safe-area-inset-*)` в CSS;
- красить статус-бар (`@capacitor/status-bar`) под тему приложения.

### CORS для iOS / Android

Страница приложения открывается с origin `capacitor://localhost` (iOS) и `https://localhost` (Android). Если у API/прокси включён CORS, эти origin нужно разрешить, иначе запросы молча падут (`didFailResourceLoad` в логе WebKit). Это особенно важно для локального **LM Studio** и собственных серверов в сети завода.

## Иконка и сплэш-экран

Исходники кладутся в `assets/` и превращаются во все размеры пакетом `@capacitor/assets`:

| Файл | Назначение |
|---|---|
| `icon-only.png` (1024×1024, **без прозрачности** — требование iOS) | иконка iOS и обычная иконка Android |
| `icon-foreground.png` / `icon-background.png` | слои adaptive-иконки Android (знак в «безопасной зоне» ~66%) |
| `splash.png` / `splash-dark.png` (2732×2732) | экран запуска |

```bash
npm i -D @capacitor/assets
npx capacitor-assets generate --ios --android
```

---

## Структура

```
src/                  исходники React
capacitor.config.ts   конфигурация Capacitor (appId: com.somascan.app)
android/              нативный Android-проект
```
