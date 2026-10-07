import { isRecord } from '@/lib/validation/guards'
import { isPhotoIssue, type PhotoIssue } from '../image/PhotoQuality'
import { RecognitionError } from '../RecognitionError'
import type { LabelKey, LabelRecord } from './labelFields'
import { PHOTO_ASSESSMENT_KEY } from './labelPrompt'

/** Оценка фото моделью. */
export interface PhotoAssessment {
  /** Фото пригодно: все значения читаются уверенно. */
  ok: boolean
  /** Проблемы фото (известные коды; прочие отбрасываются). */
  issues: PhotoIssue[]
}

/** Разобранный ответ модели. */
export interface ParsedLabelAnswer {
  /** Поля бирки. */
  label: LabelRecord
  /** Оценка фото; если модель её не прислала — «всё в порядке». */
  photo: PhotoAssessment
}

/**
 * Превращает текстовый ответ модели в `LabelRecord`.
 * Терпимо относится к блокам кода и тексту вокруг JSON, игнорирует неизвестные и некорректные поля.
 */
export class LabelParser {
  /**
   * @param rawText Ответ модели.
   * @param keys Ключи запрошенных полей; в записи будут только они (лишние ключи ответа отбрасываются).
   * @throws {RecognitionError} `answerNotJson`, если JSON-объект найти не удалось.
   */
  parse(rawText: string, keys: readonly LabelKey[]): LabelRecord {
    return this.parseAnswer(rawText, keys).label
  }

  /**
   * Поля бирки и оценка фото моделью (`_photo`).
   * @throws {RecognitionError} `answerNotJson`, если JSON-объект найти не удалось.
   */
  parseAnswer(rawText: string, keys: readonly LabelKey[]): ParsedLabelAnswer {
    const data = this.extractObject(rawText)
    const label = Object.fromEntries(keys.map((key) => {
      const value = data[key]
      const clean = typeof value === 'string' ? value.trim() : value
      return [key, typeof clean === 'string' || (typeof clean === 'number' && Number.isFinite(clean)) ? clean : null]
    }))
    return { label, photo: this.readAssessment(data[PHOTO_ASSESSMENT_KEY]) }
  }

  /** Оценка фото из ответа; неполная или отсутствующая — «всё в порядке». */
  private readAssessment(value: unknown): PhotoAssessment {
    if (!isRecord(value)) return { ok: true, issues: [] }
    const issues = Array.isArray(value.issues) ? [...new Set(value.issues.filter(isPhotoIssue))] : []
    return { ok: value.ok !== false, issues }
  }

  /** Находит в тексте внешние `{ … }` и разбирает их. */
  private extractObject(rawText: string): Record<string, unknown> {
    const text = rawText.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) throw new RecognitionError('answerNotJson')

    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1))
      if (isRecord(parsed)) return parsed
    } catch {
      // Переходим к ошибке ниже.
    }
    throw new RecognitionError('answerNotJson')
  }
}
