/**
 * Проверки каталога моделей: описание и характеристики из models.dev, поиск по id снапшота.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PublicModelDirectory } from '../src/features/recognition/catalog/PublicModelDirectory'

/** Каталог с подменённой загрузкой. */
function directoryWith(payload: unknown) {
  const directory = new PublicModelDirectory()
  Object.assign(directory, { load: () => Promise.resolve(payload) })
  return directory
}

test('описание и характеристики модели', async () => {
  const directory = directoryWith({
    openai: { models: { 'gpt-5.5': { name: 'GPT-5.5', description: ' Flagship model ', knowledge: '2026-01', limit: { context: 400000 }, cost: { input: 1.25, output: 10 }, modalities: { input: ['text', 'image'] } } } },
  })
  const [model] = await directory.models('openai')
  assert.equal(model!.description, 'Flagship model')
  assert.deepEqual(model!.details, { contextTokens: 400000, inputCost: 1.25, outputCost: 10, knowledge: '2026-01' })
  const find = await directory.index('openai')
  assert.equal(find('gpt-5.5-2026-04-23')?.id, 'gpt-5.5', 'снапшот находит свой алиас')
  assert.equal(find('gpt-5.5')?.name, 'GPT-5.5')
  assert.equal(find('gpt-4o'), undefined)
})
