import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { TOUCH_SLOP } from '@/lib/interaction/gestures'
import { motionTiming, prefersReducedMotion } from '../utils/motion'

/** Свайп длиннее этой доли высоты сцены закрывает просмотр. */
const CLOSE_DISTANCE = 0.18

/** Или быстрый взмах: скорость пальца в конце, px/мс. */
const CLOSE_VELOCITY = 0.5

/** На какой доле высоты сцены фон гаснет полностью (`--viewer-dismiss` = 1). */
const FADE_DISTANCE = 0.5

/** Класс просмотра, пока фото ведёт палец: без плавных переходов фона (`PhotoViewer.css`). */
const SWIPING_CLASS = 'is-swiping'

/** Параметры `useSwipeToClose`. */
export interface SwipeToCloseOptions {
  /** Окно просмотра: в нём `--viewer-dismiss` (0–1) гасит фон и кнопки. */
  viewerRef: RefObject<HTMLElement | null>
  /** Сцена с фото: сдвигается за пальцем (`translate`, не мешает анимациям `transform`). */
  stageRef: RefObject<HTMLElement | null>
  /** Свайп разрешён (фото не увеличено: тогда палец двигает фото). */
  enabled: boolean
  /** Закрыть просмотр. */
  onClose: () => void
}

/**
 * Свайп вверх или вниз закрывает просмотр фото: фото едет за пальцем, фон и кнопки гаснут. Отпустили дальше
 * `CLOSE_DISTANCE` или взмахом — просмотр закрывается (анимация закрытия идёт с места, где фото оставили),
 * иначе фото возвращается на место. Горизонтальный сдвиг и второй палец (щипок) свайпом не считаются.
 */
export function useSwipeToClose({ viewerRef, stageRef, enabled, onClose }: SwipeToCloseOptions) {
  const close = useRef(onClose)
  useLayoutEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    const viewer = viewerRef.current
    const stage = stageRef.current
    if (!viewer || !stage || !enabled) return
    let start: { x: number; y: number } | null = null
    let swiping = false
    let offset = 0
    /** Последние два положения пальца — для скорости взмаха. */
    let last = { y: 0, at: 0 }
    let velocity = 0

    const setOffset = (dy: number) => {
      offset = dy
      stage.style.translate = `0 ${dy}px`
      viewer.style.setProperty('--viewer-dismiss', String(Math.min(1, Math.abs(dy) / (stage.clientHeight * FADE_DISTANCE))))
    }
    const reset = () => {
      start = null
      swiping = false
      viewer.classList.remove(SWIPING_CLASS)
    }
    const settleBack = () => {
      const from = offset
      setOffset(0)
      stage.style.translate = ''
      viewer.style.removeProperty('--viewer-dismiss')
      if (!prefersReducedMotion()) stage.animate([{ translate: `0 ${from}px` }, { translate: '0 0' }], motionTiming())
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        if (swiping) settleBack()
        return reset()
      }
      const touch = event.touches[0]!
      start = { x: touch.clientX, y: touch.clientY }
      last = { y: touch.clientY, at: event.timeStamp }
      velocity = 0
    }
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || !start || event.touches.length !== 1) return
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (!swiping) {
        if (Math.hypot(dx, dy) <= TOUCH_SLOP) return
        // Сдвиг вбок — не свайп закрытия.
        if (Math.abs(dy) <= Math.abs(dx)) {
          start = null
          return
        }
        swiping = true
        viewer.classList.add(SWIPING_CLASS)
      }
      // Жест — наш: иначе браузер посчитает его броском прокрутки, и следующее касание (открыть фото снова)
      // уйдёт на остановку этой «инерции», а не на нажатие.
      if (event.cancelable) event.preventDefault()
      const elapsed = event.timeStamp - last.at
      if (elapsed > 0) velocity = (touch.clientY - last.y) / elapsed
      last = { y: touch.clientY, at: event.timeStamp }
      setOffset(dy)
    }
    const onTouchEnd = () => {
      if (!swiping) return reset()
      const far = Math.abs(offset) > stage.clientHeight * CLOSE_DISTANCE
      const flung = Math.abs(velocity) > CLOSE_VELOCITY && Math.sign(velocity) === Math.sign(offset)
      reset()
      if (far || flung) close.current()
      else settleBack()
    }

    stage.addEventListener('touchstart', onTouchStart, { passive: true })
    stage.addEventListener('touchmove', onTouchMove, { passive: false })
    stage.addEventListener('touchend', onTouchEnd)
    stage.addEventListener('touchcancel', onTouchEnd)
    return () => {
      stage.removeEventListener('touchstart', onTouchStart)
      stage.removeEventListener('touchmove', onTouchMove)
      stage.removeEventListener('touchend', onTouchEnd)
      stage.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [viewerRef, stageRef, enabled])
}
