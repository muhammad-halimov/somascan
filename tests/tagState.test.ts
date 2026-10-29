/**
 * Состояние бирки для значков в сетке и у номеров бирок: оранжевый «!» — у бирки, которая ждёт действий.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultLabelFields } from '../src/features/recognition/label/labelFields'
import type { ScanItem } from '../src/features/workspace/hooks/useScanSession'
import type { HeatDuplicate } from '../src/features/workspace/utils/sendReadiness'
import { needsAttention, tagState } from '../src/features/workspace/utils/tagState'

const fields = createDefaultLabelFields()
const full = { producer: 'Sovel', size: '8 mm', heat: '5800', weight_kg: 1990, product_form: 'bara' }
const none = new Map<string, HeatDuplicate>()

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

test('готовая бирка — без «!»', () => {
  assert.equal(tagState(item(), fields, none), 'done')
  assert.equal(needsAttention('done'), false)
})

test('нет формы, пусто обязательное поле, повтор плавки, нет фото — «!»', () => {
  const done = (label: Record<string, unknown>) => ({ kind: 'done' as const, label, photo: { retake: false, issues: [] } })
  const states = [
    tagState(item({ status: done({ ...full, product_form: null }) }), fields, none),
    tagState(item({ status: done({ ...full, heat: null }) }), fields, none),
    tagState(item(), fields, new Map<string, HeatDuplicate>([['scan-1', { kind: 'tag', number: 1 }]])),
    tagState(item({ photoUrl: '' }), fields, none),
  ]
  assert.deepEqual(states, ['noForm', 'incomplete', 'incomplete', 'noPhoto'])
  assert.ok(states.every(needsAttention))
})

test('распознаётся или ошибка — не «!»', () => {
  assert.equal(needsAttention(tagState(item({ status: { kind: 'recognizing' } }), fields, none)), false)
  assert.equal(needsAttention(tagState(item({ hasError: true }), fields, none)), false)
})
