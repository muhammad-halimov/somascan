import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { enabledLabelFields } from '@/features/recognition/label/labelFields'
import { hasProductForm } from '@/features/recognition/label/productForm'
import { settingsStore } from '@/features/settings/store/SettingsStore'
import { isDriveConfigured } from '@/features/uploads/drive/driveSettings'
import { isSmbConfigured } from '@/features/uploads/smb/smbSettings'
import { tableCheckStore } from '@/features/uploads/store/TableCheckStore'
import { uploadStore } from '@/features/uploads/store/UploadStore'
import { uploadWorker } from '@/features/uploads/worker/UploadWorker'
import { buildUploadColumns } from '@/features/uploads/xlsx/uploadColumns'
import { useHistoryLayer } from '@/hooks/useHistoryLayer'
import { usePresence } from '@/hooks/usePresence'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { NotesCard } from './components/NotesCard'
import { PhotoCard } from './components/PhotoCard'
import { PhotoViewer } from './components/PhotoViewer'
import { useEditMode } from './hooks/useEditMode'
import { useLabelRecognition } from './hooks/useLabelRecognition'
import { usePhotoPicker } from './hooks/usePhotoPicker'
import { usePhotoTransform } from './hooks/usePhotoTransform'
import type { Size } from './utils/PhotoGeometry'
import './ScanWorkspace.css'

/** Сколько крутится спиннер в «Далее», пока экран очищается для следующей бирки. */
const HANDOFF_MS = 700

/**
 * Главный экран: выбрать фото бирки, автоматически распознать, проверить и поправить поля.
 *
 * Собирает карточку фото, карточку результата и просмотр на весь экран и ведёт
 * жизненный цикл фото: выбрано → загружается → загружено → распознано → «Далее» (в очередь выгрузки).
 * Распознавание запускается один раз на фото, как только оно загрузилось.
 */
export function ScanWorkspace() {
  const { t } = useTranslation(['workspace', 'common'])
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoKey, setPhotoKey] = useState(0)
  const [naturalSize, setNaturalSize] = useState<Size | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [isViewerOpen, setIsViewerOpen] = useState(false)
  /** Адрес, уже отправленный на распознавание: повторная загрузка картинки не шлёт его снова. */
  const recognizedUrl = useRef<string | null>(null)

  const workspaceRef = useRef<HTMLElement>(null)
  const notesCardRef = useRef<HTMLDivElement>(null)

  const hasPhoto = Boolean(photoUrl) && !hasError
  const recognition = useLabelRecognition()
  const transform = usePhotoTransform({ naturalSize, enabled: hasPhoto && !isLoading })
  const editMode = useEditMode()
  /** «Далее» нажата: бирка уходит в очередь, экран очищается — пока это идёт, в кнопке крутится спиннер. */
  const [isHandingOff, setIsHandingOff] = useState(false)
  const closeViewer = useHistoryLayer(isViewerOpen, () => setIsViewerOpen(false), 'photo')
  const viewer = usePresence(isViewerOpen)

  // Вход и выход из правки — до отрисовки кадра и без анимации прокрутки:
  // карточка результата сразу оказывается вверху, фото не мелькает.
  // Поле в фокус не ставим: клавиатура появляется, только когда пользователь сам выберет поле.
  const wasEditing = useRef(false)
  useLayoutEffect(() => {
    const workspace = workspaceRef.current
    if (editMode.isEditing && !wasEditing.current) {
      const card = notesCardRef.current
      // Учитываем отступ прокрутки (на iOS содержимое прокручивается под полупрозрачной шапкой).
      const scrollPadding = workspace ? Number.parseFloat(getComputedStyle(workspace).scrollPaddingTop) || 0 : 0
      if (workspace && card) workspace.scrollTop = card.offsetTop - workspace.offsetTop - scrollPadding
    } else if (!editMode.isEditing && wasEditing.current) {
      // Прячем клавиатуру, если в момент выхода было открыто поле карточки.
      const focused = document.activeElement
      if (focused instanceof HTMLElement && notesCardRef.current?.contains(focused)) focused.blur()
      workspace?.scrollTo({ top: 0 })
    }
    wasEditing.current = editMode.isEditing
  }, [editMode.isEditing])

  // Плохое фото: после распознавания сообщаем, что его лучше переснять (один раз на результат).
  const warnedResult = useRef<object | null>(null)
  useEffect(() => {
    const status = recognition.status
    if (status.kind !== 'done' || !status.photo.retake || warnedResult.current === status.photo) return
    warnedResult.current = status.photo
    const issues = status.photo.issues.map((issue) => t(`photoIssues.${issue}`)).join(', ')
    void NativeDialogs.alert({
      title: t('qualityDialog.title'),
      message: issues ? t('qualityDialog.message', { issues }) : t('qualityDialog.messageGeneric'),
      buttonTitle: t('common:ok'),
    })
  }, [recognition.status, t])

  // Освобождаем память фото, выбранного в браузере (`blob:`), когда его заменили или экран закрыли.
  useEffect(() => () => {
    if (photoUrl?.startsWith('blob:')) URL.revokeObjectURL(photoUrl)
  }, [photoUrl])

  /** Убирает фото и результат. */
  const clearPhoto = () => {
    recognition.reset()
    editMode.exit()
    transform.reset()
    recognizedUrl.current = null
    setNaturalSize(null)
    setHasError(false)
  }

  /** Показывает только что выбранное фото; распознавание стартует в `handleLoad`. */
  const showPhoto = (url: string) => {
    clearPhoto()
    setPhotoKey((key) => key + 1)
    setIsLoading(true)
    setPhotoUrl(url)
  }

  const picker = usePhotoPicker({ onPicked: showPhoto, onError: () => setHasError(true) })

  /** Фото загрузилось: запоминаем размер и распознаём (один раз на фото). */
  const handleLoad = (size: Size) => {
    setNaturalSize(size)
    setIsLoading(false)
    if (photoUrl && recognizedUrl.current !== photoUrl) {
      recognizedUrl.current = photoUrl
      void recognition.recognize(photoUrl)
    }
  }

  /**
   * Подтверждение нужно, только когда есть что терять: распознанный результат
   * или идущее распознавание. После ошибки или без фото действуем сразу.
   */
  const hasResult = recognition.status.kind === 'done' || recognition.status.kind === 'recognizing'

  /** «Фото»: если есть результат, сначала спрашиваем, заменить ли фото (нативный диалог). */
  const addPhoto = async () => {
    if (hasPhoto && hasResult) {
      const confirmed = await NativeDialogs.confirm({
        title: t('replaceDialog.title'),
        message: t('replaceDialog.message'),
        okButtonTitle: t('replaceDialog.confirm'),
        cancelButtonTitle: t('common:cancel'),
      })
      if (!confirmed) return
    }
    await picker.pick()
  }

  /** «Сброс»: убирает фото и результат; если результат есть — после подтверждения. */
  const resetWorkspace = async () => {
    if (hasResult) {
      const confirmed = await NativeDialogs.confirm({
        title: t('resetDialog.title'),
        message: t('resetDialog.message'),
        okButtonTitle: t('resetDialog.confirm'),
        cancelButtonTitle: t('common:cancel'),
      })
      if (!confirmed) return
    }
    clearPhoto()
    setPhotoUrl(null)
    setIsLoading(false)
  }

  /** «Повтор»: заново отправляет то же фото на распознавание. */
  const retry = () => {
    if (!photoUrl) return
    editMode.exit()
    recognizedUrl.current = photoUrl
    void recognition.recognize(photoUrl)
  }

  /**
   * «Далее»: распознанная (и поправленная) бирка встаёт в очередь выгрузки, а экран очищается
   * для следующей. Спиннер в кнопке крутится, пока карточки очищаются (не меньше `HANDOFF_MS`,
   * чтобы его было видно), и гаснет, когда экран готов к следующей бирке. Сама запись в таблицу
   * идёт в фоне (`UploadWorker`), её состояние — в «Загрузках»; если хранилище не настроено
   * или проверка уже показала, что таблицы нет (своей приложение не создаёт), запись подождёт
   * исправления настроек — об этом сообщаем сразу.
   */
  const uploadResult = async () => {
    if (recognition.status.kind !== 'done' || isHandingOff) return
    // Форму поставки (пруток или катушка) выбирают вручную — без неё бирку не отправить.
    // Выбор формы — первая строка карточки: докручиваем к нему, если список прокручен.
    if (!hasProductForm(recognition.status.label)) {
      notesCardRef.current?.querySelector('.label-field.is-product-form')?.scrollIntoView({ block: 'nearest' })
      await NativeDialogs.alert({
        title: t('formDialog.title'),
        message: t('formDialog.message'),
        buttonTitle: t('common:ok'),
      })
      return
    }
    const { advanced, general, storage } = settingsStore.getSnapshot()
    const columns = buildUploadColumns(enabledLabelFields(advanced.labelFields), general.language)
    uploadStore.enqueue(recognition.status.label, columns)
    uploadWorker.kick()
    setIsHandingOff(true)
    await new Promise((resolve) => window.setTimeout(resolve, HANDOFF_MS))
    clearPhoto()
    setPhotoUrl(null)
    setIsLoading(false)
    setIsHandingOff(false)
    const configured = storage.target === 'smb' ? isSmbConfigured(storage.smb) : isDriveConfigured(storage.googleDrive)
    if (!configured) {
      await NativeDialogs.alert({
        title: t('uploadDialog.unconfiguredTitle'),
        message: t('uploadDialog.unconfiguredMessage'),
        buttonTitle: t('common:ok'),
      })
    } else if (tableCheckStore.resultFor(storage)?.kind === 'missing') {
      await NativeDialogs.alert({
        title: t('uploadDialog.tableMissingTitle'),
        message: t('uploadDialog.tableMissingMessage'),
        buttonTitle: t('common:ok'),
      })
    }
  }

  return (
    <section
      ref={workspaceRef}
      className={`scan-workspace${editMode.isEditing ? ' is-text-editing' : ''}`}
      aria-label={t('region')}
    >
      <input className="photo-input" {...picker.inputProps} />
      <PhotoCard
        photoUrl={photoUrl}
        photoKey={photoKey}
        isLoading={isLoading || picker.isReceiving}
        isRecognizing={recognition.status.kind === 'recognizing'}
        hasError={hasError}
        transform={transform}
        onPick={() => void picker.pick()}
        onOpen={() => setIsViewerOpen(true)}
        onLoad={handleLoad}
        onError={() => {
          setIsLoading(false)
          setHasError(true)
        }}
      />
      <NotesCard
        cardRef={notesCardRef}
        isEditing={editMode.isEditing}
        status={recognition.status}
        hasPhoto={hasPhoto}
        onFieldChange={recognition.updateField}
        onToggleEdit={editMode.toggle}
        onCloseEdit={editMode.exit}
        onAddPhoto={() => void addPhoto()}
        onClear={() => void resetWorkspace()}
        onCancel={recognition.abort}
        onRetry={retry}
        onNext={() => void uploadResult()}
        isUploading={isHandingOff}
      />
      {viewer.mounted && photoUrl && <PhotoViewer url={photoUrl} naturalSize={naturalSize} isClosing={viewer.closing} onClose={closeViewer} />}
    </section>
  )
}
