/**
 * Распределение расхода по плавкам Probe.
 *
 * Плавки одного Ø и формы идут в порядке журнала. «Текущая» плавка — та, которой писали последней (по дате
 * блока, при равенстве — по порядку в файле); правило `oldest` начинает с самой старой незакрытой. Расход берётся с текущей и более новых, а если не хватило — со старых.
 * Закрытые (жёлтые) и уже израсходованные плавки пропускаются.
 *
 * Остаток плавки = поставлено − расход в Sarjele (`used` меняется по ходу плана).
 */
import type { HeatRule } from '@/shared/settings'
import type { Heat, ProbeHeats } from '../books/ProbeBook'
import type { HeatEvent } from '../books/SarjeleBook'
import type { PlanLine } from './Planner'

/** Списание с плавок по одному коду. */
export interface Allocation {
  lines: PlanLine[]
  /** Не хватило, кг. */
  left: number
}

/** Плавки по (Ø, форма) и расход по ним. */
export class HeatAllocator {
  /** Плавки по ключу «Ø|форма», в порядке журнала. */
  readonly byKey = new Map<string, Heat[]>()
  private readonly lastUsed = new Map<string, string>()
  /** Плавки. */
  readonly probe: ProbeHeats
  /** Расход по плавкам (меняется при распределении). */
  readonly used: Map<string, number>
  /** Правило выбора плавки. */
  readonly rule: HeatRule
  /** Плавки, которые закроются этим прогоном. */
  readonly toClose: Set<string>

  /**
   * @param probe Плавки.
   * @param used Расход по плавкам (меняется при распределении).
   * @param events История списаний (для «последней использованной»).
   * @param rule Правило выбора плавки.
   * @param toClose Плавки, которые закроются этим прогоном (пополняется).
   */
  constructor(probe: ProbeHeats, used: Map<string, number>, events: readonly HeatEvent[], rule: HeatRule, toClose: Set<string>) {
    this.probe = probe
    this.used = used
    this.rule = rule
    this.toClose = toClose
    for (const s of [...probe.heats.values()].sort((a, b) => a.order - b.order)) {
      const k = `${s.dia}|${s.form}`
      if (!this.byKey.has(k)) this.byKey.set(k, [])
      this.byKey.get(k)!.push(s)
    }
    const ordered = [...events].sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0) || a.seq - b.seq)
    for (const e of ordered) this.lastUsed.set(e.key, e.sarja)
  }

  /** Остаток плавки. */
  remaining(s: Heat): number {
    return s.supplied - (this.used.get(s.sarja) ?? 0)
  }

  /** С какой плавки списка начинать. */
  startOf(key: string, list: readonly Heat[]): number {
    if (this.rule === 'oldest') return 0
    const i = list.findIndex((s) => s.sarja === this.lastUsed.get(key))
    return i < 0 ? 0 : i
  }

  /** Старые незакрытые плавки с остатком, которые пропускаются правилом `latest`: «Ø|форма» → «плавка(остаток)». */
  skippedOld(): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const [key, list] of this.byKey) {
      const st = this.startOf(key, list)
      const older = list.slice(0, st).filter((s) => !s.closed && this.remaining(s) > 0)
      if (older.length) out.set(key, older.map((s) => `${s.sarja}(${this.remaining(s)})`))
    }
    return out
  }

  /** Списывает `kg` кода материала с плавок. */
  allocate(code: string, dia: number | null, form: 'Bobina' | 'Bara', kg: number): Allocation {
    let left = kg
    const lines: PlanLine[] = []
    const list = this.byKey.get(`${dia}|${form}`) ?? []
    const st = this.startOf(`${dia}|${form}`, list)
    // сначала текущая и новее, потом (если не хватило) старые
    for (const s of [...list.slice(st), ...list.slice(0, st)]) {
      if (left <= 0) break
      const rem = this.remaining(s)
      if (s.closed || this.toClose.has(s.sarja) || rem <= 0) continue
      const take = Math.min(rem, left)
      lines.push({ model: code, dia, form, sarja: s.sarja, name: s.producer, kg: take, before: rem })
      this.used.set(s.sarja, (this.used.get(s.sarja) ?? 0) + take)
      left -= take
      if (this.remaining(s) <= 0) this.toClose.add(s.sarja)
    }
    return { lines, left }
  }

  /** Свободно в открытых плавках и числится в закрытых — для сообщения о нехватке. */
  freeAndClosed(dia: number | null, form: string): { free: number; closedLeft: number } {
    const list = this.byKey.get(`${dia}|${form}`) ?? []
    return {
      free: list.filter((s) => !s.closed && !this.toClose.has(s.sarja)).reduce((a, s) => a + Math.max(0, this.remaining(s)), 0),
      closedLeft: list.filter((s) => s.closed).reduce((a, s) => a + Math.max(0, this.remaining(s)), 0),
    }
  }
}
