/**
 * Вкладка «Связи»: проекты Consum ↔ листы Sarjele и элементы ↔ блоки. Файлы только читаются (движок `--scan`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshIcon } from '@/components/icons/Icons'
import { Button } from '@/components/ui/Button'
import { Notice, StatusBadge } from '@/components/ui/Layout'
import { useMessages } from '@/app/i18n'
import { api, runStore, useSettings, useStore } from '@/app/state'
import { triggerMessage } from '@/shared/messages'
import type { ScanData, ScanElement } from '@/shared/protocol'
import { activeFiles } from '@/shared/settings'
import { ElementsSection } from './ElementsSection'
import { ProjectsTable } from './ProjectsTable'
import './links.css'

/** Последний результат чтения живёт, пока открыта программа: вкладка открывается мгновенно. */
let cache: ScanData | null = null

/** Пауза перед чтением после изменения проектов или путей, мс (чтобы не читать на каждую букву). */
const SCAN_DELAY_MS = 600

/**
 * Читает файлы для вкладки и держит результат.
 * @param sig Подпись проектов и путей: меняется — файлы перечитываются.
 */
function useScan(ready: boolean, sig: string) {
  const [data, setData] = useState<ScanData | null>(cache)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)
  const refresh = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    const d = await api.scan()
    if (mine !== seq.current) return
    cache = d.error ? cache : d
    setData(d.error ? { ...(cache ?? ({} as ScanData)), error: d.error } : d)
    setLoading(false)
  }, [])
  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => void refresh(), SCAN_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [ready, sig, refresh])
  return { data, loading, refresh }
}

/** Вкладка «Связи». */
export function LinksScreen() {
  const { t } = useTranslation('links')
  const format = useMessages()
  const settings = useSettings()
  const run = useStore(runStore)
  const files = activeFiles(settings)
  const ready = files.consums.some(Boolean) && !!files.sarjele && !!files.probe
  // замок проекта не влияет на чтение
  const sig = JSON.stringify([settings.target, files, settings.autoProjects, settings.projects.map(({ locked: _locked, ...p }) => p)])
  const { data, loading, refresh } = useScan(ready, sig)
  const [creating, setCreating] = useState(false)

  const onLink = async (e: ScanElement, value: string | null) => {
    await api.setLink(`${e.project}|${e.name}`, value)
    void refresh()
  }
  const createSheets = async () => {
    setCreating(true)
    await api.createSheets()
    setCreating(false)
    void refresh()
  }

  return (
    <>
      <Notice>{t('intro')}</Notice>
      {!ready && <Notice>{t('needFiles')}</Notice>}
      {ready && (
        <div className="scan-bar">
          <Button icon={<RefreshIcon />} busy={loading} onClick={() => void refresh()}>
            {loading ? t('scanning') : t('rescan')}
          </Button>
          {run.busy && <StatusBadge tone="info">{t('busy', { what: format(triggerMessage(run.busy)) })}</StatusBadge>}
        </div>
      )}
      {data?.error && <StatusBadge tone="danger">{format(data.error)}</StatusBadge>}
      <ProjectsTable projects={settings.projects} scan={data?.sheets ? data : null} createSheets={() => void createSheets()} busy={creating || !!run.busy} />
      {data?.elements && <ElementsSection scan={data} onLink={(e, v) => void onLink(e, v)} />}
    </>
  )
}
