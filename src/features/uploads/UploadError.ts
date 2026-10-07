/**
 * Ошибки выгрузки в таблицу.
 *
 * Как и `RecognitionError`: машиночитаемый код плюс подробности; UI превращает код в сообщение
 * на языке интерфейса (`errors:upload.<код>`). Код также решает, повторять ли запись автоматически
 * (`isTransientUploadError`) или ждать действий пользователя (неверный пароль, нет настроек).
 */

/** Что пошло не так. Для каждого кода есть сообщение в `locales/<язык>/errors.json`. */
export type UploadErrorCode =
  /** Сетевой диск не настроен (сервер, папка или путь к таблице пустые). */
  | 'notConfigured'
  /** Выбранное хранилище (Google Drive) пока не поддерживается. */
  | 'targetUnsupported'
  /** Путь к таблице не оканчивается на `.xlsx` или содержит `..`. */
  | 'invalidPath'
  /** Нативного плагина нет (веб-версия в браузере). */
  | 'unavailable'
  /** Нет сети. */
  | 'offline'
  /** Сервер не отвечает: нет такого адреса, порт закрыт, соединение разорвано. */
  | 'hostUnreachable'
  /** Операция не уложилась в отведённое время. */
  | 'timeout'
  /** Сервер отверг имя пользователя или пароль. */
  | 'authFailed'
  /** На сервере нет общей папки с таким именем. */
  | 'shareNotFound'
  /** Файла или папки нет (служебный код: обрабатывается внутри). */
  | 'notFound'
  /** Файл или папка уже есть (служебный код: так работает блокировка). */
  | 'exists'
  /** Нет прав на чтение или запись. */
  | 'accessDenied'
  /** Таблица открыта в другой программе (Excel держит файл). */
  | 'locked'
  /** Таблицу в этот момент записывает другое устройство. */
  | 'busy'
  /** Файл не удалось открыть как таблицу `.xlsx`. */
  | 'corruptWorkbook'
  /** Проверка после записи не прошла: прочитанное не совпало с записанным. */
  | 'verifyFailed'
  /** Прочая ошибка ввода-вывода. */
  | 'io'
  /** Google: вход не выполнен или доступ к Drive отозван — нужно войти заново в настройках. */
  | 'authRequired'
  /** Google: в этой сборке не настроен OAuth-клиент (нет client ID). */
  | 'driveNotConfigured'
  /** Google: папки с таким id нет или нет доступа к ней. */
  | 'folderNotFound'
  /** Пользователь закрыл окно входа. */
  | 'cancelled'

/** Все коды — для проверки сохранённых записей (объект, а не список, чтобы компилятор требовал полноты). */
const CODES: Record<UploadErrorCode, true> = {
  notConfigured: true, targetUnsupported: true, invalidPath: true, unavailable: true, offline: true, hostUnreachable: true,
  timeout: true, authFailed: true, shareNotFound: true, notFound: true, exists: true, accessDenied: true, locked: true,
  busy: true, corruptWorkbook: true, verifyFailed: true, io: true, authRequired: true, driveNotConfigured: true,
  folderNotFound: true, cancelled: true,
}

/** Проверка, что значение — известный код ошибки выгрузки. */
export const isUploadErrorCode = (value: unknown): value is UploadErrorCode =>
  typeof value === 'string' && Object.hasOwn(CODES, value)

/** Значения, подставляемые в локализованное сообщение. */
export interface UploadErrorParams {
  /** Подробности от нативной части или библиотеки. */
  detail?: string
  /** Адрес сервера. */
  host?: string
  /** Имя общей папки. */
  share?: string
  /** Путь к таблице. */
  path?: string
  /** Кто держит блокировку таблицы. */
  owner?: string
}

/** Сбой выгрузки с машиночитаемым кодом. */
export class UploadError extends Error {
  /** Вид сбоя; определяет сообщение и стратегию повтора. */
  readonly code: UploadErrorCode
  /** Значения для локализованного сообщения. */
  readonly params: UploadErrorParams

  /**
   * @param code Вид сбоя.
   * @param params Значения для локализованного сообщения.
   */
  constructor(code: UploadErrorCode, params: UploadErrorParams = {}) {
    super(params.detail ? `${code}: ${params.detail}` : code)
    this.name = 'UploadError'
    this.code = code
    this.params = params
  }
}

/** Временные сбои: запись повторится сама, с растущей паузой. */
const TRANSIENT_CODES: ReadonlySet<UploadErrorCode> = new Set<UploadErrorCode>([
  'offline', 'hostUnreachable', 'timeout', 'notFound', 'exists', 'locked', 'busy', 'verifyFailed', 'io',
])

/** `true`, если сбой с таким кодом стоит повторить автоматически. */
export const isTransientUploadError = (code: UploadErrorCode) => TRANSIENT_CODES.has(code)

/** Приводит любое выброшенное значение к `UploadError`; готовые ошибки возвращает как есть. */
export function toUploadError(error: unknown): UploadError {
  if (error instanceof UploadError) return error
  return new UploadError('io', { detail: error instanceof Error ? error.message : String(error) })
}
