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

/**
 * Замок пути и имени таблицы: по умолчанию поля закрыты, чтобы их не сбили случайно; замок открывает их,
 * пока форма на экране (ушли с вкладки «Хранилище» или закрыли настройки — снова закрыт).
 */
export function useTableLock(): TableLock {
  const { t } = useTranslation('settings')
  const [unlocked, setUnlocked] = useState(false)
  return {
    locked: !unlocked,
    action: {
      icon: unlocked ? <LockOpenIcon /> : <LockIcon />,
      label: unlocked ? t('storage.table.lock') : t('storage.table.unlock'),
      tone: unlocked ? 'accent' : undefined,
      onClick: () => setUnlocked((current) => !current),
    },
  }
}
