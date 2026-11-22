#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  Somasync — установка на macOS
#  Двойной клик по файлу (первый раз: правый клик → Открыть).
#
#  Копирует Somasync.app в папку программ, снимает карантин,
#  подписывает локально (без этого macOS на Apple Silicon не запустит) и открывает.
#
#  Подпись — постоянным ключом «Somasync Local Signing» (создаётся один раз в связке
#  ключей входа). С ним macOS помнит разрешение программе читать её пароль и вход Google
#  из связки ключей: «Разрешить всегда» нажимается один раз, а не после каждой установки.
#
#  Свои пути можно задать двумя способами:
#    1) поправить две строки ниже;
#    2) передать в Terminal:  ./Установить.command  "/путь/к/Somasync.app"  "/куда/установить"
# ─────────────────────────────────────────────────────────────

# Где лежит Somasync.app. Пусто = искать рядом со скриптом и в release/mac-arm64, release/mac
APP_SOURCE=""

# Куда устанавливать
INSTALL_DIR="/Applications"

# ─────────────────────────────────────────────────────────────
APP_NAME="Somasync.app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

[ -n "$1" ] && APP_SOURCE="$1"
[ -n "$2" ] && INSTALL_DIR="$2"

say()  { printf "\n▸ %s\n" "$1"; }
fail() { printf "\n✖ %s\n\n" "$1"; read -n 1 -s -r -p "Нажмите любую клавишу, чтобы закрыть…"; exit 1; }

# 1. Ищем приложение
say "Ищу ${APP_NAME}…"
if [ -z "$APP_SOURCE" ]; then
  for dir in "$SCRIPT_DIR" "$SCRIPT_DIR/release/mac-arm64" "$SCRIPT_DIR/release/mac"; do
    if [ -d "$dir/$APP_NAME" ]; then APP_SOURCE="$dir/$APP_NAME"; break; fi
  done
fi
# Если указали папку, а не сам .app — добавим имя
[ -d "$APP_SOURCE/$APP_NAME" ] && APP_SOURCE="$APP_SOURCE/$APP_NAME"
[ -d "$APP_SOURCE" ] || fail "Не нашёл $APP_NAME. Укажите путь: ./Установить.command \"/путь/к/$APP_NAME\""
echo "  найдено: $APP_SOURCE"

# 2. Папка установки
mkdir -p "$INSTALL_DIR" 2>/dev/null || fail "Не могу создать папку $INSTALL_DIR"
[ -w "$INSTALL_DIR" ] || fail "Нет прав на запись в $INSTALL_DIR. Выберите другую папку (например, \$HOME/Applications)."
TARGET="$INSTALL_DIR/$APP_NAME"

# 3. Закрываем запущенную копию и убираем старую
say "Устанавливаю в ${INSTALL_DIR}…"
pkill -x "Somasync" 2>/dev/null
pkill -x "Somaco Sync" 2>/dev/null
sleep 1
rm -rf "$TARGET" "$INSTALL_DIR/Somaco Sync.app"   # старое имя приложения тоже убираем
cp -R "$APP_SOURCE" "$TARGET" || fail "Не удалось скопировать приложение"

# 4. Карантин и подпись
SIGN_ID="Somasync Local Signing"
LOGIN_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

# Есть ли ключ подписи в связке ключей входа
has_identity() { security find-identity -p codesigning "$LOGIN_KEYCHAIN" 2>/dev/null | grep -q "\"$SIGN_ID\""; }

# Создаёт самоподписанный ключ подписи кода и кладёт его в связку ключей входа (доступ — только codesign)
make_identity() {
  local tmp pass status
  tmp="$(mktemp -d)" || return 1
  pass="$(/usr/bin/openssl rand -hex 16)"
  cat > "$tmp/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $SIGN_ID
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CNF
  # системный /usr/bin/openssl: контейнер p12 от других сборок OpenSSL `security` не читает
  /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$tmp/cert.cnf" -keyout "$tmp/key.pem" -out "$tmp/cert.pem" >/dev/null 2>&1 &&
    /usr/bin/openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -name "$SIGN_ID" -out "$tmp/id.p12" -passout "pass:$pass" >/dev/null 2>&1 &&
    security import "$tmp/id.p12" -k "$LOGIN_KEYCHAIN" -P "$pass" -T /usr/bin/codesign >/dev/null 2>&1
  status=$?
  rm -rf "$tmp"
  return $status
}

say "Снимаю карантин и подписываю…"
xattr -cr "$TARGET"
if ! has_identity; then
  echo "  создаю ключ подписи «${SIGN_ID}» в связке ключей (один раз)…"
  make_identity || echo "  ! ключ подписи не создан"
fi
SIGNED=""
if has_identity; then
  if out="$(codesign --force --deep --keychain "$LOGIN_KEYCHAIN" --sign "$SIGN_ID" "$TARGET" 2>&1)"; then SIGNED="yes"; else echo "  ! $(printf '%s' "$out" | tail -1)"; fi
fi
if [ -n "$SIGNED" ]; then
  echo "  подписано ключом «${SIGN_ID}»"
else
  # без постоянного ключа — разовая подпись: доступ к связке ключей macOS спросит после каждой установки
  echo "  подписываю разовой подписью (ad-hoc)"
  codesign --force --deep --sign - "$TARGET" 2>&1 | tail -1
fi

# 5. Запуск
say "Готово: $TARGET"
echo "  Если macOS спросит доступ к «Somasync Safe Storage» в связке ключей — нажмите «Разрешить всегда»:"
echo "  там хранятся пароль сетевого диска и вход Google."
open "$TARGET"
