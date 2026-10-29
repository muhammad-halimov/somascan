/**
 * Подсказка «Не распозналось? Поверните или переснимите»: только у распознанной бирки с фото,
 * когда пусты обязательные поля или распознавание советует переснять.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultLabelFields } from '../src/features/recognition/label/labelFields'
import type { ScanItem } from '../src/features/workspace/hooks/useScanSession'
import { needsRetakeHint } from '../src/features/workspace/utils/retakeHint'

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

test('всё распознано — подсказки нет', () => {
  assert.equal(needsRetakeHint(item(), fields), false)
})

test('пусто обязательное поле или советуют переснять — подсказка есть', () => {
  assert.equal(needsRetakeHint(item({ status: { kind: 'done', label: { ...full, heat: null }, photo: { retake: false, issues: [] } } }), fields), true)
  assert.equal(needsRetakeHint(item({ status: { kind: 'done', label: full, photo: { retake: true, issues: ['blurry'] } } }), fields), true)
})

test('без фото, без бирки, пока распознаётся — подсказки нет', () => {
  assert.equal(needsRetakeHint(null, fields), false)
  assert.equal(needsRetakeHint(item({ manual: true, photoUrl: '', status: { kind: 'done', label: {}, photo: { retake: false, issues: [] } } }), fields), false)
  assert.equal(needsRetakeHint(item({ status: { kind: 'recognizing' } }), fields), false)
})
