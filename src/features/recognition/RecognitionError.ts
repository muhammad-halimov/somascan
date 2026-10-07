/**
 * Ошибки функциональности распознавания.
 *
 * Сервисы выбрасывают `RecognitionError` с полем `code`; UI превращает код в
 * локализованное сообщение (`errors:recognition.<code>`), поэтому текстов для пользователя в сервисах нет.
 */

/** Что пошло не так. Для каждого кода есть сообщение в `locales/<lang>/errors.json`. */
export type RecognitionErrorCode =
  /** Сервер ответил статусом ошибки. */
  | 'requestFailed'
  /** Нет соединения, сбой DNS, отказ по CORS. */
  | 'network'
  /** Сервер ответил чем-то, кроме ожидаемого JSON. */
  | 'invalidResponse'
  /** Модель не вернула текст. */
  | 'emptyAnswer'
  /** Модель отказалась обрабатывать фото. */
  | 'refused'
  /** Ответ обрезан из-за лимита токенов. */
  | 'truncated'
  /** В тексте модели нет ожидаемого JSON-объекта. */
  | 'answerNotJson'
  /** Выбранный файл не удалось прочитать. */
  | 'imageUnreadable'
  /** Выбранный файл не является изображением. */
  | 'notAnImage'
  /** Провайдеру нужен API-ключ, а он не задан. */
  | 'noApiKey'
  /** Для провайдера нет доступной модели. */
  | 'noModel'

/** Значения, подставляемые в локализованное сообщение. */
export interface RecognitionErrorParams {
  /** Название провайдера, например «Google Gemini». */
  provider?: string
  /** Подробности от сервера, если есть. */
  detail?: string
}

/** Сбой распознавания с машиночитаемым кодом. */
export class RecognitionError extends Error {
  /** Вид сбоя; определяет локализованное сообщение. */
  readonly code: RecognitionErrorCode
  /** Значения для локализованного сообщения. */
  readonly params: RecognitionErrorParams

  /**
   * @param code Вид сбоя.
   * @param params Значения для локализованного сообщения.
   */
  constructor(code: RecognitionErrorCode, params: RecognitionErrorParams = {}) {
    super(params.detail ? `${code}: ${params.detail}` : code)
    this.name = 'RecognitionError'
    this.code = code
    this.params = params
  }
}

/**
 * Приводит любое выброшенное значение к `RecognitionError`, уже готовые ошибки возвращает как есть.
 * @param provider Название провайдера для сообщения.
 */
export function toRecognitionError(error: unknown, provider: string): RecognitionError {
  if (error instanceof RecognitionError) return error
  return new RecognitionError('network', { provider, detail: error instanceof Error ? error.message : String(error) })
}

/** `true` для ошибок, вызванных отменой запроса (пользователю их показывать не стоит). */
export const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'
