import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarIcon, ImageIcon, InfinityIcon, InfoIcon, LayersIcon, ListIcon, MaximizeIcon, RefreshIcon } from '@/components/icons/Icons'
import { Button } from '@/components/ui/Button'
import { FormSection } from '@/components/ui/FormSection'
import { List, ListItem } from '@/components/ui/List'
import { Notice } from '@/components/ui/Notice'
import { Tabs } from '@/components/ui/Tabs'
import { useStore } from '@/lib/store/useStore'
import { modelCatalog } from '@/features/recognition/catalog/ModelCatalog'
import { MODEL_AGE_LIMITS } from '@/features/recognition/catalog/ModelFilter'
import { providerRegistry } from '@/features/recognition/providers/ProviderRegistry'
import { useErrorText } from '@/features/recognition/useErrorText'
import { getProviderAccess } from '../store/providerAccess'
import { settingsStore } from '../store/SettingsStore'
import { IMAGE_SIZE_LIMITS } from '../store/settingsSchema'
import { useSettings } from '../store/useSettings'
import { LabelFieldsPicker } from '../components/LabelFieldsPicker'
import { PromptEditor } from '../components/PromptEditor'
import { PROVIDER_ICONS } from '../components/providerIcons'
import './AdvancedTab.css'

/**
 * Вкладка «Расширенные»: сначала то, что определяет распознавание, — промпт и поля бирки;
 * затем фильтр возраста моделей, состояние списков моделей с обновлением,
 * размер фото для распознавания и версия приложения.
 */
export function AdvancedTab() {
  const { t, i18n } = useTranslation('settings')
  const errorText = useErrorText()
  const { advanced } = useSettings()
  const catalog = useStore(modelCatalog)
  const isRefreshing = Object.values(catalog.loading).some(Boolean)
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }), [i18n.language])

  /** Заново загружает списки всех провайдеров с текущими ключами. */
  const refreshAll = () => void modelCatalog.syncAll((id) => getProviderAccess(settingsStore.getSnapshot().general, id), { force: true })

  return (
    <>
      <PromptEditor value={advanced.prompt} />

      <LabelFieldsPicker value={advanced.labelFields} />

      <FormSection title={t('advanced.models')} icon={<LayersIcon />}>
        <span className="form-section-hint">{t('advanced.maxAge')}</span>
        <Tabs
          label={t('advanced.maxAge')}
          value={advanced.modelMaxAgeMonths}
          options={MODEL_AGE_LIMITS.map((months) => ({
            value: months,
            label: months === null ? t('advanced.ageAll') : t('advanced.ageMonths', { count: months }),
            icon: months === null ? <InfinityIcon /> : <CalendarIcon />,
          }))}
          onChange={(modelMaxAgeMonths) => settingsStore.updateAdvanced({ modelMaxAgeMonths })}
        />
      </FormSection>

      <FormSection
        title={t('advanced.lists')}
        icon={<ListIcon />}
        action={<Button icon={<RefreshIcon />} busy={isRefreshing} onClick={refreshAll}>{t('advanced.refreshAll')}</Button>}
      >
        <List>
          {providerRegistry.all().map(({ id }) => {
            const entry = catalog.entries[id]
            const error = catalog.errors[id]
            const isLoading = catalog.loading[id] ?? false
            // Строка состояния: загрузка, ошибка, дата обновления (и пометка «предпросмотр» без ключа).
            const status = isLoading
              ? t('general.refreshing')
              : error
                ? errorText(error)
                : entry
                  ? [t('advanced.updatedAt', { date: dateFormat.format(entry.fetchedAt) }), entry.source === 'directory' && t('advanced.sourcePreview')]
                    .filter(Boolean)
                    .join(' · ')
                  : t('advanced.notLoaded')
            return (
              <ListItem
                key={id}
                leading={<span className="provider-logo">{PROVIDER_ICONS[id]}</span>}
                primary={t(`general.providers.${id}`)}
                secondary={status}
                secondaryTone={error && !isLoading ? 'error' : 'default'}
              />
            )
          })}
        </List>
      </FormSection>

      <FormSection title={t('advanced.photo')} icon={<ImageIcon />} hint={t('advanced.imageSizeHint')}>
        <span className="form-section-hint">{t('advanced.imageSize')}</span>
        <Tabs
          label={t('advanced.imageSize')}
          value={advanced.maxImageSide}
          options={IMAGE_SIZE_LIMITS.map((size) => ({
            value: size,
            label: size === null ? t('advanced.imageSizeOriginal') : t('advanced.imageSizePx', { size }),
            icon: size === null ? <MaximizeIcon /> : <ImageIcon />,
          }))}
          onChange={(maxImageSide) => settingsStore.updateAdvanced({ maxImageSide })}
        />
        <Notice>{t('advanced.imageSizeAnthropic')}</Notice>
      </FormSection>

      <FormSection title={t('advanced.about')} icon={<InfoIcon />}>
        <p className="app-version">{t('advanced.version', { version: __APP_VERSION__ })}</p>
      </FormSection>
    </>
  )
}
