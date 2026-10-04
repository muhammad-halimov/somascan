import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react'
import { App as NativeApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { ActionSheet, ActionSheetButtonStyle } from '@capacitor/action-sheet'
import { Camera, MediaTypeSelection } from '@capacitor/camera'
import { Dialog } from '@capacitor/dialog'
import { Network } from '@capacitor/network'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import './App.css'

type Panel = 'settings' | 'uploads' | null
type TouchOrigin = { x: number; y: number }
type PinchOrigin = { distance: number; scale: number; centerX: number; centerY: number; offsetX: number; offsetY: number }
type PanOrigin = { pointerId?: number; x: number; y: number; offsetX: number; offsetY: number; didMove: boolean }
type TouchPoint = { clientX: number; clientY: number }
type PhotoSize = { width: number; height: number }
const LABEL_FIELDS = [
  { key: 'contract', label: 'Договор' },
  { key: 'destination', label: 'Пункт назначения' },
  { key: 'size', label: 'Размер' },
  { key: 'grade', label: 'Марка стали' },
  { key: 'standard', label: 'Стандарт' },
  { key: 'heat', label: 'Номер плавки' },
  { key: 'batch', label: 'Партия' },
  { key: 'weight_kg', label: 'Вес' },
  { key: 'customer_ref', label: 'Ссылка заказчика' },
] as const
type LabelRecord = Record<(typeof LABEL_FIELDS)[number]['key'], string | number | null>

const GEMINI_MODEL = 'gemini-3.1-flash-lite'
const LABEL_PROMPT = `Это фото металлической бирки (ярлык на рулоне арматуры/проката).
Прочитай все поля таблицы и верни ТОЛЬКО валидный JSON без markdown-разметки.
Если поле нечитаемо или отсутствует — используй null.

{
  "contract": null,
  "destination": null,
  "size": null,
  "grade": null,
  "standard": null,
  "heat": null,
  "batch": null,
  "weight_kg": null,
  "customer_ref": null
}`

function formatLabelValue(key: keyof LabelRecord, value: LabelRecord[keyof LabelRecord]) {
  if (value === null || value === '') return 'Не распознано'
  return key === 'weight_kg' ? `${value} кг` : String(value)
}

function formatLabelNotes(data: LabelRecord) {
  return `Данные с бирки\n\n${LABEL_FIELDS
    .map(({ key, label }) => `${label}: ${formatLabelValue(key, data[key])}`)
    .join('\n')}`
}

const touchDistance = (first: TouchPoint, second: TouchPoint) =>
  Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
const touchCenter = (first: TouchPoint, second: TouchPoint) => ({
  x: (first.clientX + second.clientX) / 2,
  y: (first.clientY + second.clientY) / 2,
})

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg className="settings-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path className="settings-glyph-body" d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.6-.21l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54a7.3 7.3 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.6.21L2.72 8.47a.5.5 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32a.5.5 0 0 0 .6.21l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54a7.3 7.3 0 0 0 1.62-.94l2.39.96a.5.5 0 0 0 .6-.21l1.92-3.32a.5.5 0 0 0-.12-.61l-2.03-1.58ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
      <circle className="settings-glyph-hole" cx="12" cy="12" r="2.65" />
    </svg>
  )
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
}

function RotateIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.2-4.8L4 8m0 0V4m0 4h4m-4 5a8 8 0 0 0 14.2 4.8L20 16m0 0v4m0-4h-4" /></svg>
}

function PencilIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4.2-.9L19 8.3a2.1 2.1 0 0 0-3-3L5.2 16.1 4 20Z" /></svg>
}

function ResetIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4.8 9A7.5 7.5 0 0 1 18 6.5L20 12M4 17v-5h5m10.2 3A7.5 7.5 0 0 1 6 17.5L4 12" /></svg>
}

function NextIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
}

function AddIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

async function getInlineImageData(imageUrl: string) {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error('Не удалось открыть выбранное фото.')

  const image = await response.blob()
  if (!image.type.startsWith('image/')) throw new Error('Выбранный файл не является изображением.')

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Не удалось прочитать фото.'))
    reader.onerror = () => reject(new Error('Не удалось прочитать фото.'))
    reader.readAsDataURL(image)
  })

  return { mimeType: image.type || 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
}

function App() {
  const [panel, setPanel] = useState<Panel>(null)
  const [isClosing, setIsClosing] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPhotoViewerOpen, setIsPhotoViewerOpen] = useState(false)
  const [photoSelectionId, setPhotoSelectionId] = useState(0)
  const [isImageLoading, setIsImageLoading] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [notes, setNotes] = useState('')
  const [recognizedLabel, setRecognizedLabel] = useState<LabelRecord | null>(null)
  const [isTextEditing, setIsTextEditing] = useState(false)
  const [imageScale, setImageScale] = useState(1)
  const [imageRotation, setImageRotation] = useState(0)
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 })
  const [imageNaturalSize, setImageNaturalSize] = useState<PhotoSize | null>(null)
  const [frameSize, setFrameSize] = useState<PhotoSize>({ width: 380, height: 352 })
  const isPhotoViewerOpenRef = useRef(isPhotoViewerOpen)
  const isTextEditingRef = useRef(isTextEditing)
  const panelRef = useRef<Panel>(null)
  const closeTimer = useRef<number | null>(null)
  const touchOrigin = useRef<TouchOrigin | null>(null)
  const settingsScroll = useRef<HTMLDivElement>(null)
  const uploadsRef = useRef<HTMLElement>(null)
  const webPhotoInput = useRef<HTMLInputElement>(null)
  const notesInput = useRef<HTMLTextAreaElement>(null)
  const firstLabelInput = useRef<HTMLInputElement>(null)
  const editFocusFrame = useRef<number | null>(null)
  const recognitionAbort = useRef<AbortController | null>(null)
  const imageFrame = useRef<HTMLButtonElement>(null)
  const photoViewerStage = useRef<HTMLDivElement>(null)
  const lastAutoRecognitionSource = useRef<string | null>(null)
  const pinchOrigin = useRef<PinchOrigin | null>(null)
  const panOrigin = useRef<PanOrigin | null>(null)
  const ignorePhotoTapUntil = useRef(0)

  const cancelEditFocus = () => {
    if (editFocusFrame.current !== null) {
      window.cancelAnimationFrame(editFocusFrame.current)
      editFocusFrame.current = null
    }
  }

  useLayoutEffect(() => {
    isPhotoViewerOpenRef.current = isPhotoViewerOpen
    isTextEditingRef.current = isTextEditing
  }, [isPhotoViewerOpen, isTextEditing])

  const openPanel = useCallback((nextPanel: Exclude<Panel, null>) => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
    panelRef.current = nextPanel
    setIsClosing(false)
    setPanel(nextPanel)
  }, [])

  const closePanel = useCallback(() => {
    if (panelRef.current === null || closeTimer.current !== null) return
    setIsClosing(true)
    closeTimer.current = window.setTimeout(() => {
      panelRef.current = null
      setPanel(null)
      setIsClosing(false)
      closeTimer.current = null
    }, 220)
  }, [])

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  useEffect(() => () => {
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  useEffect(() => {
    const element = isPhotoViewerOpen ? photoViewerStage.current : imageFrame.current
    if (!previewUrl || imageError || !element) return
    const observer = new ResizeObserver(() => {
      setFrameSize({ width: element.clientWidth, height: element.clientHeight })
    })
    observer.observe(element)
    setFrameSize({ width: element.clientWidth, height: element.clientHeight })
    return () => observer.disconnect()
  }, [previewUrl, imageError, isPhotoViewerOpen])

  useEffect(() => {
    if (!isPhotoViewerOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (window.history.state?.somascanTransientView === 'photo') window.history.back()
        else setIsPhotoViewerOpen(false)
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [isPhotoViewerOpen])

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = (dark: boolean) => {
      root.dataset.theme = dark ? 'dark' : 'light'
      root.style.colorScheme = dark ? 'dark' : 'light'
      if (!Capacitor.isNativePlatform()) return

      void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined)
      // Keep system-bar glyphs readable against the system-matched app theme.
      void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined)
    }

    applyTheme(media.matches)
    const onThemeChange = (event: MediaQueryListEvent) => applyTheme(event.matches)
    media.addEventListener('change', onThemeChange)
    const frame = window.requestAnimationFrame(() => {
      if (Capacitor.isNativePlatform()) {
        void SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => undefined)
      }
    })

    return () => {
      media.removeEventListener('change', onThemeChange)
      window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    let listener: PluginListenerHandle | undefined
    let active = true

    const updateNetwork = (connected: boolean) => setIsOffline(!connected)
    void Network.getStatus()
      .then((status) => { if (active) updateNetwork(status.connected) })
      .catch(() => { if (active) updateNetwork(navigator.onLine) })
    void Network.addListener('networkStatusChange', (status) => updateNetwork(status.connected))
      .then((handle) => {
        listener = handle
        if (!active) void handle.remove()
      })
      .catch(() => undefined)

    const onBrowserOnline = () => updateNetwork(true)
    const onBrowserOffline = () => updateNetwork(false)
    window.addEventListener('online', onBrowserOnline)
    window.addEventListener('offline', onBrowserOffline)

    return () => {
      active = false
      void listener?.remove()
      window.removeEventListener('online', onBrowserOnline)
      window.removeEventListener('offline', onBrowserOffline)
    }
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    if (panel === 'settings' || isTextEditing || isPhotoViewerOpen) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [panel, isTextEditing, isPhotoViewerOpen])

  useEffect(() => {
    if (!isTextEditing && !isPhotoViewerOpen) return
    window.history.pushState({ somascanTransientView: isPhotoViewerOpen ? 'photo' : 'editor' }, '', window.location.href)
    const handleBackGesture = () => {
      if (isPhotoViewerOpenRef.current) setIsPhotoViewerOpen(false)
      else if (isTextEditingRef.current) {
        cancelEditFocus()
        setIsTextEditing(false)
        notesInput.current?.blur()
        firstLabelInput.current?.blur()
      }
    }
    window.addEventListener('popstate', handleBackGesture)
    return () => window.removeEventListener('popstate', handleBackGesture)
  }, [isTextEditing, isPhotoViewerOpen])

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    let handle: PluginListenerHandle | undefined
    let active = true
    void NativeApp.addListener('backButton', ({ canGoBack }) => {
      if (isPhotoViewerOpenRef.current) {
        if (window.history.state?.somascanTransientView === 'photo') window.history.back()
        else setIsPhotoViewerOpen(false)
      }
      else if (isTextEditingRef.current) {
        if (window.history.state?.somascanTransientView === 'editor') window.history.back()
        else {
          cancelEditFocus()
          setIsTextEditing(false)
          notesInput.current?.blur()
          firstLabelInput.current?.blur()
        }
      }
      else if (panelRef.current !== null) closePanel()
      else if (!canGoBack) void NativeApp.exitApp()
      else window.history.back()
    }).then((result) => {
      handle = result
      if (!active) void result.remove()
    }).catch(() => undefined)
    return () => {
      active = false
      void handle?.remove()
    }
  }, [closePanel])

  useEffect(() => {
    if (panel !== 'uploads') return
    const closeOnOutsideTap = (event: PointerEvent) => {
      if (!uploadsRef.current?.contains(event.target as Node)) closePanel()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel()
    }
    document.addEventListener('pointerdown', closeOnOutsideTap)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideTap)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [panel, closePanel])

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const setViewportHeight = () => {
      document.documentElement.style.setProperty('--visual-viewport-height', `${viewport.height}px`)
    }
    setViewportHeight()
    viewport.addEventListener('resize', setViewportHeight)
    viewport.addEventListener('scroll', setViewportHeight)
    return () => {
      viewport.removeEventListener('resize', setViewportHeight)
      viewport.removeEventListener('scroll', setViewportHeight)
      document.documentElement.style.removeProperty('--visual-viewport-height')
    }
  }, [])

  const rememberTouch = (event: ReactTouchEvent) => {
    const touch = event.changedTouches[0]
    touchOrigin.current = { x: touch.clientX, y: touch.clientY }
  }

  const cancelRecognition = () => {
    recognitionAbort.current?.abort()
    recognitionAbort.current = null
    setIsRecognizing(false)
  }

  const closeOnDownSwipe = (event: ReactTouchEvent, scrollElement?: HTMLDivElement | null) => {
    if (!touchOrigin.current) return
    const touch = event.changedTouches[0]
    const dx = Math.abs(touch.clientX - touchOrigin.current.x)
    const dy = touch.clientY - touchOrigin.current.y
    touchOrigin.current = null
    if (dy > 84 && dx < 72 && (!scrollElement || scrollElement.scrollTop <= 0)) closePanel()
  }

  const selectWebPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !file.type.startsWith('image/')) return
    cancelRecognition()
    lastAutoRecognitionSource.current = null
    setPhotoSelectionId((id) => id + 1)
    setIsPhotoViewerOpen(false)
    setImageError(false)
    setIsImageLoading(true)
    setImageScale(1)
    setImageRotation(0)
    setImageOffset({ x: 0, y: 0 })
    setImageNaturalSize(null)
    setRecognizedLabel(null)
    setNotes('')
    setIsTextEditing(false)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const choosePhoto = async () => {
    if (!Capacitor.isNativePlatform()) {
      webPhotoInput.current?.click()
      return
    }

    setImageError(false)
    try {
      const selection = await ActionSheet.showActions({
        title: 'Добавить фото',
        cancelable: true,
        options: [
          { title: 'Сделать снимок' },
          { title: 'Выбрать из галереи' },
          { title: 'Отмена', style: ActionSheetButtonStyle.Cancel },
        ],
      })

      if (selection.index === 2 || selection.index < 0) return
      const photo = selection.index === 0
        ? await Camera.takePhoto({ quality: 90, editable: 'no' })
        : (await Camera.chooseFromGallery({
          mediaType: MediaTypeSelection.Photo,
          allowMultipleSelection: false,
        })).results[0]
      if (!photo?.webPath) return
      cancelRecognition()
      lastAutoRecognitionSource.current = null
      setPhotoSelectionId((id) => id + 1)
      setIsPhotoViewerOpen(false)
      setIsImageLoading(true)
      setImageScale(1)
      setImageRotation(0)
      setImageOffset({ x: 0, y: 0 })
      setImageNaturalSize(null)
      setRecognizedLabel(null)
      setNotes('')
      setIsTextEditing(false)
      setPreviewUrl(photo.webPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.toLowerCase().includes('cancel')) setImageError(true)
    }
  }

  const clampImageOffset = (x: number, y: number, scale = imageScale, rotation = imageRotation) => {
    const layout = getPhotoLayout(rotation)
    const transformedWidth = layout.width * scale
    const transformedHeight = layout.height * scale
    const maxX = Math.abs(transformedWidth - frameSize.width) / 2
    const maxY = Math.abs(transformedHeight - frameSize.height) / 2
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    }
  }

  const getPhotoLayout = (rotation: number) => {
    const natural = imageNaturalSize ?? { width: 4, height: 3 }
    const rotated = rotation % 180 !== 0
    const orientedWidth = rotated ? natural.height : natural.width
    const orientedHeight = rotated ? natural.width : natural.height
    const fit = Math.min(frameSize.width / orientedWidth, frameSize.height / orientedHeight)
    const width = orientedWidth * fit
    const height = orientedHeight * fit
    return {
      width: rotated ? height : width,
      height: rotated ? width : height,
    }
  }

  const changeImageScale = (scale: number) => {
    const nextScale = Math.min(4, Math.max(1, scale))
    setImageScale(nextScale)
    setImageOffset(clampImageOffset(imageOffset.x, imageOffset.y, nextScale))
  }

  const rotateImage = () => {
    const nextRotation = (imageRotation + 90) % 360
    setImageRotation(nextRotation)
    setImageOffset(clampImageOffset(imageOffset.x, imageOffset.y, imageScale, nextRotation))
  }

  const canPanImage = Boolean(previewUrl && !isImageLoading && !imageError)
  const photoLayout = getPhotoLayout(imageRotation)

  const startImageGesture = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const center = touchCenter(event.touches[0], event.touches[1])
      pinchOrigin.current = {
        distance: touchDistance(event.touches[0], event.touches[1]),
        scale: imageScale,
        centerX: center.x,
        centerY: center.y,
        offsetX: imageOffset.x,
        offsetY: imageOffset.y,
      }
      panOrigin.current = null
      ignorePhotoTapUntil.current = Date.now() + 600
    } else if (
      event.touches.length === 1 &&
      canPanImage &&
      (event.target as HTMLElement).closest('.photo-image-action')
    ) {
      panOrigin.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        offsetX: imageOffset.x,
        offsetY: imageOffset.y,
        didMove: false,
      }
    }
  }

  const moveImageGesture = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2 && pinchOrigin.current) {
      const origin = pinchOrigin.current
      const center = touchCenter(event.touches[0], event.touches[1])
      const scale = Math.min(4, Math.max(1, origin.scale * touchDistance(event.touches[0], event.touches[1]) / origin.distance))
      setImageScale(scale)
      setImageOffset(clampImageOffset(
        origin.offsetX + center.x - origin.centerX,
        origin.offsetY + center.y - origin.centerY,
        scale,
      ))
      ignorePhotoTapUntil.current = Date.now() + 600
    } else if (event.touches.length === 1 && panOrigin.current) {
      const origin = panOrigin.current
      const touch = event.touches[0]
      const dx = touch.clientX - origin.x
      const dy = touch.clientY - origin.y
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        origin.didMove = true
        ignorePhotoTapUntil.current = Date.now() + 600
      }
      setImageOffset(clampImageOffset(origin.offsetX + dx, origin.offsetY + dy))
    }
  }

  const finishImageGesture = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2 && pinchOrigin.current) {
      pinchOrigin.current = null
      ignorePhotoTapUntil.current = Date.now() + 450
      if (event.touches.length === 1 && canPanImage) {
        panOrigin.current = {
          x: event.touches[0].clientX,
          y: event.touches[0].clientY,
          offsetX: imageOffset.x,
          offsetY: imageOffset.y,
          didMove: true,
        }
      }
    }
    if (event.touches.length === 0) panOrigin.current = null
  }

  const startPointerPan = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse' || !canPanImage) return
    event.currentTarget.setPointerCapture(event.pointerId)
    panOrigin.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: imageOffset.x,
      offsetY: imageOffset.y,
      didMove: false,
    }
  }

  const movePointerPan = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = panOrigin.current
    if (!origin || origin.pointerId !== event.pointerId) return
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (Math.abs(dx) + Math.abs(dy) > 2) {
      origin.didMove = true
      ignorePhotoTapUntil.current = Date.now() + 600
    }
    setImageOffset(clampImageOffset(origin.offsetX + dx, origin.offsetY + dy))
  }

  const finishPointerPan = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (panOrigin.current?.pointerId === event.pointerId) panOrigin.current = null
  }

  const openPhotoViewer = () => {
    if (Date.now() < ignorePhotoTapUntil.current) return
    setIsPhotoViewerOpen(true)
  }

  const closePhotoViewer = () => {
    if (window.history.state?.somascanTransientView === 'photo') window.history.back()
    else setIsPhotoViewerOpen(false)
  }

  const deactivateTextEditing = () => {
    cancelEditFocus()
    setIsTextEditing(false)
    notesInput.current?.blur()
    firstLabelInput.current?.blur()
    if (window.history.state?.somascanTransientView === 'editor') window.history.back()
  }

  const toggleTextEditing = () => {
    if (isTextEditing) {
      deactivateTextEditing()
    } else {
      cancelEditFocus()
      setIsTextEditing(true)
      editFocusFrame.current = window.requestAnimationFrame(() => {
        editFocusFrame.current = null
        if (!isTextEditingRef.current) return
        if (recognizedLabel) firstLabelInput.current?.focus()
        else notesInput.current?.focus()
      })
    }
  }

  const recognizeLabel = async () => {
    if (!previewUrl) {
      setNotes('Сначала добавьте фото бирки.')
      return
    }
    if (!__GEMINI_API_KEY__) {
      setNotes('Не задан GEMINI_GOOGLE_API_KEY в .env.local.')
      return
    }

    recognitionAbort.current?.abort()
    const controller = new AbortController()
    recognitionAbort.current = controller
    setIsRecognizing(true)
    setIsTextEditing(false)
    setRecognizedLabel(null)
    setNotes('Распознавание фото…')
    notesInput.current?.blur()

    try {
      const image = await getInlineImageData(previewUrl)
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': __GEMINI_API_KEY__,
          },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: LABEL_PROMPT },
                { inlineData: image },
              ],
            }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
          }),
          signal: controller.signal,
        },
      )
      const result = await response.json() as {
        error?: { message?: string }
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      if (!response.ok) throw new Error(result.error?.message || 'Ошибка Gemini API.')

      const rawText = result.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('\n')
        .trim()
      if (!rawText) throw new Error('Gemini не вернул распознанный текст.')

      const cleaned = rawText.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim()
      const parsed = JSON.parse(cleaned) as Record<string, unknown>
      const label = Object.fromEntries(LABEL_FIELDS.map(({ key }) => {
        const value = parsed[key]
        return [key, typeof value === 'string' || typeof value === 'number' ? value : null]
      })) as LabelRecord
      setRecognizedLabel(label)
      setNotes(formatLabelNotes(label))
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setNotes(`Ошибка распознавания: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (recognitionAbort.current === controller) {
        recognitionAbort.current = null
        setIsRecognizing(false)
      }
    }
  }

  const resetWorkspace = async () => {
    const { value: confirmed } = await Dialog.confirm({
      title: 'Сбросить?',
      message: 'Фото и текст будут удалены.',
      okButtonTitle: 'Сбросить',
      cancelButtonTitle: 'Отмена',
    })
    if (!confirmed) return

    cancelRecognition()
    setPreviewUrl(null)
    lastAutoRecognitionSource.current = null
    setIsPhotoViewerOpen(false)
    setIsImageLoading(false)
    setImageError(false)
    setImageScale(1)
    setImageRotation(0)
    setImageOffset({ x: 0, y: 0 })
    setImageNaturalSize(null)
    setNotes('')
    setRecognizedLabel(null)
    setIsTextEditing(false)
    notesInput.current?.blur()
    firstLabelInput.current?.blur()
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="SomaScan — главная">
          <img src="/somaco.ico" alt="SomaScan" />
        </a>
        <nav className="header-actions" aria-label="Основное меню">
          <button
            className={`icon-button${panel === 'uploads' ? ' is-active' : ''}`}
            type="button"
            aria-label="Загрузки"
            aria-expanded={panel === 'uploads'}
            onClick={() => panelRef.current === 'uploads' ? closePanel() : openPanel('uploads')}
          >
            <UploadIcon />
          </button>
          <button
            className={`icon-button${panel === 'settings' ? ' is-active' : ''}`}
            type="button"
            aria-label="Настройки"
            aria-haspopup="dialog"
            aria-expanded={panel === 'settings'}
            onClick={() => panelRef.current === 'settings' ? closePanel() : openPanel('settings')}
          >
            <SettingsIcon />
          </button>
        </nav>
      </header>

      {isOffline && <div className="offline-banner" role="status" aria-live="polite">Нет подключения к интернету</div>}

      <section className="scan-workspace" aria-label="Рабочая область сканирования">
        <input
          className="photo-input"
          ref={webPhotoInput}
          type="file"
          accept="image/*"
          onChange={selectWebPhoto}
          tabIndex={-1}
          aria-hidden="true"
        />
        <div
          className={`photo-card${previewUrl ? ' has-photo' : ''}${isTextEditing ? ' is-text-editing' : ''}`}
          aria-busy={isImageLoading || isRecognizing}
          onTouchStart={startImageGesture}
          onTouchMove={moveImageGesture}
          onTouchEnd={finishImageGesture}
          onTouchCancel={finishImageGesture}
        >
          {previewUrl && !imageError && (
            <button
              className="photo-image-action"
              type="button"
              aria-label="Открыть фотографию на весь экран"
              onClick={openPhotoViewer}
              ref={imageFrame}
              onPointerDown={startPointerPan}
              onPointerMove={movePointerPan}
              onPointerUp={finishPointerPan}
              onPointerCancel={finishPointerPan}
            >
              <span className="photo-pan-layer" style={{ transform: `translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0)` }}>
                <span
                  className="photo-transform"
                  style={{
                    width: photoLayout.width,
                    height: photoLayout.height,
                    transform: `translate(-50%, -50%) rotate(${imageRotation}deg) scale(${imageScale})`,
                  }}
                >
                  <img
                    key={photoSelectionId}
                    className="photo-preview"
                    src={previewUrl}
                    alt="Выбранная фотография"
                    onLoad={(event) => {
                      setImageNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
                      setIsImageLoading(false)
                      if (lastAutoRecognitionSource.current !== previewUrl) {
                        lastAutoRecognitionSource.current = previewUrl
                        void recognizeLabel()
                      }
                    }}
                    onError={() => {
                      setIsImageLoading(false)
                      setImageError(true)
                    }}
                  />
                </span>
              </span>
            </button>
          )}
          {(isImageLoading || isRecognizing) && (
            <span
              className={`photo-loading${isRecognizing ? ' is-recognizing' : ''}`}
              role="status"
              aria-label={isRecognizing ? 'Распознавание фотографии' : 'Загрузка фотографии'}
            >
              <span className="photo-spinner" />
            </span>
          )}
          {(!previewUrl || imageError) && (
            <button className="photo-empty" type="button" aria-label="Добавить фотографию" onClick={() => void choosePhoto()}>
              <span className="photo-plus" aria-hidden="true" />
              <span className="photo-label">{imageError ? 'Не удалось открыть фото. Попробуйте ещё раз' : 'Добавить фото'}</span>
            </button>
          )}
          {previewUrl && !imageError && !isImageLoading && (
            <div className="photo-controls" role="group" aria-label="Управление фотографией">
              <button
                className="photo-control"
                type="button"
                aria-label="Уменьшить"
                disabled={imageScale <= 1}
                onClick={() => changeImageScale(imageScale - 0.25)}
              >−</button>
              <button
                className="photo-control"
                type="button"
                aria-label="Увеличить"
                disabled={imageScale >= 4}
                onClick={() => changeImageScale(imageScale + 0.25)}
              >+</button>
              <button
                className="photo-control photo-rotate"
                type="button"
                aria-label="Повернуть на 90 градусов"
                onClick={rotateImage}
              ><RotateIcon /></button>
            </div>
          )}
        </div>

        <div
          className={`notes-card${isTextEditing ? ' is-text-editing' : ''}`}
          aria-busy={isRecognizing}
          onBlur={(event) => {
            if (isTextEditing && !event.currentTarget.contains(event.relatedTarget as Node | null)) deactivateTextEditing()
          }}
        >
          <div className="notes-toolbar">
            <button
              className={`notes-edit-button${isTextEditing ? ' is-active' : ''}`}
              type="button"
              aria-label={isTextEditing ? 'Завершить редактирование' : 'Редактировать текст'}
              aria-pressed={isTextEditing}
              onClick={(event) => {
                const button = event.currentTarget
                toggleTextEditing()
                if (isTextEditing) window.requestAnimationFrame(() => button.blur())
              }}
            >
              <PencilIcon />
            </button>
          </div>
          <div className="notes-divider" />
          {recognizedLabel ? (
            <div
              className={`recognition-result${isTextEditing ? ' is-editing' : ''}`}
              aria-label="Распознанные данные"
            >
              <h2 className="recognition-title">Данные с бирки</h2>
              <div className="recognition-fields">
                {LABEL_FIELDS.map(({ key, label }) => {
                  const value = recognizedLabel[key]
                  const isMissing = value === null || value === ''
                  return (
                    <label className="recognition-field" key={key}>
                      <span className="recognition-field-label">{label}</span>
                      {isTextEditing ? (
                        <input
                          ref={key === LABEL_FIELDS[0].key ? firstLabelInput : undefined}
                          className="recognition-field-input"
                          aria-label={label}
                          value={value ?? ''}
                          placeholder="Не распознано"
                          onChange={(event) => {
                            const updated = { ...recognizedLabel, [key]: event.target.value }
                            setRecognizedLabel(updated)
                            setNotes(formatLabelNotes(updated))
                          }}
                        />
                      ) : (
                        <span className={`recognition-field-value${isMissing ? ' is-missing' : ''}`}>
                          {formatLabelValue(key, value)}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          ) : (
            <textarea
              ref={notesInput}
              className={`notes-textarea${isTextEditing ? ' is-editing' : ''}`}
              aria-label="Текст результата"
              placeholder="Текст появится здесь"
              value={notes}
              readOnly={!isTextEditing}
              onChange={(event) => {
                setNotes(event.target.value)
              }}
            />
          )}
          <div className="notes-footer">
            <div className="notes-divider" />
            <div className="notes-actions" role="group" aria-label="Действия">
              {previewUrl && !imageError && (
                <button
                  className="workspace-action workspace-add"
                  type="button"
                  aria-label="Добавить фотографию"
                  onClick={() => void choosePhoto()}
                >
                  <AddIcon />
                </button>
              )}
              <button className="workspace-action" type="button" aria-label="Сбросить" onClick={resetWorkspace}>
                <ResetIcon />
              </button>
              <button
                className="workspace-action is-next"
                type="button"
                aria-label="Далее"
                onClick={() => void Dialog.alert({
                  title: 'Далее',
                  message: 'Это действие пока недоступно.',
                  buttonTitle: 'Понятно',
                })}
              >
                <NextIcon />
              </button>
            </div>
          </div>
        </div>
      </section>

      {isPhotoViewerOpen && previewUrl && !imageError && (
        <section className="photo-viewer" role="dialog" aria-modal="true" aria-labelledby="photo-viewer-title">
          <header className="photo-viewer-header">
            <h2 id="photo-viewer-title">Просмотр фото</h2>
            <button
              className="icon-button photo-viewer-close"
              type="button"
              aria-label="Закрыть фото"
              onClick={closePhotoViewer}
            >
              <CloseIcon />
            </button>
          </header>
          <div
            className="photo-viewer-stage"
            ref={photoViewerStage}
            onTouchStart={startImageGesture}
            onTouchMove={moveImageGesture}
            onTouchEnd={finishImageGesture}
            onTouchCancel={finishImageGesture}
          >
            <button
              className="photo-image-action photo-viewer-image"
              type="button"
              aria-label="Фото. Используйте жесты для перемещения и масштабирования"
              onPointerDown={startPointerPan}
              onPointerMove={movePointerPan}
              onPointerUp={finishPointerPan}
              onPointerCancel={finishPointerPan}
            >
              <span className="photo-pan-layer" style={{ transform: `translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0)` }}>
                <span
                  className="photo-transform"
                  style={{
                    width: photoLayout.width,
                    height: photoLayout.height,
                    transform: `translate(-50%, -50%) rotate(${imageRotation}deg) scale(${imageScale})`,
                  }}
                >
                  <img key={photoSelectionId} className="photo-preview" src={previewUrl} alt="Фото бирки на весь экран" />
                </span>
              </span>
            </button>
            {(isImageLoading || isRecognizing) && (
              <span className="photo-loading is-recognizing" role="status" aria-label="Обработка фотографии">
                <span className="photo-spinner" />
              </span>
            )}
            {!isImageLoading && (
              <div className="photo-controls photo-viewer-controls" role="group" aria-label="Управление фотографией">
                <button
                  className="photo-control"
                  type="button"
                  aria-label="Уменьшить"
                  disabled={imageScale <= 1}
                  onClick={() => changeImageScale(imageScale - 0.25)}
                >−</button>
                <button
                  className="photo-control"
                  type="button"
                  aria-label="Увеличить"
                  disabled={imageScale >= 4}
                  onClick={() => changeImageScale(imageScale + 0.25)}
                >+</button>
                <button
                  className="photo-control photo-rotate"
                  type="button"
                  aria-label="Повернуть на 90 градусов"
                  onClick={rotateImage}
                ><RotateIcon /></button>
              </div>
            )}
          </div>
        </section>
      )}

      {panel === 'settings' && (
        <div className={`settings-backdrop${isClosing ? ' is-closing' : ''}`} onClick={closePanel}>
          <section
            className={`settings-modal${isClosing ? ' is-closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={rememberTouch}
            onTouchEnd={(event) => closeOnDownSwipe(event, settingsScroll.current)}
          >
            <header className="panel-header">
              <h1 id="settings-title">Настройки</h1>
              <button className="icon-button close-button" type="button" aria-label="Закрыть настройки" onClick={closePanel}>
                <CloseIcon />
              </button>
            </header>
            <div className="settings-content" ref={settingsScroll} />
          </section>
        </div>
      )}

      {panel === 'uploads' && (
        <section
          className={`uploads-popover${isClosing ? ' is-closing' : ''}`}
          aria-labelledby="uploads-title"
          ref={uploadsRef}
          onClick={(event) => event.stopPropagation()}
          onTouchStart={rememberTouch}
          onTouchEnd={(event) => closeOnDownSwipe(event)}
        >
          <header className="panel-header">
            <h2 id="uploads-title">Загрузки</h2>
            <button className="icon-button close-button" type="button" aria-label="Закрыть загрузки" onClick={closePanel}>
              <CloseIcon />
            </button>
          </header>
          <div className="uploads-content" />
        </section>
      )}
    </main>
  )
}

export default App
