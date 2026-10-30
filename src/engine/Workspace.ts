/**
 * Всё, что прогон знает о файлах: прочитанные Probe, Sarjele и Consum, проекты и связи элементов с блоками.
 * Собирается одинаково для записи и для вкладки «Связи» (`scan`).
 */
import path from 'node:path'
import { bestMatch, intersects, matchProject, similarity, titleTokens } from '@/shared/names'
import type { EngineScan, ScanElement } from '@/shared/protocol'
import { ConsumBook, type ConsumItem } from './books/ConsumBook'
import { ProbeBook } from './books/ProbeBook'
import { REGISTRY_SHEET, SarjeleBook } from './books/SarjeleBook'
import type { EngineOptions } from './EngineOptions'
import { ElementLinker, linkKey, LinksFile, Ownership, type Links } from './planning/ElementLinker'
import { Planner, type Resolution } from './planning/Planner'
import { ProjectCatalog } from './planning/ProjectCatalog'
import type { RunReport } from './RunReport'

/** Сколько кандидатов-блоков показывать на элемент. */
const MAX_CANDIDATES = 40

/** Прочитанное состояние прогона. */
export class Workspace {
  readonly options: EngineOptions
  /** Имя текущего Consum (источник записей реестра). */
  readonly source: string
  readonly catalog: ProjectCatalog
  readonly probe: ProbeBook
  readonly sarjele: SarjeleBook
  readonly consum: ConsumBook
  /** Элементы Consum с расходом. */
  readonly items: ConsumItem[]
  readonly ownership: Ownership
  readonly links: Links
  /** Связь каждого элемента с блоком. */
  readonly resolutions: Map<ConsumItem, Resolution>

  private constructor(data: Omit<Workspace, 'scan'>) {
    this.options = data.options
    this.source = data.source
    this.catalog = data.catalog
    this.probe = data.probe
    this.sarjele = data.sarjele
    this.consum = data.consum
    this.items = data.items
    this.ownership = data.ownership
    this.links = data.links
    this.resolutions = data.resolutions
  }

  /** Читает файлы и связывает элементы с блоками. */
  static async load(options: EngineOptions, report: RunReport): Promise<Workspace> {
    const catalog = new ProjectCatalog(options.projects)
    const [probe, sarjele, consum] = await Promise.all([
      ProbeBook.read(options.probe, { sheets: options.probeSheets, explicit: options.probeSheetsExplicit, year: options.year }),
      SarjeleBook.read(options.sarjele),
      ConsumBook.read(options.consum, (raw) => catalog.match(raw)?.project.name ?? null),
    ])
    for (const w of probe.warnings) report.warning(w)
    report.say('tech.idColumn', consum.idColumn.describe)
    catalog.sheetNames = sarjele.sheets
    // новый проект в Consum (название вписано в готовый слот) подключается сам
    const adopted = catalog.adopt(consum.projects, options.autoProjects)
    for (const it of consum.items) {
      const name = it.rawProject ? adopted.get(it.rawProject) : undefined
      if (name) it.project = name
    }
    const source = path.basename(options.consum || '')
    const ownership = new Ownership(source, options.activeSources, consum.period.key)
    // испорченный links.json — ошибка прогона (MessageError): без него пропали бы @skip и ручные привязки
    const linksFile = LinksFile.read(options.linksFile)
    for (const w of linksFile.warnings) report.warning(w)
    const links = linksFile.links
    const linker = new ElementLinker(consum.items, sarjele, catalog, ownership, links, options.migrateOnly)
    const resolutions = new Map<ConsumItem, Resolution>()
    for (const it of consum.items) resolutions.set(it, linker.resolve(it))
    return new Workspace({ options, source, catalog, probe, sarjele, consum, items: consum.items, ownership, links, resolutions })
  }

  /**
   * Сведения для вкладки «Связи»: как каждый элемент связан с блоком, подсказки для непривязанных,
   * проекты Consum и листы Sarjele. Файлы не меняются.
   */
  scan(): EngineScan {
    const { items, sarjele, catalog, resolutions, links, source } = this
    const claimed = new Set([...resolutions.values()].map((r) => ('block' in r ? r.block : null)).filter((b) => !!b))
    const sheets = sarjele.sheets.filter((n) => n !== REGISTRY_SHEET).map((name) => {
      const bl = sarjele.blocks.filter((b) => b.sheet === name)
      return { name, blocks: bl.length, unlinked: bl.filter((b) => !b.id && !claimed.has(b)).length }
    })
    const sheetNames = sheets.map((x) => x.name)

    const elements: ScanElement[] = items.map((it) => {
      const r = resolutions.get(it)!
      const sheet = it.project ? catalog.sheetOf(it.project) : null
      let candidates: ScanElement['candidates'] = []
      if (r.kind !== 'known' && sheet) {
        const tk = titleTokens(it.name)
        candidates = sarjele.blocks
          .filter((b) => b.sheet === sheet && !b.id && !claimed.has(b))
          .map((b) => {
            const sim = similarity(it.name, b.title)
            const score = intersects(tk, titleTokens(b.title)) ? Math.max(0.95, sim) : sim
            return { sheet: b.sheet, title: b.title, row: b.titleRow, filled: b.rows.length > 0 && b.rows.every((x) => x.sarja), score: Math.round(score * 100) / 100 }
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_CANDIDATES)
      }
      const block = 'block' in r ? r.block : null
      const changed = !!block && r.kind !== 'skip' && Planner.blockDiffs(block, it).length > 0
      return {
        source,
        project: it.project as string,
        rawProject: it.rawProject,
        row: it.row,
        name: it.name,
        buc: it.buc,
        id: ('id' in r ? r.id : '') || it.id || '',
        kind: r.kind,
        via: 'via' in r ? r.via : null,
        why: 'why' in r ? r.why : null,
        sheet: sheet || null,
        newSheet: r.kind === 'new' && r.newSheet,
        block: block ? { sheet: block.sheet, title: block.title, row: block.titleRow } : null,
        changed,
        link: links[linkKey(it.project, it.name)] ?? null,
        candidates,
      }
    })

    const projectNames = catalog.projects.filter((x) => !x.auto).map((x) => x.name)
    const projects = this.consum.projects.map((p) => {
      const pm = matchProject(p.name, catalog.projects)
      return {
        raw: p.name,
        rows: p.rows,
        matched: pm ? { name: pm.project.name, how: pm.project.auto ? ('adopted' as const) : pm.how, sheet: pm.project.sheet, sheetExists: sheetNames.includes(pm.project.sheet) } : null,
        suggestProject: !pm || pm.project.auto ? bestMatch(p.name, projectNames)?.name ?? null : null,
        suggestSheet: !pm || pm.project.auto ? bestMatch(p.name, sheetNames)?.name ?? null : null,
      }
    })
    const orphans = sarjele.blocks
      .filter((b) => !b.id && !claimed.has(b) && catalog.projects.some((p) => p.sheet === b.sheet))
      .map((b) => ({ sheet: b.sheet, title: b.title, row: b.titleRow }))
    return { source, elements, projects, sheets, orphans, registry: sarjele.registry.size }
  }
}
