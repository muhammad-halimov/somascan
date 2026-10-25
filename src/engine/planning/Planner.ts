/**
 * План прогона: что записать в Sarjele и что закрасить в Probe, и какие файлы для этого придётся переписать.
 *
 * Для каждого элемента Consum с расходом:
 *   - блок пустой или новый — весь расход распределяется по плавкам (`HeatAllocator`);
 *   - блок уже записан — сверка с Consum: прибавка распределяется по плавкам, уменьшение снимается
 *     с последних строк элемента (плавка, закрытая жёлтым, может открыться обратно);
 *   - если под блоком нет места для новых строк — элемент пропускается, а расчёт откатывается.
 * В конце: израсходованные плавки — на закраску, закрашенные программой с вернувшимся остатком — на открытие.
 */
import { message, type Message } from '@/shared/messages'
import type { ConsumItem, Need } from '../books/ConsumBook'
import { isFormWord, type Block, type BlockRow, type RegistryEntry } from '../books/SarjeleBook'
import type { Workspace } from '../Workspace'
import { HeatAllocator } from './HeatAllocator'

/** Связь элемента с блоком. */
export type Resolution =
  | { kind: 'skip'; why: Message; manual?: boolean }
  | {
      kind: 'known'
      via: 'id' | 'registry'
      id: string
      block: Block
      reg: RegistryEntry | null
      /** ID нужно записать в Consum (его там нет). */
      backfill: boolean
      /** Элемент переходит к этому Consum. */
      adopt: boolean
      /** Название в Consum изменилось — заголовок блока обновится. */
      rename: boolean
    }
  | { kind: 'migrate'; via: 'link' | 'name'; id: string; block: Block; backfill: true }
  | { kind: 'new'; via: 'link' | 'new'; id: string; backfill: true; newSheet: boolean }

/** Строка плана: сколько кг какой плавки ушло на код материала. */
export interface PlanLine {
  model: string
  dia: number | null
  form: 'Bobina' | 'Bara'
  /** Плавка или «— НЕТ ОСТАТКА —». */
  sarja: string
  /** Производитель. */
  name: string
  /** Кг (в сверке — со знаком). */
  kg: number
  /** Остаток плавки до списания. */
  before: number
}

/** Строка «не хватило стали». */
export const NO_STOCK = '— НЕТ ОСТАТКА —'
/** Строка плана с плавкой (не «нет остатка»). */
export const isRealLine = (l: PlanLine): boolean => !String(l.sarja).startsWith('—')

/** Снятие кг со строки блока при сверке. */
export interface PlanCut {
  row: BlockRow
  take: number
  model: string
  dia: number | null
  form: 'Bobina' | 'Bara'
}

/** Режим записи блока: правка записанного, дозаполнение пустого, новый. */
export type PlanMode = 'update' | 'fill' | 'create'

/** Что записать в один блок. */
export interface PlanItem {
  element: string
  project: string | null
  buc: unknown
  mode: PlanMode
  lines: PlanLine[]
  sheet: string | null
  block: Block | null
  /** Сверка заполненного блока. */
  recon: { cuts: PlanCut[]; adds: PlanLine[] } | null
  res: Resolution
  /** Где оказался блок после записи. */
  anchor?: { titleRow: number; col: number } | null
}

/** Действие по элементу: привязка ID (и, может быть, запись блока). */
export interface PlanAction {
  it: ConsumItem
  res: Exclude<Resolution, { kind: 'skip' }>
  p: PlanItem | null
}

/** Нехватка стали. */
export interface Shortage {
  element: string
  dia: number | null
  form: string
  kg: number
  /** Свободно в открытых плавках. */
  free: number
  /** Числится в плавках, закрытых жёлтым. */
  closedLeft: number
}

/** Пропущенный элемент. */
export interface SkippedItem {
  project: string | null
  name: string
  why: Message
}

/** Расхождение блока с Consum по коду материала. */
export interface BlockDiff {
  n: Need
  mine: BlockRow[]
  total: number
  delta: number
}

/** Итог плана. */
export interface PlanResult {
  plan: PlanItem[]
  actions: PlanAction[]
  toClose: Set<string>
  toReopen: Set<string>
  /** Плавки, закрытые жёлтым вручную, с которых сняты кг. */
  reopened: Set<string>
  shortages: Shortage[]
  skippedItems: SkippedItem[]
  /** Старые незакрытые плавки, пропущенные правилом `latest`. */
  skippedOld: Map<string, string[]>
  allocator: HeatAllocator
}

/** Что прогон меняет в файлах. */
export interface ChangeSet {
  /** Блоки, в которые есть что записать (без строк «нет остатка»). */
  plan: PlanItem[]
  /** Действия с ID; новые блоки — только те, что попадут в Sarjele. */
  acts: PlanAction[]
  sarjele: boolean
  probe: boolean
  consum: boolean
  /** ID для Consum: строка → ID. */
  consumIds: Map<number, string>
}

/** Действия с ID, о которых стоит сказать (привязка, новый блок, переименование, запись ID, переход). */
export const idActions = (actions: readonly PlanAction[]): PlanAction[] =>
  actions.filter((a) => a.res.kind === 'migrate' || a.res.kind === 'new' || ('rename' in a.res && a.res.rename) || a.res.backfill || ('adopt' in a.res && a.res.adopt))

/** Строит план по прочитанным файлам. */
export class Planner {
  private readonly ws: Workspace

  constructor(ws: Workspace) {
    this.ws = ws
  }

  /** Расхождения блока Sarjele с Consum по кодам (больше 1 кг). */
  static blockDiffs(block: Block, it: ConsumItem): BlockDiff[] {
    const out: BlockDiff[] = []
    for (const n of it.need) {
      const mine = block.rows.filter((r) => String(r.model) === String(n.code))
      const total = mine.reduce((a, r) => a + (r.kg || 0), 0)
      if (Math.abs(n.kg - total) > 1) out.push({ n, mine, total, delta: n.kg - total })
    }
    return out
  }

  /** Строит план. */
  build(): PlanResult {
    const { probe, sarjele, items, catalog, options, resolutions } = this.ws
    const allocator = new HeatAllocator(probe, sarjele.used, sarjele.events, options.rule, new Set())
    const used = allocator.used
    const toClose = allocator.toClose
    const plan: PlanItem[] = []
    const shortages: Shortage[] = []
    const reopened = new Set<string>()
    const skippedItems: SkippedItem[] = []
    const actions: PlanAction[] = []
    const skippedOld = allocator.skippedOld()

    for (const it of items) {
      if (!it.project || !catalog.isEnabled(it.project)) continue
      const sheet = catalog.sheetOf(it.project)
      const res = resolutions.get(it)!
      if (res.kind === 'skip') {
        skippedItems.push({ project: it.project, name: it.name, why: res.why })
        continue
      }
      const block = 'block' in res ? res.block : null
      if (options.migrateOnly) {
        if (block) actions.push({ it, res, p: null })
        continue
      }
      const recon = !!block && block.rows.every((r) => r.sarja) // блок уже записан: сверяем кг с Consum
      const snap = { toClose: new Set(toClose), reopened: new Set(reopened), shortages: shortages.length }
      const adds: BlockDiff[] = []
      const cuts: PlanCut[] = []
      if (recon) {
        const ds = Planner.blockDiffs(block!, it)
        if (!ds.length) {
          if (res.kind === 'migrate' || res.backfill || ('rename' in res && res.rename) || ('adopt' in res && res.adopt)) actions.push({ it, res, p: null })
          continue
        }
        for (const d of ds) {
          if (d.delta > 0) adds.push(d)
          else {
            let cut = -d.delta
            for (const row of [...d.mine].reverse()) {
              // снимаем с последних строк элемента
              if (cut <= 0) break
              const take = Math.min(row.kg ?? 0, cut)
              cuts.push({ row, take, model: d.n.code, dia: d.n.dia, form: d.n.form })
              used.set(row.sarja, (used.get(row.sarja) ?? 0) - take)
              cut -= take
              if (probe.heats.get(row.sarja)?.closed) reopened.add(row.sarja)
            }
          }
        }
      }
      const mode: PlanMode = recon ? 'update' : block ? 'fill' : 'create'
      const lines: PlanLine[] = []
      for (const c of cuts) lines.push({ model: c.model, dia: c.dia, form: c.form, sarja: c.row.sarja, name: c.row.name, kg: -c.take, before: c.row.kg as number })
      const needs = recon ? adds.map((a) => ({ ...a.n, kg: a.delta })) : it.need
      for (const n of needs) {
        const { lines: got, left } = allocator.allocate(n.code, n.dia, n.form, n.kg)
        lines.push(...got)
        if (left > 0) {
          shortages.push({ element: it.name, dia: n.dia, form: n.form, kg: left, ...allocator.freeAndClosed(n.dia, n.form) })
          lines.push({ model: n.code, dia: n.dia, form: n.form, sarja: NO_STOCK, name: '', kg: left, before: 0 })
        }
      }
      if (recon) {
        // хватит ли места под новые строки блока? Иначе запись будет пропущена — и расчёт остатков нельзя считать выполненным
        const rows: Array<{ r?: number; model: unknown; sarja: string; kg: number }> = block!.rows.map((x) => ({ r: x.r, model: x.model, sarja: x.sarja, kg: x.kg ?? 0 }))
        for (const c of cuts) {
          const x = rows.find((q) => q.r === c.row.r)
          if (x) x.kg -= c.take
        }
        for (const a of lines.filter((l) => l.kg > 0 && isRealLine(l))) {
          const same = rows.find((q) => String(q.model) === String(a.model) && String(q.sarja) === String(a.sarja))
          if (same) same.kg += a.kg
          else rows.push({ model: a.model, sarja: a.sarja, kg: a.kg })
        }
        const need = rows.filter((q) => q.kg > 0).length - block!.rows.length
        if (need > 0 && (block!.room ?? 0) < need + 1) {
          for (const l of lines) if (isRealLine(l)) used.set(l.sarja, (used.get(l.sarja) ?? 0) - l.kg)
          toClose.clear()
          for (const x of snap.toClose) toClose.add(x)
          reopened.clear()
          for (const x of snap.reopened) reopened.add(x)
          shortages.length = snap.shortages
          skippedItems.push({ project: it.project, name: it.name, why: message('skip.noRoom', { n: need, sheet: sheet ?? '' }) })
          continue
        }
      }
      const item: PlanItem = { element: it.name, project: it.project, buc: it.buc, mode, lines, sheet, block, recon: recon ? { cuts, adds: lines.filter((l) => l.kg > 0) } : null, res }
      plan.push(item)
      actions.push({ it, res, p: item })
    }

    // итог после всех правок Consum (Buc вверх/вниз): израсходованная плавка закрашивается, даже если её остаток обнулился не при записи, а при пересчёте
    for (const s of probe.heats.values()) {
      if (!s.closed && !toClose.has(s.sarja) && s.supplied > 0 && (used.get(s.sarja) ?? 0) > 0 && allocator.remaining(s) <= 0) toClose.add(s.sarja)
    }
    // плавки, закрашенные самим скриптом, у которых после пересчёта снова есть остаток -> открыть обратно
    const toReopen = new Set([...probe.journal].filter((x) => probe.heats.get(x)?.closed && allocator.remaining(probe.heats.get(x)!) > 0 && !toClose.has(x)))
    for (const x of toReopen) reopened.delete(x) // это не «ручная» закраска — предупреждать не нужно
    return { plan, actions, toClose, toReopen, reopened, shortages, skippedItems, skippedOld, allocator }
  }

  /**
   * Что придётся переписать. Файл переписывается, только если в нём есть что менять:
   *   - Sarjele — блоки по плану, привязки ID, недостающие листы, а также оформление, если оно «уехало»
   *     (подпись формы не та, «Model ID» не скрыт, нет левой линии, ID виден, реестр спрятан глубже, чем нужно);
   *   - Probe — плавки на закраску или открытие;
   *   - Consum — новые ID и вид колонки ID.
   */
  changes(result: PlanResult): ChangeSet {
    const { sarjele, probe, catalog, consum } = this.ws
    const plan = result.plan.filter((p) => p.lines.some(isRealLine))
    const planSet = new Set(plan)
    const acts = result.actions.filter((a) => a.res.kind !== 'new' || (a.p && planSet.has(a.p)))
    const isFormLabel = (x: string) => x === '' || isFormWord(x)
    const labelsStale = sarjele.blocks.some((b) => b.col > 1 && b.final && b.rows.some((x) => {
      const heat = x.sarja ? probe.heats.get(x.sarja) : undefined
      return !!heat && x.label !== heat.form && isFormLabel(x.label)
    }))
    const idsMove = acts.some((a) => {
      const r = a.res
      if (r.kind === 'migrate' || r.kind === 'new') return true
      return r.rename || !r.reg || r.adopt || (r.block.col > 1 && !r.block.idLeft)
    })
    const sarjeleNeeded = plan.length > 0
      || catalog.missingSheets().length > 0
      || idsMove
      || labelsStale
      || sarjele.blocks.some((b) => b.col > 1 && !b.layoutOk)
      || sarjele.blocks.some((b) => b.id && sarjele.registry.has(b.id) && !b.idHidden)
      || sarjele.registryState === 'veryHidden'
      || sarjele.blocks.some((b) => b.modelIdHide || b.modelIdVisible || b.noLeft)
    const consumIds = new Map(acts.filter((a) => a.res.backfill && !a.it.id).map((a) => [a.it.row, a.res.id]))
    return {
      plan,
      acts,
      sarjele: sarjeleNeeded,
      probe: result.toClose.size > 0 || result.toReopen.size > 0,
      consum: consumIds.size > 0 || consum.idColumn.stale,
      consumIds,
    }
  }
}

/** Есть ли что записывать. */
export const hasChanges = (c: ChangeSet): boolean => c.sarjele || c.probe || c.consum
