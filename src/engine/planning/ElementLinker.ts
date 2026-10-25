/**
 * Кто есть кто: элемент Consum ↔ блок Sarjele.
 *
 * Порядок поиска:
 *   0. `@skip` в links.json — элемент не обрабатывается никогда;
 *   1. ID в колонке Consum → блок с этим ID;
 *   2. ID нет → реестр по проекту и названию (запись должна принадлежать этому Consum, см. `Ownership`);
 *   3. ручная привязка (links.json, вкладка «Связи»): «ПРОЕКТ|название» → заголовок блока или `@new`;
 *      блока с таким заголовком нет или команда неизвестна — элемент пропускается (не создаётся лишний блок);
 *   4. старый блок без ID на листе проекта с похожим названием → получает новый ID (миграция);
 *   5. ничего → новый блок с новым ID (буквы проекта + номер).
 * Сомнительные случаи (дубль ID, несколько похожих блоков, общий блок) пропускаются с причиной.
 */
import fs from 'node:fs'
import { message, MessageError, type Message } from '@/shared/messages'
import { cleanText, intersects, matchProject, titleTokens } from '@/shared/names'
import type { ConsumItem } from '../books/ConsumBook'
import type { Block, SarjeleBook } from '../books/SarjeleBook'
import type { Resolution } from './Planner'
import type { ProjectCatalog } from './ProjectCatalog'

/** Ручные привязки: ключ `linkKey(проект, элемент)` → заголовок блока, `@new` или `@skip`. */
export type Links = Record<string, string>

/** Сравнение названий без регистра. */
const norm = (x: unknown) => cleanText(x).toUpperCase()

/** Ключ привязки: «ПРОЕКТ|элемент» без учёта регистра и лишних пробелов. */
export const linkKey = (project: unknown, name: unknown): string => `${norm(project)}|${norm(name)}`

/**
 * links.json — ручные привязки элементов к блокам: `{ "ПРОЕКТ|элемент": "заголовок блока" | "@new" | "@skip" }`.
 *
 * Читается строго: испорченный файл (не JSON, не объект) — ошибка, прогон не выполняется. Иначе молча
 * пропали бы `@skip` и привязки, и программа записала бы элементы туда, куда оператор запретил.
 * Отдельные неверные строки (ключ без «|», значение не текст) пропускаются с предупреждением.
 * Допускаются: BOM в начале (Блокнот Windows), пустой файл, регистр и пробелы в ключах и командах.
 */
export class LinksFile {
  /** Привязки. */
  readonly links: Links
  /** Пропущенные строки. */
  readonly warnings: Message[]

  private constructor(links: Links, warnings: Message[]) {
    this.links = links
    this.warnings = warnings
  }

  /**
   * Файл как есть (объект ключ → значение); нет файла или он пуст — пустой объект.
   * @throws {MessageError} Файл не JSON или не объект.
   */
  static raw(file: string): Record<string, unknown> {
    if (!fs.existsSync(file)) return {}
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (!text.trim()) return {}
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch (e) {
      throw new MessageError(message('error.linksBroken', { error: (e as Error).message }))
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new MessageError(message('error.linksNotObject'))
    return data as Record<string, unknown>
  }

  /**
   * Читает и проверяет links.json.
   * @throws {MessageError} Файл не JSON или не объект.
   */
  static read(file: string): LinksFile {
    const links: Links = {}
    const warnings: Message[] = []
    for (const [key, value] of Object.entries(LinksFile.raw(file))) {
      const bar = key.indexOf('|')
      if (bar <= 0 || bar === key.length - 1) {
        warnings.push(message('warn.linksBadKey', { key }))
        continue
      }
      if (typeof value !== 'string' || !value.trim()) {
        warnings.push(message('warn.linksBadValue', { key }))
        continue
      }
      const k = linkKey(key.slice(0, bar), key.slice(bar + 1))
      if (k in links) warnings.push(message('warn.linksDuplicate', { key }))
      const v = value.trim()
      links[k] = v.startsWith('@') ? v.toLowerCase() : v
    }
    return new LinksFile(links, warnings)
  }
}

/**
 * Чей элемент: какой Consum ведёт запись реестра ID.
 *
 * Consum каждый месяц новый (копия прошлого с продолжением данных). Запись реестра принадлежит этому Consum, если:
 *   - она создана этим же файлом;
 *   - её прежний файл убран из списка программы («Хранилище»);
 *   - этот Consum — более поздний месяц той же цепочки.
 * Иначе строка с таким ID в Consum, скорее всего, скопирована из другого файла — она пропускается.
 */
export class Ownership {
  /** Имя текущего Consum. */
  readonly source: string
  /** Месяц текущего Consum («2026-09») или пусто. */
  readonly period: string
  /** Имена Consum из «Хранилища» или `null`. */
  private readonly active: ReadonlySet<string> | null

  constructor(source: string, active: ReadonlySet<string> | null, period: string) {
    this.source = source
    this.active = active
    this.period = period
  }

  /** Принадлежит ли запись с источником `source` и месяцем `period` текущему Consum. */
  mine(source: string, period: string): boolean {
    if (!source) return true
    return source === this.source || (this.active !== null && !this.active.has(source)) || (!!this.period && !!period && period < this.period)
  }
}

/** Связывает элементы Consum с блоками Sarjele и выдаёт новые ID. */
export class ElementLinker {
  private readonly blockById: Map<string, Block>
  private readonly claims = new Map<Block, number>()
  private readonly idCount = new Map<string, number>()
  private readonly usedIds: Set<string>
  private readonly claimedNow = new Set<Block>()
  private readonly items: readonly ConsumItem[]
  private readonly sarjele: SarjeleBook
  private readonly catalog: ProjectCatalog
  private readonly ownership: Ownership
  private readonly links: Links
  private readonly migrateOnly: boolean

  /**
   * @param items Элементы Consum с расходом.
   * @param migrateOnly Только привязать существующие блоки (новых не создавать).
   */
  constructor(items: readonly ConsumItem[], sarjele: SarjeleBook, catalog: ProjectCatalog, ownership: Ownership, links: Links, migrateOnly: boolean) {
    this.items = items
    this.sarjele = sarjele
    this.catalog = catalog
    this.ownership = ownership
    this.links = links
    this.migrateOnly = migrateOnly
    this.blockById = new Map(sarjele.blocks.filter((b) => b.id).map((b) => [b.id, b]))
    for (const it of items) for (const b of this.legacyBlocks(it)) this.claims.set(b, (this.claims.get(b) ?? 0) + 1)
    for (const it of items) if (it.id) this.idCount.set(it.id, (this.idCount.get(it.id) ?? 0) + 1)
    this.usedIds = new Set([...sarjele.registry.keys(), ...items.map((i) => i.id).filter(Boolean)])
  }

  /** Блоки без ID на листе проекта, похожие на элемент по названию. */
  legacyBlocks(it: ConsumItem): Block[] {
    const sheet = it.project ? this.catalog.sheetOf(it.project) : null
    const tk = titleTokens(it.name)
    return sheet ? this.sarjele.blocks.filter((b) => b.sheet === sheet && !b.id && intersects(tk, titleTokens(b.title))) : []
  }

  /** Новый ID проекта: следующий номер после занятых. */
  private nextId(project: string): string {
    const pre = this.catalog.prefixOf(project)
    const n = Math.max(0, ...[...this.usedIds].filter((x) => x.startsWith(pre + '-')).map((x) => Number(x.slice(pre.length + 1))))
    const id = `${pre}-${String(n + 1).padStart(4, '0')}`
    this.usedIds.add(id)
    return id
  }

  /** Связь элемента с блоком. */
  resolve(it: ConsumItem): Resolution {
    const link = this.links[linkKey(it.project, it.name)]
    const cp = it.project ? this.catalog.get(it.project) : null
    const sheet = cp?.sheet
    if (!cp) return { kind: 'skip', why: message('skip.projectNotConfigured', { project: it.project ?? '' }) }
    if (!sheet) return { kind: 'skip', why: message('skip.noSheet') }
    if (link === '@skip') return { kind: 'skip', why: message('skip.manual'), manual: true }
    const sheetExists = this.sarjele.sheets.includes(sheet)
    if (!sheetExists && !cp.create) return { kind: 'skip', why: message('skip.sheetNotFound', { sheet }) }
    if (it.badId) return { kind: 'skip', why: message('skip.badId', { id: it.badId }) }
    if (it.id && (this.idCount.get(it.id) ?? 0) > 1) return { kind: 'skip', why: message('skip.duplicateId', { id: it.id }) }
    let id = it.id
    let reg = id ? this.sarjele.registry.get(id) ?? null : null
    if (!id) {
      // ID в Consum ещё нет (новая строка или запись ID не удалась) — ищем по названию в реестре
      reg = [...this.sarjele.registry.values()].find((r) =>
        (matchProject(r.project, this.catalog.projects)?.project.name ?? r.project) === it.project
        && norm(r.name) === norm(it.name)
        && this.ownership.mine(r.source, r.period)
        && !this.items.some((o) => o !== it && o.id === r.id)) ?? null
      if (reg) id = reg.id
    }
    if (id && reg && !this.ownership.mine(reg.source, reg.period)) return { kind: 'skip', why: message('skip.foreignId', { id, source: reg.source }) }
    if (id) {
      const b = this.blockById.get(id)
      if (!b) return { kind: 'skip', why: message('skip.blockNotFound', { id }) }
      if (this.claimedNow.has(b)) return { kind: 'skip', why: message('skip.blockTaken', { id }) }
      this.claimedNow.add(b)
      return { kind: 'known', via: it.id ? 'id' : 'registry', id, block: b, reg, backfill: !it.id, adopt: !!reg && reg.source !== this.ownership.source, rename: !!reg && norm(reg.name) !== norm(it.name) }
    }
    const project = it.project!
    const linkTitle = link
    if (linkTitle === '@new') return { kind: 'new', via: 'link', id: this.nextId(project), backfill: true, newSheet: !sheetExists }
    if (linkTitle?.startsWith('@')) return { kind: 'skip', why: message('skip.linkUnknown', { value: linkTitle }), manual: true }
    const cands = linkTitle ? this.sarjele.blocks.filter((b) => b.sheet === sheet && !b.id && norm(b.title) === norm(linkTitle)) : this.legacyBlocks(it)
    // ручная привязка к блоку, которого нет (опечатка, у блока уже есть ID): не создаём лишний блок
    if (linkTitle && !cands.length) return { kind: 'skip', why: message('skip.linkNotFound', { title: linkTitle, sheet }), manual: true }
    if (cands.length === 1 && (linkTitle || this.claims.get(cands[0]!) === 1) && !this.claimedNow.has(cands[0]!)) {
      this.claimedNow.add(cands[0]!)
      return { kind: 'migrate', via: linkTitle ? 'link' : 'name', id: this.nextId(project), block: cands[0]!, backfill: true }
    }
    if (cands.length > 1) return { kind: 'skip', why: message('skip.ambiguous', { blocks: cands.map((c) => `«${c.title}»`).slice(0, 3).join(', ') }) }
    if (cands.length === 1) return { kind: 'skip', why: message('skip.sharedBlock', { title: cands[0]!.title }) }
    return this.migrateOnly ? { kind: 'skip', why: message('skip.migrateNoBlock') } : { kind: 'new', via: 'new', id: this.nextId(project), backfill: true, newSheet: !sheetExists }
  }
}
