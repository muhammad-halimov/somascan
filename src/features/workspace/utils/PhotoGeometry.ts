/** Ширина и высота в CSS-пикселях. */
export interface Size { width: number; height: number }

/** Смещение в CSS-пикселях. */
export interface Point { x: number; y: number }

/**
 * Геометрия просмотра фото: вписывание (с учётом поворота) в рамку,
 * границы перетаскивания и масштабирование относительно точки.
 *
 * Система координат: начало — центр рамки. Фото рисуется по центру, поворачивается,
 * масштабируется и затем сдвигается на `offset` (экранные пиксели).
 */
export class PhotoGeometry {
  /** Без увеличения: фото целиком помещается в рамку. */
  static readonly MIN_SCALE = 1
  /** Максимальное увеличение. */
  static readonly MAX_SCALE = 5
  /** Шаг масштаба для кнопок «больше»/«меньше». */
  static readonly SCALE_STEP = 0.5

  /** Натуральный размер фото (заглушка 4:3, пока фото не загрузилось). */
  private readonly natural: Size
  /** Размер рамки, в которой показано фото. */
  private readonly frame: Size

  /**
   * @param natural Натуральный размер загруженного фото или `null`, пока оно грузится.
   * @param frame Размер рамки.
   */
  constructor(natural: Size | null, frame: Size) {
    this.natural = natural ?? { width: 4, height: 3 }
    this.frame = frame
  }

  /** Ограничивает масштаб допустимым диапазоном. */
  static clampScale(scale: number) {
    return Math.min(PhotoGeometry.MAX_SCALE, Math.max(PhotoGeometry.MIN_SCALE, scale))
  }

  /** Следующий поворот на четверть оборота по часовой стрелке (0 → 90 → 180 → 270 → 0). */
  static nextRotation(rotation: number) {
    return (rotation + 90) % 360
  }

  /** Повёрнуто ли фото на 90° или 270° (стороны на экране меняются местами). */
  private static isSideways(rotation: number) {
    return rotation % 180 !== 0
  }

  /**
   * Размер блока фото до поворота: такой, чтобы после поворота фото целиком вписалось в рамку.
   * Именно этот размер задаётся элементу, а поворот и масштаб — через `transform`.
   */
  layout(rotation: number): Size {
    const sideways = PhotoGeometry.isSideways(rotation)
    const shownWidth = sideways ? this.natural.height : this.natural.width
    const shownHeight = sideways ? this.natural.width : this.natural.height
    const fit = Math.min(this.frame.width / shownWidth, this.frame.height / shownHeight)
    const width = this.natural.width * fit
    const height = this.natural.height * fit
    return { width, height }
  }

  /** Размер фото на экране после поворота и масштаба. */
  visualSize(rotation: number, scale: number): Size {
    const { width, height } = this.layout(rotation)
    return PhotoGeometry.isSideways(rotation)
      ? { width: height * scale, height: width * scale }
      : { width: width * scale, height: height * scale }
  }

  /**
   * Ограничивает сдвиг так, чтобы увеличенное фото нельзя было утащить за края рамки.
   * По оси, где фото меньше рамки, оно остаётся по центру.
   */
  clampOffset(offset: Point, scale: number, rotation: number): Point {
    const visual = this.visualSize(rotation, scale)
    const maxX = Math.max(0, (visual.width - this.frame.width) / 2)
    const maxY = Math.max(0, (visual.height - this.frame.height) / 2)
    return {
      x: Math.max(-maxX, Math.min(maxX, offset.x)),
      y: Math.max(-maxY, Math.min(maxY, offset.y)),
    }
  }

  /**
   * Сдвиг после смены масштаба так, чтобы точка фото под `focus` осталась на месте
   * (масштаб «к пальцам», а не к центру рамки).
   * @param focus Точка относительно центра рамки.
   */
  static zoomOffset(offset: Point, fromScale: number, toScale: number, focus: Point): Point {
    const ratio = toScale / fromScale
    return {
      x: focus.x - (focus.x - offset.x) * ratio,
      y: focus.y - (focus.y - offset.y) * ratio,
    }
  }
}

/** Часть `Touch`, нужная для расчётов жестов. */
export interface TouchPoint { clientX: number; clientY: number }

/** Расстояние между двумя пальцами (щипок). */
export const touchDistance = (first: TouchPoint, second: TouchPoint) =>
  Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)

/** Середина между двумя пальцами (центр щипка). */
export const touchCenter = (first: TouchPoint, second: TouchPoint): Point => ({
  x: (first.clientX + second.clientX) / 2,
  y: (first.clientY + second.clientY) / 2,
})
