/**
 * Распределение расхода по плавкам и принадлежность записей реестра.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Heat, ProbeHeats } from '../src/engine/books/ProbeBook'
import { Ownership } from '../src/engine/planning/ElementLinker'
import { HeatAllocator } from '../src/engine/planning/HeatAllocator'

/** Плавка Ø8 Bobina. */
const heat = (sarja: string, supplied: number, order: number, closed = false): Heat => ({ sarja, producer: 'P', dia: 8, form: 'Bobina', supplied, rows: [], closed, order })

function probe(...heats: Heat[]): ProbeHeats {
  return { heats: new Map(heats.map((h) => [h.sarja, h])), journal: new Set() }
}

test('latest: с последней использованной, потом новее, потом старые', () => {
  const p = probe(heat('A', 100, 0), heat('B', 100, 1), heat('C', 100, 2))
  const used = new Map([['B', 50]])
  const events = [{ key: '8|Bobina', sarja: 'B', date: new Date(2026, 9, 1), seq: 0 }]
  const al = new HeatAllocator(p, used, events, 'latest', new Set())
  const { lines, left } = al.allocate('X', 8, 'Bobina', 200)
  assert.deepEqual(lines.map((l) => [l.sarja, l.kg]), [['B', 50], ['C', 100], ['A', 50]])
  assert.equal(left, 0)
  assert.deepEqual([...al.toClose].sort(), ['B', 'C'])
  assert.deepEqual([...al.skippedOld()], [['8|Bobina', ['A(50)']]], 'A старше текущей B и не закрыта — в списке «заброшенных»')
})

test('oldest: с самой старой незакрытой', () => {
  const p = probe(heat('A', 100, 0), heat('B', 100, 1))
  const events = [{ key: '8|Bobina', sarja: 'B', date: new Date(2026, 9, 1), seq: 0 }]
  assert.equal(new HeatAllocator(p, new Map(), events, 'oldest', new Set()).allocate('X', 8, 'Bobina', 10).lines[0]!.sarja, 'A')
})

test('закрытые жёлтым пропускаются, нехватка считается', () => {
  const p = probe(heat('A', 100, 0, true), heat('B', 30, 1))
  const al = new HeatAllocator(p, new Map(), [], 'latest', new Set())
  const r = al.allocate('X', 8, 'Bobina', 50)
  assert.deepEqual(r.lines.map((l) => l.sarja), ['B'])
  assert.equal(r.left, 20)
  assert.deepEqual(al.freeAndClosed(8, 'Bobina'), { free: 0, closedLeft: 100 })
})

test('чья запись реестра', () => {
  const o = new Ownership('Consum_nov.xlsx', new Set(['Consum_nov.xlsx', 'Consum_okt.xlsx']), '2026-11')
  assert.equal(o.mine('', ''), true, 'без источника — ничья, берём')
  assert.equal(o.mine('Consum_nov.xlsx', '2026-11'), true)
  assert.equal(o.mine('Consum_okt.xlsx', '2026-10'), true, 'прошлый месяц той же цепочки')
  assert.equal(o.mine('Consum_dec.xlsx', '2026-12'), true, 'файл убран из «Хранилища»')
  assert.equal(o.mine('Consum_okt.xlsx', '2026-12'), false, 'активный файл более позднего месяца — чужой')
})
