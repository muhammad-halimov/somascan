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

/** Выбирает модель; если списка ещё нет в кэше — сначала загружает его. */
async function resolveModel(signal: AbortSignal) {
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

/**
 * Распознаёт бирку на фото `imageUrl` с актуальными настройками (провайдер, ключ, модель, размер фото,
 * поля, известные поставщики — на момент вызова).
 *
 * LM Studio — общий сервер нескольких устройств: распознавание встаёт в очередь `lmStudioGate` — ждёт,
 * пока идёт смена модели (своя или чужая), и отмечает устройство занятым, чтобы смена модели на другом
 * устройстве не оборвала запрос. Модель берётся после ожидания — уже новая, если её только что сменили.
 * @throws {RecognitionError} Нет ключа или модели, сбой провайдера; при отмене — ошибка отмены запроса.
 */
export async function recognizeLabel(imageUrl: string, signal: AbortSignal) {
  const { general } = settingsStore.getSnapshot()
  const provider = providerRegistry.get(general.provider)
  const access = getProviderAccess(general, provider.id)
  if (!provider.isConfigured(access)) throw new RecognitionError('noApiKey', { provider: provider.title })
  if (provider.id !== 'lmstudio') return recognizeNow(imageUrl, signal)
  const release = await lmStudioGate.use(lmStudioServerKey(access.endpoint || provider.defaultEndpoint), signal)
  try {
    return await recognizeNow(imageUrl, signal)
  } finally {
    release()
  }
}

/** Распознаёт сразу, с настройками на этот момент. */
async function recognizeNow(imageUrl: string, signal: AbortSignal) {
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
    maxImageSide: advanced.maxImageSide,
    instructions: advanced.prompt,
    fields: recognizedLabelFields(advanced.labelFields),
    suppliers: advanced.knownSuppliers,
  })
}
