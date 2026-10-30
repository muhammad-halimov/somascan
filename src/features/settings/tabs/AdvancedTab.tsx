import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarIcon, ClockIcon, ExportIcon, ImageIcon, InfinityIcon, InfoIcon, LayersIcon, ListIcon, MaximizeIcon, RefreshIcon, ScanTextIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { FormSection } from '@/components/ui/FormSection'
import { List, ListItem } from '@/components/ui/List'
import { Notice } from '@/components/ui/Notice'
import { Tabs } from '@/components/ui/Tabs'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { shareTextFile } from '@/lib/platform/files'
import { useStore } from '@/lib/store/useStore'
import { modelCatalog } from '@/features/recognition/catalog/ModelCatalog'
import { MODEL_AGE_LIMITS } from '@/features/recognition/catalog/ModelFilter'
import { OnDeviceProvider } from '@/features/recognition/providers/OnDeviceProvider'
import { providerRegistry } from '@/features/recognition/providers/ProviderRegistry'
import { useErrorText } from '@/features/recognition/useErrorText'
import { BACKUP_RETENTION_OPTIONS } from '@/features/uploads/xlsx/BackupPolicy'
import { getProviderAccess } from '../store/providerAccess'
import { settingsStore } from '../store/SettingsStore'
import { IMAGE_SIZE_LIMITS } from '../store/settingsSchema'
import { useSettings } from '../store/useSettings'
import { KnownSuppliersPicker } from '../components/KnownSuppliersPicker'
import { LabelFieldsPicker } from '../components/LabelFieldsPicker'
import { PromptEditor } from '../components/PromptEditor'
import { RecognitionRulesPicker } from '../components/RecognitionRulesPicker'
import { PROVIDER_ICONS } from '../components/providerIcons'
import './AdvancedTab.css'

/**
 * Вкладка «Расширенные»: сначала то, что определяет распознавание, — промпт (для ИИ-моделей) и правила
 * (для распознавания на устройстве; действует одно из двух — по выбору в «Основных»), поля бирки и поставщики;
 * затем срок хранения резервных копий таблицы, фильтр возраста моделей, состояние списков моделей с обновлением,
 * размер фото для распознавания, текст последнего распознавания на устройстве (для отладки правил) и версия приложения.
 */
export function AdvancedTab() {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const errorText = useErrorText()
  const { general, storage, advanced } = useSettings()
  const catalog = useStore(modelCatalog)
  const isRefreshing = Object.values(catalog.loading).some(Boolean)
  const onDevice = general.provider === 'device'
  // День и месяц без года: строка состояния списка — в одну строку (списки обновляются раз в месяц).
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }), [i18n.language])

  /**
   * Текст, который движок прочитал с последней распознанной бирки (строки с рамками во всех поворотах, коды
   * и найденные поля), — файлом JSON в панель «Поделиться»: по нему видно, почему правила ошиблись.
   */
  const shareOcrReading = async () => {
    const provider = providerRegistry.get('device')
    const reading = provider instanceof OnDeviceProvider ? provider.lastReading : null
    if (!reading) {
      await NativeDialogs.alert({ title: t('advanced.ocrReading'), message: t('advanced.ocrReadingEmpty'), buttonTitle: t('common:ok') })
      return
    }
    const { extraction, ...rest } = reading
    const text = `${JSON.stringify({ version: __APP_VERSION__, engine: provider.title, ...rest, label: extraction?.label ?? null, turns: extraction?.turns ?? null })}\n`
    try {
      await shareTextFile(`somascan-ocr-${reading.at.replace(/[:.]/g, '-')}.json`, text, 'application/json', t('advanced.ocrReadingShare'))
    } catch (error) {
      await NativeDialogs.alert({ title: t('advanced.ocrReading'), message: errorText(error), buttonTitle: t('common:ok') })
    }
  }

  /** Заново загружает списки всех провайдеров с текущими ключами. */
  const refreshAll = () => void modelCatalog.syncAll((id) => getProviderAccess(settingsStore.getSnapshot().general, id), { force: true })

  return (
    <>
      {/* Промпт — только для ИИ-моделей, правила — только для распознавания на устройстве: другое приглушено. */}
      <PromptEditor value={advanced.prompt} unavailable={onDevice ? t('advanced.promptUnavailable') : undefined} />

      <RecognitionRulesPicker value={advanced.ruleLabels} fields={advanced.labelFields} unavailable={onDevice ? undefined : t('advanced.rulesUnavailable')} />

      <LabelFieldsPicker value={advanced.labelFields} />

      <KnownSuppliersPicker value={advanced.knownSuppliers} />

      {/* Срок хранения копий таблицы — настройка записи (лежит в хранилище, её получает движок записи). */}
      <FormSection title={t('advanced.backups')} icon={<ClockIcon />} hint={t('advanced.backupsHint')}>
        <span className="form-section-hint">{t('advanced.backupsKeep')}</span>
        <Tabs
          label={t('advanced.backupsKeep')}
          value={storage.backupDays}
          options={BACKUP_RETENTION_OPTIONS.map((days) => ({ value: days, label: t('advanced.backupDays', { count: days }), icon: <CalendarIcon /> }))}
          onChange={(backupDays) => settingsStore.setBackupDays(backupDays)}
        />
      </FormSection>

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
        action={(
          <div className="form-section-actions">
            <ActionButton variant="ghost" icon={<RefreshIcon />} caption={t('general.refresh')} label={t('advanced.refreshAll')} busy={isRefreshing} spinIcon onClick={refreshAll} />
          </div>
        )}
      >
        <List className="provider-list">
          {/* У распознавания на устройстве списка моделей нет. */}
          {providerRegistry.all().filter((provider) => !provider.onDevice).map(({ id }) => {
            const entry = catalog.entries[id]
            const error = catalog.errors[id]
            const isLoading = catalog.loading[id] ?? false
            // Строка состояния: загрузка, ошибка, дата обновления (и пометка «предпросмотр» без ключа).
            const status = isLoading
              ? t('general.refreshing')
              : error
                // Нет связи — коротко, в одну строку (адрес сервера — в сообщении распознавания).
                ? error.code === 'network' ? t('advanced.listOffline') : errorText(error)
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

      <FormSection title={t('advanced.photo')} icon={<ImageIcon />}>
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
        <span className="form-section-hint">{t('advanced.imageSizeHint')}</span>
        <Notice>{t('advanced.imageSizeAnthropic')}</Notice>
      </FormSection>

      {general.provider === 'device' && (
        <FormSection
          title={t('advanced.ocrReading')}
          icon={<ScanTextIcon />}
          action={(
            <div className="form-section-actions">
              <ActionButton variant="ghost" icon={<ExportIcon />} caption={t('advanced.ocrReadingShare')} label={t('advanced.ocrReading')} onClick={() => void shareOcrReading()} />
            </div>
          )}
        >
          <span className="form-section-hint">{t('advanced.ocrReadingHint')}</span>
        </FormSection>
      )}

      <FormSection title={t('advanced.about')} icon={<InfoIcon />}>
        <p className="app-version">{t('advanced.version', { version: __APP_VERSION__ })}</p>
      </FormSection>
    </>
  )
}
