import { useTranslation } from 'react-i18next'
import { GlobeIcon, LinkIcon, SparklesIcon } from '@/components/icons/Icons'
import { FormSection } from '@/components/ui/FormSection'
import { Tabs } from '@/components/ui/Tabs'
import { TextInput } from '@/components/ui/TextInput'
import { providerRegistry } from '@/features/recognition/providers/ProviderRegistry'
import { ApiKeyField } from '../components/ApiKeyField'
import { LanguagePicker } from '../components/LanguagePicker'
import { ModelPicker } from '../components/ModelPicker'
import { PROVIDER_ICONS } from '../components/providerIcons'
import { settingsStore } from '../store/SettingsStore'
import { useSettings } from '../store/useSettings'

/** Вкладка «Основные»: язык интерфейса, ИИ-провайдер, модель, адрес сервера и API-ключ. */
export function GeneralTab() {
  const { t } = useTranslation('settings')
  const { general } = useSettings()
  const provider = providerRegistry.get(general.provider)

  return (
    <>
      <FormSection title={t('general.language')} icon={<GlobeIcon />}>
        <LanguagePicker value={general.language} onChange={(language) => settingsStore.setLanguage(language)} label={t('general.language')} />
      </FormSection>

      <FormSection title={t('general.provider')} icon={<SparklesIcon />}>
        <Tabs
          label={t('general.provider')}
          value={general.provider}
          options={providerRegistry.all().map(({ id }) => ({ value: id, label: t(`general.providers.${id}`), icon: PROVIDER_ICONS[id] }))}
          onChange={(id) => settingsStore.setProvider(id)}
        />
      </FormSection>

      {/* Только для провайдеров на своём сервере (LM Studio). */}
      {provider.defaultEndpoint && (
        <FormSection title={t('general.serverUrl')} icon={<LinkIcon />} hint={t('general.serverHint')}>
          <TextInput
            type="url"
            inputMode="url"
            aria-label={t('general.serverUrl')}
            placeholder={provider.defaultEndpoint}
            value={general.endpoints[provider.id]}
            onChange={(value) => settingsStore.setEndpoint(provider.id, value)}
          />
        </FormSection>
      )}

      {/* Ключ — до списка моделей: список загружается по ключу, поэтому сначала вводят его. */}
      <ApiKeyField key={`key-${provider.id}`} provider={provider} value={general.apiKeys[provider.id]} />

      {/* Пересоздаём на каждого провайдера: у каждого своя шторка (свёрнута при переключении). */}
      <ModelPicker key={provider.id} providerId={provider.id} />
    </>
  )
}
