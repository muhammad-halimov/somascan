import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AddIcon, ChevronRightIcon, GridIcon, ImageIcon, ResetIcon, RotateClockwiseIcon, ZoomOutIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import type { PhotoTransform } from '../hooks/usePhotoTransform'
import { motionTiming, prefersReducedMotion } from '../utils/motion'
import './SlideBar.css'

/**
 * Сколько панель держится в DOM, уходя (`usePresence`), мс: чуть дольше её анимации — та идёт столько же,
 * сколько переход между сеткой и одной биркой (до 420 мс), и кончается вместе с ним.
 */
export const SLIDE_BAR_EXIT_MS = 460

/** Свойства `SlideBar`. */
export interface SlideBarProps {
  /** Номер открытой бирки (последняя позиция — пустая ячейка, если бирок меньше девяти). */
  activeIndex: number
  /** Сколько позиций можно листать: бирки и (пока их меньше девяти) пустая ячейка за ними. */
  positions: number
  /** Сейчас на экране сетка: «Открыть» увеличивает выбранную ячейку до одной бирки; у одной бирки на её месте — «Сетка». */
  isGrid: boolean
  /** Предыдущая бирка. */
  onPrevious: () => void
  /** Следующая бирка (или пустая ячейка). */
  onNext: () => void
  /** Открыть выбранную бирку (из сетки). */
  onOpen: () => void
  /** Показать все бирки сеткой (у одной бирки). */
  onShowGrid: () => void
  /** Масштаб и поворот фото открытой бирки: кнопки по сторонам от листания. */
  transform: PhotoTransform
  /** Фото готово (одна бирка, фото есть и не загружается, не распознаётся): кнопки масштаба и поворота видны. */
  toolsShown: boolean
  /** Одна бирка: панель не полоса под фото, а кнопки поверх его низа; в сетке — снова полоса. */
  isFloating: boolean
  /** Панель уходит: схлопывается по высоте и гаснет (см. `usePresence`). */
  isClosing?: boolean
}

/** Свойство CSS блока фото: высота панели — на столько она поднята над низом фото, пока парит (`SlideBar.css`). */
const BAR_HEIGHT_PROPERTY = '--slide-bar-height'

/**
 * Панель листания — нижняя часть блока фото: листать бирки (уголки влево и вправо) и справа от них
 * переключатель вида: в сетке — «Открыть» (тот же значок фото, что и в углу сетки) увеличивает выбранную
 * ячейку до одной бирки, у одной бирки — «Сетка» показывает все; в сетке уголки передвигают выбор
 * по ячейкам, у одной бирки — листают бирки как слайды. По сторонам от них — кнопки фото (только у готового
 * фото одной бирки, иначе гаснут, не сдвигая листание): слева масштаб («меньше», «больше»), справа поворот
 * и «Сброс» (исходный масштаб и поворот).
 * Кнопки компактные, без подписей (доступные имена — для экранных дикторов); на iOS 26+ — стеклянная
 * «пилюля» внутри блока.
 *
 * У одной бирки панель парит поверх низа фото — без полосы под ним; в сетке полоса возвращается: блок фото плавно
 * растёт вниз, и кнопки съезжают в неё (с той же кривой и длительностью, что и переход к сетке, — оба движения
 * идут вместе).
 *
 * Появляется и уходит плавно: полоса растёт и сжимается по высоте (карточка результата под блоком съезжает
 * вместе с ней, а не прыгает), кнопки проявляются; парящие кнопки только проявляются.
 */
export function SlideBar({ activeIndex, positions, isGrid, onPrevious, onNext, onOpen, onShowGrid, transform, toolsShown, isFloating, isClosing = false }: SlideBarProps) {
  const { t } = useTranslation('workspace')
  const { canZoomIn, canZoomOut, isPristine, zoomIn, zoomOut, rotate, reset } = transform
  const barRef = useRef<HTMLDivElement>(null)
  /** Парит ли панель сейчас (для появления и для перехода между «парит» и «полоса»). */
  const floatingRef = useRef(isFloating)
  /** Идущий переход между «парит» и «полоса» (null — панель на месте). */
  const liftRef = useRef<Animation | null>(null)

  // Высота панели — блоку фото: на столько парящая панель поднята над низом фото, и столько места над ней
  // оставляют кнопки внизу фото («Без фото», кнопки масштаба поверх фото).
  useLayoutEffect(() => {
    const bar = barRef.current
    const block = bar?.parentElement
    if (!bar || !block) return
    const measure = () => block.style.setProperty(BAR_HEIGHT_PROPERTY, `${bar.offsetHeight}px`)
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(bar)
    return () => {
      resize.disconnect()
      block.style.removeProperty(BAR_HEIGHT_PROPERTY)
    }
  }, [])

  // «Парит» ↔ «полоса»: панель опускается под фото (блок растёт) или поднимается на него — вместе с переходом
  // к сетке и обратно. Переход, начатый посреди другого, начинается с того места, где панель сейчас. Пока панель
  // едет (`is-moving`), стекло «пилюль» размывает фото под ними и в полосе: оно не пропадает и не появляется рывком.
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || floatingRef.current === isFloating) return
    floatingRef.current = isFloating
    const lifted = `${-bar.offsetHeight}px`
    const running = liftRef.current
    const from = running ? getComputedStyle(bar).marginTop : isFloating ? '0px' : lifted
    running?.cancel()
    liftRef.current = null
    if (prefersReducedMotion()) return
    const lift = bar.animate([{ marginTop: from }, { marginTop: isFloating ? lifted : '0px' }], motionTiming())
    liftRef.current = lift
    bar.classList.add('is-moving')
    void lift.finished.then(() => {
      liftRef.current = null
      bar.classList.remove('is-moving')
    }, () => undefined)
  }, [isFloating])
  useLayoutEffect(() => () => liftRef.current?.cancel(), [])

  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || prefersReducedMotion()) return
    const pillFrames: Keyframe[] = [
      { transform: 'translateY(-8px) scale(.92)', opacity: 0 },
      { transform: 'none', opacity: 1 },
    ]
    // Та же кривая и длительность, что у перехода между сеткой и одной биркой: оба движения идут вместе.
    const timing = { ...motionTiming(), fill: 'both' as const }
    // листание и кнопки фото по сторонам проявляются вместе
    const animations = Array.from(bar.children, (child) => child.animate(isClosing ? [...pillFrames].reverse() : pillFrames, timing))
    // Полоса растёт по высоте; парящая панель места под фото не занимает — только проявляется.
    if (!floatingRef.current) {
      // Высота растёт от нуля вместе с отступами: без них панель сразу занимала свои 11 px и замирала
      // (а уходя — застревала на них и пропадала рывком).
      const { paddingTop, paddingBottom } = getComputedStyle(bar)
      const height = bar.getBoundingClientRect().height
      const frames: Keyframe[] = [
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
        { height: `${height}px`, paddingTop, paddingBottom, opacity: 1 },
      ]
      // Пока высота меняется, содержимое обрезается по панели (в покое тень «пилюли» не обрезаем).
      bar.classList.add('is-revealing')
      animations.push(bar.animate(isClosing ? [...frames].reverse() : frames, timing))
    }
    let cancelled = false
    void Promise.all(animations.map((animation) => animation.finished)).then(() => {
      if (cancelled || isClosing) return
      // Открылась: конечные кадры равны обычным стилям — анимации больше не нужны.
      animations.forEach((animation) => animation.cancel())
      bar.classList.remove('is-revealing')
    }, () => undefined)
    return () => {
      cancelled = true
      animations.forEach((animation) => animation.cancel())
      bar.classList.remove('is-revealing')
    }
  }, [isClosing])

  return (
    <div ref={barRef} className={`slide-bar${isFloating ? ' is-floating' : ''}`} role="group" aria-label={t('slides.group')} inert={isClosing || undefined}>
      <div className={`slide-bar-tools is-start${toolsShown ? '' : ' is-hidden'}`} role="group" aria-label={t('photo.controls')} inert={!toolsShown || undefined}>
        <ActionButton size={32} icon={<ZoomOutIcon />} caption={t('controls.zoomOut')} label={t('photo.zoomOut')} disabled={!canZoomOut} onClick={zoomOut} />
        <ActionButton size={32} icon={<AddIcon />} caption={t('controls.zoomIn')} label={t('photo.zoomIn')} disabled={!canZoomIn} onClick={zoomIn} />
      </div>
      <div className="slide-bar-pill">
        <ActionButton
          className="slide-bar-previous"
          size={32}
          icon={<ChevronRightIcon />}
          caption={t('slides.previous')}
          label={t('slides.previousLabel')}
          disabled={activeIndex <= 0}
          onClick={onPrevious}
        />
        <ActionButton
          size={32}
          icon={<ChevronRightIcon />}
          caption={t('slides.next')}
          label={t('slides.nextLabel')}
          disabled={activeIndex >= positions - 1}
          onClick={onNext}
        />
        {/* Переключатель вида: в сетке — «Открыть» выбранную бирку (фото), у одной бирки — «Сетка». */}
        {isGrid ? (
          <ActionButton key="open" className="slide-bar-toggle" size={32} variant="accent" icon={<ImageIcon />} caption={t('slides.open')} label={t('slides.openLabel')} onClick={onOpen} />
        ) : (
          <ActionButton key="grid" className="slide-bar-toggle" size={32} icon={<GridIcon />} caption={t('slides.grid')} label={t('slides.gridLabel')} onClick={onShowGrid} />
        )}
      </div>
      <div className={`slide-bar-tools is-end${toolsShown ? '' : ' is-hidden'}`} role="group" aria-label={t('photo.controls')} inert={!toolsShown || undefined}>
        <ActionButton size={32} icon={<RotateClockwiseIcon />} caption={t('controls.rotate')} label={t('photo.rotate')} onClick={rotate} />
        <ActionButton size={32} icon={<ResetIcon />} caption={t('controls.reset')} label={t('controls.resetLabel')} disabled={isPristine} onClick={reset} />
      </div>
    </div>
  )
}
