#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  Somasync — установка на macOS
#  Двойной клик по файлу (первый раз: правый клик → Открыть).
#
#  Копирует Somasync.app в папку программ, снимает карантин,
#  подписывает локально (без этого macOS на Apple Silicon не запустит) и открывает.
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
say "Ищу $APP_NAME…"
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
say "Устанавливаю в $INSTALL_DIR…"
pkill -x "Somasync" 2>/dev/null
pkill -x "Somaco Sync" 2>/dev/null
sleep 1
rm -rf "$TARGET" "$INSTALL_DIR/Somaco Sync.app"   # старое имя приложения тоже убираем
cp -R "$APP_SOURCE" "$TARGET" || fail "Не удалось скопировать приложение"

# 4. Карантин и подпись
say "Снимаю карантин и подписываю локально…"
xattr -cr "$TARGET"
codesign --force --deep --sign - "$TARGET" 2>&1 | tail -1

# 5. Запуск
say "Готово: $TARGET"
open "$TARGET"
