/**
 * Проверки адреса LM Studio: схема и порт по умолчанию, `/v1` в конце.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeLmStudioEndpoint } from '../src/features/recognition/providers/LMStudioProvider'

test('адрес LM Studio', () => {
  assert.equal(normalizeLmStudioEndpoint('192.168.1.14'), 'http://192.168.1.14:1234/v1')
  assert.equal(normalizeLmStudioEndpoint(' 192.168.1.14:1234 '), 'http://192.168.1.14:1234/v1')
  assert.equal(normalizeLmStudioEndpoint('http://192.168.1.14:1234/v1/'), 'http://192.168.1.14:1234/v1')
  assert.equal(normalizeLmStudioEndpoint('http://lm.local:8080'), 'http://lm.local:8080/v1')
  assert.equal(normalizeLmStudioEndpoint('http://host:80'), 'http://host/v1')
  assert.equal(normalizeLmStudioEndpoint('https://ai.example.com/api'), 'https://ai.example.com/api/v1')
})
