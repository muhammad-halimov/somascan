/**
 * Проекты прогона: настроенные в программе плюс новые, которые движок подключил сам из Consum.
 *
 * Новый проект в Consum (название вписано в готовый слот) получает лист Sarjele: похожий по названию, иначе —
 * новый с этим именем (создаётся при записи). Так оператору не нужно ничего настраивать для нового объекта.
 */
import { bestMatch, idPrefix, matchProject, projectKey, safeSheetName, type ProjectMatch } from '@/shared/names'
import type { EngineProject } from '../EngineOptions'
import { REGISTRY_SHEET } from '../books/SarjeleBook'

/** Запасные листы Sarjele («1», «new», «шаблон») — не берутся как похожие по названию. */
const SPARE_SHEET = /^(\d+|new|template|шаблон)$/i
/** Служебные «названия» в колонке проектов Consum, которые не проекты. */
const NOT_A_PROJECT = /^(proiect|project|nume proiect|total)$/i

/** Проект из Consum: название, есть ли видимые строки. */
export interface RawProject {
  name: string
  visible: boolean
}

/** Проекты прогона. */
export class ProjectCatalog {
  /** Все проекты: настроенные и подключённые сами. */
  readonly projects: EngineProject[]
  /** Проекты программы, чьи названия есть в этом Consum. */
  readonly present = new Set<string>()
  /** Листы Sarjele (после чтения). */
  sheetNames: string[] = []
  /** @param projects Настроенные проекты. */
  constructor(projects: readonly EngineProject[]) {
    this.projects = [...projects]
  }

  /** Проект по имени. */
  get(name: string): EngineProject | null {
    return this.projects.find((p) => p.name === name) ?? null
  }

  /** Лист Sarjele проекта. */
  sheetOf(name: string): string | null {
    return this.get(name)?.sheet || null
  }

  /** Обрабатывать ли проект. */
  isEnabled(name: string): boolean {
    const p = this.get(name)
    return !!p && p.enabled !== false
  }

  /** Проект программы по названию из Consum. */
  match(raw: string): ProjectMatch<EngineProject> | null {
    return matchProject(raw, this.projects)
  }

  /** Буквы ID проекта. */
  prefixOf(project: string): string {
    return idPrefix(project, this.get(project)?.prefix)
  }

  /**
   * Отмечает проекты, которые есть в Consum, и подключает новые (если разрешено).
   * @returns Подключённые проекты: «как в Consum» → имя проекта.
   */
  adopt(raw: readonly RawProject[], autoProjects: boolean): Map<string, string> {
    const added = new Map<string, string>()
    for (const p of raw) {
      const m = this.match(p.name)
      if (m) {
        if (p.visible) this.present.add(m.project.name)
        continue
      }
      if (!p.visible || !autoProjects || NOT_A_PROJECT.test(p.name.trim()) || !safeSheetName(p.name)) continue
      const like = bestMatch(p.name, this.sheetNames.filter((n) => !SPARE_SHEET.test(n) && n !== REGISTRY_SHEET), projectKey, 0.8)
      const project: EngineProject = { name: p.name, aliases: [], sheet: like?.name ?? safeSheetName(p.name), prefix: '', enabled: true, create: true, auto: true }
      this.projects.push(project)
      this.present.add(project.name)
      added.set(p.name, project.name)
    }
    return added
  }

  /** Листы проектов, которые есть в Consum, но ещё не созданы в Sarjele. */
  missingSheets(): string[] {
    return [...this.present].map((n) => this.get(n)).filter((c): c is EngineProject => !!c && this.isEnabled(c.name) && c.create && !!c.sheet && !this.sheetNames.includes(c.sheet)).map((c) => c.sheet)
  }
}
