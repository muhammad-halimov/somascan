/**
 * Сопоставление названий: проекты Consum ↔ проекты программы, варианты названия блока, буквы ID.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoIdPrefix, bestMatch, idPrefix, matchProject, safeSheetName, similarity, titleTokens } from '../src/shared/names'

const projects = [
  { name: 'PETRA DATE', aliases: ['Petra_2025'] },
  { name: 'NORD INFRA', aliases: [] },
]

test('проект узнаётся по имени, алиасу и без года / регистра / знаков', () => {
  assert.equal(matchProject('PETRA DATE', projects)?.how, 'exact')
  assert.equal(matchProject('petra_2025', projects)?.project.name, 'PETRA DATE')
  assert.deepEqual(matchProject('Nord Infra 2026', projects), { project: projects[1], how: 'auto' })
  assert.equal(matchProject('SOMACO', projects), null)
  assert.equal(matchProject('', projects), null)
})

test('варианты названия блока «ST_100.110»', () => {
  assert.deepEqual([...titleTokens('ST_100.110')].sort(), ['ST_100', 'ST_100.110', 'ST_110'])
  assert.deepEqual([...titleTokens(' rec_4100 ')], ['REC_4100'])
})

test('похожесть и лучшее совпадение', () => {
  assert.equal(similarity('ABC', 'abc'), 1)
  assert.ok(similarity('GR_A12', 'GR_A12_40M') > 0.5)
  assert.equal(bestMatch('Nord', ['NORD INFRA', 'PETRA'])?.name, 'NORD INFRA')
  assert.equal(bestMatch('XYZ', ['NORD INFRA']), null)
})

test('буквы ID и имя листа', () => {
  assert.equal(autoIdPrefix('NORD INFRA'), 'NI')
  assert.equal(autoIdPrefix('Petra'), 'PE')
  assert.equal(autoIdPrefix('Объект'), 'XX')
  assert.equal(idPrefix('NORD INFRA', 'ab1c'), 'ABC')
  assert.equal(idPrefix('NORD INFRA', 'q'), 'QX')
  assert.equal(safeSheetName('A/B:C*D?'), 'A B C D')
  assert.equal(safeSheetName('x'.repeat(40)).length, 31)
})
