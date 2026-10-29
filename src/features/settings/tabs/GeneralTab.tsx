import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GlobeIcon, LinkIcon, LockIcon, LockOpenIcon, ScanTextIcon, SmartphoneIcon, SparklesIcon } from '@/components/icons/Icons'
import { FormSection } from '@/components/ui/FormSection'
import { Tabs } from '@/components/ui/Tabs'
import { TextInput } from '@/components/ui/TextInput'
import { providerRegistry } from '@/features/recognition/providers/ProviderRegistry'
import { ON_DEVICE_PROVIDER } from '@/features/recognition/types'
import { ApiKeyField } from '../components/ApiKeyField'
import { LanguagePicker } from '../components/LanguagePicker'
import { ModelPicker } from '../components/ModelPicker'
import { OnDeviceSection } from '../components/OnDeviceSection'
import { PROVIDER_ICONS } from '../components/providerIcons'
import { settingsStore } from '../store/SettingsStore'
import { useSettings } from '../store/useSettings'

/** Как распознавать: телефоном или ИИ-моделью. */
type RecognitionMode = 'device' | 'model'

/**
 * Вкладка «Основные»: язык интерфейса и распознавание — телефоном (вместо ключа и модели — пояснение)
 * или ИИ-моделью: провайдер, адрес сервера, API-ключ и модель.
 *
 * «ИИ-модель» закрыта замком, как путь к таблице: чтобы не перейти на неё случайно (фото уходят провайдеру,
 * нужен ключ), первое нажатие открывает замок, второе — выбирает. Замок снова закрыт, когда ушли с вкладки
 * или закрыли настройки; пока распознаёт модель, он открыт.
 */
export function GeneralTab() {
  const { t } = useTranslation('settings')
  const { general } = useSettings()
  const provider = providerRegistry.get(general.provider)
  const mode: RecognitionMode = provider.onDevice ? 'device' : 'model'
  const [modelUnlocked, setModelUnlocked] = useState(false)
  const modelOpen = modelUnlocked || mode === 'model'
  const modelLabel = t('general.recognitionModes.model')

  return (
    <>
      <FormSection title={t('general.language')} icon={<GlobeIcon />}>
        <LanguagePicker value={general.language} onChange={(language) => settingsStore.setLanguage(language)} label={t('general.language')} />
      </FormSection>

      <FormSection title={t('general.recognition')} icon={<ScanTextIcon />} hint={mode === 'device' ? t('general.recognitionLockHint') : undefined}>
        <Tabs<RecognitionMode>
          label={t('general.recognition')}
          value={mode}
          options={[
            { value: 'device', label: t('general.recognitionModes.device'), icon: <SmartphoneIcon /> },
            {
              value: 'model',
              label: modelLabel,
              icon: <SparklesIcon />,
              badge: modelOpen ? <LockOpenIcon /> : <LockIcon />,
              badgeAccent: modelOpen,
              ariaLabel: modelOpen ? undefined : `${modelLabel}. ${t('general.recognitionUnlock')}`,
            },
          ]}
          onChange={(next) => {
            if (next === 'model' && !modelOpen) setModelUnlocked(true)
            else settingsStore.setProvider(next === 'device' ? ON_DEVICE_PROVIDER : general.modelProvider)
          }}
        />
      </FormSection>

      {/* ИИ-провайдеры — только для распознавания моделью (у телефона своя секция ниже). */}
      {!provider.onDevice && (
        <FormSection title={t('general.provider')} icon={<SparklesIcon />}>
          <Tabs
            label={t('general.provider')}
            value={general.provider}
            options={providerRegistry.all().filter(({ onDevice }) => !onDevice)
              .map(({ id }) => ({ value: id, label: t(`general.providers.${id}`), icon: PROVIDER_ICONS[id] }))}
            onChange={(id) => settingsStore.setProvider(id)}
          />
        </FormSection>
      )}

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

      {provider.onDevice ? (
        <OnDeviceSection provider={provider} />
      ) : (
        <>
          {/* Ключ — до списка моделей: список загружается по ключу, поэтому сначала вводят его. */}
          <ApiKeyField key={`key-${provider.id}`} provider={provider} value={general.apiKeys[provider.id]} />

          {/* Пересоздаём на каждого провайдера: у каждого своя шторка (свёрнута при переключении). */}
          <ModelPicker key={provider.id} providerId={provider.id} />
        </>
      )}
    </>
  )
}
