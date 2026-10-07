import { useTranslation } from 'react-i18next'
import { KeyIcon } from '@/components/icons/Icons'
import { FormSection } from '@/components/ui/FormSection'
import { SecretInput } from '@/components/ui/SecretInput'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { RecognitionProvider } from '@/features/recognition/providers/RecognitionProvider'
import { settingsStore } from '../store/SettingsStore'
import './ApiKeyField.css'

/** Свойства `ApiKeyField`. */
export interface ApiKeyFieldProps {
  /** Провайдер, которому принадлежит ключ. */
  provider: RecognitionProvider
  /** Текущий ключ. */
  value: string
}

/**
 * Поле ввода API-ключа провайдера: по умолчанию значение скрыто, кнопка-«глаз» позволяет его проверить;
 * рядом значок статуса (сохранён / отсутствует / не нужен для локальных серверов).
 */
export function ApiKeyField({ provider, value }: ApiKeyFieldProps) {
  const { t } = useTranslation('settings')
  const hasKey = value.trim() !== ''

  return (
    <FormSection title={`${t('general.apiKey')} • ${t(`general.providers.${provider.id}`)}`} icon={<KeyIcon />}>
      <SecretInput
        value={value}
        onChange={(next) => settingsStore.setApiKey(provider.id, next)}
        placeholder={provider.requiresApiKey ? t('general.apiKeyPlaceholder') : t('general.apiKeyOptional')}
        aria-label={t('general.apiKey')}
        showLabel={t('general.showKey')}
        hideLabel={t('general.hideKey')}
      />
      <div className="api-key-status">
        {hasKey ? (
          <StatusBadge tone="success">{t('general.apiKeySaved')}</StatusBadge>
        ) : provider.requiresApiKey ? (
          <StatusBadge tone="neutral">{t('general.apiKeyMissing')}</StatusBadge>
        ) : (
          <StatusBadge tone="success">{t('general.localConnection')}</StatusBadge>
        )}
        <span className="form-section-hint">{t('general.apiKeyHint')}</span>
      </div>
    </FormSection>
  )
}
