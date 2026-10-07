import { useStore } from '@/lib/store/useStore'
import type { ProviderId } from '../types'
import { modelCatalog, type SyncAccess } from './ModelCatalog'
import type { ModelAgeLimit } from './ModelFilter'

/**
 * Реактивное представление списка моделей одного провайдера.
 * Перерисовывается при изменении каталога; фильтрация нескольких десятков записей на каждый рендер дёшева.
 *
 * @param providerId Провайдер, чей список читается.
 * @param maxAgeMonths Ограничение по возрасту из расширенных настроек.
 * @param access Текущие учётные данные: если список получен с другими (другой адрес или ключ), он не показывается.
 */
export function useModelList(providerId: ProviderId, maxAgeMonths: ModelAgeLimit, access?: SyncAccess) {
  const state = useStore(modelCatalog)
  const entry = state.entries[providerId]
  const isCurrent = !access || modelCatalog.matches(providerId, access)
  return {
    /** Предлагаемые модели, сначала новые. */
    models: isCurrent ? modelCatalog.modelsOf(state, providerId, maxAgeMonths) : [],
    /** Список получен с текущими учётными данными (иначе он ещё загружается или не загрузился). */
    isCurrent,
    /** Откуда взят кэшированный список или `null`, если ничего не кэшировано. */
    source: entry?.source ?? null,
    /** Когда был получен кэшированный список или `null`. */
    fetchedAt: entry?.fetchedAt ?? null,
    /** Выполняется ли загрузка. */
    isLoading: state.loading[providerId] ?? false,
    /** Последняя ошибка загрузки или `null`. */
    error: state.errors[providerId] ?? null,
  }
}
