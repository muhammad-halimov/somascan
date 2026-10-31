/**
 * Правила распознавания на устройстве («Расширенные» → «Правила»): подписи полей по умолчанию, чистка и сравнение
 * подписей, хранение только изменённых, экспорт и импорт JSON, и что распознавание берёт подписи из настроек.
 * Запуск: `npm test`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultLabelFields } from '../src/features/recognition/label/labelFields'
import { companyDomains } from '../src/features/recognition/ocr/domainProducer'
import { extractLabel } from '../src/features/recognition/ocr/LabelExtractor'
import type { OcrPage } from '../src/features/recognition/ocr/ocrTypes'
import {
  compactRuleLabels, DEFAULT_RULE_LABELS, isDefaultRuleLabels, normalizeRuleLabels, parseRulesJson, ruleLabelsFor, rulesToJson, NON_FIELD_RULE_KEYS,
} from '../src/features/recognition/ocr/ruleLabels'
import { matchSupplier } from '../src/features/recognition/ocr/supplierMatch'
import { providerRegistry } from '../src/features/recognition/providers/ProviderRegistry'
import { createDefaultSettings, parseSettings } from '../src/features/settings/store/settingsSchema'

const FIELDS = createDefaultLabelFields().filter((field) => !field.manual).map((field) => ({ ...field, enabled: true }))

/** Страница из строк: текст, x и y в долях страницы 1000×1000. */
function page(rows: ReadonlyArray<[string, number, number]>): OcrPage {
  return {
    rotation: 0,
    width: 1000,
    height: 1000,
    lines: rows.map(([text, x, y]) => {
      const [left, top, right, bottom] = [x * 1000, y * 1000, (x + text.length * 0.012) * 1000, (y + 0.03) * 1000]
      return { text, corners: [left, top, right, top, right, bottom, left, bottom], confidence: 0.9 }
    }),
  }
}

test('подписи по умолчанию есть у каждого встроенного поля, читаемого с фото', () => {
  const builtIn = FIELDS.filter((field) => field.builtIn).map((field) => field.key)
  assert.deepEqual(builtIn.filter((key) => !(key in DEFAULT_RULE_LABELS)), [])
  assert.ok(DEFAULT_RULE_LABELS.heat!.includes('heat no'))
})

test('чистка: пробелы, пустые, повторы в сравнении на бирке («Heat No» = «heat no:»), предел длины', () => {
  assert.deepEqual(normalizeRuleLabels(['  Heat  No ', 'heat no:', '', 'x', 'Şarjă', 'SARJA', 42]), ['Heat No', 'Şarjă'])
  assert.equal(normalizeRuleLabels(['a'.repeat(100)])[0]!.length, 60)
  assert.ok(isDefaultRuleLabels('heat', [...DEFAULT_RULE_LABELS.heat!].reverse().map((label) => label.toUpperCase())))
  assert.ok(!isDefaultRuleLabels('heat', ['heat']))
})

test('хранятся только изменённые поля; неизвестные ключи и стандартные списки отбрасываются', () => {
  assert.deepEqual(compactRuleLabels({ heat: ['Heat', 'Nr. șarjă'], weight_kg: [...DEFAULT_RULE_LABELS.weight_kg!], nonsense: ['x y'] }), { heat: ['Heat', 'Nr. șarjă'] })
  assert.deepEqual(ruleLabelsFor({ heat: ['Heat'] }, 'heat'), ['Heat'])
  assert.deepEqual(ruleLabelsFor({}, 'size'), DEFAULT_RULE_LABELS.size)
  const defaults = createDefaultSettings(providerRegistry)
  assert.deepEqual(defaults.advanced.ruleLabels, {})
  assert.deepEqual(parseSettings({ advanced: { ruleLabels: { heat: ['Lot sarja'], size: 'мусор' } } }, defaults).advanced.ruleLabels, { heat: ['Lot sarja'] })
})

test('экспорт — все поля целиком; импорт читает его и простой объект; не правила — null', () => {
  const json = rulesToJson({ heat: ['Heat', 'Nr. șarjă'] })
  const parsed = parseRulesJson(`﻿${json}`)!
  assert.deepEqual(parsed.heat, ['Heat', 'Nr. șarjă'])
  assert.deepEqual(parsed.size, DEFAULT_RULE_LABELS.size)
  assert.deepEqual(parseRulesJson('{"batch": ["Lot no"]}'), { batch: ['Lot no'] })
  assert.equal(parseRulesJson('[1, 2]'), null)
  assert.equal(parseRulesJson('{"unknown": ["x y"]}'), null)
  assert.equal(parseRulesJson('не JSON'), null)
})

test('распознавание берёт подписи из правил: своя подпись находит поле, убранная — нет', () => {
  const rows: Array<[string, number, number]> = [['Numar topire: 4417721', 0.1, 0.1], ['Greutate: 1990 kg', 0.1, 0.2]]
  const read = (ruleLabels?: Record<string, string[]>) => extractLabel({ page: page(rows), codes: [], fields: FIELDS, suppliers: [], ruleLabels }).label
  assert.equal(read().heat, null, '«numar topire» нет в стандартных подписях')
  assert.equal(read({ heat: [...DEFAULT_RULE_LABELS.heat!, 'Numar topire'] }).heat, '4417721')
  assert.equal(read().weight_kg, 1990)
  assert.equal(read({ weight_kg: ['net weight'] }).weight_kg, null, 'подпись «greutate» убрана — строка с ней больше не вес')
})

test('правила, которые не подписи полей: у каждого есть список по умолчанию; хранятся, экспортируются и импортируются как подписи полей', () => {
  for (const key of NON_FIELD_RULE_KEYS) assert.ok((DEFAULT_RULE_LABELS[key] ?? []).length > 0, key)
  assert.deepEqual(compactRuleLabels({ house_supplier: ['Depozit Nord'], strand_words: [...DEFAULT_RULE_LABELS.strand_words!] }), { house_supplier: ['Depozit Nord'] })
  const parsed = parseRulesJson(rulesToJson({ free_mail_domains: ['mailbox'] }))!
  assert.deepEqual(parsed.free_mail_domains, ['mailbox'])
  assert.deepEqual(parsed.strand_lot_masks, DEFAULT_RULE_LABELS.strand_lot_masks)
})

test('общие слова в названиях и бесплатная почта — из правил', () => {
  // «Moldova» — общее слово: по нему одному «Moldova Steel Works» не узнаётся, пока его не уберут из правила
  assert.equal(matchSupplier('MOLDOVA', ['Moldova Steel Works']), null)
  assert.equal(matchSupplier('MOLDOVA', ['Moldova Steel Works'], [])?.name, 'Moldova Steel Works')
  assert.deepEqual(companyDomains(['sales@sovel.gr', 'office@mailbox.org']), ['sovel', 'mailbox'])
  assert.deepEqual(companyDomains(['sales@sovel.gr', 'office@mailbox.org'], ['mailbox']), ['sovel'])
})
