/**
 * Что посоветовать по самому прочтению на устройстве (модели оценивают фото сами): если поля нашлись не все,
 * эти проблемы превращаются в подсказку над фото и пояснение в окне качества — но не в совет переснять.
 *
 * - `rotated` — текст прочитан с повёрнутого фото или боком: поверните фото и нажмите «Повтор».
 * - `far` — OCR прочёл текст неуверенно: мелкий или бледный шрифт; ближе снятая бирка читается лучше.
 */
import type { PhotoIssue } from '../image/PhotoQuality'
import type { OcrPage } from './ocrTypes'

/**
 * Средняя (медианная) уверенность OCR по строкам ниже этой — прочтение неуверенное. Подобрано по настоящим
 * чтениям ML Kit (`tests/fixtures/ocr`): у хорошо читаемых бирок медиана 0,77–0,88, у мелкой бледной BPM — 0,58.
 */
export const LOW_CONFIDENCE = 0.7

/** Медиана чисел (`null` — пусто). */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * Проблемы прочтения страницы, по которой разобрана бирка.
 * @param page Прочитанная страница (поворот фото, строки с уверенностью).
 * @param turns На сколько четвертей пришлось повернуть координаты строк (`Extraction.turns`).
 */
export function readingIssues(page: OcrPage, turns: number): PhotoIssue[] {
  const issues: PhotoIssue[] = []
  if (page.rotation !== 0 || turns !== 0) issues.push('rotated')
  const confidence = median(page.lines.flatMap((line) => (line.confidence === null ? [] : [line.confidence])))
  if (confidence !== null && confidence < LOW_CONFIDENCE) issues.push('far')
  return issues
}
