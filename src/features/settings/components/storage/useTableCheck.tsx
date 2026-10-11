import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TableSearchIcon } from '@/components/icons/Icons'
import type { InputAction } from '@/components/ui/ActionTextInput'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { isDriveConfigured } from '@/features/uploads/drive/driveSettings'
import { isSmbConfigured } from '@/features/uploads/smb/smbSettings'
import { tableCheckStore, type TableCheckResult } from '@/features/uploads/store/TableCheckStore'
import { useUploadErrorText } from '@/features/uploads/useUploadErrorText'
import { JOURNAL_COLUMN_TITLES, type LayoutMismatch } from '@/features/uploads/xlsx/labTableLayout'
import { writeTarget } from '@/features/uploads/xlsx/tableStructure'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { useStore } from '@/lib/store/useStore'
import { settingsStore } from '../../store/SettingsStore'
import { useSettings } from '../../store/useSettings'

/** Проверка таблицы во вкладке «Хранилище»: значок в поле, строка итога и «Проверить подключение». */
export interface TableCheck {
  /** Значок сверки в конце поля таблицы: цвет — итог проверки. */
  action: InputAction
  /** Итог проверки текущих настроек — строкой под полями. */
  status: ReactNode
  /** «Проверить подключение»: та же проверка, итог — диалогом. */
  testConnection: () => Promise<void>
  /** Идёт проверка от «Проверить подключение». */
  isTesting: boolean
  /** Идёт любая проверка. */
  isChecking: boolean
}

/**
 * Проверка таблицы по текущим настройкам хранилища (`TableCheckStore`). Если хранилище настроено,
 * а списка листов этой таблицы ещё нет, проверка запускается сама при появлении формы — так
 * выбор листа (`TableSheetField`) сразу получает листы.
 *
 * Найденная таблица сверяется и по строению листа, куда пойдёт запись (выбранный или лист года):
 * нет шапки журнала — запись не пойдёт; при «Строгом строении таблицы» — ещё и все колонки журнала
 * по порядку. Сверка — по итогу последней проверки, поэтому смена листа или переключателя видна сразу.
 */
export function useTableCheck(): TableCheck {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const { storage } = useSettings()
  const errorText = useUploadErrorText()
  const check = useStore(tableCheckStore)
  /** Идёт проверка от «Проверить подключение» (а не от значка сверки в поле). */
  const [isTesting, setIsTesting] = useState(false)
  /** Проверять есть что: у Google Drive — только после входа. */
  const canCheck = storage.target === 'smb' || Boolean(storage.googleDrive.account)
  const result = tableCheckStore.resultFor(storage)

  /** Хранилище настроено так, что таблицу можно прочитать. */
  const isConfigured = storage.target === 'smb' ? isSmbConfigured(storage.smb) : isDriveConfigured(storage.googleDrive)
  useEffect(() => {
    const { storage: current } = settingsStore.getSnapshot()
    if (!isConfigured || tableCheckStore.sheetsFor(current).length > 0 || tableCheckStore.resultFor(current) || tableCheckStore.getSnapshot().checking) return
    void tableCheckStore.check()
  }, [isConfigured])

  /** Что не так со строением листа для записи или `null` — запись пойдёт (или строение неизвестно). */
  const structureProblem = (found: Extract<TableCheckResult, { kind: 'found' }>): string | null => {
    if (!found.structure) return null
    const year = new Date().getFullYear()
    const target = writeTarget(found.structure, storage.sheet, year)
    // Выбранного листа нет — об этом говорит выбор листа («нет в таблице»).
    if (!target) return storage.sheet ? null : t('storage.check.noJournal', { sheet: year })
    if (!target.journal) return t('storage.check.noJournal', { sheet: target.name })
    if (!storage.strictLayout || !target.mismatch) return null
    return t('storage.check.mismatch', { sheet: target.name, problems: mismatchText(target.mismatch) })
  }

  /** «нет колонок ID; колонки не по порядку». */
  const mismatchText = ({ missing, outOfOrder, extra }: LayoutMismatch) => [
    missing.length > 0 && t('storage.check.mismatchMissing', { columns: missing.map((kind) => JOURNAL_COLUMN_TITLES[kind]).join(', ') }),
    outOfOrder && t('storage.check.mismatchOrder'),
    extra.length > 0 && t('storage.check.mismatchExtra', { columns: extra.join(', ') }),
  ].filter(Boolean).join('; ')

  /** «Таблица найдена: 24 КБ, изменена …». */
  const foundText = (found: Extract<TableCheckResult, { kind: 'found' }>) => t('storage.smb.testOkExisting', {
    size: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(Math.max(1, found.size / 1024)),
    date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(found.modifiedAt),
  })

  const testConnection = async () => {
    setIsTesting(true)
    try {
      const outcome = await tableCheckStore.check()
      const problem = outcome.kind === 'found' ? structureProblem(outcome) : null
      if (problem) {
        await NativeDialogs.alert({ title: t('storage.smb.testMismatchTitle'), message: problem, buttonTitle: t('common:ok') })
      } else if (outcome.kind === 'found') {
        await NativeDialogs.alert({ title: t('storage.smb.testOkTitle'), message: foundText(outcome), buttonTitle: t('common:ok') })
      } else if (outcome.kind === 'missing') {
        await NativeDialogs.alert({ title: t('storage.smb.testMissingTitle'), message: t('storage.smb.testMissingMessage'), buttonTitle: t('common:ok') })
      } else {
        await NativeDialogs.alert({ title: t('storage.smb.testFailedTitle'), message: errorText(outcome.error), buttonTitle: t('common:ok') })
      }
    } finally {
      setIsTesting(false)
    }
  }

  const problem = result?.kind === 'found' ? structureProblem(result) : null

  const action: InputAction = {
    icon: <TableSearchIcon />,
    label: t('storage.check.label'),
    busy: check.checking && !isTesting,
    disabled: check.checking || !canCheck,
    tone: result ? (result.kind === 'found' && !problem ? 'success' : 'danger') : undefined,
    onClick: () => void tableCheckStore.check(),
  }

  const status = check.storage === storage && check.checking
    ? <StatusBadge tone="neutral">{t('storage.check.checking')}</StatusBadge>
    : !result
      ? <StatusBadge tone="neutral">{t('storage.check.unchecked')}</StatusBadge>
      : problem
        ? <StatusBadge tone="danger">{problem}</StatusBadge>
        : result.kind === 'found'
          ? <StatusBadge tone="success">{foundText(result)}</StatusBadge>
          : result.kind === 'missing'
            ? <StatusBadge tone="danger">{t('storage.check.missing')}</StatusBadge>
            : <StatusBadge tone="danger">{t('storage.check.failed', { error: errorText(result.error) })}</StatusBadge>

  return { action, status, testConnection, isTesting, isChecking: check.checking }
}
