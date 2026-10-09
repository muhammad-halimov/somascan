/**
 * «Далее»: какая бирка готова к отправке и что уходит в очередь (свой лист — только при включённом поле).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultLabelFields, type LabelRecord } from '../src/features/recognition/label/labelFields'
import type { ScanItem } from '../src/features/workspace/hooks/useScanSession'
import { awaitsPhoto, isReadyToSend, labelForQueue, missingRequiredFields } from '../src/features/workspace/utils/sendReadiness'

const fields = createDefaultLabelFields()
const done = (label: LabelRecord, extra: Partial<ScanItem> = {}): ScanItem => ({
  id: 'scan-1', photoUrl: 'blob:photo', thumbUrl: null, naturalSize: null, isLoading: false, hasError: false,
  status: { kind: 'done', label, photo: { retake: false, issues: [] } }, manualValues: {}, selected: true, manual: false, ...extra,
})

test('распознанная бирка готова, когда выбрана форма', () => {
  assert.equal(isReadyToSend(done({ heat: '1', product_form: null }), fields), false)
  assert.equal(isReadyToSend(done({ heat: '1', product_form: 'bara' }), fields), true)
})

test('бирка без фото: обязательны поля по умолчанию; ждущая фото — не готова', () => {
  const manual = done({ product_form: 'bobina', producer: 'Sovel' }, { manual: true, photoUrl: '' })
  assert.deepEqual(missingRequiredFields(manual, fields).map((field) => field.key), ['size', 'heat', 'weight_kg'])
  assert.equal(isReadyToSend(manual, fields), false)
  const filled = done({ product_form: 'bobina', producer: 'Sovel', size: '10', heat: '1', weight_kg: 5 }, { manual: true, photoUrl: '' })
  assert.equal(isReadyToSend(filled, fields), true)
  const waiting = done({ product_form: 'bara' }, { photoUrl: '' })
  assert.equal(awaitsPhoto(waiting), true)
  assert.equal(isReadyToSend(waiting, fields), false)
})

test('свой лист уходит в очередь, только если поле «Лист» включено и лист выбран', () => {
  const label = { heat: '1', sheet: '2025' }
  assert.deepEqual(labelForQueue(label, fields), { heat: '1' }, 'поле выключено — лист из настроек')
  const withSheet = fields.map((field) => (field.key === 'sheet' ? { ...field, enabled: true } : field))
  assert.deepEqual(labelForQueue(label, withSheet), { heat: '1', sheet: '2025' })
  assert.deepEqual(labelForQueue({ heat: '1', sheet: '' }, withSheet), { heat: '1' }, 'не выбран — как в настройках')
})
