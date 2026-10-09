import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { enabledLabelFields } from '@/features/recognition/label/labelFields'
import { hasProductForm } from '@/features/recognition/label/productForm'
import { settingsStore } from '@/features/settings/store/SettingsStore'
import { isDriveConfigured } from '@/features/uploads/drive/driveSettings'
import { isSmbConfigured } from '@/features/uploads/smb/smbSettings'
import { tableCheckStore } from '@/features/uploads/store/TableCheckStore'
import { uploadQueue } from '@/features/uploads/queue/appQueue'
import { buildUploadColumns } from '@/features/uploads/xlsx/uploadColumns'
import { useHistoryLayer } from '@/hooks/useHistoryLayer'
import { usePresence } from '@/hooks/usePresence'
import { Notice } from '@/components/ui/Notice'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { NotesCard } from './components/NotesCard'
import { PhotoCard, type PhotoCardView } from './components/PhotoCard'
import { PhotoViewer } from './components/PhotoViewer'
import { SlideBar } from './components/SlideBar'
import { useEditMode } from './hooks/useEditMode'
import { usePhotoPicker } from './hooks/usePhotoPicker'
import { usePhotoTransform } from './hooks/usePhotoTransform'
import { IDLE, MAX_SCAN_ITEMS, useScanSession, type ScanItem } from './hooks/useScanSession'
import './ScanWorkspace.css'

/** Сколько крутится спиннер в «Далее», пока бирка уходит в очередь и открывается следующая. */
const HANDOFF_MS = 700

/**
 * Главный экран: выбрать фото бирок (до девяти сразу), автоматически распознать, проверить и поправить поля.
 *
 * Собирает карточку фото (одна бирка или сетка 3 × 3), панель листания (стрелки и «Открыть»),
 * карточку результата открытой бирки и просмотр на весь экран. Бирки идут по порядку: новые фото встают в конец, каждое распознаётся само и сразу
 * выбрано для отправки (выбор меняется в сетке); «Далее» отправляет выбранные в очередь выгрузки пачкой.
 * К бирке можно перейти из сетки и из карточки результата (номера бирок над полями).
 */
export function ScanWorkspace() {
  const { t } = useTranslation(['workspace', 'common'])
  const session = useScanSession()
  const item = session.active
  const activeIndex = session.activeIndex
  const status = item?.status ?? IDLE
  const [isViewerOpen, setIsViewerOpen] = useState(false)
  /** Карточка фото: одна бирка или сетка. */
  const [view, setView] = useState<PhotoCardView>('single')
  /** Сетку уже открывали: у бирки появляется «Назад» к сетке. */
  const [usedGrid, setUsedGrid] = useState(false)

  const workspaceRef = useRef<HTMLElement>(null)
  const notesCardRef = useRef<HTMLDivElement>(null)

  const hasPhoto = item !== null && !item.hasError
  const transform = usePhotoTransform({ naturalSize: item?.naturalSize ?? null, enabled: hasPhoto && !item.isLoading && view === 'single' })
  const editMode = useEditMode()
  /** «Далее» нажата: бирка уходит в очередь, открывается следующая — пока это идёт, в кнопке крутится спиннер. */
  const [isHandingOff, setIsHandingOff] = useState(false)
  const closeViewer = useHistoryLayer(isViewerOpen, () => setIsViewerOpen(false), 'photo')
  const viewer = usePresence(isViewerOpen)
  /** Сетка закрывается системным «Назад» (жест iOS, кнопка Android) — открывается выбранная бирка. */
  const closeGrid = useHistoryLayer(view === 'grid', () => setView('single'), 'grid')

  // Другая бирка — исходный масштаб и поворот.
  const { reset: resetTransform } = transform
  useEffect(() => {
    resetTransform()
  }, [item?.id, resetTransform])

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

  // Плохое фото: когда открытая бирка распознана, сообщаем, что его лучше переснять (один раз на результат).
  const warnedResults = useRef(new WeakSet<object>())
  useEffect(() => {
    if (status.kind !== 'done' || !status.photo.retake || warnedResults.current.has(status.photo)) return
    warnedResults.current.add(status.photo)
    const issues = status.photo.issues.map((issue) => t(`photoIssues.${issue}`)).join(', ')
    void NativeDialogs.alert({
      title: t('qualityDialog.title'),
      message: issues ? t('qualityDialog.message', { issues }) : t('qualityDialog.messageGeneric'),
      buttonTitle: t('common:ok'),
    })
  }, [status, t])

  /** Куда идут выбранные фото: в конец (новые бирки) или вместо фото открытой бирки (все девять заняты). */
  const pickTarget = useRef<'add' | 'replace'>('add')
  const picker = usePhotoPicker({
    onPicked: (urls) => {
      editMode.exit()
      if (pickTarget.current === 'replace') {
        session.replace(activeIndex, urls[0]!)
        return
      }
      // Системный выбор не везде ограничивает число фото: лишние (сверх свободных ячеек) не встают.
      const overflow = session.add(urls)
      if (overflow > 0) {
        void NativeDialogs.alert({
          title: t('photo.add'),
          message: t('photo.overflow', { added: urls.length - overflow, picked: urls.length, max: MAX_SCAN_ITEMS }),
          buttonTitle: t('common:ok'),
        })
      }
    },
    onError: () => {
      void NativeDialogs.alert({ title: t('photo.add'), message: t('photo.failedToOpen'), buttonTitle: t('common:ok') })
    },
  })

  /**
   * Подтверждение нужно, только когда есть что терять: распознанный результат
   * или идущее распознавание. После ошибки или без фото действуем сразу.
   */
  const hasResult = status.kind === 'done' || status.kind === 'recognizing'

  /**
   * «Фото» и пустая ячейка: выбранные фото (до числа свободных ячеек) встают в конец по порядку.
   * Если все девять заняты — фото открытой бирки заменяется (с подтверждением, если есть результат).
   */
  const addPhotos = async () => {
    if (session.canAdd) {
      pickTarget.current = 'add'
      await picker.pick(MAX_SCAN_ITEMS - session.items.length)
      return
    }
    if (hasPhoto && hasResult) {
      const confirmed = await NativeDialogs.confirm({
        title: t('replaceDialog.title'),
        message: t('replaceDialog.message'),
        okButtonTitle: t('replaceDialog.confirm'),
        cancelButtonTitle: t('common:cancel'),
      })
      if (!confirmed) return
    }
    pickTarget.current = 'replace'
    await picker.pick(1)
  }

  /** «Сброс»: убирает открытую бирку (следующие сдвигаются); если есть результат — после подтверждения. */
  const removeItem = async () => {
    if (!item) return
    if (hasResult) {
      const dialog = session.items.length > 1 ? 'removeDialog' : 'resetDialog'
      const confirmed = await NativeDialogs.confirm({
        title: t(`${dialog}.title`),
        message: t(`${dialog}.message`),
        okButtonTitle: t(`${dialog}.confirm`),
        cancelButtonTitle: t('common:cancel'),
      })
      if (!confirmed) return
    }
    editMode.exit()
    session.remove(activeIndex)
  }

  /** «Повтор»: заново отправляет фото открытой бирки на распознавание. */
  const retry = () => {
    if (!item) return
    editMode.exit()
    session.retry(activeIndex)
  }

  /** Открывает бирку `index` из карточки результата (номера бирок). */
  const selectItem = (index: number) => {
    if (index !== activeIndex) session.select(index)
  }

  /** «Сетка» и «Назад»: фото уменьшается в свою ячейку, появляется сетка. Правка закрывается. */
  const pendingGrid = useRef(false)
  const showGrid = () => {
    setUsedGrid(true)
    // Правка — свой слой истории: сначала закрываем его, сетку открываем, когда он снят (см. эффект ниже).
    if (editMode.isEditing) {
      pendingGrid.current = true
      editMode.exit()
      return
    }
    setView('grid')
  }
  useEffect(() => {
    if (editMode.isEditing || !pendingGrid.current) return
    pendingGrid.current = false
    setView('grid')
  }, [editMode.isEditing])

  /** Ячейка сетки: бирка (или следующая пустая ячейка) открывается, ячейка увеличивается до неё. */
  const openCell = (index: number) => {
    session.select(index)
    closeGrid()
  }

  /** Бирка готова к отправке: распознана и выбрана форма. */
  const isReady = (candidate: ScanItem) => candidate.status.kind === 'done' && hasProductForm(candidate.status.label)

  /** Открывает бирку, которая мешает отправке, и объясняет, что с ней. */
  const showNotReady = async (blocker: ScanItem) => {
    const index = session.items.indexOf(blocker)
    session.select(index)
    const number = index + 1
    if (blocker.status.kind === 'done') {
      // Не выбрана форма: выбор формы — первая строка карточки, докручиваем к нему.
      window.setTimeout(() => notesCardRef.current?.querySelector('.label-field.is-product-form')?.scrollIntoView({ block: 'nearest' }), 0)
      await NativeDialogs.alert({ title: t('formDialog.title'), message: t('formDialog.message'), buttonTitle: t('common:ok') })
      return
    }
    await NativeDialogs.alert({
      title: t('sendDialog.notReadyTitle', { number }),
      message: blocker.status.kind === 'recognizing' ? t('sendDialog.recognizingMessage') : t('sendDialog.failedMessage'),
      buttonTitle: t('common:ok'),
    })
  }

  /**
   * «Далее»: выбранные бирки (по умолчанию — все), распознанные и с формой, встают в очередь выгрузки
   * по порядку и убираются с экрана, открывается следующая. Если часть выбранных не готова
   * (распознаётся, не распознана, без формы), сначала спрашиваем, отправить ли готовые; отказ открывает
   * первую неготовую. Спиннер в кнопке крутится не меньше `HANDOFF_MS`, чтобы его было видно.
   *
   * Сама запись в таблицу идёт в фоне (на устройстве — движок очереди вне WebView, и в свёрнутом,
   * и в закрытом приложении), её состояние — в «Загрузках»; если хранилище не настроено или проверка
   * уже показала, что таблицы нет (своей приложение не создаёт), записи подождут исправления
   * настроек — об этом сообщаем сразу.
   */
  const uploadSelected = async () => {
    if (isHandingOff) return
    const selected = session.items.filter((candidate) => candidate.selected)
    if (selected.length === 0) {
      await NativeDialogs.alert({ title: t('sendDialog.noneTitle'), message: t('sendDialog.noneMessage'), buttonTitle: t('common:ok') })
      return
    }
    const ready = selected.filter(isReady)
    const blocker = selected.find((candidate) => !isReady(candidate))
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
    const { advanced, general, storage } = settingsStore.getSnapshot()
    const columns = buildUploadColumns(enabledLabelFields(advanced.labelFields), general.language)
    for (const candidate of ready) {
      if (candidate.status.kind === 'done') uploadQueue.enqueue(candidate.status.label, columns)
    }
    setIsHandingOff(true)
    await new Promise((resolve) => window.setTimeout(resolve, HANDOFF_MS))
    session.removeMany(ready.map((candidate) => candidate.id))
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

  /** Панель листания — когда есть что листать или открыта сетка (из неё надо выйти и в пустом списке). */
  const hasSlideBar = session.items.length > 0 || view === 'grid'

  /** Сколько бирок выбрано для отправки. */
  const selectedCount = session.items.filter((candidate) => candidate.selected).length

  return (
    <section
      ref={workspaceRef}
      className={`scan-workspace${editMode.isEditing ? ' is-text-editing' : ''}`}
      aria-label={t('region')}
    >
      <input className="photo-input" {...picker.inputProps} />
      {/* Карточка фото и панель листания под ней — один блок. */}
      <div className={`photo-block${hasSlideBar ? ' has-slide-bar' : ''}`}>
        <PhotoCard
          item={item}
          items={session.items}
          activeIndex={activeIndex}
          view={view}
          showBack={usedGrid}
          isReceiving={picker.isReceiving}
          transform={transform}
          onPick={() => void addPhotos()}
          onOpen={() => setIsViewerOpen(true)}
          onLoad={(size) => item && session.markLoaded(item.id, size)}
          onError={() => item && session.markFailed(item.id)}
          onShowGrid={showGrid}
          onOpenCell={openCell}
          onOpenActive={closeGrid}
          onToggleSelected={session.toggleSelected}
        />
        {hasSlideBar && (
          <SlideBar
            activeIndex={activeIndex}
            positions={Math.min(session.items.length + 1, MAX_SCAN_ITEMS)}
            isGrid={view === 'grid'}
            onPrevious={() => session.select(activeIndex - 1)}
            onNext={() => session.select(activeIndex + 1)}
            onOpen={closeGrid}
          />
        )}
      </div>
      {/* Напоминание над карточкой результата: распознанное проверяют перед каждой отправкой. */}
      {status.kind === 'done' && <Notice compact className="check-notice anim-fade">{t('notes.checkBeforeSend')}</Notice>}
      <NotesCard
        cardRef={notesCardRef}
        itemKey={item?.id ?? `empty-${activeIndex}`}
        itemCount={session.items.length}
        activeIndex={activeIndex}
        onSelectItem={selectItem}
        isEditing={editMode.isEditing}
        status={status}
        hasPhoto={item !== null}
        onFieldChange={(key, value) => session.updateField(activeIndex, key, value)}
        onToggleEdit={editMode.toggle}
        onCloseEdit={editMode.exit}
        onAddPhoto={() => void addPhotos()}
        onClear={() => void removeItem()}
        onCancel={() => session.abort(activeIndex)}
        onRetry={retry}
        onNext={() => void uploadSelected()}
        sendCount={selectedCount}
        isUploading={isHandingOff}
      />
      {viewer.mounted && item && <PhotoViewer url={item.photoUrl} naturalSize={item.naturalSize} isClosing={viewer.closing} onClose={closeViewer} />}
    </section>
  )
}
