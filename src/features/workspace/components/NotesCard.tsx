import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { AddIcon, CheckIcon, CloseIcon, ExclamationIcon, InfoIcon, NextIcon, PencilIcon, ResetIcon, TagIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { SkeletonLine } from '@/components/ui/SkeletonLine'
import { Tabs, type TabOption } from '@/components/ui/Tabs'
import { useLongPress } from '@/hooks/useLongPress'
import type { LabelKey } from '@/features/recognition/label/labelFields'
import { MAX_SCAN_ITEMS, type RecognitionStatus } from '../hooks/useScanSession'
import type { HeatDuplicate } from '../utils/sendReadiness'
import { attentionTone, type TagState } from '../utils/tagState'
import { LabelFields, LabelFieldsSkeleton } from './LabelFields'
import './NotesCard.css'

/** Свойства `NotesCard`. */
export interface NotesCardProps {
  /** Ref карточки: в режиме правки экран прокручивается к ней. */
  cardRef?: Ref<HTMLDivElement>
  /** Открытая бирка (её id): поля пересоздаются для другой бирки. */
  itemKey: string
  /** Сколько бирок на экране. */
  itemCount: number
  /** Состояние каждой бирки по порядку: рядом с номером — красный «!» (нет формы) или жёлтый (нет полей, повтор плавки, нет фото). */
  itemStates: readonly TagState[]
  /** Номер открытой бирки (`itemCount` — пустая ячейка). */
  activeIndex: number
  /** Перейти к бирке. */
  onSelectItem: (index: number) => void
  /** Режим правки включён. */
  isEditing: boolean
  /** Состояние распознавания. */
  status: RecognitionStatus
  /** Открыта бирка, а не пустая ячейка (иначе «Сброс» недоступен). */
  hasPhoto: boolean
  /** «Повтор» доступен: у бирки есть фото (бирку без фото распознавать нечего). */
  canRetry: boolean
  /** Сколько бирок распознает заново удержание «Повтора». */
  retryAllCount: number
  /** Бирка без фото: поля заполняют вручную, поля по умолчанию обязательны. */
  isManual: boolean
  /** Плавка открытой бирки повторяется (`heatDuplicates`). */
  heatDuplicate?: HeatDuplicate | null
  /** Поле бирки отредактировано. */
  onFieldChange: (key: LabelKey, value: string) => void
  /** «Правка»: включить режим правки, а нажатая ещё раз — отменить изменения и выйти. */
  onToggleEdit: () => void
  /** «Готово»: выйти из режима правки, сохранив изменения. */
  onCloseEdit: () => void
  /** «Фото»: выбрать другое фото. */
  onAddPhoto: () => void
  /** Крестик «Сброс»: очистить экран. */
  onClear: () => void
  /** Удержание «Сброса» (или нажатие на пустой ячейке): сбросить все бирки — очистить сетку. */
  onClearAll: () => void
  /** «Сброс» во время распознавания: прервать запрос, оставив фото. */
  onCancel: () => void
  /** «Повтор»: распознать то же фото заново. */
  onRetry: () => void
  /** Удержание «Повтора» (или нажатие, когда у открытой бирки фото нет): распознать заново все бирки. */
  onRetryAll: () => void
  /** «Далее»: поставить выбранные бирки в очередь выгрузки в таблицу. */
  onNext: () => void
  /** Сколько бирок выбрано для отправки (на «Далее» — счётчик, если их больше одной). */
  sendCount: number
  /** «Далее» нажата и экран очищается для следующей бирки: в кнопке крутится спиннер. */
  isUploading?: boolean
}

/** Узкая плашка-примечание вверху карточки результата: значок ⓘ и текст. */
function CardNotice({ text }: { text: string }) {
  return (
    <p className="notes-check anim-fade">
      <InfoIcon />
      <span>{text}</span>
    </p>
  )
}

/** Значок у номера бирки по её состоянию или `null`, если значка нет. */
function itemMark(state: TagState): ReactNode {
  if (state === 'busy') return <span className="notes-item-mark skeleton" />
  const tone = attentionTone(state)
  if (tone) return <span className={`notes-item-mark is-${tone}`}><ExclamationIcon /></span>
  if (state === 'done') return <span className="notes-item-mark is-done"><CheckIcon /></span>
  return null
}

/**
 * Карточка результата под фото: узкая полоса «Проверьте данные перед отправкой» (у распознанной бирки; пока фото
 * нет — «Поля заполнятся по фото бирки»; во время распознавания — её силуэт),
 * шапка с заголовком и кнопками правки, номера бирок (когда их
 * несколько — переход к любой: вкладки Material на Android, сегменты на iOS), распознанные поля
 * открытой бирки (пока фото нет — ровные силуэты полей, во время распознавания — переливающиеся, иначе ошибка) и панель действий «Фото», «Сброс» (во время распознавания —
 * прерывает его; удержание — сбросить все бирки), «Повтор» (удержание — повторить все бирки), «Далее».
 * У всех кнопок — подписи.
 */
export function NotesCard({ cardRef, itemKey, itemCount, itemStates, activeIndex, onSelectItem, isEditing, status, hasPhoto, canRetry, retryAllCount, isManual, heatDuplicate = null, onFieldChange, onToggleEdit, onCloseEdit, onAddPhoto, onClear, onClearAll, onCancel, onRetry, onRetryAll, onNext, sendCount, isUploading = false }: NotesCardProps) {
  const { t } = useTranslation(['workspace', 'errors', 'label'])
  const clearAllPress = useLongPress(onClearAll)
  const retryAllPress = useLongPress(onRetryAll)
  const isRecognizing = status.kind === 'recognizing'
  // Фото ещё нет: на местах плашки и полей — ровные силуэты (при распознавании они же переливаются).
  const isIdle = status.kind === 'idle'
  const actionsRef = useRef<HTMLDivElement>(null)

  // Высота панели действий — в `--notes-actions-height`: на телефоне панель внизу экрана, и рабочая область
  // оставляет под ней место (см. NotesCard.css). Шрифт и подписи на разных языках меняют высоту — меряем.
  // Следим за рамкой целиком (`border-box`): нижний отступ панели — безопасная зона, а её Capacitor
  // сообщает уже после первой отрисовки; по одному содержимому замер оставался старым, и конец карточки
  // результата уходил под панель.
  useLayoutEffect(() => {
    const actions = actionsRef.current
    if (!actions) return
    const root = document.documentElement
    const measure = () => root.style.setProperty('--notes-actions-height', `${Math.ceil(actions.getBoundingClientRect().height)}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(actions, { box: 'border-box' })
    return () => {
      observer.disconnect()
      root.style.removeProperty('--notes-actions-height')
    }
  }, [])
  // Править и отправлять в таблицу можно только распознанный результат: не во время запроса и не после ошибки.
  const canEdit = status.kind === 'done'

  // Заголовок карточки: «Данные с бирки» для результата, иначе нейтральное «Результат».
  const title = status.kind === 'done' ? t('label:title') : t('notes.label')
  // Номера бирок и (пока их меньше девяти) «+» — пустая ячейка для следующей. Рядом с номером — тот же значок,
  // что в углу ячейки бирки в сетке: зелёная галочка у готовой, красный или жёлтый «!» у ждущей действий
  // (`attentionTone`), у распознаваемой — силуэт значка, как у полей (диктору — словами).
  const itemOptions: TabOption<number>[] = Array.from({ length: itemCount }, (_, index) => {
    const state = itemStates[index] ?? 'none'
    const label = String(index + 1)
    const badge = itemMark(state)
    if (!badge || state === 'none') return { value: index, label }
    return { value: index, label, badge, ariaLabel: `${t('grid.item', { number: index + 1 })}: ${t(`grid.state.${state}`)}` }
  })
  if (itemCount < MAX_SCAN_ITEMS) itemOptions.push({ value: itemCount, label: '+' })

  return (
    <div ref={cardRef} className={`notes-card${isEditing ? ' is-text-editing' : ''}`} aria-busy={isRecognizing}>
      {/*
        Узкая плашка-примечание вверху карточки: у распознанной бирки — проверить данные перед отправкой, пока фото
        нет — что поля заполнятся по фото, пока бирка распознаётся — силуэт плашки. Размер у всех трёх один:
        карточка не меняет высоту, когда данные появятся.
      */}
      {status.kind === 'done' ? (
        <CardNotice key="check" text={t('notes.checkBeforeSend')} />
      ) : isIdle ? (
        <CardNotice key="hint" text={t('notes.placeholder')} />
      ) : isRecognizing && (
        <p key="check-skeleton" className="notes-check is-skeleton anim-fade" aria-hidden="true">
          <span className="notes-check-mark skeleton" />
          <span className="notes-check-text"><SkeletonLine className="notes-check-line" /></span>
        </p>
      )}
      {/*
        Шапка — узкая строка: заголовок слева, справа «✎ Правка»; в правке на её месте — «✕ Отмена» (отменяет
        изменения) и «✓ Готово» (сохраняет, главная), как «Отмена» и «Готово» в панелях Android и iOS.
      */}
      <div className="notes-header">
        <h2 className="notes-title"><TagIcon /><span className="notes-title-text">{title}</span></h2>
        <div className="notes-header-actions">
          {isEditing ? (
            <>
              <ActionButton key="cancel" layout="inline" size={28} icon={<CloseIcon />} caption={t('editing.cancelCaption')} label={t('editing.cancel')} onClick={onToggleEdit} />
              <ActionButton key="done" layout="inline" size={28} icon={<CheckIcon />} caption={t('editing.closeCaption')} label={t('editing.close')} active onClick={onCloseEdit} />
            </>
          ) : (
            <ActionButton
              key="edit"
              layout="inline"
              size={28}
              icon={<PencilIcon />}
              caption={t('editing.editCaption')}
              label={t('editing.edit')}
              disabled={!canEdit}
              onClick={onToggleEdit}
            />
          )}
        </div>
      </div>

      {itemCount > 0 && (
        <div className="notes-items">
          <Tabs options={itemOptions} value={activeIndex} onChange={onSelectItem} label={t('grid.items')} />
        </div>
      )}

      {status.kind === 'done' ? (
        <LabelFields key={`${itemKey}-${isEditing ? 'edit' : 'view'}`} label={status.label} isEditing={isEditing} onFieldChange={onFieldChange} manual={isManual} heatDuplicate={heatDuplicate} />
      ) : status.kind === 'failed' ? (
        <p className="notes-message is-error anim-enter" role="alert">
          <span className="notes-message-title">{t('errors:recognitionFailed')}</span>
          {status.message}
        </p>
      ) : status.kind === 'cancelled' ? (
        // Разные `key`: iOS (WebKit) не перерисовывал прокручиваемый абзац при смене текста,
        // и строки прежнего сообщения оставались поверх нового — новый узел рисуется с нуля.
        <p key="cancelled" className="notes-message is-placeholder anim-fade" role="status">{t('notes.cancelled')}</p>
      ) : (
        // Силуэты полей на их местах — столько же строк той же высоты, что у бирки с данными: ровные, пока фото
        // нет, переливаются, пока бирка распознаётся. Один узел на оба состояния — при выборе фото силуэты
        // не появляются заново, а начинают переливаться.
        <LabelFieldsSkeleton key="skeleton" label={isRecognizing ? t('photo.recognizing') : t('notes.placeholder')} still={isIdle} />
      )}

      <div ref={actionsRef} className="notes-actions" role="group" aria-label={t('actions.group')}>
        <ActionButton icon={<AddIcon />} caption={t('actions.add')} label={t('actions.addLabel')} onClick={onAddPhoto} />
        {/*
          «Сброс»: пока идёт распознавание — прерывает его, оставляя фото для «Повтора»; иначе убирает открытую
          бирку. Удержание — «Сбросить все» (очистить сетку); на пустой ячейке, когда другие бирки есть, — сразу оно.
        */}
        <ActionButton
          icon={<CloseIcon />}
          caption={t('actions.clear')}
          label={!hasPhoto ? t('actions.clearAllLabel') : isRecognizing ? t('actions.cancelLabel') : t('actions.clearLabel')}
          disabled={!hasPhoto && itemCount === 0}
          onClick={!hasPhoto ? onClearAll : isRecognizing ? onCancel : onClear}
          {...clearAllPress}
        />
        {/*
          «Повтор»: распознать фото открытой бирки заново. Удержание — «Повторить все» (все бирки с фото);
          когда у открытой бирки фото нет (пустая ячейка, «без фото»), а у других есть, — сразу оно.
        */}
        <ActionButton
          icon={<ResetIcon />}
          caption={t('actions.retry')}
          label={canRetry ? t('actions.retryLabel') : t('actions.retryAllLabel')}
          disabled={isRecognizing || (!canRetry && retryAllCount === 0)}
          onClick={canRetry ? onRetry : onRetryAll}
          {...retryAllPress}
        />
        <ActionButton
          variant="accent"
          icon={<NextIcon />}
          caption={t('actions.next')}
          label={isUploading ? t('actions.uploading') : sendCount > 1 ? t('actions.nextManyLabel', { count: sendCount }) : t('actions.nextLabel')}
          badge={sendCount > 1 && !isUploading ? sendCount : undefined}
          busy={isUploading}
          disabled={sendCount === 0}
          onClick={onNext}
        />
      </div>
    </div>
  )
}
