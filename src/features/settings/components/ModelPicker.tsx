import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, LayersIcon, RefreshIcon } from '@/components/icons/Icons'
import { Button } from '@/components/ui/Button'
import { Disclosure } from '@/components/ui/Disclosure'
import { StatusDot, type StatusDotTone } from '@/components/ui/StatusDot'
import { FormSection } from '@/components/ui/FormSection'
import { List, ListItem } from '@/components/ui/List'
import { localModelLoader } from '@/features/recognition/catalog/LocalModelLoader'
import { modelCatalog } from '@/features/recognition/catalog/ModelCatalog'
import { ModelFilter } from '@/features/recognition/catalog/ModelFilter'
import { modelFit } from '@/features/recognition/catalog/modelFit'
import { useModelList } from '@/features/recognition/catalog/useModelList'
import { providerRegistry } from '@/features/recognition/providers/ProviderRegistry'
import type { ModelInfo, ProviderId } from '@/features/recognition/types'
import { useErrorText } from '@/features/recognition/useErrorText'
import { useStore } from '@/lib/store/useStore'
import { getProviderAccess } from '../store/providerAccess'
import { settingsStore } from '../store/SettingsStore'
import { useSettings } from '../store/useSettings'
import './ModelPicker.css'

/** Свойства `ModelPicker`. */
export interface ModelPickerProps {
  /** Провайдер, чьи модели показываем. */
  providerId: ProviderId
}

/** Пауза перед сворачиванием шторки после выбора: галочка успевает появиться на новой модели. */
const COLLAPSE_AFTER_PICK_MS = 220

/** После загрузки локальной модели шторка сворачивается не сразу: зелёная точка успевает загореться. */
const COLLAPSE_AFTER_LOAD_MS = 700

/**
 * Модель провайдера: шторка с выбранной моделью; список для выбора другой раскрывается по нажатию
 * и сворачивается сам после выбора. У каждой модели — характеристики (дата, контекст, цена),
 * рекомендация для бирок (`modelFit`) и — в английском интерфейсе — описание из её источника: API провайдера или открытого каталога models.dev. Рядом — кнопка «Обновить».
 *
 * Без API-ключа список — серый предпросмотр из открытого каталога:
 * видно, что доступно, но выбрать модель можно только после ввода ключа.
 *
 * LM Studio: у каждой модели точка — зелёная, если модель в памяти сервера, красная, если нет.
 * Выбор модели выгружает прежнюю и загружает новую (`LocalModelLoader`): пока идёт загрузка,
 * точка мигает жёлтым, а список серый и недоступен; потом точка горит зелёным.
 */
export function ModelPicker({ providerId }: ModelPickerProps) {
  const { t, i18n } = useTranslation('settings')
  const errorText = useErrorText()
  const { general, advanced } = useSettings()
  const provider = providerRegistry.get(providerId)
  const access = getProviderAccess(general, providerId)
  const isEnabled = provider.isConfigured(access)
  const { models, isLoading, error, isCurrent } = useModelList(providerId, advanced.modelMaxAgeMonths, access)
  const activeModel = ModelFilter.pick(general.models[providerId], models)
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(i18n.language, { month: 'short', year: 'numeric' }), [i18n.language])
  const [isOpen, setIsOpen] = useState(false)
  /**
   * Модель, выбранная на момент раскрытия: её название уже в заголовке шторки, в списке её не повторяем.
   * Запоминается при раскрытии, чтобы после выбора другой модели список не перестраивался, пока сворачивается.
   */
  const [shownInSummary, setShownInSummary] = useState<string | null>(null)
  const collapseTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current)
  }, [])

  /** Локальный сервер: показываем, какие модели в памяти, и переключаем загруженную модель. */
  const isLocal = providerId === 'lmstudio'
  const loader = useStore(localModelLoader)
  const isSwitching = isLocal && loader.loadingId !== null

  // Состояние моделей в памяти меняется вне приложения: при открытии настроек перечитываем список.
  const { endpoint, apiKey } = access
  useEffect(() => {
    if (!isLocal || !isEnabled) return
    localModelLoader.clearError()
    const timer = window.setTimeout(() => void modelCatalog.sync(providerId, { endpoint, apiKey }, { force: true }), 300)
    return () => window.clearTimeout(timer)
  }, [isLocal, isEnabled, providerId, endpoint, apiKey])

  // Модель загрузилась без ошибки — сворачиваем шторку, когда зелёная точка уже видна.
  const wasSwitching = useRef(false)
  useEffect(() => {
    if (wasSwitching.current && !isSwitching && !loader.error) {
      if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current)
      collapseTimer.current = window.setTimeout(() => {
        collapseTimer.current = null
        setIsOpen(false)
      }, COLLAPSE_AFTER_LOAD_MS)
    }
    wasSwitching.current = isSwitching
  }, [isSwitching, loader.error])

  /** Точка состояния локальной модели: мигает жёлтым при загрузке, зелёная — в памяти, красная — нет. */
  const dotOf = (model: ModelInfo) => {
    if (!isLocal || !isEnabled) return undefined
    // Во время переключения остальные модели выгружаются — показываем их красными сразу.
    const tone: StatusDotTone = loader.loadingId === model.id ? 'pending' : model.loaded && !isSwitching ? 'success' : 'danger'
    const label = tone === 'pending' ? t('general.modelState.loading') : tone === 'success' ? t('general.modelState.loaded') : t('general.modelState.notLoaded')
    return <StatusDot tone={tone} label={label} />
  }

  const compact = useMemo(() => new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 }), [i18n.language])
  const price = useMemo(() => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }), [i18n.language])

  /** Строка характеристик: дата выхода, контекст, цена, дата знаний, квантизация. */
  const factsOf = (model: ModelInfo) => {
    const details = model.details ?? {}
    return [
      releaseOf(model.releasedAt),
      details.contextTokens && t('general.modelContext', { value: compact.format(details.contextTokens) }),
      details.inputCost !== undefined && details.outputCost !== undefined
        && t('general.modelPrice', { input: price.format(details.inputCost), output: price.format(details.outputCost) }),
      details.knowledge && t('general.modelKnowledge', { date: details.knowledge }),
      details.quantization,
    ].filter(Boolean).join(' · ')
  }

  /** Есть ли у модели настоящее описание: у некоторых моделей Gemini API вместо него повторяет название. */
  const hasOwnDescription = (model: ModelInfo) => {
    const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '')
    return Boolean(model.description) && normalize(model.description!) !== normalize(model.name) && normalize(model.description!) !== normalize(model.id)
  }

  /** Описания из источников (API провайдера, models.dev) только на английском. */
  const showSourceDescription = i18n.language === 'en'

  /** Рекомендация для бирок: класс модели и пометка предварительной версии. */
  const fitOf = (model: ModelInfo) => {
    const { tier, preview } = modelFit(model, providerId)
    // «Хороший выбор по умолчанию» — только для стабильных сбалансированных моделей.
    return [
      tier && t(`general.fit.${tier}`),
      tier === 'balanced' && !preview && t('general.fit.default'),
      preview && t('general.fit.preview'),
    ].filter(Boolean).join(' ')
  }

  /** Дата выхода модели или «Локальная модель». */
  const releaseOf = (releasedAt: string | null) =>
    releasedAt ? dateFormat.format(new Date(releasedAt)) : t('general.localModel')

  const active = isEnabled ? models.find((model) => model.id === activeModel) : undefined
  const summary = !isEnabled
    ? t('general.modelsPreviewSummary', { count: models.length })
    : active?.name ?? t('general.modelNone')
  const details = active ? factsOf(active) : undefined
  /**
   * Варианты в раскрытом списке: все модели, кроме той, что в заголовке. У облачных моделей —
   * по снимку на момент раскрытия (список не перестраивается, пока шторка сворачивается), у локальных —
   * по текущему выбору: шторка открыта всю загрузку, и выбранная модель уже в заголовке.
   */
  const inSummary = isLocal ? activeModel : shownInSummary
  const options = models.filter((model) => !isEnabled || model.id !== inSummary)

  /** Раскрывает или сворачивает шторку. */
  const toggle = () => {
    if (!isOpen) setShownInSummary(isEnabled ? activeModel : null)
    setIsOpen((current) => !current)
  }

  /** Выбирает модель и сворачивает шторку; локальную модель сначала загружает в память сервера. */
  const pick = (id: string) => {
    settingsStore.setModel(providerId, id)
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current)
    if (isLocal) {
      // Шторка свернётся после загрузки (см. эффект выше).
      void localModelLoader.switchTo(id, access)
      return
    }
    collapseTimer.current = window.setTimeout(() => {
      collapseTimer.current = null
      setIsOpen(false)
    }, COLLAPSE_AFTER_PICK_MS)
  }

  /** Пояснение под списком: почему он серый или какой фильтр действует. */
  const note = !isEnabled
    ? t('general.modelsPreview')
    : !provider.reportsReleaseDates
      ? null
      : advanced.modelMaxAgeMonths === null
        ? t('general.modelsNoteAll')
        : t('general.modelsNote', { count: advanced.modelMaxAgeMonths })

  return (
    <FormSection
      title={t('general.model')}
      icon={<LayersIcon />}
      action={(
        <Button icon={<RefreshIcon />} busy={isLoading} onClick={() => void modelCatalog.sync(providerId, access, { force: true })}>
          {isLoading ? t('general.refreshing') : t('general.refresh')}
        </Button>
      )}
    >
      {models.length > 0 && (
        <Disclosure
          className="anim-enter"
          open={isOpen}
          onToggle={toggle}
          leading={active ? dotOf(active) : undefined}
          summary={summary}
          details={details}
          disabled={options.length === 0}
        >
          <List className="model-picker-list" role="radiogroup" label={t('general.model')} disabled={!isEnabled || isSwitching}>
            {options.map((model) => {
              const selected = isEnabled && model.id === activeModel
              return (
                <ListItem
                  key={model.id}
                  itemRole="radio"
                  leading={dotOf(model)}
                  primary={model.name}
                  secondary={(
                    <span className="model-picker-info">
                      <span>{factsOf(model)}</span>
                      {fitOf(model) && <span className="model-picker-fit">{fitOf(model)}</span>}
                      {/* Описание из источника — по-английски: показываем только в английском интерфейсе,
                          в остальных хватает рекомендации на языке интерфейса. */}
                      {showSourceDescription && hasOwnDescription(model) && <span className="model-picker-description">{model.description}</span>}
                    </span>
                  )}
                  trailing={selected ? <CheckIcon /> : undefined}
                  selected={selected}
                  disabled={!isEnabled || isSwitching}
                  onClick={() => pick(model.id)}
                />
              )
            })}
          </List>
        </Disclosure>
      )}
      {isLocal && loader.error && (
        <span className="model-picker-status is-error" role="alert">{t('general.modelSwitchError')}: {errorText(loader.error)}</span>
      )}
      {error ? (
        <span className="model-picker-status is-error" role="alert">{t('general.modelsLoadError')}: {errorText(error)}</span>
      ) : models.length === 0 && !isLoading && isCurrent && (
        <span className="model-picker-status">{t('general.modelsEmpty')}</span>
      )}
      {note && <span className="model-picker-note">{note}</span>}
    </FormSection>
  )
}
