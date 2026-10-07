import type { ModelCandidate, ModelInfo } from '../types'

/** Допустимые значения ограничения по возрасту моделей в настройках; `null` показывает все модели. */
export const MODEL_AGE_LIMITS = [3, 6, 12, null] as const

/** Ограничение по возрасту модели в месяцах или `null`, если ограничения нет. */
export type ModelAgeLimit = (typeof MODEL_AGE_LIMITS)[number]

/** Ограничение по умолчанию: модели, вышедшие за последние полгода. */
export const DEFAULT_MODEL_AGE_LIMIT: ModelAgeLimit = 6

/** Параметры одного прохода фильтрации. */
export interface ModelFilterOptions {
  /** Скрывать модели, вышедшие раньше, чем столько месяцев назад; `null` отключает ограничение. */
  maxAgeMonths: ModelAgeLimit
  /** Оставлять модели с неизвестной датой выхода (локальные серверы даты не сообщают). */
  keepUndated: boolean
  /** Опорное «сейчас»; подставляется в тестах. */
  now?: Date
}

/**
 * Решает, какие модели предлагать пользователю:
 * только с поддержкой изображений, в пределах ограничения по возрасту, сначала новые.
 */
export class ModelFilter {
  /** Первая допустимая дата выхода (`YYYY-MM-DD`) или `''`, если ограничения нет. */
  static cutoffDate(maxAgeMonths: ModelAgeLimit, now = new Date()) {
    if (maxAgeMonths === null) return ''
    const cutoff = new Date(now)
    cutoff.setMonth(cutoff.getMonth() - maxAgeMonths)
    return cutoff.toISOString().slice(0, 10)
  }

  /** Фильтрует и сортирует `candidates`. */
  static apply(candidates: readonly ModelCandidate[], { maxAgeMonths, keepUndated, now }: ModelFilterOptions): ModelInfo[] {
    const cutoff = ModelFilter.cutoffDate(maxAgeMonths, now)
    return candidates
      .filter((model) => model.supportsVision)
      .filter((model) => (model.releasedAt === null ? keepUndated || maxAgeMonths === null : model.releasedAt >= cutoff))
      .map(({ id, name, releasedAt, description, details, loaded }) => ({ id, name, releasedAt, description, details, loaded }))
      // Сначала новые; при одинаковой дате выше идёт больший id («3.8» перед «3.7»).
      .sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '') || b.id.localeCompare(a.id))
  }

  /**
   * Модель для использования: выбор пользователя, пока он ещё предлагается, иначе самая новая.
   * При пустом списке (офлайн, локальный сервер) сохранённый выбор возвращается как есть.
   */
  static pick(selected: string, offered: readonly ModelInfo[]) {
    if (offered.length === 0 || offered.some((model) => model.id === selected)) return selected
    return offered[0].id
  }
}
