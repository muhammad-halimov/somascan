/**
 * Очередь к общему серверу LM Studio между устройствами.
 *
 * Сервер у телефонов один, а модель в его памяти — одна на всех: смена модели на одном телефоне
 * выгружает модель, которой распознаёт другой, и его запрос обрывается. LM Studio не сообщает,
 * занята ли модель, поэтому устройства отмечаются сами — файлами-отметками в общем хранилище
 * таблицы (`LeaseBoard`: папка на сетевом диске или Google Drive, где лежит журнал):
 *
 * - `using` — устройство распознаёт (идёт хотя бы один запрос к серверу);
 * - `switching` — устройство меняет модель (выгружает и загружает).
 *
 * Смена модели ждёт, пока на сервере никто не распознаёт и не меняет модель (и это устройство тоже),
 * затем ставит `switching` и перечитывает отметки: если кто-то успел начать — снимает свою и ждёт дальше.
 * Распознавание ставит `using` и перечитывает отметки: если чужая смена уже идёт — снимает свою и ждёт
 * её конца. Так ни одно распознавание не обрывается сменой модели, а смена не начинается посреди чужого
 * распознавания. Отменить можно и ожидание, и саму смену или распознавание — отметка снимается сразу.
 *
 * Отметка живёт `ttlMs` и продлевается, пока устройство занято: упавший или выключенный телефон
 * перестаёт мешать через `ttlMs`. Сроки сравниваются по часам устройств (телефоны сверяют время по сети).
 * Хранилище недоступно или не настроено — устройство работает без очереди, как раньше: отметки —
 * помощь, а не условие распознавания.
 * РИСК: Google Drive отдаёт список файлов с небольшой задержкой; если два устройства начнут смену
 * и распознавание в одну и ту же секунду, распознавание может оборваться.
 */

/** Чем занято устройство. */
export type LeaseKind = 'using' | 'switching'

/** Отметка устройства. */
export interface Lease {
  /** Id устройства. */
  device: string
  /** Чем занято. */
  kind: LeaseKind
  /** Сервер LM Studio (`host:port`): устройства с разными серверами друг другу не мешают. */
  server: string
  /** До какого времени отметка действует (мс с начала эпохи). */
  until: number
}

/** Общая папка отметок: по одной отметке на устройство. */
export interface LeaseBoard {
  /** Все отметки, в том числе свои и просроченные. */
  list(): Promise<Lease[]>
  /** Ставит или обновляет отметку устройства `lease.device`. */
  put(lease: Lease): Promise<void>
  /** Убирает отметку устройства; её нет — не ошибка. */
  remove(device: string): Promise<void>
}

/** Параметры `ModelUseGate`. */
export interface ModelUseGateOptions {
  /** Id этого устройства. */
  device: string
  /** Папка отметок по текущим настройкам; `null` — общего хранилища нет, очереди тоже. */
  board: () => Promise<LeaseBoard | null> | LeaseBoard | null
  /** Сколько живёт отметка без продления, мс. */
  ttlMs?: number
  /** Как часто продлевать свою отметку, мс. */
  heartbeatMs?: number
  /** Как часто ожидание перечитывает отметки, мс. */
  pollMs?: number
  /** Сколько ждать хранилище, мс: дольше — работаем без очереди. */
  boardTimeoutMs?: number
  /** Часы. */
  now?: () => number
  /** Случайное число от 0 до 1 (разброс повторов, когда два устройства начали смену разом). */
  random?: () => number
}

/** Сколько живёт отметка без продления: столько упавшее устройство держит чужую смену модели. */
const TTL_MS = 60_000
/** Как часто продлевать отметку. */
const HEARTBEAT_MS = 20_000
/** Как часто ожидание перечитывает отметки. */
const POLL_MS = 3_000
/** Сколько ждать хранилище. */
const BOARD_TIMEOUT_MS = 5_000

/** Ожидание, которое прерывается сигналом (ошибка отмены — `signal.reason`). */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Промис, который прерывается сигналом. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/** Очередь устройства к общему серверу LM Studio (см. описание модуля). */
export class ModelUseGate {
  private readonly device: string
  private readonly boardOf: ModelUseGateOptions['board']
  private readonly ttlMs: number
  private readonly heartbeatMs: number
  private readonly pollMs: number
  private readonly boardTimeoutMs: number
  private readonly now: () => number
  private readonly random: () => number

  /** Сколько распознаваний этого устройства идёт сейчас. */
  private uses = 0
  /** Своя отметка `switching` поставлена (смена модели идёт). */
  private switching = false
  /** Сервер последней работы — для отметки. */
  private server = ''
  /** Своя смена модели (от начала ожидания до конца): новые распознавания этого устройства ждут её. */
  private ownSwitch: Promise<void> | null = null
  /** Записи своей отметки — строго по очереди, последняя отражает текущее состояние. */
  private writes: Promise<void> = Promise.resolve()
  /** Что сейчас подтверждённо лежит в хранилище от этого устройства. */
  private published: LeaseKind | null = null
  /** Продление отметки. */
  private heartbeat: ReturnType<typeof setInterval> | null = null
  /** Ждут, пока распознавания этого устройства закончатся. */
  private idleWaiters: Array<() => void> = []

  /** @param options Устройство, хранилище отметок и сроки. */
  constructor(options: ModelUseGateOptions) {
    this.device = options.device
    this.boardOf = options.board
    this.ttlMs = options.ttlMs ?? TTL_MS
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS
    this.pollMs = options.pollMs ?? POLL_MS
    this.boardTimeoutMs = options.boardTimeoutMs ?? BOARD_TIMEOUT_MS
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
  }

  /**
   * Распознавание на сервере `server`: ждёт, пока идёт чужая или своя смена модели, и отмечает
   * устройство занятым. Отметка снимается, когда все распознавания устройства вызвали `release`.
   * @returns `release` — вызвать, когда запрос к серверу закончился (успешно, с ошибкой или отменён).
   * @throws `signal.reason`, если распознавание отменили во время ожидания.
   */
  async use(server: string, signal?: AbortSignal): Promise<() => void> {
    for (;;) {
      signal?.throwIfAborted()
      if (this.ownSwitch) {
        await abortable(this.ownSwitch, signal)
        continue
      }
      // Отметка уже стоит (идёт другое распознавание этого устройства) — её видят все, проверять нечего.
      const covered = this.uses > 0 && this.published === 'using' && this.server === server
      this.uses += 1
      this.server = server
      if (covered) return this.releaser()
      const board = await this.boardOrNull()
      if (!board) return this.releaser()
      await this.publish(board)
      if (await this.busyOthers(board, server, ['switching']) === 0) return this.releaser()
      // Чужая смена модели уже идёт: уступаем и ждём её конца.
      this.endUse()
      await wait(this.pollMs, signal)
    }
  }

  /**
   * Смена модели на сервере `server`: ждёт, пока все (и это устройство) закончат распознавать
   * или менять модель или отменят, и отмечает устройство меняющим модель.
   * @param onWait Сколько устройств сейчас занято (это устройство тоже считается) — пока смена ждёт.
   * @returns `release` — вызвать, когда смена закончилась (успешно, с ошибкой или отменена).
   * @throws `signal.reason`, если смену отменили во время ожидания.
   */
  async acquireSwitch(server: string, signal: AbortSignal, onWait: (devices: number) => void): Promise<() => void> {
    let finish!: () => void
    const own = new Promise<void>((resolve) => { finish = resolve })
    this.ownSwitch = own
    const end = () => {
      if (this.ownSwitch === own) this.ownSwitch = null
      finish()
    }
    try {
      for (;;) {
        signal.throwIfAborted()
        if (this.uses > 0) {
          onWait(1)
          await abortable(new Promise<void>((resolve) => this.idleWaiters.push(resolve)), signal)
          continue
        }
        const board = await this.boardOrNull()
        if (!board) break
        const busy = await this.busyOthers(board, server, ['using', 'switching'])
        if (busy > 0) {
          onWait(busy)
          await wait(this.pollMs, signal)
          continue
        }
        this.switching = true
        this.server = server
        await this.publish(board)
        const contenders = await this.busyOthers(board, server, ['using', 'switching'])
        if (contenders === 0) break
        // Кто-то начал одновременно с нами: уступаем и пробуем снова через случайную паузу.
        this.switching = false
        void this.publish(board)
        onWait(contenders)
        await wait(this.pollMs * (0.3 + this.random() * 0.7), signal)
      }
    } catch (error) {
      this.endSwitch()
      end()
      throw error
    }
    let released = false
    return () => {
      if (released) return
      released = true
      this.endSwitch()
      end()
    }
  }

  /** Освобождение одного распознавания (повторный вызов ничего не делает). */
  private releaser(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.endUse()
    }
  }

  /** Распознавание закончилось: последнее снимает отметку и отпускает ждущую смену модели. */
  private endUse() {
    this.uses -= 1
    if (this.uses > 0) return
    void this.publishCurrent()
    const waiters = this.idleWaiters
    this.idleWaiters = []
    waiters.forEach((resolve) => resolve())
  }

  /** Смена модели закончилась: снимаем отметку `switching`. */
  private endSwitch() {
    if (!this.switching) return
    this.switching = false
    void this.publishCurrent()
  }

  /** Записывает текущее состояние в хранилище по текущим настройкам. */
  private async publishCurrent() {
    const board = await this.boardOrNull()
    if (board) await this.publish(board)
    else this.published = null
  }

  /** Своя отметка по текущему состоянию или `null` — устройство свободно. */
  private currentLease(): Lease | null {
    const kind: LeaseKind | null = this.switching ? 'switching' : this.uses > 0 ? 'using' : null
    return kind && { device: this.device, kind, server: this.server, until: this.now() + this.ttlMs }
  }

  /**
   * Ставит, обновляет или снимает свою отметку — по состоянию на момент записи, строго после
   * предыдущих записей. Отказ хранилища не мешает работе (очередь — помощь, а не условие).
   */
  private publish(board: LeaseBoard): Promise<void> {
    const task = this.writes.then(async () => {
      const lease = this.currentLease()
      try {
        if (lease) await this.withTimeout(board.put(lease))
        else await this.withTimeout(board.remove(this.device))
        this.published = lease?.kind ?? null
      } catch (error) {
        this.published = null
        console.warn('[lmstudio] lease', error)
      }
      this.keepAlive(board, lease !== null)
    })
    this.writes = task
    return task
  }

  /** Продлевает отметку, пока устройство занято. */
  private keepAlive(board: LeaseBoard, active: boolean) {
    if (active && !this.heartbeat) {
      this.heartbeat = setInterval(() => void this.publish(board), this.heartbeatMs)
    } else if (!active && this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
  }

  /** Сколько других устройств на этом сервере заняты (по действующим отметкам видов `kinds`). */
  private async busyOthers(board: LeaseBoard, server: string, kinds: readonly LeaseKind[]): Promise<number> {
    let leases: Lease[]
    try {
      leases = await this.withTimeout(board.list())
    } catch (error) {
      console.warn('[lmstudio] leases', error)
      return 0
    }
    const now = this.now()
    return new Set(leases
      .filter((lease) => lease.device !== this.device && lease.server === server && lease.until > now && kinds.includes(lease.kind))
      .map((lease) => lease.device)).size
  }

  /** Хранилище отметок по текущим настройкам; не настроено или не отвечает — `null`. */
  private async boardOrNull(): Promise<LeaseBoard | null> {
    try {
      return await this.withTimeout(Promise.resolve(this.boardOf()))
    } catch (error) {
      console.warn('[lmstudio] lease board', error)
      return null
    }
  }

  /** Обрывает ожидание хранилища через `boardTimeoutMs`. */
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Хранилище отметок не отвечает')), this.boardTimeoutMs)
      promise.then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }
}
