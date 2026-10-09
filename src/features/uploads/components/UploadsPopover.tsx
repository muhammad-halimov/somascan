import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { AlertIcon, CheckIcon, ClockIcon, CloseIcon, EmptyInboxIcon, RefreshIcon, ResetIcon, TrashIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { List, ListItem } from '@/components/ui/List'
import { PanelHeader } from '@/components/ui/PanelHeader'
import { useStore } from '@/lib/store/useStore'
import { EXIT_ANIMATION_MS } from '@/hooks/usePresence'
import { isMissingValue } from '@/features/recognition/label/labelFields'
import { useLabelFormatter } from '@/features/recognition/label/useLabelFormatter'
import { isProductForm, PRODUCT_FORM_KEY } from '@/features/recognition/label/productForm'
import { uploadQueue, uploadStore } from '../queue/appQueue'
import { hasFailed, type UploadRecord, type UploadStatus } from '../store/UploadStore'
import { useUploadErrorText } from '../useUploadErrorText'
import './UploadsPopover.css'

/** Свойства `UploadsPopover`. */
export interface UploadsPopoverProps {
  /** Проигрывает анимацию закрытия. */
  isClosing: boolean
  /** Просьба закрыть: нажатие вне панели, Escape, крестик. */
  onClose: () => void
}

/** Иконка состояния записи. */
const STATUS_ICONS: Record<UploadStatus, ReactNode> = {
  queued: <ClockIcon />,
  uploading: <RefreshIcon />,
  completed: <CheckIcon />,
  failed: <AlertIcon />,
}

/**
 * Всплывающая панель под шапкой: очередь выгрузки и история записанных бирок.
 * У каждой записи — состояние (в очереди, пишется, записана, не записана) и причина сбоя;
 * незаписанные можно повторить. Закрывается нажатием вне панели или крестиком.
 */
export function UploadsPopover({ isClosing, onClose }: UploadsPopoverProps) {
  const { t, i18n } = useTranslation(['uploads', 'label', 'common'])
  const records = useStore(uploadStore)
  const formatter = useLabelFormatter()
  const errorText = useUploadErrorText()
  const popoverRef = useRef<HTMLElement>(null)
  /** Записи, которые сейчас уезжают с анимацией удаления. */
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set())
  const dateTimeFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    [i18n.language],
  )

  // Закрываем при нажатии вне панели и по Escape (на компьютере).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  /** После подтверждения удаляет завершённые записи. */
  const clearCompleted = async () => {
    const confirmed = await NativeDialogs.confirm({
      title: t('clearDialog.title'),
      message: t('clearDialog.message'),
      okButtonTitle: t('clearDialog.confirm'),
      cancelButtonTitle: t('common:cancel'),
    })
    if (confirmed) uploadQueue.clearCompleted()
  }

  /** Текст значения поля бирки или `undefined`, если его нет. */
  const text = (record: UploadRecord, key: string) => (isMissingValue(record.label[key]) ? undefined : String(record.label[key]))

  /** Заголовок записи: номер контракта с бирки, а если его нет — собственный номер записи. */
  const titleOf = (record: UploadRecord) => {
    const contract = text(record, 'contract')
    return contract ? `${t('label:fields.contract')} ${contract}` : `№ ${record.localNumber}`
  }

  /** Где записана бирка, коротко и с выделенными числами: «л. 2026, стр. 25, элем. 19». */
  const placeOf = (record: UploadRecord, rowNumber: number) => {
    const parts: Array<[string, string | number]> = [[t('place.row'), rowNumber]]
    if (record.sheet) parts.unshift([t('place.sheet'), record.sheet])
    if (record.item) parts.push([t('place.item'), record.item])
    return parts.map(([label, value], index) => (
      <span key={label}>
        {index > 0 && ', '}
        {label}{'\u00a0'}<b>{value}</b>
      </span>
    ))
  }

  /** Строка состояния: что с записью и почему. */
  const statusOf = (record: UploadRecord): { text: ReactNode; isError: boolean } => {
    switch (record.status) {
      case 'failed':
        return { text: record.error ? errorText(record.error) : t('status.failed'), isError: true }
      case 'queued':
        return { text: record.error ? t('queuedAfterError', { error: errorText(record.error) }) : t('status.queued'), isError: false }
      case 'completed':
        return { text: record.rowNumber ? placeOf(record, record.rowNumber) : t('status.completed'), isError: false }
      default:
        return { text: record.cancelRequested ? t('status.cancelling') : t('status.uploading'), isError: false }
    }
  }

  /** Проигрывает уход строки, потом выполняет `action` (убирает запись из хранилища). */
  const removeAnimated = (id: string, action: () => void) => {
    setRemoving((current) => new Set(current).add(id))
    window.setTimeout(() => {
      action()
      setRemoving((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }, EXIT_ANIMATION_MS)
  }

  /** «Удалить» у записанной бирки: после подтверждения (нативный диалог) убирает её из истории. */
  const removeRecord = async (record: UploadRecord) => {
    const confirmed = await NativeDialogs.confirm({
      title: t('deleteDialog.title'),
      message: t('deleteDialog.message', { title: titleOf(record) }),
      okButtonTitle: t('deleteDialog.confirm'),
      cancelButtonTitle: t('common:cancel'),
    })
    if (confirmed) removeAnimated(record.id, () => uploadQueue.remove(record.id))
  }

  /**
   * «Отмена» у незаписанной бирки: после подтверждения бирка не попадёт в журнал. Ждущая убирается
   * сразу; пишущаяся — когда запись остановится (до замены файла), а если файл уже заменяется,
   * запись завершится как обычно.
   */
  const cancelRecord = async (record: UploadRecord) => {
    const confirmed = await NativeDialogs.confirm({
      title: t('cancelDialog.title'),
      message: t('cancelDialog.message', { title: titleOf(record) }),
      okButtonTitle: t('cancelDialog.confirm'),
      cancelButtonTitle: t('cancelDialog.keep'),
    })
    if (!confirmed) return
    const current = uploadStore.getSnapshot().find((candidate) => candidate.id === record.id)
    if (current?.status === 'uploading') uploadQueue.cancel(record.id)
    else if (current && current.status !== 'completed') removeAnimated(record.id, () => uploadQueue.cancel(record.id))
  }

  return (
    <section ref={popoverRef} className={`uploads-popover${isClosing ? ' is-closing' : ''}`} aria-labelledby="uploads-title">
      <PanelHeader
        titleId="uploads-title"
        title={t('title')}
        actions={(
          <>
            {hasFailed(records) && (
              <ActionButton variant="ghost" icon={<ResetIcon />} caption={t('retryAllCaption')} label={t('retryAll')} onClick={() => uploadQueue.retryAll()} />
            )}
            <ActionButton variant="ghost" icon={<TrashIcon />} caption={t('clearCaption')} label={t('clear')} disabled={!records.some((record) => record.status === 'completed')} onClick={() => void clearCompleted()} />
            <ActionButton variant="ghost" icon={<CloseIcon />} caption={t('common:close')} label={t('close')} onClick={onClose} />
          </>
        )}
      />
      <div className="uploads-content">
        {records.length === 0 ? (
          <div className="uploads-empty-state">
            <EmptyInboxIcon />
            <h3 className="uploads-empty-title">{t('empty.title')}</h3>
            <p className="uploads-empty-desc">{t('empty.description')}</p>
          </div>
        ) : (
          <List className="uploads-list">
            {records.map((record) => {
              // Строки подробностей: марка, размер и вес; плавка и партия; назначение и время; состояние.
              const join = (parts: Array<string | undefined | false>) => parts.filter(Boolean).join(' · ')
              const weight = text(record, 'weight_kg')
              const heat = text(record, 'heat')
              const batch = text(record, 'batch')
              const status = statusOf(record)
              const form = record.label[PRODUCT_FORM_KEY]
              const lines = [
                join([isProductForm(form) && t(`label:productForm.${form}`), text(record, 'grade'), text(record, 'size') && formatter.value('code', text(record, 'size'), 'size'), weight && formatter.value('weight', weight)]),
                join([heat && `${t('label:fields.heat')} ${heat}`, batch && `${t('label:fields.batch')} ${batch}`]),
                join([text(record, 'destination'), dateTimeFormat.format(record.createdAt)]),
              ].filter(Boolean)
              return (
                <ListItem
                  key={record.id}
                  className={removing.has(record.id) ? 'is-removing' : 'anim-enter'}
                  leading={<span className={`upload-item-status is-${record.status}`}>{STATUS_ICONS[record.status]}</span>}
                  primary={titleOf(record)}
                  secondary={(
                    <span className="upload-item-details">
                      {lines.map((line) => <span key={line}>{line}</span>)}
                      <span className={`upload-item-state${status.isError ? ' is-error' : ''}`} role={status.isError ? 'alert' : undefined}>{status.text}</span>
                    </span>
                  )}
                  trailing={(
                    <span className="upload-item-actions">
                      {record.status === 'failed' && (
                        <ActionButton size={46} icon={<ResetIcon />} caption={t('retryCaption')} label={t('retry')} onClick={() => uploadQueue.retry(record.id)} />
                      )}
                      {record.status === 'completed' ? (
                        <ActionButton size={46} icon={<TrashIcon />} caption={t('deleteCaption')} label={t('delete')} onClick={() => void removeRecord(record)} />
                      ) : (
                        // Незаписанную бирку не удаляют, а отменяют: она не попадёт в журнал.
                        <ActionButton size={46} icon={<CloseIcon />} caption={t('cancelCaption')} label={t('cancel')} busy={record.cancelRequested} disabled={record.cancelRequested} onClick={() => void cancelRecord(record)} />
                      )}
                    </span>
                  )}
                />
              )
            })}
          </List>
        )}
      </div>
    </section>
  )
}
