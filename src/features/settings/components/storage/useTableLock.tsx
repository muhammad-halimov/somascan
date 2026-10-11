import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LockIcon, LockOpenIcon } from '@/components/icons/Icons'
import type { InputAction } from '@/components/ui/ActionTextInput'

/** Замок пути и имени таблицы. */
export interface TableLock {
  /** Поля закрыты для правки. */
  locked: boolean
  /** Значок замка в поле: открывает и закрывает. */
  action: InputAction
}

/** Подписи замка для экранного диктора: закрыть и открыть. */
export interface LockLabels {
  lock: string
  unlock: string
}

/**
 * Замок настройки: по умолчанию закрыт, чтобы её не сбили случайно; открывается значком замка, пока форма
 * на экране (ушли с вкладки «Хранилище» или закрыли настройки — снова закрыт). Без подписей — замок пути
 * и имени таблицы.
 */
export function useTableLock(labels?: LockLabels): TableLock {
  const { t } = useTranslation('settings')
  const [unlocked, setUnlocked] = useState(false)
  const { lock, unlock } = labels ?? { lock: t('storage.table.lock'), unlock: t('storage.table.unlock') }
  return {
    locked: !unlocked,
    action: {
      icon: unlocked ? <LockOpenIcon /> : <LockIcon />,
      label: unlocked ? lock : unlock,
      tone: unlocked ? 'accent' : undefined,
      onClick: () => setUnlocked((current) => !current),
    },
  }
}
