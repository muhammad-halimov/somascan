/**
 * Ответ HTTP со статусом не 2xx либо ответ 2xx, тело которого не является ожидаемым JSON.
 */
export class HttpError extends Error {
  /** Код статуса HTTP. */
  readonly status: number
  /** Текст ошибки, который сообщил сервер, если он его прислал. */
  readonly serverMessage: string | null

  /**
   * @param status Код статуса HTTP.
   * @param serverMessage Человекочитаемая ошибка из тела ответа, если есть.
   */
  constructor(status: number, serverMessage: string | null) {
    super(serverMessage ?? `HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
    this.serverMessage = serverMessage
  }
}
