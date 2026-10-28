import { useTranslation } from 'react-i18next'
import { SmartphoneIcon } from '@/components/icons/Icons'
import { FormSection } from '@/components/ui/FormSection'
import { Notice } from '@/components/ui/Notice'
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
 * Распознавание на устройстве вместо ключа и модели: чем читается бирка, что без интернета,
 * и что это пробная функция (в браузере — что она недоступна).
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
      <Notice>{t('general.onDevice.notice')}</Notice>
    </FormSection>
  )
}
