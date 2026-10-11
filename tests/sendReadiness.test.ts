/**
 * «Далее»: какая бирка готова к отправке и что уходит в очередь (свой лист — только при включённом поле).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultLabelFields, type LabelRecord } from '../src/features/recognition/label/labelFields'
import type { ScanItem } from '../src/features/workspace/hooks/useScanSession'
import { awaitsPhoto, heatDuplicates, isReadyToSend, labelForQueue, missingRequiredFields } from '../src/features/workspace/utils/sendReadiness'

const fields = createDefaultLabelFields()
const done = (label: LabelRecord, extra: Partial<ScanItem> = {}): ScanItem => ({
  id: 'scan-1', photoUrl: 'blob:photo', thumbUrl: null, naturalSize: null, isLoading: false, hasError: false,
  status: { kind: 'done', label, photo: { retake: false, issues: [] } }, manualValues: {}, selected: true, manual: false, ...extra,
})

test('распознанная бирка готова, когда выбрана форма и заполнены поля по умолчанию', () => {
  const recognized = { producer: 'OAM', size: '12', heat: '1', weight_kg: 2650 }
  assert.equal(isReadyToSend(done({ ...recognized, product_form: null }), fields), false)
  assert.equal(isReadyToSend(done({ ...recognized, product_form: 'bara' }), fields), true)
  // Модель не прочитала вес и плавку — их дописывают в правке, пока бирка не готова.
  const partial = done({ producer: 'OAM', size: '12', heat: null, weight_kg: '', product_form: 'bara' })
  assert.deepEqual(missingRequiredFields(partial, fields).map((field) => field.key), ['heat', 'weight_kg'])
  assert.equal(isReadyToSend(partial, fields), false)
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

test('плавка уникальна: повтор на экране и уже отправленная плавка не отправляются', () => {
  const full = { producer: 'OAM', size: '12', weight_kg: 2650, product_form: 'bobina' }
  const items = [
    done({ ...full, heat: '25R00581' }, { id: 'a' }),
    done({ ...full, heat: '25r 00581' }, { id: 'b' }),
    done({ ...full, heat: '253830' }, { id: 'c' }),
    done({ ...full, heat: '999' }, { id: 'd' }),
  ]
  const duplicates = heatDuplicates(items, [{ localNumber: 'SCN-261011-7F3A', label: { heat: 253830 } }])
  assert.equal(duplicates.has('a'), false, 'первая бирка с плавкой остаётся')
  assert.deepEqual(duplicates.get('b'), { kind: 'tag', number: 1 })
  assert.deepEqual(duplicates.get('c'), { kind: 'sent', localNumber: 'SCN-261011-7F3A' })
  assert.equal(duplicates.has('d'), false)
  assert.equal(isReadyToSend(items[0]!, fields, duplicates), true)
  assert.equal(isReadyToSend(items[1]!, fields, duplicates), false)
  assert.equal(isReadyToSend(items[2]!, fields, duplicates), false)
})
