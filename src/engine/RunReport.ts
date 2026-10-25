/**
 * Отчёт прогона: технический текст (stdout / stderr, по-русски) и итог для окна (`RunSummary`, коды сообщений).
 *
 * Технический текст — для `log.txt` и «Подробно» в журнале окна; по началу строки главный процесс его раскрашивает
 * (`✔` — готово, `!` — внимание, `■` — блок плана). Итог (`summary`) пишется в `JSON_OUT`: по нему окно строит
 * понятную карточку прогона на языке интерфейса.
 */
import { formatRu, message, type Message } from '@/shared/messages'
import { emptySummary, type RunSummary } from '@/shared/protocol'
import { idActions, isRealLine, type PlanAction, type PlanMode, type PlanResult } from './planning/Planner'
import type { Workspace } from './Workspace'

/** Куда идёт технический текст. */
export interface TextSink {
  /** Обычная строка (stdout). */
  line(text?: string): void
  /** Предупреждение или ошибка (stderr). */
  warn(text: string): void
}

/** Текст в консоль процесса. */
export const consoleSink: TextSink = {
  line: (text = '') => console.log(text),
  warn: (text) => console.warn(text),
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
}

/** Подписи режимов блока в техническом тексте. */
const MODE_LABEL: Record<PlanMode, string> = { update: 'ИЗМЕНИТЬ блок', fill: 'ДОЗАПОЛНИТЬ блок', create: 'СОЗДАТЬ блок' }

/** Описание действия с ID в техническом тексте. */
function describeAction(a: PlanAction): string {
  const r = a.res
  if (r.kind === 'migrate') return `привязан существующий блок «${r.block.title}»`
  if (r.kind === 'new') return 'новый блок'
  if (r.rename) return `переименование → заголовок блока станет «${a.it.name}»`
  if (r.adopt && !r.backfill) return 'элемент переходит к этому Consum'
  return 'ID будет записан в Consum'
}

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

  /** Строка технического текста. */
  line(text = ''): void {
    this.out.line(text)
  }

  /** Строка в stderr. */
  warn(text: string): void {
    this.out.warn(text)
  }

  /** Предупреждение: `! текст` в stderr и (по умолчанию) в итог. */
  warning(m: Message, toSummary = true): void {
    if (toSummary) this.summary.warnings.push(m)
    this.out.warn(`! ${formatRu(m)}`)
  }

  /** Заметка: `• текст` и (по умолчанию) в итог. */
  note(m: Message, toSummary = true): void {
    if (toSummary) this.summary.notes.push(m)
    this.out.line(`• ${formatRu(m)}`)
  }

  /** Ошибка, из-за которой прогон не завершился. */
  fail(m: Message): void {
    this.summary.error = m
    this.out.warn(formatRu(m))
  }

  /** Что прочитано: месяц Consum, сколько плавок, блоков и строк. */
  overview(ws: Workspace): void {
    const { probe, sarjele, items, consum } = ws
    const closedHeats = [...probe.heats.values()].filter((s) => s.closed).length
    this.summary.period = consum.period.label
    this.summary.counts = { heats: probe.heats.size, closedHeats, blocks: sarjele.blocks.length, rows: items.length }
    if (consum.period.label) this.line(`Consum: ${consum.period.label}`)
    this.line(`Probe: плавок ${probe.heats.size} (закрыто ${closedHeats}); Sarjele: блоков ${sarjele.blocks.length}; Consum: строк с расходом ${items.length}\n`)
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

  /** Технический текст плана. Формат строк важен: по их началу главный процесс раскрашивает журнал. */
  private printPlan(ws: Workspace, result: PlanResult): void {
    const { items, catalog } = ws
    const { plan, actions, skippedItems, toClose, toReopen, shortages, skippedOld, allocator } = result
    const unmapped = [...new Set(items.filter((i) => i.project && !catalog.get(i.project)).map((i) => i.project))]
    if (unmapped.length) this.line(`Проекты из Consum, которые не настроены (их строки не обрабатываются): ${unmapped.map((x) => `«${x}»`).join(', ')} — добавьте во вкладке «Связи»\n`)
    const newSheets = [...new Set([...actions.filter((a) => a.res.kind === 'new' && a.res.newSheet).map((a) => catalog.sheetOf(a.it.project!)), ...catalog.missingSheets()])]
    if (newSheets.length) this.line(`Будут созданы листы в Sarjele: ${newSheets.map((x) => `«${x}»`).join(', ')}\n`)
    const acts = idActions(actions)
    if (acts.length) {
      this.line('Привязка ID (Consum ↔ Sarjele):')
      for (const a of acts) this.line(`  ${(a.res.id || '').padEnd(8)} ${a.it.project} / ${a.it.name}  — ${describeAction(a)}`)
      this.line()
    }
    if (skippedItems.length) {
      this.line('Пропущены (нужно внимание):')
      for (const x of skippedItems) this.line(`  ${x.project} / ${x.name}: ${formatRu(x.why)}`)
      this.line()
    }
    for (const p of plan) {
      this.line(`■ ${p.project} / ${p.element} (Buc ${p.buc}) — ${MODE_LABEL[p.mode]}`)
      for (const l of p.lines) {
        this.line(`    ${String(l.model).padEnd(9)} Ø${String(l.dia).padEnd(3)} ${l.form.padEnd(6)} ${String(l.sarja).padEnd(14)} ${String(l.name).padEnd(16)} ${((p.recon && l.kg > 0 ? '+' : '') + l.kg).padStart(6)} кг   (остаток плавки до: ${l.before})`)
      }
    }
    this.line(`\nПравило выбора: ${allocator.rule}`)
    if (allocator.rule === 'latest' && skippedOld.size) {
      this.line('Старые незакрытые плавки, которые пропущены как «заброшенные» (проверь, не пора ли их закрасить):')
      for (const [k, v] of skippedOld) {
        if (plan.some((p) => p.lines.some((l) => `${l.dia}|${l.form}` === k))) this.line(`  Ø/форма ${k}: ${v.slice(0, 6).join(', ')}${v.length > 6 ? ' …' : ''}`)
      }
    }
    this.line(`\nСнять жёлтый в Probe (скрипт закрасил, остаток снова > 0): ${toReopen.size ? [...toReopen].join(', ') : '—'}`)
    this.line(`\nЗакрасить жёлтым в Probe (остаток 0): ${toClose.size ? [...toClose].join(', ') : '—'}`)
    if (shortages.length) {
      this.line('\n!!! В Probe не хватает стали (эти строки в Sarjele не записаны):')
      const byDia = new Map<string, { kg: number; els: string[]; free: number; closedLeft: number }>()
      for (const x of shortages) {
        const k = `Ø${x.dia} ${x.form}`
        const e = byDia.get(k) ?? { kg: 0, els: [], free: x.free, closedLeft: x.closedLeft }
        e.kg += x.kg
        e.els.push(x.element)
        byDia.set(k, e)
      }
      for (const [k, e] of byDia) {
        this.line(`  ${k}: нужно ещё ${e.kg} кг (${[...new Set(e.els)].join(', ')}); свободно в открытых плавках ${e.free} кг${e.closedLeft > 0 ? `, ещё ${e.closedLeft} кг числится в плавках, закрытых жёлтым` : ''}`)
      }
      this.line('  Что делать: добавьте поставку (плавки) в Probe или снимите жёлтый с плавки, где сталь ещё есть.')
    }
  }
}
