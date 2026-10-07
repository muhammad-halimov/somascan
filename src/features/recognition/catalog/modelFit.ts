/**
 * Насколько модель подходит для чтения бирок — короткая рекомендация в списке моделей.
 *
 * Оценка по семейству модели (по id и названию), а для незнакомых семейств — по цене:
 * дорогие модели обычно точнее, дешёвые — быстрее. Тексты рекомендаций — в переводах
 * (`settings:general.fit.<класс>`).
 */
import type { ModelInfo, ProviderId } from '../types'

/** Класс модели для задачи «прочитать бирку с фото». */
export type ModelFitTier =
  /** Быстрая и недорогая, уверенно читает печатный текст — выбор по умолчанию. */
  | 'balanced'
  /** Самая точная на сложных фото (ржавчина, наклон, блики), но медленнее и дороже. */
  | 'precise'
  /** Самая быстрая и дешёвая; на сложных бирках ошибается чаще. */
  | 'economy'
  /** Локальная модель: фото не покидают сеть завода. */
  | 'local'

/** Рекомендация для модели. */
export interface ModelFit {
  /** Класс модели или `null`, если оценить нельзя. */
  tier: ModelFitTier | null
  /** Предварительная версия: поведение может меняться. */
  preview: boolean
}

/** Экономичные семейства: Lite, Haiku, nano, mini. */
const ECONOMY = /\b(lite|haiku|nano|mini|small)\b|flash-8b/i
/** Флагманы: Pro, Opus, Fable, Ultra. */
const PRECISE = /\b(pro|opus|fable|ultra|mythos)\b/i
/** Сбалансированные семейства: Flash, Sonnet. */
const BALANCED = /\b(flash|sonnet)\b/i
/** Предварительные версии. */
const PREVIEW = /\b(preview|exp|experimental|beta)\b/i

/** Порог цены входных токенов ($ за 1M): дороже — точная модель, дешевле нижнего — экономичная. */
const PRECISE_INPUT_COST = 3
const ECONOMY_INPUT_COST = 0.4

/**
 * Рекомендация для модели провайдера.
 * @param model Модель из списка.
 * @param providerId Провайдер (у LM Studio все модели локальные).
 */
export function modelFit(model: Pick<ModelInfo, 'id' | 'name' | 'details'>, providerId: ProviderId): ModelFit {
  // Дефисы и точки — границы слов: `gemini-3.5-flash-lite` → «gemini 3.5 flash lite».
  const text = `${model.id} ${model.name}`.replace(/[-_./]+/g, ' ')
  const preview = PREVIEW.test(text)
  if (providerId === 'lmstudio') return { tier: 'local', preview }
  if (ECONOMY.test(text)) return { tier: 'economy', preview }
  if (PRECISE.test(text)) return { tier: 'precise', preview }
  if (BALANCED.test(text)) return { tier: 'balanced', preview }
  const cost = model.details?.inputCost
  if (cost === undefined) return { tier: null, preview }
  if (cost >= PRECISE_INPUT_COST) return { tier: 'precise', preview }
  if (cost <= ECONOMY_INPUT_COST) return { tier: 'economy', preview }
  return { tier: 'balanced', preview }
}
