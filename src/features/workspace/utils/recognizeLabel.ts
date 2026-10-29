import { modelCatalog } from '@/features/recognition/catalog/ModelCatalog'
import { ModelFilter } from '@/features/recognition/catalog/ModelFilter'
import { recognizedLabelFields } from '@/features/recognition/label/labelFields'
import { labelRecognizer } from '@/features/recognition/LabelRecognizer'
import { lmStudioServerKey } from '@/features/recognition/providers/LMStudioProvider'
import { providerRegistry } from '@/features/recognition/providers/ProviderRegistry'
import { RecognitionError } from '@/features/recognition/RecognitionError'
import { getProviderAccess } from '@/features/settings/store/providerAccess'
import { settingsStore } from '@/features/settings/store/SettingsStore'
import { lmStudioGate } from '@/features/uploads/leases/lmStudioGate'

/**
 * Длинная сторона фото для распознавания на устройстве: мелкий текст бирки (номера сертификатов) читается
 * лучше, чем на уменьшенном для облака фото, а в сеть фото не уходит.
 */
const ON_DEVICE_IMAGE_SIDE = 2560

/** Выбирает модель; если списка ещё нет в кэше — сначала загружает его. У распознавания на устройстве модели нет. */
async function resolveModel(signal: AbortSignal) {
  const { general, advanced } = settingsStore.getSnapshot()
  const id = general.provider
  if (providerRegistry.get(id).onDevice) return ''
  const offered = () => modelCatalog.modelsOf(modelCatalog.getSnapshot(), id, advanced.modelMaxAgeMonths)
  let model = ModelFilter.pick(general.models[id], offered())
  if (!model && !providerRegistry.get(id).allowsDefaultModel) {
    await modelCatalog.sync(id, getProviderAccess(general, id))
    if (signal.aborted) return ''
    model = ModelFilter.pick('', offered())
  }
  return model
}

/**
 * Распознаёт бирку на фото `imageUrl`, повёрнутом на `rotation` (как в карточке), с актуальными настройками
 * (провайдер, ключ, модель, размер фото, поля, известные поставщики — на момент вызова).
 *
 * LM Studio — общий сервер нескольких устройств: распознавание встаёт в очередь `lmStudioGate` — ждёт,
 * пока идёт смена модели (своя или чужая), и отмечает устройство занятым, чтобы смена модели на другом
 * устройстве не оборвала запрос. Модель берётся после ожидания — уже новая, если её только что сменили.
 * @throws {RecognitionError} Нет ключа или модели, сбой провайдера; при отмене — ошибка отмены запроса.
 */
export async function recognizeLabel(imageUrl: string, signal: AbortSignal, rotation = 0) {
  const { general } = settingsStore.getSnapshot()
  const provider = providerRegistry.get(general.provider)
  const access = getProviderAccess(general, provider.id)
  if (!provider.isConfigured(access)) throw new RecognitionError('noApiKey', { provider: provider.title })
  if (provider.id !== 'lmstudio') return recognizeNow(imageUrl, signal, rotation)
  const release = await lmStudioGate.use(lmStudioServerKey(access.endpoint || provider.defaultEndpoint), signal)
  try {
    return await recognizeNow(imageUrl, signal, rotation)
  } finally {
    release()
  }
}

/** Распознаёт сразу, с настройками на этот момент; `rotation` — поворот фото, заданный в карточке. */
async function recognizeNow(imageUrl: string, signal: AbortSignal, rotation: number) {
  const { general, advanced } = settingsStore.getSnapshot()
  const provider = providerRegistry.get(general.provider)
  const access = getProviderAccess(general, provider.id)
  const model = await resolveModel(signal)
  if (!model && !provider.allowsDefaultModel) throw new RecognitionError('noModel', { provider: provider.title })
  return labelRecognizer.recognize({
    providerId: provider.id,
    model,
    access: { ...access, signal },
    imageUrl,
    rotation,
    maxImageSide: provider.onDevice ? ON_DEVICE_IMAGE_SIDE : advanced.maxImageSide,
    instructions: advanced.prompt,
    fields: recognizedLabelFields(advanced.labelFields),
    suppliers: advanced.knownSuppliers,
  })
}
