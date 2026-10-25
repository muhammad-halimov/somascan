/**
 * Вкладка «Главная»: состояние слежения, «Старт / Стоп», режим записи и журнал.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClockIcon, PlayIcon, StopIcon } from '@/components/icons/Icons'
import { Button } from '@/components/ui/Button'
import { Notice, StatusBadge } from '@/components/ui/Layout'
import { List, ListItem, Switch } from '@/components/ui/List'
import { useLocale, useMessages } from '@/app/i18n'
import { api, runStore, settingsStore, useSettings, useStore } from '@/app/state'
import { triggerMessage } from '@/shared/messages'
import { Journal } from './Journal'
import './run.css'

/** Секунды до `until` (обновляется дважды в секунду) или `null`, если срока нет. */
function useCountdown(until: number | null): number | null {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!until) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [until])
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : null
}

/** Вкладка «Главная». */
export function RunScreen() {
  const { t } = useTranslation('run')
  const format = useMessages()
  const { time } = useLocale()
  const settings = useSettings()
  const run = useStore(runStore)
  const on = run.status === 'watching'
  const stopping = run.status === 'stopping'
  const left = useCountdown(on ? run.nextCheckAt : null)
  const tone = on ? 'success' : stopping ? 'info' : 'neutral'

  return (
    <>
      <section className="hero">
        <div className="hero-state">
          <StatusBadge tone={tone}>{on ? t('status.watching') : stopping ? t('status.stopping') : t('status.idle')}</StatusBadge>
          {run.busy && <StatusBadge tone="info">{t('status.busy', { what: format(triggerMessage(run.busy)) })}</StatusBadge>}
          <span className="hero-meta">
            {on && left !== null && (
              <>
                <ClockIcon /> {t('status.nextCheck', { seconds: left })}
              </>
            )}
            {!on && !stopping && run.lastRunAt && t('status.lastRun', { time: time(run.lastRunAt) })}
          </span>
        </div>
        <Button variant="tonal" className={`hero-button${on ? ' is-stop' : ''}`} icon={on || stopping ? <StopIcon /> : <PlayIcon />} disabled={stopping} onClick={() => void (on || stopping ? api.stop() : api.start())}>
          {on || stopping ? t('stop') : t('start')}
        </Button>
        {run.pending.length > 0 && (
          <div className="hero-pending">
            <StatusBadge tone="attention">{t('status.pending')}</StatusBadge>
          </div>
        )}
      </section>

      <List label={t('mode.title')}>
        <ListItem
          itemRole="checkbox"
          primary={t('mode.write')}
          secondary={settings.write ? t('mode.writeOn') : t('mode.writeOff')}
          selected={settings.write}
          disabled={on || stopping}
          trailing={<Switch on={settings.write} />}
          onClick={() => settingsStore.update({ write: !settings.write })}
        />
      </List>
      {(on || stopping) && <Notice>{t('mode.lockedWhileRunning')}</Notice>}

      <div className="journal-section">
        <Journal />
      </div>
    </>
  )
}
