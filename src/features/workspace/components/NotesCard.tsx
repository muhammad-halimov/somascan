import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { AddIcon, CloseIcon, NextIcon, PencilIcon, ResetIcon, TagIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { Tabs } from '@/components/ui/Tabs'
import type { LabelKey } from '@/features/recognition/label/labelFields'
import type { RecognitionStatus } from '../hooks/useScanSession'
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
  /** Есть ли фото (иначе «Сброс» и «Повтор» недоступны). */
  hasPhoto: boolean
  /** Поле бирки отредактировано. */
  onFieldChange: (key: LabelKey, value: string) => void
  /** Карандаш: включить или выключить режим правки. */
  onToggleEdit: () => void
  /** «Готово»: выйти из режима правки. */
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
 * Карточка результата под фото: шапка с заголовком и кнопками правки, номера бирок (когда их
 * несколько — переход к любой: вкладки Material на Android, сегменты на iOS), распознанные поля
 * открытой бирки (или подсказка/ошибка) и панель действий «Фото», «Сброс» (во время распознавания —
 * прерывает его), «Повтор», «Далее». У всех кнопок — подписи.
 */
export function NotesCard({ cardRef, itemKey, itemCount, activeIndex, onSelectItem, isEditing, status, hasPhoto, onFieldChange, onToggleEdit, onCloseEdit, onAddPhoto, onClear, onCancel, onRetry, onNext, sendCount, isUploading = false }: NotesCardProps) {
  const { t } = useTranslation(['workspace', 'errors', 'label'])
  const isRecognizing = status.kind === 'recognizing'
  // Править и отправлять в таблицу можно только распознанный результат: не во время запроса и не после ошибки.
  const canEdit = status.kind === 'done'

  // Заголовок карточки: «Данные с бирки» для результата, иначе нейтральное «Результат».
  const title = status.kind === 'done' ? t('label:title') : t('notes.label')
  // Номера бирок; открыта пустая ячейка после них — ещё и «+».
  const itemOptions = Array.from({ length: itemCount }, (_, index) => ({ value: index, label: String(index + 1) }))
  if (activeIndex === itemCount) itemOptions.push({ value: itemCount, label: '+' })

  return (
    <div ref={cardRef} className={`notes-card${isEditing ? ' is-text-editing' : ''}`} aria-busy={isRecognizing}>
      {/* Шапка: заголовок слева, «Готово» (только в правке) и карандаш справа — одной строкой. */}
      <div className="notes-header">
        <h2 className="notes-title"><TagIcon />{title}</h2>
        <div className="notes-header-actions">
          {isEditing && (
            <ActionButton size={40} icon={<CloseIcon />} caption={t('editing.closeCaption')} label={t('editing.close')} onClick={onCloseEdit} />
          )}
          <ActionButton
            size={40}
            icon={<PencilIcon />}
            caption={t('editing.editCaption')}
            label={isEditing ? t('editing.finish') : t('editing.edit')}
            active={isEditing}
            aria-pressed={isEditing}
            disabled={!canEdit}
            onClick={onToggleEdit}
          />
        </div>
      </div>

      {itemOptions.length > 1 && (
        <div className="notes-items">
          <Tabs options={itemOptions} value={activeIndex} onChange={onSelectItem} label={t('grid.items')} />
        </div>
      )}

      {status.kind === 'done' ? (
        <LabelFields key={`${itemKey}-${isEditing ? 'edit' : 'view'}`} label={status.label} isEditing={isEditing} onFieldChange={onFieldChange} />
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

      <div className="notes-actions" role="group" aria-label={t('actions.group')}>
        <ActionButton size={48} icon={<AddIcon />} caption={t('actions.add')} label={t('actions.addLabel')} onClick={onAddPhoto} />
        {/* «Сброс»: пока идёт распознавание — прерывает его, оставляя фото для «Повтора»; иначе очищает экран. */}
        <ActionButton
          size={48}
          icon={<CloseIcon />}
          caption={t('actions.clear')}
          label={isRecognizing ? t('actions.cancelLabel') : t('actions.clearLabel')}
          disabled={!hasPhoto}
          onClick={isRecognizing ? onCancel : onClear}
        />
        <ActionButton size={48} icon={<ResetIcon />} caption={t('actions.retry')} label={t('actions.retryLabel')} disabled={!hasPhoto || isRecognizing} onClick={onRetry} />
        <ActionButton
          size={48}
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
