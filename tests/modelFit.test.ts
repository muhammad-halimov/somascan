/**
 * Проверки рекомендаций моделей для чтения бирок.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { modelFit } from '../src/features/recognition/catalog/modelFit'

const fit = (id: string, name = id, inputCost?: number, provider: 'google' | 'anthropic' | 'openai' | 'lmstudio' = 'google') =>
  modelFit({ id, name, details: inputCost === undefined ? undefined : { inputCost } }, provider)

test('классы по семейству', () => {
  assert.deepEqual(fit('gemini-3.8-flash', 'Gemini 3.8 Flash'), { tier: 'balanced', preview: false })
  assert.equal(fit('gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite').tier, 'economy')
  assert.equal(fit('gemini-3.5-pro', 'Gemini 3.5 Pro').tier, 'precise')
  assert.equal(fit('claude-sonnet-5-5', 'Claude Sonnet 5.5', 2, 'anthropic').tier, 'balanced')
  assert.equal(fit('claude-opus-5-5', 'Claude Opus 5.5', 4, 'anthropic').tier, 'precise')
  assert.equal(fit('claude-haiku-4-5', 'Claude Haiku 4.5', 1, 'anthropic').tier, 'economy')
  assert.equal(fit('gpt-5-mini', 'gpt-5-mini', undefined, 'openai').tier, 'economy')
  assert.equal(fit('qwen2-vl-7b', 'qwen2-vl-7b', undefined, 'lmstudio').tier, 'local')
})

test('по цене и предварительные версии', () => {
  assert.equal(fit('gpt-6.1-sol', 'GPT-6.1 Sol', 2, 'openai').tier, 'balanced')
  assert.equal(fit('gpt-6.1-astra', 'GPT-6.1 Astra', 10, 'openai').tier, 'precise')
  assert.equal(fit('x-model', 'X', 0.2, 'openai').tier, 'economy')
  assert.equal(fit('x-model', 'X', undefined, 'openai').tier, null)
  assert.equal(fit('gemini-omni-flash-preview', 'Gemini Omni Flash Preview').preview, true)
})
