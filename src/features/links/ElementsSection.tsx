/**
 * Элементы Consum и их блоки в Sarjele: как связан каждый элемент, фильтр «требуют внимания / новые / все»
 * и ручная привязка к блоку (запоминается в links.json).
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AddIcon, AlertIcon, LinkIcon } from '@/components/icons/Icons'
import { SelectInput } from '@/components/ui/Inputs'
import { FormSection, Notice, StatusBadge, type StatusTone } from '@/components/ui/Layout'
import { Tabs } from '@/components/ui/Tabs'
import { useMessages } from '@/app/i18n'
import type { ScanData, ScanElement } from '@/shared/protocol'

/** Какие элементы показывать. */
type Filter = 'attention' | 'all' | 'new'

/** Сколько блоков без привязки перечислять. */
const ORPHANS_SHOWN = 8

/** Элементы по проектам (и по файлам, если Consum несколько) с фильтром. */
export function ElementsSection({ scan, onLink }: { scan: ScanData; onLink: (e: ScanElement, value: string | null) => void }) {
  const { t } = useTranslation('links')
  const [filter, setFilter] = useState<Filter>('attention')
  const multi = scan.files.length > 1
  const isNew = (e: ScanElement) => e.kind === 'new' || e.kind === 'migrate'
  const counts = { attention: scan.elements.filter((e) => e.kind === 'skip').length, new: scan.elements.filter(isNew).length, all: scan.elements.length }
  const list = scan.elements.filter((e) => (filter === 'all' ? true : filter === 'attention' ? e.kind === 'skip' : isNew(e)))
  const groups = new Map<string, ScanElement[]>()
  for (const e of list) {
    const k = multi ? `${e.source} · ${e.project}` : e.project
    groups.set(k, [...(groups.get(k) ?? []), e])
  }

  return (
    <FormSection title={t('elements.title')} icon={<LinkIcon />} hint={t('elements.hint')}>
      <Tabs
        label={t('elements.filter')}
        value={filter}
        options={[
          { value: 'attention' as Filter, label: t('elements.attention', { n: counts.attention }), icon: <AlertIcon /> },
          { value: 'new' as Filter, label: t('elements.new', { n: counts.new }), icon: <AddIcon /> },
          { value: 'all' as Filter, label: t('elements.all', { n: counts.all }), icon: <LinkIcon /> },
        ]}
        onChange={setFilter}
      />
      {list.length === 0 && <Notice>{filter === 'attention' ? t('elements.allLinked') : t('elements.empty')}</Notice>}
      {[...groups].map(([g, els]) => (
        <div key={g} className="link-group">
          <div className="link-group-title">
            {g} · {els.length}
          </div>
          <ul className="link-list">
            {els.map((e) => (
              <ElementRow key={`${e.source}|${e.row}`} e={e} onLink={onLink} />
            ))}
          </ul>
        </div>
      ))}
      {scan.orphans.length > 0 && (
        <Notice>
          {t('elements.orphans', {
            n: scan.orphans.length,
            list: scan.orphans.slice(0, ORPHANS_SHOWN).map((o) => `«${o.title}»`).join(', ') + (scan.orphans.length > ORPHANS_SHOWN ? '…' : ''),
          })}
        </Notice>
      )}
    </FormSection>
  )
}

/** Элемент: как он связан с блоком и выбор блока вручную (`@new`, `@skip`, заголовок блока; пусто — само). */
function ElementRow({ e, onLink }: { e: ScanElement; onLink: (e: ScanElement, value: string | null) => void }) {
  const { t } = useTranslation('links')
  const format = useMessages()
  const title = e.block?.title ?? ''
  let tone: StatusTone = 'neutral'
  let text = t('elements.willCreate', { id: e.id }) + (e.newSheet ? t('elements.withSheet') : '')
  if (e.kind === 'skip') {
    tone = 'danger'
    text = e.why ? format(e.why) : t('elements.needsAttention')
  } else if (e.kind === 'known') {
    tone = 'success'
    text = e.via === 'id' ? t('elements.knownById', { id: e.id, title }) + (e.changed ? t('elements.willUpdate') : '') : t('elements.knownByRegistry', { id: e.id, title })
  } else if (e.kind === 'migrate') {
    tone = 'info'
    text = t(e.via === 'link' ? 'elements.byLink' : 'elements.byName', { id: e.id, title })
  }
  const editable = e.kind !== 'known' && !!e.sheet
  const options = useMemo(() => {
    const opts = [
      { value: '', label: t('elements.auto') },
      { value: '@new', label: t('elements.newBlock') },
      { value: '@skip', label: t('elements.skip') },
      ...e.candidates.map((c) => ({ value: c.title, label: t('elements.candidate', { title: c.title, empty: c.filled ? '' : t('elements.emptyBlock'), score: Math.round(c.score * 100) }) })),
    ]
    if (e.link && !opts.some((o) => o.value === e.link)) opts.push({ value: e.link, label: e.link })
    return opts
  }, [e, t])
  return (
    <li className="link-row">
      <div className="link-main">
        <div className="link-name">{e.name}</div>
        <StatusBadge tone={tone}>{text}</StatusBadge>
      </div>
      {editable && (
        <div className="link-pick">
          <SelectInput aria-label={t('elements.pickFor', { name: e.name })} value={e.link ?? ''} options={options} onChange={(v) => onLink(e, v || null)} />
        </div>
      )}
    </li>
  )
}
