"""
Иконки Somasync из логотипа Somaco (`scripts/somaco-logo.png`, тот же, что у somascan).

Как в somascan (`scripts/generate-app-icon.py`): из логотипа вырезается маска знака — белый фон становится
прозрачным, края сглаживаются, цвет заменяется чистым фирменным бирюзовым.

Что получается:
- `build/icon.png` 1024×1024 — значок приложения на Mac: тёмный скруглённый квадрат с полями (сетка значков Apple),
  светло-бирюзовый знак со словом «somaco» по центру;
- `build/icon-win.png` 1024×1024 — значок для Windows (из него electron-builder делает .ico): тот же тёмный квадрат,
  но без полей и со знаком крупнее — на панели задач значок мелкий, поля там только съедают место;
- `assets/trayTemplate.png`, `trayTemplate@2x.png` — значок строки меню macOS: чёрный слон без надписи
  (шаблон: macOS сама красит его под светлую и тёмную строку меню);
- `assets/tray.png`, `tray@2x.png` — значок трея Windows / Linux: бирюзовый слон без надписи.

Запуск (нужен Pillow): python3 scripts/generate-app-icon.py
"""
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
LOGO = Path(__file__).resolve().parent / 'somaco-logo.png'

# Фирменный бирюзовый цвет логотипа; на тёмном фоне — чуть светлее, чтобы не терялся (как в somascan).
TEAL = (0, 162, 178)
TEAL_ON_DARK = (24, 190, 206)
# Фон значка — как фон приложения в тёмной теме.
DARK = (0x1B, 0x1C, 0x20, 255)
# Насколько сглаживать границу маски: доля «бирюзовости», ниже которой пиксель — фон, выше — знак.
EDGE_LOW, EDGE_HIGH = 0.25, 0.75

# Значок macOS: квадрат 824 из 1024 со скруглением ~22,5 % (сетка значков Apple), знак — 62 % квадрата.
ICON = 1024
TILE = 824
TILE_RADIUS = 185
GLYPH_IN_TILE = 0.62
# Значок Windows: квадрат на всё поле, скругление ~18 %, знак — 80 % стороны.
WIN_RADIUS = 180
WIN_GLYPH = 0.80


@lru_cache(maxsize=1)
def logo_mask() -> Image.Image:
    """Маска знака (255 — знак, 0 — фон), обрезанная по знаку. «Бирюзовость» пикселя = 1 − R/255."""
    red = Image.open(LOGO).convert('RGB').getchannel('R')
    span = (EDGE_HIGH - EDGE_LOW) * 255

    def level(value: int) -> int:
        teal = 255 - value
        return round(min(255, max(0, (teal - EDGE_LOW * 255) / span * 255)))

    mask = red.point(level).filter(ImageFilter.GaussianBlur(0.6))
    return mask.crop(mask.getbbox())


@lru_cache(maxsize=1)
def elephant_mask() -> Image.Image:
    """Только слон: маска до первой пустой строки над надписью «somaco»."""
    mask = logo_mask()
    rows = [any(mask.getpixel((x, y)) > 64 for x in range(0, mask.width, 2)) for y in range(mask.height)]
    gap = next(y for y in range(mask.height // 2, mask.height) if not rows[y])
    elephant = mask.crop((0, 0, mask.width, gap))
    return elephant.crop(elephant.getbbox())


def fit(mask: Image.Image, box: int) -> Image.Image:
    """Маска, вписанная в квадрат `box` с сохранением пропорций."""
    k = box / max(mask.width, mask.height)
    return mask.resize((max(1, round(mask.width * k)), max(1, round(mask.height * k))), Image.LANCZOS)


def glyph(mask: Image.Image, color: tuple) -> Image.Image:
    """Знак цвета `color` по маске."""
    image = Image.new('RGBA', mask.size, color + (0,))
    image.putalpha(mask)
    return image


def app_icon() -> Image.Image:
    """Значок Mac: тень, тёмный скруглённый квадрат, знак со словом по центру."""
    image = Image.new('RGBA', (ICON, ICON), (0, 0, 0, 0))
    offset = (ICON - TILE) // 2
    shadow = Image.new('L', (ICON, ICON), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((offset, offset + 12, offset + TILE, offset + TILE + 12), TILE_RADIUS, fill=70)
    image.putalpha(shadow.filter(ImageFilter.GaussianBlur(14)))
    tile = Image.new('RGBA', (ICON, ICON), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle((offset, offset, offset + TILE, offset + TILE), TILE_RADIUS, fill=DARK)
    image.alpha_composite(tile)
    sign = glyph(fit(logo_mask(), round(TILE * GLYPH_IN_TILE)), TEAL_ON_DARK)
    image.alpha_composite(sign, ((ICON - sign.width) // 2, (ICON - sign.height) // 2))
    return image


def win_icon() -> Image.Image:
    """Значок Windows: тёмный скруглённый квадрат на всё поле, крупный знак."""
    image = Image.new('RGBA', (ICON, ICON), (0, 0, 0, 0))
    ImageDraw.Draw(image).rounded_rectangle((0, 0, ICON - 1, ICON - 1), WIN_RADIUS, fill=DARK)
    sign = glyph(fit(logo_mask(), round(ICON * WIN_GLYPH)), TEAL_ON_DARK)
    image.alpha_composite(sign, ((ICON - sign.width) // 2, (ICON - sign.height) // 2))
    return image


def tray(size: int, color: tuple) -> Image.Image:
    """Значок трея `size`×`size`: слон с полем в 1/16 стороны."""
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sign = glyph(fit(elephant_mask(), size - 2 * max(1, size // 16)), color)
    image.alpha_composite(sign, ((size - sign.width) // 2, (size - sign.height) // 2))
    return image


def main() -> None:
    app_icon().save(ROOT / 'build' / 'icon.png')
    win_icon().save(ROOT / 'build' / 'icon-win.png')
    assets = ROOT / 'assets'
    for name, color in (('trayTemplate', (0, 0, 0)), ('tray', TEAL)):
        tray(16, color).save(assets / f'{name}.png')
        tray(32, color).save(assets / f'{name}@2x.png')
    print('build/icon.png, build/icon-win.png, assets/tray*.png — готово')


if __name__ == '__main__':
    main()
