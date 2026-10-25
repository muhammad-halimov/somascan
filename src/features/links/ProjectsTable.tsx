/**
 * Проекты: таблица «проект Consum → лист Sarjele». Лист выбирается вручную, по умолчанию закрыт замком
 * (как пути в «Хранилище»): открыть замок — выбрать лист — закрыть.
 *
 * Строки — настроенные проекты и проекты из Consum, которые ещё не настроены (их программа подключает сама,
 * если включено «Новые проекты подключать сами»). Выбор листа у такой строки добавляет проект в настройки.
 * Под строкой настроенного проекта — подробности: другие написания в Consum, буквы ID, вкл/выкл, удаление.
 */
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AddIcon, ChevronDownIcon, FactoryIcon, LockIcon, LockOpenIcon, TableIcon, TrashIcon } from '@/components/icons/Icons'
import { Button } from '@/components/ui/Button'
import { SelectInput, TextInput } from '@/components/ui/Inputs'
import { Field, FormSection, Notice, StatusBadge } from '@/components/ui/Layout'
import { List, ListItem, Switch } from '@/components/ui/List'
import { settingsStore } from '@/app/state'
import { autoIdPrefix, safeSheetName } from '@/shared/names'
import type { ScanData, ScanProject } from '@/shared/protocol'
import { createProject, type ProjectSettings } from '@/shared/settings'

/** Значение выбора «новый лист» (не может совпасть с именем листа). */
const NEW_SHEET = '\u0000new'

/** Свойства `ProjectsTable`. */
interface ProjectsTableProps {
  projects: ProjectSettings[]
  scan: ScanData | null
  createSheets: () => void
  busy: boolean
}

/** Строка таблицы: настроенный проект или проект из Consum без настройки. */
type Row = { kind: 'project'; p: ProjectSettings; index: number; seen: ScanProject[] } | { kind: 'raw'; raw: ScanProject }

/** Таблица проектов. */
export function ProjectsTable({ projects, scan, createSheets, busy }: ProjectsTableProps) {
  const { t } = useTranslation('links')
  const [name, setName] = useState('')
  const known = new Set(projects.flatMap((p) => [p.name, ...p.aliases]).map((x) => x.toLowerCase()))
  const raw = (scan?.projects ?? []).filter((x) => x.rows > 0 && !known.has(x.raw.toLowerCase()) && (!x.matched || x.matched.how === 'adopted'))
  const rows: Row[] = [
    ...projects.map((p, index): Row => ({ kind: 'project', p, index, seen: (scan?.projects ?? []).filter((x) => x.matched?.name === p.name && x.matched.how !== 'adopted') })),
    ...raw.map((r): Row => ({ kind: 'raw', raw: r })),
  ]
  const missingSheets = projects.filter((p) => p.enabled && p.sheet && p.create && scan && !scan.sheets.some((s) => s.name === p.sheet))

  const add = (nm: string, sheet: string, locked = true) => {
    const n = nm.trim()
    if (!n || projects.some((p) => p.name.toLowerCase() === n.toLowerCase())) return
    settingsStore.update({ projects: [...projects, createProject(n, sheet || safeSheetName(n), locked)] })
  }

  return (
    <FormSection title={t('projects.title')} icon={<FactoryIcon />} hint={t('projects.hint')}>
      {rows.length === 0 ? (
        <Notice>{t('projects.empty')}</Notice>
      ) : (
        <table className="projects-table">
          <thead>
            <tr>
              <th>{t('projects.consum')}</th>
              <th>{t('projects.sarjele')}</th>
              <th>
                <span className="visually-hidden">{t('projects.lock')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              r.kind === 'project' ? (
                <ProjectRow key={`p:${r.p.name}`} p={r.p} index={r.index} projects={projects} seen={r.seen} scan={scan} />
              ) : (
                <RawRow key={`r:${r.raw.raw}`} raw={r.raw} scan={scan} projects={projects} add={add} />
              ),
            )}
          </tbody>
        </table>
      )}
      {missingSheets.length > 0 && (
        <Button variant="tonal" icon={<TableIcon />} busy={busy} onClick={createSheets}>
          {t('projects.createSheets', { sheets: missingSheets.map((p) => p.sheet).join(', ') })}
        </Button>
      )}
      <div className="project-add">
        <TextInput placeholder={t('projects.manualName')} value={name} onChange={setName} />
        <Button
          icon={<AddIcon />}
          disabled={!name.trim()}
          onClick={() => {
            add(name, '')
            setName('')
          }}
        >
          {t('projects.manualAdd')}
        </Button>
      </div>
    </FormSection>
  )
}

/**
 * Варианты листа: листы Sarjele с блоками и «новый лист». `value` — что выбрано: `current`, если такой лист есть,
 * иначе «новый лист» (его создаст запись). Пока файлы не прочитаны — только текущий лист.
 */
function sheetChoice(scan: ScanData | null, current: string, t: ReturnType<typeof useTranslation<'links'>>['t']) {
  if (!scan) return { known: true, value: current || NEW_SHEET, options: [current ? { value: current, label: current } : { value: NEW_SHEET, label: t('projects.newSheet') }] }
  const sheets = scan.sheets.filter((s) => s.blocks > 0 || s.name === current)
  const known = !!current && sheets.some((s) => s.name === current)
  return {
    known,
    value: known ? current : NEW_SHEET,
    options: [
      ...sheets.map((s) => ({ value: s.name, label: t('projects.sheetOption', { name: s.name, blocks: s.blocks }) })),
      { value: NEW_SHEET, label: current && !known ? t('projects.newSheetNamed', { name: current }) : t('projects.newSheet') },
    ],
  }
}

/** Кнопка замка. */
function LockButton({ locked, onToggle, name }: { locked: boolean; onToggle: () => void; name: string }) {
  const { t } = useTranslation('links')
  const label = locked ? t('projects.unlock', { name }) : t('projects.lockIt', { name })
  return (
    <button type="button" className={`icon-btn lock-btn${locked ? '' : ' is-open'}`} aria-label={label} title={label} aria-pressed={!locked} onClick={onToggle}>
      {locked ? <LockIcon /> : <LockOpenIcon />}
    </button>
  )
}

/** Настроенный проект. */
function ProjectRow({ p, index, projects, seen, scan }: { p: ProjectSettings; index: number; projects: ProjectSettings[]; seen: ScanProject[]; scan: ScanData | null }) {
  const { t } = useTranslation('links')
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<ProjectSettings>) => settingsStore.update({ projects: projects.map((x, i) => (i === index ? { ...x, ...patch } : x)) })
  const { known, value, options } = sheetChoice(scan, p.sheet, t)
  const rows = seen.reduce((a, x) => a + x.rows, 0)
  const attention = (scan?.elements ?? []).filter((e) => e.project === p.name && e.kind === 'skip').length
  const status = !p.enabled
    ? t('projects.off')
    : scan && !seen.length
      ? t('projects.notInConsum')
      : seen.length
        ? t('projects.rows', { n: rows })
        : ''
  return (
    <Fragment>
      <tr className={p.enabled ? '' : 'is-off'}>
        <td>
          <button type="button" className="project-name" aria-expanded={open} onClick={() => setOpen(!open)}>
            <ChevronDownIcon />
            <span>{p.name}</span>
          </button>
          {/* части строки — элементы flex: при переносе «·» не повисает в конце строки */}
          <div className="project-sub project-meta">
            {status && <span>{status}</span>}
            {p.aliases.length > 0 && <span>· {t('projects.aliasesShort', { n: p.aliases.length })}</span>}
            {attention > 0 && <StatusBadge tone="danger">{t('projects.attention', { n: attention })}</StatusBadge>}
          </div>
        </td>
        <td>
          <SelectInput
            aria-label={t('projects.sheetFor', { name: p.name })}
            disabled={p.locked}
            value={value}
            options={options}
            onChange={(v) => (v === NEW_SHEET ? set({ sheet: safeSheetName(p.name) || 'NEW', create: true }) : set({ sheet: v }))}
          />
          {p.enabled && p.sheet && !known && <div className="project-sub">{p.create ? t('projects.willCreate') : t('projects.sheetMissing')}</div>}
        </td>
        <td>
          <LockButton locked={p.locked} name={p.name} onToggle={() => set({ locked: !p.locked })} />
        </td>
      </tr>
      {open && (
        <tr className="project-details">
          <td colSpan={3}>
            <ProjectDetails p={p} set={set} known={known} remove={() => settingsStore.update({ projects: projects.filter((_, i) => i !== index) })} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

/** Подробности проекта: новый лист, другие написания, буквы ID, вкл/выкл, удаление. */
function ProjectDetails({ p, set, known, remove }: { p: ProjectSettings; set: (patch: Partial<ProjectSettings>) => void; known: boolean; remove: () => void }) {
  const { t } = useTranslation('links')
  const [alias, setAlias] = useState('')
  const addAlias = () => {
    const a = alias.trim()
    if (!a || p.aliases.some((x) => x.toLowerCase() === a.toLowerCase())) return
    set({ aliases: [...p.aliases, a] })
    setAlias('')
  }
  return (
    <div className="project-card">
      {!known && (
        <>
          <Field label={t('projects.newSheetName')}>
            <TextInput value={p.sheet} disabled={p.locked} onChange={(v) => set({ sheet: safeSheetName(v) })} />
          </Field>
          <List label={t('projects.createList')}>
            <ListItem itemRole="checkbox" primary={t('projects.create')} secondary={p.create ? t('projects.createOn') : t('projects.createOff')} selected={p.create} trailing={<Switch on={p.create} />} onClick={() => set({ create: !p.create })} />
          </List>
        </>
      )}
      <div className="alias-row">
        <span className="alias-label">{t('projects.aliases')}</span>
        <div className="chips">
          {p.aliases.map((a) => (
            <span key={a} className="chip">
              {a}
              <button type="button" aria-label={t('projects.removeAlias', { alias: a })} onClick={() => set({ aliases: p.aliases.filter((x) => x !== a) })}>
                ×
              </button>
            </span>
          ))}
          <input
            className="chip-input"
            placeholder={t('projects.addAlias')}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addAlias()
            }}
            onBlur={addAlias}
          />
        </div>
        <span className="project-hint">{t('projects.aliasHint')}</span>
      </div>
      <div className="project-foot">
        <Field label={t('projects.prefix')}>
          <TextInput className="prefix-input" placeholder={autoIdPrefix(p.name)} value={p.prefix} onChange={(v) => set({ prefix: v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })} />
        </Field>
        <span className="project-hint">{t('projects.ids', { prefix: p.prefix || autoIdPrefix(p.name) })}</span>
        <span className="project-actions">
          <Button onClick={() => set({ enabled: !p.enabled })}>{p.enabled ? t('projects.disable') : t('projects.enable')}</Button>
          <Button icon={<TrashIcon />} onClick={remove}>
            {t('projects.remove')}
          </Button>
        </span>
      </div>
    </div>
  )
}

/** Проект из Consum, который не настроен. */
function RawRow({ raw, scan, projects, add }: { raw: ScanProject; scan: ScanData | null; projects: ProjectSettings[]; add: (name: string, sheet: string, locked?: boolean) => void }) {
  const { t } = useTranslation('links')
  const [locked, setLocked] = useState(true)
  const adopted = raw.matched?.how === 'adopted' ? raw.matched : null
  const { value, options } = sheetChoice(scan, adopted?.sheet ?? raw.suggestSheet ?? safeSheetName(raw.raw), t)
  const asAlias = (project: string) => settingsStore.update({ projects: projects.map((p) => (p.name === project ? { ...p, aliases: [...p.aliases, raw.raw] } : p)) })
  return (
    <tr className="is-raw">
      <td>
        <div className="project-name is-static">
          <span>{raw.raw}</span>
        </div>
        <div className="project-sub">
          {t('projects.rows', { n: raw.rows })} · {adopted ? t('projects.adopted') : t('projects.notProcessed')}
          {raw.suggestProject && (
            <>
              {' '}
              · <button type="button" className="link-btn" onClick={() => asAlias(raw.suggestProject!)}>{t('projects.sameAs', { name: raw.suggestProject })}</button>
            </>
          )}
        </div>
      </td>
      <td>
        <SelectInput
          aria-label={t('projects.sheetFor', { name: raw.raw })}
          disabled={locked}
          value={value}
          options={options}
          onChange={(v) => add(raw.raw, v === NEW_SHEET ? safeSheetName(raw.raw) : v, false)}
        />
        {adopted && !adopted.sheetExists && <div className="project-sub">{t('projects.willCreate')}</div>}
      </td>
      <td>
        <LockButton locked={locked} name={raw.raw} onToggle={() => setLocked(!locked)} />
      </td>
    </tr>
  )
}
