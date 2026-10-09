import { useLayoutEffect, useRef, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { AddIcon, CheckIcon, CloseIcon, InfoIcon, NextIcon, PencilIcon, ResetIcon, TagIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { Tabs } from '@/components/ui/Tabs'
import type { LabelKey } from '@/features/recognition/label/labelFields'
import { MAX_SCAN_ITEMS, type RecognitionStatus } from '../hooks/useScanSession'
import { LabelFields } from './LabelFields'
import './NotesCard.css'

/** Свойства `NotesCard`. */
export interface NotesCardProps {
  /** Ref карточки: в режиме правки экран прокручивается к ней. */
  cardRef?: Ref<HTMLDivElement>
  /** Открытая бирка (её id): поля пересоздаются для другой бирки. */
  itemKey: string
  /** Сколько бирок на экране. */
  itemCount: number
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
  /** Бирка без фото: поля заполняют вручную, поля по умолчанию обязательны. */
  isManual: boolean
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
  /** «Сброс» во время распознавания: прервать запрос, оставив фото. */
  onCancel: () => void
  /** «Повтор»: распознать то же фото заново. */
  onRetry: () => void
  /** «Далее»: поставить выбранные бирки в очередь выгрузки в таблицу. */
  onNext: () => void
  /** Сколько бирок выбрано для отправки (на «Далее» — счётчик, если их больше одной). */
  sendCount: number
  /** «Далее» нажата и экран очищается для следующей бирки: в кнопке крутится спиннер. */
  isUploading?: boolean
}

/**
 * Карточка результата под фото: узкая полоса «Проверьте данные перед отправкой» (у распознанной бирки),
 * шапка с заголовком и кнопками правки, номера бирок (когда их
 * несколько — переход к любой: вкладки Material на Android, сегменты на iOS), распознанные поля
 * открытой бирки (или подсказка/ошибка) и панель действий «Фото», «Сброс» (во время распознавания —
 * прерывает его), «Повтор», «Далее». У всех кнопок — подписи.
 */
export function NotesCard({ cardRef, itemKey, itemCount, activeIndex, onSelectItem, isEditing, status, hasPhoto, canRetry, isManual, onFieldChange, onToggleEdit, onCloseEdit, onAddPhoto, onClear, onCancel, onRetry, onNext, sendCount, isUploading = false }: NotesCardProps) {
  const { t } = useTranslation(['workspace', 'errors', 'label'])
  const isRecognizing = status.kind === 'recognizing'
  const actionsRef = useRef<HTMLDivElement>(null)

  // Высота панели действий — в `--notes-actions-height`: на телефоне панель внизу экрана, и рабочая область
  // оставляет под ней место (см. NotesCard.css). Шрифт и подписи на разных языках меняют высоту — меряем.
  useLayoutEffect(() => {
    const actions = actionsRef.current
    if (!actions) return
    const root = document.documentElement
    const measure = () => root.style.setProperty('--notes-actions-height', `${Math.ceil(actions.getBoundingClientRect().height)}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(actions)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--notes-actions-height')
    }
  }, [])
  // Править и отправлять в таблицу можно только распознанный результат: не во время запроса и не после ошибки.
  const canEdit = status.kind === 'done'

  // Заголовок карточки: «Данные с бирки» для результата, иначе нейтральное «Результат».
  const title = status.kind === 'done' ? t('label:title') : t('notes.label')
  // Номера бирок и (пока их меньше девяти) «+» — пустая ячейка для следующей.
  const itemOptions = Array.from({ length: itemCount }, (_, index) => ({ value: index, label: String(index + 1) }))
  if (itemCount < MAX_SCAN_ITEMS) itemOptions.push({ value: itemCount, label: '+' })

  return (
    <div ref={cardRef} className={`notes-card${isEditing ? ' is-text-editing' : ''}`} aria-busy={isRecognizing}>
      {/* Узкая плашка-примечание вверху карточки: распознанное проверяют перед каждой отправкой. */}
      {status.kind === 'done' && (
        <p className="notes-check anim-fade">
          <InfoIcon />
          <span>{t('notes.checkBeforeSend')}</span>
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
        <LabelFields key={`${itemKey}-${isEditing ? 'edit' : 'view'}`} label={status.label} isEditing={isEditing} onFieldChange={onFieldChange} manual={isManual} />
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
        <p key="placeholder" className="notes-message is-placeholder anim-fade">{t('notes.placeholder')}</p>
      )}

      <div ref={actionsRef} className="notes-actions" role="group" aria-label={t('actions.group')}>
        <ActionButton icon={<AddIcon />} caption={t('actions.add')} label={t('actions.addLabel')} onClick={onAddPhoto} />
        {/* «Сброс»: пока идёт распознавание — прерывает его, оставляя фото для «Повтора»; иначе очищает экран. */}
        <ActionButton
          icon={<CloseIcon />}
          caption={t('actions.clear')}
          label={isRecognizing ? t('actions.cancelLabel') : t('actions.clearLabel')}
          disabled={!hasPhoto}
          onClick={isRecognizing ? onCancel : onClear}
        />
        <ActionButton icon={<ResetIcon />} caption={t('actions.retry')} label={t('actions.retryLabel')} disabled={!canRetry || isRecognizing} onClick={onRetry} />
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
