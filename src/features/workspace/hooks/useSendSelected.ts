import { useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { recognizedLabelFields } from '@/features/recognition/label/labelFields'
import { hasProductForm } from '@/features/recognition/label/productForm'
import { useLabelFieldName } from '@/features/recognition/label/useLabelFieldName'
import { settingsStore } from '@/features/settings/store/SettingsStore'
import { isDriveConfigured } from '@/features/uploads/drive/driveSettings'
import { uploadQueue } from '@/features/uploads/queue/appQueue'
import { isSmbConfigured } from '@/features/uploads/smb/smbSettings'
import { tableCheckStore } from '@/features/uploads/store/TableCheckStore'
import { buildUploadColumns } from '@/features/uploads/xlsx/uploadColumns'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import type { PhotoCardHandle } from '../components/PhotoCard'
import { flyToUploads } from '../utils/sendFlight'
import { awaitsPhoto, isReadyToSend, labelForQueue, missingRequiredFields } from '../utils/sendReadiness'
import type { useEditMode } from './useEditMode'
import type { ScanItem, useScanSession } from './useScanSession'

/** Сколько крутится спиннер в «Далее», пока бирка уходит в очередь и открывается следующая. */
const HANDOFF_MS = 700

/** Что нужно «Далее» от экрана. */
export interface SendSelectedDeps {
  /** Бирки экрана. */
  session: ReturnType<typeof useScanSession>
  /** Режим правки (закрывается при отправке, открывается у бирки с пустыми обязательными полями). */
  editMode: ReturnType<typeof useEditMode>
  /** Карточка результата: к её строкам докручиваем, её поля улетают вслед за фото. */
  notesCardRef: RefObject<HTMLDivElement | null>
  /** Карточка фото: что улетает к «Загрузкам». */
  photoCardRef: RefObject<PhotoCardHandle | null>
}

/**
 * «Далее»: выбранные бирки (по умолчанию — все), готовые к отправке (`isReadyToSend`), встают в очередь
 * выгрузки по порядку и убираются с экрана, открывается следующая. Если часть выбранных не готова,
 * сначала спрашиваем, отправить ли готовые; отказ открывает первую неготовую и объясняет, что с ней.
 * Спиннер в кнопке крутится не меньше `HANDOFF_MS`, чтобы его было видно; за это время фото отправленных
 * улетают к «Загрузкам».
 *
 * Сама запись в таблицу идёт в фоне (на устройстве — движок очереди вне WebView, и в свёрнутом,
 * и в закрытом приложении), её состояние — в «Загрузках»; если хранилище не настроено или проверка
 * уже показала, что таблицы нет (своей приложение не создаёт), записи подождут исправления настроек —
 * об этом сообщаем сразу.
 */
export function useSendSelected({ session, editMode, notesCardRef, photoCardRef }: SendSelectedDeps) {
  const { t } = useTranslation(['workspace', 'common'])
  const fieldName = useLabelFieldName()
  /** «Далее» нажата: бирки уходят в очередь, открывается следующая — пока это идёт, в кнопке крутится спиннер. */
  const [isHandingOff, setIsHandingOff] = useState(false)

  /** Открывает бирку, которая мешает отправке, и объясняет, что с ней. */
  const showNotReady = async (blocker: ScanItem) => {
    const index = session.items.indexOf(blocker)
    session.select(index)
    const number = index + 1
    if (awaitsPhoto(blocker)) {
      await NativeDialogs.alert({ title: t('photoDialog.title'), message: t('photoDialog.message', { number }), buttonTitle: t('common:ok') })
      return
    }
    if (blocker.status.kind === 'done' && !hasProductForm(blocker.status.label)) {
      // Не выбрана форма: выбор формы — первая строка карточки, докручиваем к нему.
      window.setTimeout(() => notesCardRef.current?.querySelector('.label-field.is-product-form')?.scrollIntoView({ block: 'nearest' }), 0)
      await NativeDialogs.alert({ title: t('formDialog.title'), message: t('formDialog.message'), buttonTitle: t('common:ok') })
      return
    }
    const missing = missingRequiredFields(blocker, settingsStore.getSnapshot().advanced.labelFields)
    if (missing.length > 0) {
      // Бирка без фото с пустыми обязательными полями: объясняем какими и открываем правку у первого из них.
      await NativeDialogs.alert({
        title: t('requiredDialog.title'),
        message: t('requiredDialog.message', { fields: missing.map(fieldName).join(', ') }),
        buttonTitle: t('common:ok'),
      })
      if (!editMode.isEditing) editMode.toggle()
      window.setTimeout(() => notesCardRef.current?.querySelector('.label-field.is-required')?.scrollIntoView({ block: 'nearest' }), 0)
      return
    }
    await NativeDialogs.alert({
      title: t('sendDialog.notReadyTitle', { number }),
      message: blocker.status.kind === 'recognizing' ? t('sendDialog.recognizingMessage') : t('sendDialog.failedMessage'),
      buttonTitle: t('common:ok'),
    })
  }

  const send = async () => {
    if (isHandingOff) return
    const { advanced, general, storage } = settingsStore.getSnapshot()
    const selected = session.items.filter((candidate) => candidate.selected)
    if (selected.length === 0) {
      await NativeDialogs.alert({ title: t('sendDialog.noneTitle'), message: t('sendDialog.noneMessage'), buttonTitle: t('common:ok') })
      return
    }
    const ready = selected.filter((candidate) => isReadyToSend(candidate, advanced.labelFields))
    const blocker = selected.find((candidate) => !isReadyToSend(candidate, advanced.labelFields))
    if (blocker && ready.length === 0) {
      await showNotReady(blocker)
      return
    }
    if (blocker) {
      const confirmed = await NativeDialogs.confirm({
        title: t('sendDialog.partialTitle'),
        message: t('sendDialog.partialMessage', { ready: ready.length, total: selected.length, rest: selected.length - ready.length }),
        okButtonTitle: t('sendDialog.sendReady', { count: ready.length }),
        cancelButtonTitle: t('common:cancel'),
      })
      if (!confirmed) {
        await showNotReady(blocker)
        return
      }
    }
    editMode.exit()
    // Колонки журнала — только поля с бирки: выбранные вручную (лист) в колонки не пишутся.
    const columns = buildUploadColumns(recognizedLabelFields(advanced.labelFields), general.language)
    for (const candidate of ready) {
      if (candidate.status.kind === 'done') uploadQueue.enqueue(labelForQueue(candidate.status.label, advanced.labelFields), columns)
    }
    setIsHandingOff(true)
    // Отправленные фото улетают к «Загрузкам» (в сетке — их ячейки, у одной бирки — её фото вместе с данными),
    // а когда спиннер отработал, бирки убираются; скрытое на время полёта возвращается уже на новом месте.
    const ids = ready.map((candidate) => candidate.id)
    const sent = new Set(ids)
    const targets = photoCardRef.current?.sendTargets(sent) ?? { fly: [], hide: [] }
    // Данные открытой бирки (если она среди отправленных) улетают вслед за её фото.
    const active = session.active
    const fields = active && sent.has(active.id) ? notesCardRef.current?.querySelector<HTMLElement>('.label-fields') : null
    const flight = flyToUploads(fields ? [...targets.fly, fields] : targets.fly, targets.hide)
    await new Promise((resolve) => window.setTimeout(resolve, HANDOFF_MS))
    flushSync(() => session.removeMany(ids))
    flight.restore()
    setIsHandingOff(false)
    const configured = storage.target === 'smb' ? isSmbConfigured(storage.smb) : isDriveConfigured(storage.googleDrive)
    if (!configured) {
      await NativeDialogs.alert({ title: t('uploadDialog.unconfiguredTitle'), message: t('uploadDialog.unconfiguredMessage'), buttonTitle: t('common:ok') })
    } else if (tableCheckStore.resultFor(storage)?.kind === 'missing') {
      await NativeDialogs.alert({ title: t('uploadDialog.tableMissingTitle'), message: t('uploadDialog.tableMissingMessage'), buttonTitle: t('common:ok') })
    }
  }

  return { send, isHandingOff }
}
