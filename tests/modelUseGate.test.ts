import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ModelUseGate, type Lease, type LeaseBoard } from '../src/features/recognition/catalog/ModelUseGate'

/** Общая папка отметок в памяти: её видят все «устройства» теста. */
class MemoryBoard implements LeaseBoard {
  readonly leases = new Map<string, Lease>()
  /** Хранилище недоступно. */
  down = false

  async list() {
    if (this.down) throw new Error('down')
    return [...this.leases.values()]
  }

  async put(lease: Lease) {
    if (this.down) throw new Error('down')
    this.leases.set(lease.device, lease)
  }

  async remove(device: string) {
    if (this.down) throw new Error('down')
    this.leases.delete(device)
  }
}

const SERVER = '192.168.1.14:1234'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Устройство с быстрыми сроками. */
const device = (id: string, board: LeaseBoard | null) =>
  new ModelUseGate({ device: id, board: () => board, pollMs: 10, ttlMs: 5_000, heartbeatMs: 1_000, boardTimeoutMs: 200 })

/** Ждёт, пока промис выполнится, и сообщает, выполнился ли он за `ms`. */
async function settledWithin(promise: Promise<unknown>, ms: number) {
  let settled = false
  void promise.then(() => { settled = true }, () => { settled = true })
  await sleep(ms)
  return settled
}

test('смена модели ждёт, пока другое устройство распознаёт, и начинается после', async () => {
  const board = new MemoryBoard()
  const phoneA = device('a', board)
  const phoneB = device('b', board)
  const releaseUse = await phoneA.use(SERVER)
  assert.equal(board.leases.get('a')?.kind, 'using')

  const waits: number[] = []
  const switching = phoneB.acquireSwitch(SERVER, new AbortController().signal, (devices) => waits.push(devices))
  assert.equal(await settledWithin(switching, 60), false)
  assert.ok(waits.includes(1))

  releaseUse()
  const release = await switching
  assert.equal(board.leases.get('b')?.kind, 'switching')
  assert.equal(board.leases.has('a'), false)
  release()
  await sleep(20)
  assert.equal(board.leases.size, 0)
})

test('распознавание ждёт чужой смены модели и не держит отметку, пока ждёт', async () => {
  const board = new MemoryBoard()
  const phoneA = device('a', board)
  const phoneB = device('b', board)
  const release = await phoneB.acquireSwitch(SERVER, new AbortController().signal, () => {})

  const using = phoneA.use(SERVER)
  assert.equal(await settledWithin(using, 60), false)
  // Уступило: своей отметки не держит, иначе обе стороны ждали бы друг друга.
  assert.equal(board.leases.has('a'), false)

  release()
  const releaseUse = await using
  assert.equal(board.leases.get('a')?.kind, 'using')
  releaseUse()
  await sleep(20)
  assert.equal(board.leases.size, 0)
})

test('ожидание смены можно отменить — отметки не остаётся', async () => {
  const board = new MemoryBoard()
  const releaseUse = await device('a', board).use(SERVER)
  const controller = new AbortController()
  const switching = device('b', board).acquireSwitch(SERVER, controller.signal, () => {})
  await sleep(30)
  controller.abort()
  await assert.rejects(switching)
  assert.equal(board.leases.has('b'), false)
  releaseUse()
  await sleep(20)
})

test('распознавание можно отменить, пока оно ждёт чужой смены', async () => {
  const board = new MemoryBoard()
  const release = await device('b', board).acquireSwitch(SERVER, new AbortController().signal, () => {})
  const controller = new AbortController()
  const using = device('a', board).use(SERVER, controller.signal)
  await sleep(30)
  controller.abort()
  await assert.rejects(using)
  assert.equal(board.leases.has('a'), false)
  release()
  await sleep(20)
})

test('просроченная отметка (упавшее устройство) и другой сервер не мешают', async () => {
  const board = new MemoryBoard()
  board.leases.set('dead', { device: 'dead', kind: 'using', server: SERVER, until: Date.now() - 1 })
  board.leases.set('other', { device: 'other', kind: 'switching', server: '10.0.0.7:1234', until: Date.now() + 60_000 })
  const release = await device('b', board).acquireSwitch(SERVER, new AbortController().signal, () => {})
  const releaseUse = await device('c', board).use('10.0.0.7:5555')
  release()
  releaseUse()
  await sleep(20)
})

test('хранилище недоступно или не настроено — работа без очереди', async () => {
  const board = new MemoryBoard()
  board.down = true
  const releaseUse = await device('a', board).use(SERVER)
  const release = await device('b', board).acquireSwitch(SERVER, new AbortController().signal, () => {})
  releaseUse()
  release()
  const unconfigured = device('c', null)
  const releaseC = await unconfigured.use(SERVER)
  releaseC()
  await sleep(20)
})

test('на одном устройстве смена ждёт своих распознаваний, а новые распознавания — своей смены', async () => {
  const board = new MemoryBoard()
  const phone = device('a', board)
  const first = await phone.use(SERVER)
  const switching = phone.acquireSwitch(SERVER, new AbortController().signal, () => {})
  assert.equal(await settledWithin(switching, 40), false)
  // Новое распознавание этого устройства ждёт его же смену модели.
  const second = phone.use(SERVER)
  first()
  const release = await switching
  assert.equal(await settledWithin(second, 40), false)
  assert.equal(board.leases.get('a')?.kind, 'switching')
  release()
  const releaseSecond = await second
  assert.equal(board.leases.get('a')?.kind, 'using')
  releaseSecond()
  await sleep(20)
  assert.equal(board.leases.size, 0)
})

test('два распознавания устройства держат одну отметку до конца последнего', async () => {
  const board = new MemoryBoard()
  const phone = device('a', board)
  const one = await phone.use(SERVER)
  const two = await phone.use(SERVER)
  one()
  await sleep(20)
  assert.equal(board.leases.get('a')?.kind, 'using')
  two()
  await sleep(20)
  assert.equal(board.leases.has('a'), false)
})
