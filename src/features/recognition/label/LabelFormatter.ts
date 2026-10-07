import { isMissingValue, type LabelFieldKind, type LabelValue } from './labelFields'
import { measureNumber } from './measure'

/** Локализованные строки, нужные форматтеру. */
export interface LabelFormatterStrings {
  /** Показывается вместо отсутствующего значения. */
  notRecognized: string
  /** Единица веса, например «кг». */
  weightUnit: string
  /** Единица длины (диаметра), например «мм». */
  lengthUnit: string
}

/** Единицы, которые модели копируют с бирки после числа: `10 mm`, `Ø12mm`, `2140 Kg`. */
const UNIT_AFTER_NUMBER = /(\d)\s*(mm|kg)(?![\p{L}\p{N}])/giu

/** Ключ поля размера (диаметра): его число показывается с миллиметрами. */
const SIZE_KEY = 'size'

/**
 * Отображает значения бирки на текущем языке интерфейса.
 *
 * В просмотре числа — с единицами на языке интерфейса (`10 мм`, `2140 кг`), пометки с бирки
 * (`R20`) сохраняются. В правке у размера и веса — только число (`editValue`): единицы и пометки
 * добавляет просмотр, а журнал всё равно пишет число.
 */
export class LabelFormatter {
  /** Локализованные строки. */
  private readonly strings: LabelFormatterStrings

  /** @param strings Локализованные строки (см. `useLabelFormatter`). */
  constructor(strings: LabelFormatterStrings) {
    this.strings = strings
  }

  /**
   * Текст значения поля для просмотра.
   * @param kind Вид поля.
   * @param value Значение.
   * @param key Ключ поля: у размера к «голому» числу добавляются миллиметры.
   */
  value(kind: LabelFieldKind, value: LabelValue | undefined, key?: string) {
    if (isMissingValue(value)) return this.strings.notRecognized
    const text = String(value).trim()
    // К «голому» числу веса и размера добавляем единицу; единицы, скопированные с бирки, переводим.
    const isBareNumber = /^\d+(?:[.,]\d+)?$/.test(text)
    if (isBareNumber && kind === 'weight') return `${text} ${this.strings.weightUnit}`
    if (isBareNumber && key === SIZE_KEY) return `${text} ${this.strings.lengthUnit}`
    return this.units(text)
  }

  /**
   * Текст значения в поле правки: у размера и веса — только число, без пометки `R`/`Ø` и единиц
   * (`R20` → `20`, `10 mm` → `10`); если это не одно число (`8/7`) или поле другое — как есть.
   */
  editValue(kind: LabelFieldKind, value: LabelValue | undefined, key?: string) {
    if (value === null || value === undefined) return ''
    const text = String(value)
    const measure = key === SIZE_KEY ? 'length' : kind === 'weight' ? 'weight' : null
    return (measure && measureNumber(text, measure)) ?? text
  }

  /** Переводит единицы после чисел (`10 mm` → `10 мм`); коды вроде `B500C` не трогает. */
  units(text: string) {
    return text.replace(UNIT_AFTER_NUMBER, (_match, digit: string, unit: string) =>
      `${digit} ${unit.toLowerCase() === 'mm' ? this.strings.lengthUnit : this.strings.weightUnit}`)
  }
}
