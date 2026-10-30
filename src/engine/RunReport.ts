/**
 * Отчёт прогона: технический текст и итог для окна (`RunSummary`, коды сообщений).
 *
 * Технический текст — для `log.txt` и «Подробно» в журнале окна. Строки — сообщения с кодом и уровнем
 * (`TECH_MARK` + JSON в stdout): текст подставляет главный процесс на языке интерфейса, по уровню строка
 * раскрашивается. Без кода выходят только данные (метки копий) и стек ошибки. Итог (`summary`) пишется
 * в `JSON_OUT`: по нему окно строит понятную карточку прогона.
 */
import { formatRu, message, type Message, type MessageCode, type MessageParam } from '@/shared/messages'
import { emptySummary, TECH_MARK, type RunSummary, type TechLevel } from '@/shared/protocol'
import { idActions, isRealLine, type PlanAction, type PlanMode, type PlanResult } from './planning/Planner'
import type { Workspace } from './Workspace'

/** Куда идёт технический текст. */
export interface TextSink {
  /** Обычная строка без перевода (stdout): данные, пустая строка. */
  line(text?: string): void
  /** Строка без перевода в stderr: стек ошибки. */
  warn(text: string): void
  /**
   * Строка-сообщение: текст на языке интерфейса подставит главный процесс.
   * @param stream Куда строка относится: `err` — предупреждения и ошибки (как stderr).
   */
  msg(level: TechLevel, m: Message, stream?: 'out' | 'err'): void
}

/** Текст в консоль процесса. */
export const consoleSink: TextSink = {
  line: (text = '') => console.log(text),
  warn: (text) => console.warn(text),
  msg: (level, m) => console.log(TECH_MARK + JSON.stringify({ level, msg: m })),
}

/** Текст в память (для проверок). */
export class MemorySink implements TextSink {
  readonly lines: string[] = []
  readonly warnings: string[] = []

  line(text = ''): void {
    this.lines.push(...text.split('\n'))
  }

  warn(text: string): void {
    this.warnings.push(text)
  }

  /** Сообщения — по-русски, предупреждения и ошибки — к `warnings`. */
  msg(_level: TechLevel, m: Message, stream: 'out' | 'err' = 'out'): void {
    if (stream === 'err') this.warn(formatRu(m))
    else this.line(formatRu(m))
  }
}

/** Подписи режимов блока в техническом тексте. */
const MODE_LABEL: Record<PlanMode, Message> = { update: message('tech.mode.update'), fill: message('tech.mode.fill'), create: message('tech.mode.create') }

/** Описание действия с ID в техническом тексте. */
function describeAction(a: PlanAction): Message {
  const r = a.res
  if (r.kind === 'migrate') return message('tech.idAction.migrate', { title: r.block.title })
  if (r.kind === 'new') return message('tech.idAction.new')
  if (r.rename) return message('tech.idAction.rename', { name: a.it.name })
  if (r.adopt && !r.backfill) return message('tech.idAction.adopt')
  return message('tech.idAction.backfill')
}

/** Список в кавычках: «A», «B». */
const quoted = (names: readonly string[]) => names.map((x) => `«${x}»`).join(', ')

/** Действие с ID для итога. */
function idAction(a: PlanAction): RunSummary['ids'][number]['action'] {
  const r = a.res
  if (r.kind === 'migrate') return 'linked'
  if (r.kind === 'new') return 'created'
  if (r.rename) return 'renamed'
  if (r.adopt && !r.backfill) return 'adopted'
  return 'backfill'
}

/** Отчёт одного прогона. */
export class RunReport {
  readonly summary: RunSummary
  private readonly out: TextSink

  constructor(out: TextSink, command: RunSummary['command'], applied: boolean) {
    this.out = out
    this.summary = emptySummary(command, applied)
  }

  /** Строка без перевода (данные). */
  line(text = ''): void {
    this.out.line(text)
  }

  /** Строка технического текста по коду. */
  say(code: MessageCode, params?: Record<string, MessageParam>, level: TechLevel = 'info'): void {
    this.out.msg(level, message(code, params))
  }

  /** Предупреждение по коду (как stderr), в итог не попадает. */
  caution(code: MessageCode, params?: Record<string, MessageParam>): void {
    this.out.msg('warn', message(code, params), 'err')
  }

  /** Предупреждение: `! текст` (как stderr) и (по умолчанию) в итог. */
  warning(m: Message, toSummary = true): void {
    if (toSummary) this.summary.warnings.push(m)
    this.out.msg('warn', message('tech.warning', { text: m }), 'err')
  }

  /** Заметка: `• текст` и (по умолчанию) в итог. */
  note(m: Message, toSummary = true): void {
    if (toSummary) this.summary.notes.push(m)
    this.out.msg('info', message('tech.note', { text: m }))
  }

  /** Ошибка, из-за которой прогон не завершился. */
  fail(m: Message): void {
    this.summary.error = m
    this.out.msg('err', m, 'err')
  }

  /** Что прочитано: месяц Consum, сколько плавок, блоков и строк. */
  overview(ws: Workspace): void {
    const { probe, sarjele, items, consum } = ws
    const closedHeats = [...probe.heats.values()].filter((s) => s.closed).length
    this.summary.period = consum.period.label
    this.summary.counts = { heats: probe.heats.size, closedHeats, blocks: sarjele.blocks.length, rows: items.length }
    if (consum.period.label) this.say('tech.period', { period: consum.period.label })
    this.say('tech.overview', { heats: probe.heats.size, closed: closedHeats, blocks: sarjele.blocks.length, rows: items.length })
    this.line()
  }

  /** План: технический текст и итог (блоки, ID, плавки, нехватка, пропуски). */
  plan(ws: Workspace, result: PlanResult): void {
    this.printPlan(ws, result)
    const s = this.summary
    const { items, catalog } = ws
    s.unconfigured = [...new Set(items.filter((i) => i.project && !catalog.get(i.project)).map((i) => i.project!))]
    s.sheets = [...new Set([...result.actions.filter((a) => a.res.kind === 'new' && a.res.newSheet).map((a) => catalog.sheetOf(a.it.project!)), ...catalog.missingSheets()])].filter((x): x is string => !!x)
    s.ids = idActions(result.actions).map((a) => ({ id: a.res.id, project: a.it.project ?? '', element: a.it.name, action: idAction(a) }))
    s.blocks = result.plan.map((p) => {
      const real = p.lines.filter(isRealLine)
      return {
        project: p.project ?? '',
        element: p.element,
        mode: p.mode,
        kg: real.reduce((a, l) => a + l.kg, 0),
        heats: [...new Set(real.map((l) => String(l.sarja)))],
        missingKg: p.lines.filter((l) => !isRealLine(l)).reduce((a, l) => a + l.kg, 0),
      }
    })
    s.closed = [...result.toClose]
    s.reopened = [...result.toReopen]
    s.skipped = result.skippedItems.map((x) => ({ project: x.project, element: x.name, reason: x.why }))
    const byDia = new Map<string, RunSummary['shortages'][number]>()
    for (const x of result.shortages) {
      const k = `${x.dia}|${x.form}`
      const e = byDia.get(k) ?? { dia: x.dia, form: x.form, kg: 0, elements: [], free: x.free, closedLeft: x.closedLeft }
      e.kg += x.kg
      if (!e.elements.includes(x.element)) e.elements.push(x.element)
      byDia.set(k, e)
    }
    s.shortages = [...byDia.values()]
    if (result.allocator.rule === 'latest') {
      for (const [k, heats] of result.skippedOld) {
        if (!result.plan.some((p) => p.lines.some((l) => `${l.dia}|${l.form}` === k))) continue
        const [dia = '', form = ''] = k.split('|')
        s.oldHeats.push({ dia, form, heats })
      }
    }
    for (const heat of result.reopened) s.warnings.push(message('warn.manualReopen', { heat }))
  }

  /** Технический текст плана. */
  private printPlan(ws: Workspace, result: PlanResult): void {
    const { items, catalog } = ws
    const { plan, actions, skippedItems, toClose, toReopen, shortages, skippedOld, allocator } = result
    const unmapped = [...new Set(items.filter((i) => i.project && !catalog.get(i.project)).map((i) => i.project))]
    if (unmapped.length) this.say('tech.unmapped', { projects: quoted(unmapped.map(String)) }, 'warn')
    const newSheets = [...new Set([...actions.filter((a) => a.res.kind === 'new' && a.res.newSheet).map((a) => catalog.sheetOf(a.it.project!)), ...catalog.missingSheets()])]
    if (newSheets.length) this.say('tech.newSheets', { sheets: quoted(newSheets.map(String)) })
    const acts = idActions(actions)
    if (acts.length) {
      this.line()
      this.say('tech.idsTitle')
      for (const a of acts) this.say('tech.idLine', { id: (a.res.id || '').padEnd(8), project: a.it.project ?? '', element: a.it.name, action: describeAction(a) })
    }
    if (skippedItems.length) {
      this.line()
      this.say('tech.skippedTitle', undefined, 'warn')
      for (const x of skippedItems) this.say('tech.skippedLine', { project: x.project ?? '', element: x.name, why: x.why })
    }
    if (plan.length) this.line()
    for (const p of plan) {
      this.say('tech.block', { project: p.project ?? '', element: p.element, buc: String(p.buc), mode: MODE_LABEL[p.mode] }, 'plan')
      for (const l of p.lines) {
        this.say('tech.blockLine', {
          model: String(l.model).padEnd(9),
          dia: String(l.dia).padEnd(3),
          form: l.form.padEnd(6),
          heat: isRealLine(l) ? String(l.sarja).padEnd(14) : message('tech.noStock'),
          name: String(l.name).padEnd(16),
          kg: ((p.recon && l.kg > 0 ? '+' : '') + l.kg).padStart(6),
          before: String(l.before),
        })
      }
    }
    this.line()
    this.say('tech.rule', { rule: message(`tech.rules.${allocator.rule}`) })
    if (allocator.rule === 'latest' && skippedOld.size) {
      this.say('tech.oldHeatsTitle', undefined, 'warn')
      for (const [k, v] of skippedOld) {
        if (plan.some((p) => p.lines.some((l) => `${l.dia}|${l.form}` === k))) this.say('tech.oldHeatsLine', { key: k, heats: `${v.slice(0, 6).join(', ')}${v.length > 6 ? ' …' : ''}` })
      }
    }
    this.say('tech.reopen', { heats: toReopen.size ? [...toReopen].join(', ') : '—' })
    this.say('tech.close', { heats: toClose.size ? [...toClose].join(', ') : '—' })
    if (shortages.length) {
      this.line()
      this.say('tech.shortageTitle', undefined, 'err')
      const byDia = new Map<string, { kg: number; els: string[]; free: number; closedLeft: number }>()
      for (const x of shortages) {
        const k = `Ø${x.dia} ${x.form}`
        const e = byDia.get(k) ?? { kg: 0, els: [], free: x.free, closedLeft: x.closedLeft }
        e.kg += x.kg
        e.els.push(x.element)
        byDia.set(k, e)
      }
      for (const [k, e] of byDia) {
        this.say('tech.shortageLine', { key: k, kg: e.kg, elements: [...new Set(e.els)].join(', '), free: e.free, closed: e.closedLeft > 0 ? message('tech.shortageClosed', { kg: e.closedLeft }) : '' })
      }
      this.say('tech.shortageHint')
    }
  }
}
