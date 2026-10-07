/**
 * Проверки разбора ответа модели: поля и оценка качества фото (`_photo`).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergePhotoIssues } from '../src/features/recognition/image/PhotoQuality'
import { LabelParser } from '../src/features/recognition/label/LabelParser'

const parser = new LabelParser()

test('поля и оценка фото', () => {
  const answer = '```json\n{"heat": " 251216 ", "weight_kg": 2140, "extra": 1, "_photo": {"ok": false, "issues": ["glare", "blurry", "glare", "weird"]}}\n```'
  const { label, photo } = parser.parseAnswer(answer, ['heat', 'weight_kg', 'batch'])
  assert.deepEqual(label, { heat: '251216', weight_kg: 2140, batch: null })
  assert.deepEqual(photo, { ok: false, issues: ['glare', 'blurry'] })
})

test('без оценки фото — фото в порядке', () => {
  assert.deepEqual(parser.parseAnswer('{"heat": null}', ['heat']).photo, { ok: true, issues: [] })
  assert.deepEqual(parser.parseAnswer('{"_photo": "bad"}', ['heat']).photo, { ok: true, issues: [] })
})

test('объединение проблем без повторов, в порядке показа', () => {
  assert.deepEqual(mergePhotoIssues(['glare', 'blurry'], ['dark', 'blurry']), ['blurry', 'glare', 'dark'])
})
