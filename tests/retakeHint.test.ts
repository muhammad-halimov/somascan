/**
 * Подсказка над фото: только у распознанной бирки с фото, когда пусты обязательные поля или распознавание
 * советует переснять; текст — по первой проблеме фото (`PHOTO_ISSUES`), иначе «не все поля распознаны».
 * Прочтение на устройстве само называет проблемы: повёрнутое фото и неуверенный (мелкий, бледный) текст.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { PhotoIssue } from '../src/features/recognition/image/PhotoQuality'
import { createDefaultLabelFields } from '../src/features/recognition/label/labelFields'
import type { OcrPage } from '../src/features/recognition/ocr/ocrTypes'
import { readingIssues } from '../src/features/recognition/ocr/readingAdvice'
import type { ScanItem } from '../src/features/workspace/hooks/useScanSession'
import { retakeHintReason } from '../src/features/workspace/utils/retakeHint'

const fields = createDefaultLabelFields()
const full = { producer: 'Sovel', size: '8 mm', heat: '5800', weight_kg: 1990 }

const item = (patch: Partial<ScanItem> = {}): ScanItem => ({
  id: 'scan-1',
  photoUrl: 'blob:photo',
  thumbUrl: null,
  naturalSize: null,
  isLoading: false,
  hasError: false,
  rotation: 0,
  status: { kind: 'done', label: full, photo: { retake: false, issues: [] } },
  manualValues: {},
  selected: true,
  manual: false,
  ...patch,
})

/** Бирка с пустой плавкой и такими проблемами фото. */
const missingHeat = (issues: PhotoIssue[], retake = false) =>
  item({ status: { kind: 'done', label: { ...full, heat: null }, photo: { retake, issues } } })

test('всё распознано — подсказки нет, даже если прочтение что-то советует', () => {
  assert.equal(retakeHintReason(item(), fields), null)
  assert.equal(retakeHintReason(item({ status: { kind: 'done', label: full, photo: { retake: false, issues: ['far'] } } }), fields), null)
})

test('причина — первая проблема фото по важности, иначе «не все поля распознаны»', () => {
  assert.equal(retakeHintReason(missingHeat([]), fields), 'missing')
  assert.equal(retakeHintReason(missingHeat(['far']), fields), 'far')
  assert.equal(retakeHintReason(missingHeat(['far', 'rotated']), fields), 'rotated')
  assert.equal(retakeHintReason(item({ status: { kind: 'done', label: full, photo: { retake: true, issues: ['blurry'] } } }), fields), 'blurry')
  assert.equal(retakeHintReason(item({ status: { kind: 'done', label: {}, photo: { retake: true, issues: ['noTag'] } } }), fields), 'noTag')
})

test('без фото, без бирки, пока распознаётся — подсказки нет', () => {
  assert.equal(retakeHintReason(null, fields), null)
  assert.equal(retakeHintReason(item({ manual: true, photoUrl: '', status: { kind: 'done', label: {}, photo: { retake: false, issues: [] } } }), fields), null)
  assert.equal(retakeHintReason(item({ status: { kind: 'recognizing' } }), fields), null)
})

test('прочтение на устройстве: повёрнутое фото — «rotated», неуверенный текст (BPM, настоящее чтение) — «far», хорошая бирка — ничего', () => {
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/ocr/${name}.json`, import.meta.url), 'utf8')) as OcrPage
  assert.deepEqual(readingIssues(fixture('bpm-strand'), 0), ['far'])
  assert.deepEqual(readingIssues(fixture('suez'), 0), [])
  assert.deepEqual(readingIssues(fixture('suez'), 1), ['rotated'])
  assert.deepEqual(readingIssues({ ...fixture('suez'), rotation: 90 }, 0), ['rotated'])
})
