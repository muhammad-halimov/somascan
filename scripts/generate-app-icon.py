"""
Иконка приложения — логотип Somaco (слон с надписью «somaco») на белом фоне, с вариантами для тем.

Исходник — увеличенный (апскейл) логотип `scripts/somaco-logo.png`. Из него вырезается маска знака:
белый фон становится прозрачным, края сглаживаются, а цвет заменяется чистым фирменным бирюзовым —
так артефакты апскейла и сжатия не попадают в иконку.

Что получается:
- светлая иконка iOS и слои Android — через `@capacitor/assets`; его исходники (`icon-*.png`)
  создаются во временной папке и после генерации удаляются, в проекте их нет;
- iOS: тёмный и «тонированный» варианты в AppIcon (iOS 18+), светлый — от `@capacitor/assets`;
- Android: монохромный слой для тематических иконок (Android 13+) и тёмный фон для ночной темы;
- сплэш-экран с тем же знаком: iOS (светлый и тёмный) и Android до 12 (светлый и тёмный).

Запуск (нужен Pillow):
    python3 -m venv .venv && .venv/bin/pip install pillow
    .venv/bin/python scripts/generate-app-icon.py
Скрипт сам вызывает `npx capacitor-assets generate --ios --android`, а затем дописывает
варианты для тем поверх того, что тот сгенерировал.
"""
import json
import os
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
LOGO = Path(__file__).resolve().parent / 'somaco-logo.png'
IOS_ICONSET = ROOT / 'ios/App/App/Assets.xcassets/AppIcon.appiconset'
ANDROID_RES = ROOT / 'android/app/src/main/res'

# Фирменный бирюзовый цвет логотипа; на тёмном фоне — чуть светлее, чтобы не терялся.
TEAL = (0, 162, 178)
TEAL_ON_DARK = (24, 190, 206)
# Фон иконки в тёмной теме Android (близок к фону приложения в тёмной теме).
DARK_BACKGROUND = '#1B1C20'

# Насколько сглаживать границу маски: доля «бирюзовости», ниже которой пиксель — фон, выше — знак.
EDGE_LOW, EDGE_HIGH = 0.25, 0.75


@lru_cache(maxsize=1)
def logo_mask() -> Image.Image:
    """
    Маска знака из исходного логотипа (255 — знак, 0 — фон), обрезанная по знаку.

    Бирюзовый отличается от белого в первую очередь красным каналом (0 против 255), поэтому
    «бирюзовость» пикселя = 1 − R/255. Плавный порог убирает ореолы апскейла и шум фона,
    сохраняя сглаженный край.
    """
    red = Image.open(LOGO).convert('RGB').getchannel('R')
    span = (EDGE_HIGH - EDGE_LOW) * 255

    def level(value: int) -> int:
        teal = 255 - value
        return round(min(255, max(0, (teal - EDGE_LOW * 255) / span * 255)))

    mask = red.point(level).filter(ImageFilter.GaussianBlur(0.6))
    return mask.crop(mask.getbbox())


def glyph_mask(height: int) -> Image.Image:
    """Маска знака высотой `height` px со сглаженными краями."""
    mask = logo_mask()
    return mask.resize((round(mask.width * height / mask.height), height), Image.LANCZOS)


def canvas(size: int, background: tuple, color: tuple, glyph_height: int) -> Image.Image:
    """Квадрат `size` с фоном `background` и знаком цвета `color` по центру."""
    image = Image.new('RGBA', (size, size), background)
    mask = glyph_mask(glyph_height)
    glyph = Image.new('RGBA', mask.size, color + (0,))
    glyph.putalpha(mask)
    image.alpha_composite(glyph, ((size - glyph.width) // 2, (size - glyph.height) // 2))
    return image


# Высота знака: на iOS — на весь квадрат иконки, на Android — внутри безопасной зоны
# адаптивной иконки (её круглая маска не должна задевать знак).
IOS_GLYPH_H = 640
ANDROID_GLYPH_H = 560


def write_sources(out: Path) -> None:
    """Исходники для `@capacitor/assets` в папке `out`: светлая иконка iOS и слои адаптивной иконки Android."""
    # iOS: 1024×1024 без прозрачности (требование App Store), белый фон.
    canvas(1024, (255, 255, 255, 255), TEAL, IOS_GLYPH_H).convert('RGB').save(out / 'icon-only.png')
    # Android adaptive: прозрачный передний план, белый фон.
    canvas(1024, (0, 0, 0, 0), TEAL, ANDROID_GLYPH_H).save(out / 'icon-foreground.png')
    Image.new('RGB', (1024, 1024), (255, 255, 255)).save(out / 'icon-background.png')


def write_ios_variants() -> None:
    """
    Варианты для iOS 18+: тёмный (прозрачный фон — система подкладывает свой тёмный градиент)
    и «тонированный» (светлый знак в градациях серого на чёрном — система окрашивает его сама).
    """
    canvas(1024, (0, 0, 0, 0), TEAL_ON_DARK, IOS_GLYPH_H).save(IOS_ICONSET / 'AppIcon-Dark-512@2x.png')
    canvas(1024, (0, 0, 0, 255), (255, 255, 255), IOS_GLYPH_H).convert('L').save(IOS_ICONSET / 'AppIcon-Tinted-512@2x.png')
    image = {'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}
    contents = {
        'images': [
            {**image, 'filename': 'AppIcon-512@2x.png'},
            {**image, 'filename': 'AppIcon-Dark-512@2x.png', 'appearances': [{'appearance': 'luminosity', 'value': 'dark'}]},
            {**image, 'filename': 'AppIcon-Tinted-512@2x.png', 'appearances': [{'appearance': 'luminosity', 'value': 'tinted'}]},
        ],
        'info': {'author': 'xcode', 'version': 1},
    }
    (IOS_ICONSET / 'Contents.json').write_text(json.dumps(contents, indent=2) + '\n')


# Адаптивная иконка Android: фон — цвет (белый днём, тёмный ночью), передний план — знак,
# монохромный слой — для тематических иконок Android 13+ (лаунчер сам окрашивает его по обоям).
ADAPTIVE_ICON_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- Сгенерировано scripts/generate-app-icon.py. Фон зависит от темы (values и values-night). -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />
    </foreground>
    <monochrome>
        <inset android:drawable="@mipmap/ic_launcher_monochrome" android:inset="16.7%" />
    </monochrome>
</adaptive-icon>
"""

NIGHT_BACKGROUND_XML = f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Сгенерировано scripts/generate-app-icon.py: фон иконки в тёмной теме. -->
<resources>
    <color name="ic_launcher_background">{DARK_BACKGROUND}</color>
</resources>
"""


def write_android_variants() -> None:
    """Монохромный слой (по размерам переднего плана), XML адаптивной иконки и тёмный фон."""
    monochrome = canvas(1024, (0, 0, 0, 0), (255, 255, 255), ANDROID_GLYPH_H)
    for foreground in ANDROID_RES.glob('mipmap-*/ic_launcher_foreground.png'):
        size = Image.open(foreground).size
        monochrome.resize(size, Image.LANCZOS).save(foreground.with_name('ic_launcher_monochrome.png'))
    for name in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        (ANDROID_RES / 'mipmap-anydpi-v26' / name).write_text(ADAPTIVE_ICON_XML)
    night = ANDROID_RES / 'values-night'
    night.mkdir(exist_ok=True)
    (night / 'ic_launcher_background.xml').write_text(NIGHT_BACKGROUND_XML)


# Сплэш-экран: тот же знак по центру. Фон — как у приложения в светлой и тёмной теме.
SPLASH_LIGHT = (255, 255, 255)
SPLASH_DARK = (0x17, 0x18, 0x1C)
# Высота знака — доля меньшей стороны картинки сплэша.
SPLASH_GLYPH_RATIO = 0.28
IOS_SPLASHSET = ROOT / 'ios/App/App/Assets.xcassets/Splash.imageset'


def splash(width: int, height: int, background: tuple, color: tuple) -> Image.Image:
    """Картинка сплэша `width`×`height` со знаком по центру."""
    image = Image.new('RGB', (width, height), background)
    mask = glyph_mask(round(min(width, height) * SPLASH_GLYPH_RATIO))
    glyph = Image.new('RGB', mask.size, color)
    image.paste(glyph, ((width - mask.width) // 2, (height - mask.height) // 2), mask)
    return image


def write_splashes() -> None:
    """
    Сплэш на обеих платформах: iOS — светлая и тёмная картинка в Splash.imageset;
    Android до 12 — splash.png во всех размерах и ориентациях, тёмные — в каталогах `-night`.
    На Android 12+ системный сплэш показывает отдельный знак `splash_icon` (см. write_android12_splash_icon).
    """
    splash(2732, 2732, SPLASH_LIGHT, TEAL).save(IOS_SPLASHSET / 'splash-light-2732.png')
    splash(2732, 2732, SPLASH_DARK, TEAL_ON_DARK).save(IOS_SPLASHSET / 'splash-dark-2732.png')
    for light in ANDROID_RES.glob('drawable*/splash.png'):
        folder = light.parent.name
        if '-night' in folder:
            continue
        width, height = Image.open(light).size
        splash(width, height, SPLASH_LIGHT, TEAL).save(light)
        # Квалификатор night идёт после ориентации: drawable-port-night-xxhdpi.
        parts = folder.split('-')
        insert = 2 if len(parts) > 1 and parts[1] in ('port', 'land') else 1
        night = ANDROID_RES / '-'.join(parts[:insert] + ['night'] + parts[insert:])
        night.mkdir(exist_ok=True)
        splash(width, height, SPLASH_DARK, TEAL_ON_DARK).save(night / 'splash.png')


# Android 12+: значок системного сплэша — 288 dp, видимая часть — круг 192 dp (2/3 стороны).
# Знак вписан с запасом, чтобы углы тела слона не обрезались кругом.
SPLASH_ICON_DP = 288
SPLASH_ICON_GLYPH_RATIO = 0.46
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def write_android12_splash_icon() -> None:
    """Знак для системного сплэша Android 12+ (`windowSplashScreenAnimatedIcon`) во всех плотностях."""
    for density, factor in DENSITIES.items():
        size = round(SPLASH_ICON_DP * factor)
        icon = canvas(size, (0, 0, 0, 0), TEAL, round(size * SPLASH_ICON_GLYPH_RATIO))
        icon.save(ANDROID_RES / f'mipmap-{density}' / 'splash_icon.png')


def main() -> None:
    with tempfile.TemporaryDirectory() as sources:
        write_sources(Path(sources))
        # `--assetPath` склеивается с корнем проекта, поэтому передаём путь относительно него.
        asset_path = os.path.relpath(sources, ROOT)
        subprocess.run(['npx', 'capacitor-assets', 'generate', '--ios', '--android', '--assetPath', asset_path], cwd=ROOT, check=True)
    write_ios_variants()
    write_android_variants()
    write_splashes()
    write_android12_splash_icon()
    print('Готово: иконки iOS и Android обновлены.')


if __name__ == '__main__':
    main()
