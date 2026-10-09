import { useCallback, useEffect, useRef, useState } from 'react'
import type { LabelKey, LabelRecord } from '@/features/recognition/label/labelFields'
import { PRODUCT_FORM_KEY } from '@/features/recognition/label/productForm'
import type { PhotoVerdict } from '@/features/recognition/LabelRecognizer'
import { useErrorText } from '@/features/recognition/useErrorText'
import type { Size } from '../utils/PhotoGeometry'
import { recognizeLabel } from '../utils/recognizeLabel'
import { makeThumbnail } from '../utils/thumbnail'

/** Сколько бирок можно держать на экране одновременно (сетка 3 × 3). */
export const MAX_SCAN_ITEMS = 9

/** Сколько фото распознаётся одновременно: остальные ждут (провайдеры ограничивают частоту запросов). */
const RECOGNITION_CONCURRENCY = 2

/** Состояние распознавания. */
export type RecognitionStatus =
  /** Ничего не распознавалось (нет фото). */
  | { kind: 'idle' }
  /** Запрос выполняется или ждёт очереди. */
  | { kind: 'recognizing' }
  /** Бирка распознана; `photo` — стоит ли переснять фото. */
  | { kind: 'done'; label: LabelRecord; photo: PhotoVerdict }
  /** Ошибка; `message` уже переведено на язык интерфейса. */
  | { kind: 'failed'; message: string }
  /** Пользователь отменил распознавание; фото осталось, его можно распознать снова («Повтор»). */
  | { kind: 'cancelled' }

/** Пустое состояние распознавания. */
export const IDLE: RecognitionStatus = { kind: 'idle' }

/** Одна бирка на экране: фото и его распознавание. */
export interface ScanItem {
  /** Постоянный id (номер в сетке меняется, когда бирку перед ней убрали). */
  id: string
  /** Фото (`blob:` или путь WebView). */
  photoUrl: string
  /** Миниатюра для сетки; `null` — ещё готовится. Если её не получилось сделать — само фото. */
  thumbUrl: string | null
  /** Натуральный размер фото (известен, когда фото декодировано для миниатюры или загрузилось в карточке). */
  naturalSize: Size | null
  /** Фото ещё не загружено (не декодировано). */
  isLoading: boolean
  /** Фото не открылось. */
  hasError: boolean
  /** Распознавание. */
  status: RecognitionStatus
  /** Выбранная вручную форма поставки: переживает «Повтор» того же фото. */
  productForm: string | null
}

let nextId = 0

/** Освобождает память фото и миниатюры, выбранных в браузере (`blob:`). */
function revoke(item: ScanItem) {
  if (item.photoUrl.startsWith('blob:')) URL.revokeObjectURL(item.photoUrl)
  if (item.thumbUrl && item.thumbUrl !== item.photoUrl) URL.revokeObjectURL(item.thumbUrl)
}

/**
 * Бирки на главном экране — до девяти фото сразу (сетка 3 × 3), одна из них открыта.
 *
 * Бирки идут по порядку, без пропусков: новые фото встают в конец, убранная бирка сдвигает следующие.
 * Каждое фото распознаётся само (не больше `RECOGNITION_CONCURRENCY` запросов одновременно,
 * остальные ждут), с настройками на момент запроса; для сетки строится миниатюра.
 *
 * `activeIndex` — открытая бирка; значение `items.length` (пока бирок меньше девяти) — следующая
 * пустая ячейка: карточка «Добавить фото».
 */
export function useScanSession() {
  const errorText = useErrorText()
  const errorTextRef = useRef(errorText)
  useEffect(() => {
    errorTextRef.current = errorText
  })

  const [items, setItems] = useState<ScanItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  /** Текущий список для асинхронных обновлений (распознавание, миниатюры): единый источник правды. */
  const itemsRef = useRef<ScanItem[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const waiting = useRef<string[]>([])
  const running = useRef(0)

  const commit = useCallback((next: ScanItem[]) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  /** Меняет бирку `id`, если она ещё на экране. */
  const patch = useCallback((id: string, change: (item: ScanItem) => Partial<ScanItem>) => {
    if (!itemsRef.current.some((item) => item.id === id)) return
    commit(itemsRef.current.map((item) => (item.id === id ? { ...item, ...change(item) } : item)))
  }, [commit])

  /** Отменяет распознавание бирки (идущее или ждущее очереди). */
  const stopRecognition = useCallback((id: string) => {
    controllers.current.get(id)?.abort()
    controllers.current.delete(id)
    waiting.current = waiting.current.filter((waitingId) => waitingId !== id)
  }, [])

  const run = useCallback(async (id: string) => {
    const item = itemsRef.current.find((candidate) => candidate.id === id)
    if (!item) return
    const controller = new AbortController()
    controllers.current.set(id, controller)
    try {
      const { label, photo } = await recognizeLabel(item.photoUrl, controller.signal)
      if (controller.signal.aborted) return
      patch(id, (current) => ({ status: { kind: 'done', label: { ...label, [PRODUCT_FORM_KEY]: current.productForm }, photo } }))
    } catch (error) {
      // Отменено: бирку убрали, заменили фото или распознают заново — результат не нужен.
      if (controller.signal.aborted) return
      patch(id, () => ({ status: { kind: 'failed', message: errorTextRef.current(error) } }))
    } finally {
      if (controllers.current.get(id) === controller) controllers.current.delete(id)
    }
  }, [patch])

  /** Запускает ждущие распознавания, пока есть место. */
  const pump = useCallback(function startWaiting() {
    while (running.current < RECOGNITION_CONCURRENCY && waiting.current.length > 0) {
      const id = waiting.current.shift()!
      running.current += 1
      void run(id).finally(() => {
        running.current -= 1
        startWaiting()
      })
    }
  }, [run])

  /** Ставит бирку в очередь распознавания (с начала: прежний запрос отменяется). */
  const schedule = useCallback((id: string) => {
    stopRecognition(id)
    patch(id, () => ({ status: { kind: 'recognizing' } }))
    waiting.current.push(id)
    pump()
  }, [patch, pump, stopRecognition])

  /** Новая бирка для фото. */
  const create = useCallback((photoUrl: string): ScanItem => ({
    id: `scan-${++nextId}`,
    photoUrl,
    thumbUrl: null,
    naturalSize: null,
    isLoading: true,
    hasError: false,
    status: { kind: 'recognizing' },
    productForm: null,
  }), [])

  /** Распознавание и миниатюра новой бирки. */
  const prepare = useCallback((item: ScanItem) => {
    schedule(item.id)
    void makeThumbnail(item.photoUrl).then((thumbnail) => {
      if (!itemsRef.current.some((candidate) => candidate.id === item.id)) {
        if (thumbnail) URL.revokeObjectURL(thumbnail.url)
        return
      }
      // Фото декодировано: размер известен, карточка не показывает загрузку, когда бирку откроют.
      patch(item.id, (current) => (thumbnail
        ? { thumbUrl: thumbnail.url, naturalSize: current.naturalSize ?? { width: thumbnail.width, height: thumbnail.height }, isLoading: false }
        : { thumbUrl: current.photoUrl }))
    })
  }, [patch, schedule])

  /**
   * Добавляет фото в конец (по порядку, без пропусков) и открывает первое из них.
   * @returns Сколько фото не поместилось (бирок уже девять).
   */
  const add = useCallback((urls: readonly string[]) => {
    const list = itemsRef.current
    const added = urls.slice(0, MAX_SCAN_ITEMS - list.length).map(create)
    for (const url of urls.slice(added.length)) if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    if (added.length === 0) return urls.length
    commit([...list, ...added])
    setActiveIndex(list.length)
    added.forEach(prepare)
    return urls.length - added.length
  }, [commit, create, prepare])

  /** Заменяет фото бирки `index` (распознавание — заново). */
  const replace = useCallback((index: number, url: string) => {
    const old = itemsRef.current[index]
    if (!old) return
    stopRecognition(old.id)
    revoke(old)
    const item = create(url)
    commit(itemsRef.current.map((candidate, position) => (position === index ? item : candidate)))
    setActiveIndex(index)
    prepare(item)
  }, [commit, create, prepare, stopRecognition])

  /** Убирает бирку `index`; следующие сдвигаются, открывается та, что встала на её место (или предыдущая). */
  const remove = useCallback((index: number) => {
    const item = itemsRef.current[index]
    if (!item) return
    stopRecognition(item.id)
    revoke(item)
    const next = itemsRef.current.filter((candidate) => candidate.id !== item.id)
    commit(next)
    setActiveIndex(next.length === 0 ? 0 : Math.min(index, next.length - 1))
  }, [commit, stopRecognition])

  /** Открывает бирку `index` или следующую пустую ячейку (`items.length`). */
  const select = useCallback((index: number) => {
    const last = Math.min(itemsRef.current.length, MAX_SCAN_ITEMS - 1)
    setActiveIndex(Math.max(0, Math.min(index, last)))
  }, [])

  /** Распознаёт фото бирки `index` заново. */
  const retry = useCallback((index: number) => {
    const item = itemsRef.current[index]
    if (item) schedule(item.id)
  }, [schedule])

  /** Отменяет распознавание бирки `index` по просьбе пользователя: фото остаётся, результат — «отменено». */
  const abort = useCallback((index: number) => {
    const item = itemsRef.current[index]
    if (!item || item.status.kind !== 'recognizing') return
    stopRecognition(item.id)
    patch(item.id, () => ({ status: { kind: 'cancelled' } }))
  }, [patch, stopRecognition])

  /** Правит поле распознанной бирки `index`. */
  const updateField = useCallback((index: number, key: LabelKey, value: string) => {
    const item = itemsRef.current[index]
    if (!item) return
    patch(item.id, (current) => ({
      productForm: key === PRODUCT_FORM_KEY ? value || null : current.productForm,
      status: current.status.kind === 'done' ? { ...current.status, label: { ...current.status.label, [key]: value } } : current.status,
    }))
  }, [patch])

  /** Фото бирки загрузилось в карточке. */
  const markLoaded = useCallback((id: string, naturalSize: Size) => {
    patch(id, () => ({ naturalSize, isLoading: false }))
  }, [patch])

  /** Фото бирки не открылось. */
  const markFailed = useCallback((id: string) => {
    patch(id, () => ({ isLoading: false, hasError: true }))
  }, [patch])

  // Уход с экрана: запросы отменяются, память фото освобождается.
  useEffect(() => () => {
    for (const controller of controllers.current.values()) controller.abort()
    itemsRef.current.forEach(revoke)
  }, [])

  return {
    items,
    activeIndex,
    /** Открытая бирка или `null` — открыта пустая ячейка. */
    active: items[activeIndex] ?? null,
    /** Можно ли добавить ещё фото. */
    canAdd: items.length < MAX_SCAN_ITEMS,
    add,
    replace,
    remove,
    select,
    retry,
    abort,
    updateField,
    markLoaded,
    markFailed,
  }
}

/** Сессия бирок главного экрана. */
export type ScanSession = ReturnType<typeof useScanSession>
