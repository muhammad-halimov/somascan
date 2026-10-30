import { useTranslation } from 'react-i18next'
import { SmartphoneIcon } from '@/components/icons/Icons'
import { FormSection } from '@/components/ui/FormSection'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TagOcr } from '@/features/recognition/ocr/TagOcr'
import type { RecognitionProvider } from '@/features/recognition/providers/RecognitionProvider'
import './OnDeviceSection.css'

/** Свойства `OnDeviceSection`. */
export interface OnDeviceSectionProps {
  /** Провайдер распознавания на устройстве. */
  provider: RecognitionProvider
}

/**
 * Распознавание на устройстве вместо ключа и модели: чем читается бирка и что без интернета
 * (в браузере — что оно недоступно). Что точность ниже, чем у модели, сказано под вкладками «Распознавание».
 */
export function OnDeviceSection({ provider }: OnDeviceSectionProps) {
  const { t } = useTranslation('settings')
  const available = TagOcr.isAvailable()

  return (
    <FormSection title={`${t('general.onDevice.title')} • ${provider.title}`} icon={<SmartphoneIcon />}>
      <p className="on-device-text">{t('general.onDevice.text', { engine: provider.title })}</p>
      <div className="on-device-status">
        {available
          ? <StatusBadge tone="success">{t('general.onDevice.offline')}</StatusBadge>
          : <StatusBadge tone="neutral">{t('general.onDevice.unavailable')}</StatusBadge>}
      </div>
    </FormSection>
  )
}
