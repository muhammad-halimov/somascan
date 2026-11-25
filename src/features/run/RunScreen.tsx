/**
 * Вкладка «Главная»: рабочее место (цех / лаборатория / контроль качества — запоминается; во время слежения
 * не меняется), состояние слежения, «Старт / Стоп» и справа «Запись» в рапорт Betsy (у каждого рабочего места;
 * пока пишет только лаборатория — результат таблицы лаборатории, после подтверждения в окне системы), режим записи (у цеха: лаборатория таблицу только
 * читает, у контроля качества слежения пока нет) и журнал.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ClockIcon, FactoryIcon, FlaskIcon, PlayIcon, QualityIcon, StopIcon, WriteDocIcon } from '@/components/icons/Icons'
import { Button } from '@/components/ui/Button'
import { Notice, StatusBadge } from '@/components/ui/Layout'
import { List, ListItem, Switch } from '@/components/ui/List'
import { Tabs } from '@/components/ui/Tabs'
import { useLocale, useMessages } from '@/app/i18n'
import { api, runStore, settingsStore, useSettings, useStore } from '@/app/state'
import { triggerMessage } from '@/shared/messages'
import { betsySource, canWriteBetsy, WORKPLACES, type Workplace } from '@/shared/settings'
import { Journal } from './Journal'
import './run.css'

/** Значки рабочих мест. */
const WORKPLACE_ICONS: Record<Workplace, ReactNode> = { atelier: <FactoryIcon />, laborator: <FlaskIcon />, calitate: <QualityIcon /> }

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
  const atelier = settings.workplace === 'atelier'
  // у контроля качества следить пока не за чем
  const idle = settings.workplace === 'calitate'

  /**
   * «Запись» в рапорт Betsy: где она пишет (`canWriteBetsy`) — после подтверждения в окне системы (куда пишется);
   * рапорт не задан или у рабочего места записи пока нет — сразу (причина — в журнале).
   */
  const writeReport = async () => {
    const source = betsySource(settings)
    if (canWriteBetsy(settings.workplace) && source) {
      const ok = await api.confirm({
        title: t('writeConfirm.title'),
        message: t(settings.betsy.manual ? 'writeConfirm.file' : 'writeConfirm.dir', { path: source }),
        ok: t('writeConfirm.ok'),
        cancel: t('writeConfirm.cancel'),
      })
      if (!ok) return
    }
    await api.writeBetsy()
  }

  return (
    <>
      <Tabs
        label={t('workplace.label')}
        value={settings.workplace}
        options={WORKPLACES.map((w) => ({ value: w, label: t(`workplace.${w}`), icon: WORKPLACE_ICONS[w] }))}
        disabled={on || stopping}
        onChange={(workplace) => settingsStore.update({ workplace })}
      />

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
        <div className="hero-actions">
          <Button variant="tonal" className={`hero-button${on ? ' is-stop' : ''}`} icon={on || stopping ? <StopIcon /> : <PlayIcon />} disabled={stopping || (idle && !on)} onClick={() => void (on || stopping ? api.stop() : api.start())}>
            {on || stopping ? t('stop') : t('start')}
          </Button>
          {/* «Запись» — у каждого рабочего места, в любой момент (и во время слежения), но не во время другого прогона */}
          <Button variant="tonal" className="hero-button is-side" icon={<WriteDocIcon />} title={t('writeHint')} busy={run.busy === 'betsy'} disabled={!!run.busy} onClick={() => void writeReport()}>
            {t('write')}
          </Button>
        </div>
        {run.pending.length > 0 && (
          <div className="hero-pending">
            <StatusBadge tone="attention">{t('status.pending')}</StatusBadge>
          </div>
        )}
      </section>

      {idle && <Notice>{t('noWatch')}</Notice>}
      {atelier && (
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
      )}
      {(on || stopping) && <Notice>{t('mode.lockedWhileRunning')}</Notice>}

      <div className="journal-section">
        <Journal />
      </div>
    </>
  )
}
