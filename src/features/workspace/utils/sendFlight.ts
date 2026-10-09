import { prefersReducedMotion } from './motion'

/** Полёт одного снимка к «Загрузкам», мс. */
const FLIGHT_MS = 620
/** Сдвиг старта соседних снимков, мс: из сетки они улетают друг за другом. */
const STAGGER_MS = 50

/** Идущая «отправка»: исходные элементы скрыты, их копии летят к кнопке «Загрузки». */
export interface SendFlight {
  /** Вернуть скрытые элементы (когда отправленные бирки уже убраны и на их месте другие). */
  restore: () => void
}

/** Фон под элементом: свой или ближайшего предка (у кнопки с фото фон прозрачный — берём фон карточки). */
function backgroundOf(element: HTMLElement): string {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor
    if (color && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)) return color
  }
  return 'transparent'
}

/**
 * «Отправка» фото: копии `elements` (фото открытой бирки или ячейки сетки) улетают по дуге к кнопке
 * «Загрузки» в шапке — уменьшаются, скругляются в кружок и растворяются у значка, а значок в момент
 * прилёта слегка «принимает» их (пульс). Сами элементы и `hide` (кнопки поверх фото) сразу гаснут.
 * Копии живут в `body` поверх всего и убираются сами, поэтому бирки можно убирать, не дожидаясь конца полёта.
 * Если пользователь просил уменьшить движение — элементы просто гаснут.
 */
export function flyToUploads(elements: readonly HTMLElement[], hide: readonly HTMLElement[] = []): SendFlight {
  // Исходные гаснут с небольшой задержкой: копия поверх них сначала должна отрисоваться (фото в ней
  // декодируется не в тот же кадр), иначе на кадр карточка оставалась бы пустой.
  const hidden = [...elements, ...hide].map((element) => element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, delay: 90, easing: 'ease-out', fill: 'forwards' }))
  const restore = () => hidden.forEach((animation) => animation.cancel())
  if (elements.length === 0 || prefersReducedMotion()) return { restore }

  const target = document.querySelector<HTMLElement>('[data-fly-target="uploads"] .action-button-icon')
  const targetRect = target?.getBoundingClientRect()
  const hasTarget = targetRect !== undefined && targetRect.width > 0
  let flights = 0
  elements.forEach((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const radius = getComputedStyle(element).borderTopLeftRadius
    // Внешний слой летит по горизонтали, внутренний — по вертикали и уменьшается: разные кривые по осям дают дугу.
    const outer = document.createElement('div')
    outer.className = 'send-flight'
    Object.assign(outer.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
    const box = document.createElement('div')
    box.className = 'send-flight-box'
    box.style.background = backgroundOf(element)
    box.style.borderRadius = radius
    const copy = element.cloneNode(true) as HTMLElement
    copy.classList.add('send-flight-copy')
    copy.removeAttribute('id')
    box.append(copy)
    outer.append(box)
    document.body.append(outer)

    const dx = hasTarget ? targetRect.left + targetRect.width / 2 - (rect.left + rect.width / 2) : 0
    const dy = hasTarget ? targetRect.top + targetRect.height / 2 - (rect.top + rect.height / 2) : -rect.height * 0.4
    const endScale = hasTarget ? Math.max(0.04, Math.min(targetRect.height, 28) / rect.width) : 0.6
    const delay = flights * STAGGER_MS
    flights += 1
    const timing = { duration: FLIGHT_MS, delay, fill: 'both' as const }
    const horizontal = outer.animate(
      [{ transform: 'none' }, { transform: `translateX(${dx}px)` }],
      { ...timing, easing: 'cubic-bezier(.5, 0, .5, 1)' },
    )
    const vertical = box.animate([
      { transform: 'none', opacity: 1, borderRadius: radius },
      // Короткий «замах»: снимок чуть сжимается на месте, прежде чем улететь.
      { transform: 'scale(.94)', opacity: 1, offset: 0.12 },
      { opacity: 1, offset: 0.7 },
      { transform: `translateY(${dy}px) scale(${endScale})`, opacity: 0, borderRadius: `${Math.max(rect.width, rect.height) / 2}px` },
    ], { ...timing, easing: 'cubic-bezier(.35, 0, .25, 1)' })
    const remove = () => outer.remove()
    void Promise.all([horizontal.finished, vertical.finished]).then(remove, remove)
  })

  // Значок «Загрузок» принимает снимки: короткий пульс с прилётом первого (длиннее, если летят несколько).
  if (target && hasTarget && flights > 0) {
    target.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.35 }, { transform: 'scale(1)' }],
      { duration: 360 + (flights - 1) * STAGGER_MS, delay: FLIGHT_MS * 0.8, easing: 'ease-out' },
    )
  }
  return { restore }
}
