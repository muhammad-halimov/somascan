import { useCallback, useEffect, useRef, useState } from 'react'
import { modelCatalog } from '@/features/recognition/catalog/ModelCatalog'
import { ModelFilter } from '@/features/recognition/catalog/ModelFilter'
import { enabledLabelFields, type LabelKey, type LabelRecord } from '@/features/recognition/label/labelFields'
import { PRODUCT_FORM_KEY } from '@/features/recognition/label/productForm'
import { labelRecognizer, type PhotoVerdict } from '@/features/recognition/LabelRecognizer'
import { providerRegistry } from '@/features/recognition/providers/ProviderRegistry'
import { RecognitionError } from '@/features/recognition/RecognitionError'
import { useErrorText } from '@/features/recognition/useErrorText'
import { getProviderAccess } from '@/features/settings/store/providerAccess'
import { settingsStore } from '@/features/settings/store/SettingsStore'

/** Состояние распознавания. */
export type RecognitionStatus =
  /** Ничего не распознавалось (нет фото или сброс). */
  | { kind: 'idle' }
  /** Запрос выполняется. */
  | { kind: 'recognizing' }
  /** Бирка распознана; `photo` — стоит ли переснять фото. */
  | { kind: 'done'; label: LabelRecord; photo: PhotoVerdict }
  /** Ошибка; `message` уже переведено на язык интерфейса. */
  | { kind: 'failed'; message: string }
  /** Пользователь отменил распознавание; фото осталось, его можно распознать снова («Повтор»). */
  | { kind: 'cancelled' }

/** Начальное состояние. */
const IDLE: RecognitionStatus = { kind: 'idle' }

/**
 * Распознавание фото на главном экране.
 *
 * `recognize` берёт актуальные настройки в момент вызова (провайдер, ключ, модель, размер фото)
 * и отменяет предыдущий запрос. В очередь выгрузки бирка попадает позже, по кнопке «Далее».
 * Ошибки превращаются в текст на языке интерфейса.
 */
export function useLabelRecognition() {
  const errorText = useErrorText()
  const [status, setStatus] = useState<RecognitionStatus>(IDLE)
  const abortRef = useRef<AbortController | null>(null)
  /** Выбранная вручную форма поставки: переживает «Повтор» того же фото, сбрасывается с новым фото. */
  const productFormRef = useRef<string | null>(null)

  /** Отменяет текущий запрос, если он есть. */
  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /** Отменяет идущее распознавание по просьбе пользователя: фото остаётся, результат — «отменено». */
  const abort = useCallback(() => {
    if (!abortRef.current) return
    cancel()
    setStatus({ kind: 'cancelled' })
  }, [cancel])

  /** Сбрасывает результат и отменяет запрос. */
  const reset = useCallback(() => {
    cancel()
    productFormRef.current = null
    setStatus(IDLE)
  }, [cancel])

  /** Выбирает модель; если списка ещё нет в кэше — сначала загружает его. */
  const resolveModel = async (signal: AbortSignal) => {
    const { general, advanced } = settingsStore.getSnapshot()
    const id = general.provider
    const offered = () => modelCatalog.modelsOf(modelCatalog.getSnapshot(), id, advanced.modelMaxAgeMonths)
    let model = ModelFilter.pick(general.models[id], offered())
    if (!model && !providerRegistry.get(id).allowsDefaultModel) {
      await modelCatalog.sync(id, getProviderAccess(general, id))
      if (signal.aborted) return ''
      model = ModelFilter.pick('', offered())
    }
    return model
  }

  /** Распознаёт фото по адресу `imageUrl`. */
  const recognize = async (imageUrl: string) => {
    const { general, advanced } = settingsStore.getSnapshot()
    const provider = providerRegistry.get(general.provider)
    const access = getProviderAccess(general, provider.id)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus({ kind: 'recognizing' })

    try {
      if (!provider.isConfigured(access)) throw new RecognitionError('noApiKey', { provider: provider.title })
      const model = await resolveModel(controller.signal)
      if (!model && !provider.allowsDefaultModel) throw new RecognitionError('noModel', { provider: provider.title })
      const { label, photo } = await labelRecognizer.recognize({
        providerId: provider.id,
        model,
        access: { ...access, signal: controller.signal },
        imageUrl,
        maxImageSide: advanced.maxImageSide,
        instructions: advanced.prompt,
        fields: enabledLabelFields(advanced.labelFields),
        suppliers: advanced.knownSuppliers,
      })
      if (controller.signal.aborted) return
      setStatus({ kind: 'done', label: { ...label, [PRODUCT_FORM_KEY]: productFormRef.current }, photo })
    } catch (error) {
      // Отменено: выбрали новое фото или сбросили экран — результат больше не нужен.
      if (controller.signal.aborted) return
      setStatus({ kind: 'failed', message: errorText(error) })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  /** Правит одно распознанное поле (режим правки). */
  const updateField = useCallback((key: LabelKey, value: string) => {
    if (key === PRODUCT_FORM_KEY) productFormRef.current = value || null
    setStatus((current) => (current.kind === 'done' ? { ...current, label: { ...current.label, [key]: value } } : current))
  }, [])

  // Не оставляем висящий запрос после ухода с экрана.
  useEffect(() => () => abortRef.current?.abort(), [])

  return { status, recognize, cancel, abort, reset, updateField }
}
