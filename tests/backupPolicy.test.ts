/**
 * Проверки имён и срока хранения резервных копий.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BackupPolicy } from '../src/features/uploads/xlsx/BackupPolicy'

test('имя копии и его разбор', () => {
  const policy = new BackupPolicy('labels', '.xlsx')
  const at = new Date(2026, 9, 7, 13, 41, 5, 123)
  const name = policy.backupName(at)
  assert.equal(name, 'labels.2026-10-07_13-41-05-123.xlsx')
  assert.equal(policy.backupTime(name), at.getTime())
  assert.equal(policy.backupTime('labels.xlsx'), null)
  assert.equal(policy.backupTime('other.2026-10-07_13-41-05-123.xlsx'), null, 'копии других таблиц не наши')
})

test('удаляются только наши копии старше недели', () => {
  const policy = new BackupPolicy('labels', '.xlsx')
  const now = new Date(2026, 9, 7, 12, 0, 0).getTime()
  const day = 24 * 60 * 60 * 1000
  const entry = (name: string) => ({ name, isDirectory: false, size: 1, modifiedAt: 0 })
  const entries = [
    entry(policy.backupName(new Date(now - 8 * day))),
    entry(policy.backupName(new Date(now - 6 * day))),
    entry('report.2020-01-01_00-00-00-000.xlsx'),
    { name: policy.backupName(new Date(now - 30 * day)), isDirectory: true, size: 0, modifiedAt: 0 },
  ]
  assert.deepEqual(policy.expired(entries, now).map((item) => item.name), [entries[0]!.name])
})
