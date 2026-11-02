import { scrollParentOf } from './scrollParent'

/**
 * Держит элемент на его месте экрана, пока раскладка вокруг меняется: сворачивается список, прячется клавиатура,
 * карточка меняет высоту. Ближайший прокручиваемый предок докручивается так, чтобы элемент оставался там же, где был.
 * Браузер iOS прокрутку сам не держит (нет scroll anchoring), и экран уезжал к началу.
 *
 * Держит, пока элемент не простоит на месте `SETTLED_FRAMES` кадров подряд (раскладка успокоилась), но не дольше
 * `MAX_HOLD_MS`. Касание или прокрутка пользователем отпускают сразу: его жест важнее.
 */

/** Сколько кадров подряд без сдвига — раскладка успокоилась (~¼ секунды при 60 кадрах). */
const SETTLED_FRAMES = 15

/** Дольше этого не держим: сворачивание списка и уход клавиатуры занимают меньше. */
const MAX_HOLD_MS = 1500

export function keepInPlace(element: HTMLElement): void {
  const scroller = scrollParentOf(element)
  if (!scroller) return
  // Место — относительно контейнера прокрутки: сдвиг всего экрана (видимая область iOS) — не повод докручивать.
  const offsetOf = () => element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  const target = offsetOf()
  const deadline = performance.now() + MAX_HOLD_MS
  let settled = 0
  let released = false
  const release = () => {
    released = true
    scroller.removeEventListener('touchstart', release)
    scroller.removeEventListener('wheel', release)
  }
  scroller.addEventListener('touchstart', release, { passive: true })
  scroller.addEventListener('wheel', release, { passive: true })

  const hold = () => {
    if (released) return
    const drift = offsetOf() - target
    if (Math.abs(drift) >= 1) {
      scroller.scrollTop += drift
      settled = 0
    } else {
      settled += 1
    }
    if (settled >= SETTLED_FRAMES || performance.now() > deadline) release()
    else requestAnimationFrame(hold)
  }
  requestAnimationFrame(hold)
}
