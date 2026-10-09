import { modelCatalog } from '@/features/recognition/catalog/ModelCatalog'
import { ModelFilter } from '@/features/recognition/catalog/ModelFilter'
import { enabledLabelFields } from '@/features/recognition/label/labelFields'
import { labelRecognizer } from '@/features/recognition/LabelRecognizer'
import { providerRegistry } from '@/features/recognition/providers/ProviderRegistry'
import { RecognitionError } from '@/features/recognition/RecognitionError'
import { getProviderAccess } from '@/features/settings/store/providerAccess'
import { settingsStore } from '@/features/settings/store/SettingsStore'

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
 * @throws {RecognitionError} Нет ключа или модели, сбой провайдера; при отмене — ошибка отмены запроса.
 */
export async function recognizeLabel(imageUrl: string, signal: AbortSignal) {
  const { general, advanced } = settingsStore.getSnapshot()
  const provider = providerRegistry.get(general.provider)
  const access = getProviderAccess(general, provider.id)
  if (!provider.isConfigured(access)) throw new RecognitionError('noApiKey', { provider: provider.title })
  const model = await resolveModel(signal)
  if (!model && !provider.allowsDefaultModel) throw new RecognitionError('noModel', { provider: provider.title })
  return labelRecognizer.recognize({
    providerId: provider.id,
    model,
    access: { ...access, signal },
    imageUrl,
    maxImageSide: advanced.maxImageSide,
    instructions: advanced.prompt,
    fields: enabledLabelFields(advanced.labelFields),
    suppliers: advanced.knownSuppliers,
  })
}
