import { isMissingValue, type LabelFieldKind, type LabelValue } from './labelFields'

/** Локализованные строки, нужные форматтеру. */
export interface LabelFormatterStrings {
  /** Показывается вместо отсутствующего значения. */
  notRecognized: string
  /** Единица, добавляемая к «голому» числу веса, например «кг». */
  weightUnit: string
}

/** Отображает значения бирки на текущем языке интерфейса. */
export class LabelFormatter {
  /** Локализованные строки. */
  private readonly strings: LabelFormatterStrings

  /** @param strings Локализованные строки (см. `useLabelFormatter`). */
  constructor(strings: LabelFormatterStrings) {
    this.strings = strings
  }

  /** Отображаемый текст значения поля указанного вида. */
  value(kind: LabelFieldKind, value: LabelValue | undefined) {
    if (isMissingValue(value)) return this.strings.notRecognized
    // Модели иногда копируют единицу с бирки («2140 kg»); добавляем её только к «голым» числам.
    const isBareNumber = /^\s*\d+(?:[.,]\d+)?\s*$/.test(String(value))
    return kind === 'weight' && isBareNumber ? `${value} ${this.strings.weightUnit}` : String(value)
  }
}
