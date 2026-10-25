/**
 * Журнал на главной: события программы одной строкой и карточки прогонов.
 *
 * Карточка прогона — что запустило, по какому Consum, итог (записано / только план / изменений нет / отложено /
 * ошибка) и по разделам: блоки Sarjele, ID, закраска плавок в Probe, нехватка стали, что требует внимания,
 * проверка после записи, бэкап. «Подробно» — технический вывод движка (он же в `log.txt`).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyIcon, TerminalIcon, TrashIcon } from '@/components/icons/Icons'
import { Button } from '@/components/ui/Button'
import { FormSection, StatusBadge, type StatusTone } from '@/components/ui/Layout'
import { useLocale, useMessages } from '@/app/i18n'
import { journalStore, useStore } from '@/app/state'
import { runHeadline, triggerMessage } from '@/shared/messages'
import type { JournalEntry, JournalEvent, JournalRun, RunOutcome, RunSummary } from '@/shared/protocol'

/** Сколько пунктов раздела показывать до «ещё N». */
const SHOWN = 5

/** Цвет итога прогона. */
const OUTCOME_TONE: Record<RunOutcome, StatusTone> = { running: 'info', wrote: 'success', planned: 'info', nothing: 'neutral', deferred: 'attention', failed: 'danger' }

/** Метка бэкапа → время: «2026-10-19T14-02-11-123Z» → дата. */
const stampTime = (stamp: string): number => Date.parse(stamp.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, 'T$1:$2:$3.$4Z'))

/** Журнал: записи по порядку, прокручивается вниз сам, пока пользователь не прокрутил вверх. */
export function Journal() {
  const { t } = useTranslation('run')
  const format = useMessages()
  const { time } = useLocale()
  const entries = useStore(journalStore)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const last = entries.at(-1)
  const lastKey = `${entries.length}:${last?.id}:${last?.kind === 'run' ? last.outcome : ''}`
  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lastKey])

  /** Журнал текстом (на языке окна) — для «Копировать». */
  const copy = () => {
    const text = entries.map((e) => {
      const head = `${time(e.t)} ${e.kind === 'event' ? format(e.msg) : `${format(runHeadline(e))}${e.file ? ` · ${e.file}` : ''}`}`
      return e.kind === 'run' && e.lines.length ? [head, ...e.lines.map((l) => `    ${l.text}`)].join('\n') : head
    })
    void navigator.clipboard.writeText(text.join('\n'))
  }

  return (
    <FormSection
      title={t('journal.title')}
      icon={<TerminalIcon />}
      action={
        <div className="journal-actions">
          <Button icon={<CopyIcon />} onClick={copy}>
            {t('journal.copy')}
          </Button>
          <Button icon={<TrashIcon />} onClick={() => journalStore.clear()}>
            {t('journal.clear')}
          </Button>
        </div>
      }
    >
      <div
        className="journal"
        data-selectable="true"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {entries.length === 0 && <div className="journal-empty">{t('journal.empty')}</div>}
        {entries.map((e: JournalEntry) => (e.kind === 'event' ? <EventRow key={e.id} event={e} /> : <RunCard key={e.id} run={e} />))}
      </div>
    </FormSection>
  )
}

/** Событие одной строкой. */
function EventRow({ event }: { event: JournalEvent }) {
  const format = useMessages()
  const { time } = useLocale()
  return (
    <div className={`journal-event is-${event.level}`}>
      <span className="journal-time">{time(event.t)}</span>
      <span>{format(event.msg)}</span>
    </div>
  )
}

/** Раздел карточки: заголовок и пункты (лишние — под «ещё N»). */
function Section({ title, tone, items }: { title: string; tone?: 'ok' | 'warn' | 'err'; items: ReactNode[] }) {
  const { t } = useTranslation('run')
  const [all, setAll] = useState(false)
  if (!items.length) return null
  const shown = all ? items : items.slice(0, SHOWN)
  return (
    <div className={`run-section${tone ? ` is-${tone}` : ''}`}>
      <div className="run-section-title">{title}</div>
      <ul>
        {shown.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      {items.length > SHOWN && (
        <button type="button" className="run-more" onClick={() => setAll(!all)}>
          {all ? t('journal.less') : t('journal.more', { n: items.length - SHOWN })}
        </button>
      )}
    </div>
  )
}

/** Строка-итог без списка. */
function Line({ tone, children }: { tone?: 'ok' | 'warn' | 'err'; children: ReactNode }) {
  return <div className={`run-line${tone ? ` is-${tone}` : ''}`}>{children}</div>
}

/** Карточка прогона. */
function RunCard({ run }: { run: JournalRun }) {
  const { t } = useTranslation('run')
  const format = useMessages()
  const { time } = useLocale()
  const [details, setDetails] = useState(false)
  const s = run.summary
  return (
    <article className={`run-card is-${run.outcome}`}>
      <header className="run-head">
        <span className="journal-time">{time(run.t)}</span>
        <span className="run-title">
          {format(triggerMessage(run.trigger))}
          {run.file && <span className="run-file">{run.file}</span>}
          <span className="run-mode">{run.apply ? t('journal.modeWrite') : t('journal.modeDry')}</span>
        </span>
        <StatusBadge tone={OUTCOME_TONE[run.outcome]}>{t(`journal.outcome.${run.outcome}`)}</StatusBadge>
      </header>
      {s && <RunBody run={run} s={s} />}
      {!s && run.outcome === 'failed' && <Line tone="err">{t('journal.crashed')}</Line>}
      {run.lines.length > 0 && (
        <>
          <button type="button" className="run-more" aria-expanded={details} onClick={() => setDetails(!details)}>
            {details ? t('journal.hideDetails') : t('journal.details')}
          </button>
          {details && (
            <div className="run-tech">
              {run.lines.map((l, i) => (
                <div key={i} className={`tech-line is-${l.level}`}>
                  {l.text}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {run.outcome === 'running' && <Line>{t('journal.running')}</Line>}
    </article>
  )
}

/** Разделы итога прогона. */
function RunBody({ run, s }: { run: JournalRun; s: RunSummary }) {
  const { t } = useTranslation('run')
  const format = useMessages()
  const { kg, dateTime } = useLocale()
  const done = s.wrote
  const list = (xs: readonly string[]) => xs.join(', ')
  // блоки только с нехваткой стали — в разделе «Не хватает стали»
  const blocks = s.blocks.filter((b) => b.heats.length > 0).map((b) => (
    <>
      <b>{b.element}</b>
      <span className="run-dim"> · {b.project}</span> — {t(`journal.block.${b.mode}`)}
      {b.heats.length > 0 && <>, {t(b.mode === 'update' && b.kg < 0 ? 'journal.kgLess' : 'journal.kg', { kg: kg(Math.abs(b.kg)) })}, {t('journal.heats', { list: list(b.heats) })}</>}
      {b.missingKg > 0 && <span className="run-warn"> · {t('journal.missing', { kg: kg(b.missingKg) })}</span>}
    </>
  ))
  const ids = s.ids.filter((x) => x.action !== 'created').map((x) => (
    <>
      <b>{x.id}</b> {x.element} — {x.action === 'backfill' && done ? t('journal.id.backfillDone') : t(`journal.id.${x.action}`)}
    </>
  ))
  const shortages = s.shortages.map((x) => (
    <>
      {t('journal.shortage', { dia: x.dia ?? '?', form: x.form, kg: kg(x.kg), elements: list(x.elements) })}
      <span className="run-dim">
        {' '}
        · {t('journal.free', { kg: kg(x.free) })}
        {x.closedLeft > 0 && <> · {t('journal.inClosed', { kg: kg(x.closedLeft) })}</>}
      </span>
    </>
  ))
  const skipped = s.skipped.map((x) => (
    <>
      <b>{x.element}</b>
      {x.project && <span className="run-dim"> · {x.project}</span>} — {format(x.reason)}
    </>
  ))
  const nothing = !s.error && !s.blocks.length && !s.ids.length && !s.closed.length && !s.reopened.length && !s.skipped.length && !s.shortages.length && !s.restored && !s.sheets.length && !s.deferred.length
  return (
    <div className="run-body">
      {s.error && <Line tone="err">{format(s.error)}</Line>}
      {s.restored && <Line tone="ok">{t('journal.restored', { time: dateTime(stampTime(s.restored.stamp)) })}</Line>}
      {s.deferred.length > 0 && <Line tone="warn">{t('journal.deferred', { list: list(s.deferred.map((d) => d.file)) })}</Line>}
      {nothing && run.outcome !== 'running' && <Line>{s.command === 'sync' ? t('journal.nothing') : t('journal.nothingSheets')}</Line>}
      <Section title={done ? t('journal.blocksDone', { n: blocks.length }) : t('journal.blocksPlan', { n: blocks.length })} items={blocks} />
      <Section title={t('journal.ids')} items={ids} />
      <Section title={done ? t('journal.closedDone') : t('journal.closedPlan')} items={s.closed.length ? [list(s.closed)] : []} />
      <Section title={done ? t('journal.reopenedDone') : t('journal.reopenedPlan')} items={s.reopened.length ? [list(s.reopened)] : []} />
      <Section title={done ? t('journal.sheetsDone') : t('journal.sheetsPlan')} items={s.sheets.length ? [list(s.sheets)] : []} />
      <Section title={t('journal.shortages')} tone="warn" items={shortages.length ? [...shortages, <span className="run-dim">{t('journal.shortageHint')}</span>] : []} />
      <Section title={t('journal.skipped', { n: s.skipped.length })} tone="warn" items={skipped} />
      <Section title={t('journal.unconfigured')} tone="warn" items={s.unconfigured.length ? [list(s.unconfigured)] : []} />
      <Section title={t('journal.oldHeats')} tone="warn" items={s.oldHeats.map((h) => `Ø${h.dia} ${h.form}: ${list(h.heats)}`)} />
      <Section title={t('journal.warnings')} tone="warn" items={s.warnings.map(format)} />
      <Section title={t('journal.notes')} items={s.notes.map(format)} />
      <Section title={t('journal.problems')} tone="err" items={s.problems.map(format)} />
      {s.verified === true && <Line tone="ok">{t('journal.verified')}</Line>}
      {s.backup && <Line>{t('journal.backup', { time: dateTime(stampTime(s.backup)) })}</Line>}
    </div>
  )
}
