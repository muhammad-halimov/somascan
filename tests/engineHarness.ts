/**
 * Проверка собранного движка очереди (`upload-engine.js`) так, как его запускает iOS: в «голом»
 * JS-контексте без браузерных API (`node:vm`, как JSContext), с хостом `SomascanHost`, который здесь
 * реализован на Node: хранилище — Map, сетевой диск — `FakeSmb`, HTTP — `FakeDrive`, таймеры — Node.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { build } from 'vite'
import type { EngineActivity, EngineCommand } from '../src/engine/protocol'
import type { UploadRecord } from '../src/features/uploads/store/UploadStore'
import type { FakeDrive } from './fakeDrive'
import type { FakeSmb } from './fakeSmb'

/** Собирает движок во временную папку и возвращает его код. */
export async function buildEngine(): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), 'somascan-engine-'))
  await build({ configFile: 'vite.engine.config.ts', logLevel: 'silent', build: { outDir } })
  return readFileSync(join(outDir, 'upload-engine.js'), 'utf8')
}

/** Событие движка в разобранном виде. */
export type HarnessEvent =
  | { type: 'ready' }
  | { type: 'state'; records: UploadRecord[] }
  | { type: 'activity'; activity: EngineActivity }

/** Что даёт хосту тест. */
export interface HarnessDeps {
  smb?: FakeSmb
  drive?: FakeDrive
  token?: string
  /** Общее хранилище: передаётся следующему движку, чтобы проверить «перезапуск процесса». */
  storage?: Map<string, string>
}

/** Base64 ↔ байты на стороне Node. */
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'))

/** Запущенный движок в голом контексте. */
export class EngineHarness {
  readonly events: HarnessEvent[] = []
  readonly logs: string[] = []
  readonly storage: Map<string, string>
  /** Какие глобальные веб-API отсутствовали в контексте до загрузки движка. */
  readonly missingBefore: string[]
  private readonly context: vm.Context
  private readonly timers = new Map<number, NodeJS.Timeout>()
  private stopped = false

  constructor(code: string, private readonly deps: HarnessDeps) {
    this.storage = deps.storage ?? new Map()
    this.context = vm.createContext({})
    this.missingBefore = vm.runInContext(
      `['setTimeout', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'AbortController', 'console', 'window', 'URLSearchParams', 'Blob', 'fetch'].filter((name) => typeof globalThis[name] === 'undefined')`,
      this.context,
    ) as string[]
    this.context.SomascanHost = this.host()
    vm.runInContext(code, this.context, { filename: 'upload-engine.js' })
  }

  /** Команда движку (как нативная часть: JSON-строкой). */
  command(command: EngineCommand) {
    ;(this.context.SomascanEngine as { command(json: string): void }).command(JSON.stringify(command))
  }

  /** Последний снимок очереди. */
  get records(): UploadRecord[] {
    const states = this.events.filter((event): event is Extract<HarnessEvent, { type: 'state' }> => event.type === 'state')
    return states.at(-1)?.records ?? []
  }

  /** Последняя активность. */
  get activity(): EngineActivity | undefined {
    const activities = this.events.filter((event): event is Extract<HarnessEvent, { type: 'activity' }> => event.type === 'activity')
    return activities.at(-1)?.activity
  }

  /** Ждёт, пока условие не станет верным (по событиям движка). */
  async until(predicate: () => boolean, timeoutMs = 20_000) {
    const started = Date.now()
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) throw new Error(`timeout; last records: ${JSON.stringify(this.records.map((r) => [r.localNumber, r.status, r.error?.code]))}; logs: ${this.logs.slice(-5).join(' | ')}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  /** Останавливает таймеры (движок «выгружен»). */
  stop() {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  /** Объект `SomascanHost`. */
  private host() {
    const settle = (id: number, ok: boolean, payload: unknown) => {
      if (this.stopped) return
      ;(this.context.__somascanSettle as (id: number, ok: boolean, json: string) => void)(id, ok, JSON.stringify(payload))
    }
    return {
      storageGet: (key: string) => this.storage.get(key) ?? null,
      storageSet: (key: string, value: string) => void this.storage.set(key, value),
      storageRemove: (key: string) => void this.storage.delete(key),
      emit: (type: string, payload: string) => void this.events.push({ type, ...JSON.parse(payload) } as HarnessEvent),
      log: (level: string, message: string) => void this.logs.push(`${level}: ${message}`),
      setTimer: (id: number, delay: number) => {
        this.timers.set(id, setTimeout(() => {
          this.timers.delete(id)
          if (!this.stopped) (this.context.__somascanTimer as (id: number) => void)(id)
        }, Math.min(delay, 50)))
      },
      clearTimer: (id: number) => {
        clearTimeout(this.timers.get(id))
        this.timers.delete(id)
      },
      call: (id: number, method: string, json: string) => {
        const args = JSON.parse(json) as Record<string, unknown>
        this.perform(method, args).then((result) => settle(id, true, result), (error: { code?: string; message?: string }) => settle(id, false, { code: error.code ?? 'io', message: error.message ?? String(error) }))
      },
    }
  }

  /** Долгая операция хоста. */
  private async perform(method: string, args: Record<string, unknown>): Promise<unknown> {
    await new Promise((resolve) => setImmediate(resolve))
    if (method === 'googleToken') {
      if (!this.deps.token) throw { code: 'notSignedIn', message: 'no token' }
      return { accessToken: this.deps.token }
    }
    if (method === 'http') {
      const drive = this.deps.drive
      if (!drive) throw { code: 'io', message: 'no drive' }
      const response = await drive.fetch(String(args.url), {
        method: String(args.method),
        headers: args.headers as Record<string, string>,
        ...(typeof args.body === 'string' ? { body: fromBase64(args.body) } : {}),
      })
      return { status: response.status, body: toBase64(new Uint8Array(await response.arrayBuffer())) }
    }
    if (method === 'smb') {
      const smb = this.deps.smb
      if (!smb) throw { code: 'io', message: 'no smb' }
      const connection = args.connection as Parameters<FakeSmb['probe']>[0]
      const path = String(args.path ?? '')
      switch (args.op) {
        case 'probe': return smb.probe(connection, path)
        case 'read': return { data: toBase64(await smb.read(connection, path)) }
        case 'write': return smb.write(connection, path, fromBase64(String(args.data))).then(() => ({}))
        case 'commit': return smb.commit(connection, path, fromBase64(String(args.data)), args.backupPath as string | undefined)
        case 'rename': return smb.rename(connection, String(args.from), String(args.to)).then(() => ({}))
        case 'remove': return smb.remove(connection, path).then(() => ({}))
        case 'list': return { entries: await smb.list(connection, path) }
        case 'mkdir': return smb.mkdir(connection, path).then(() => ({}))
        case 'mkdirs': return smb.mkdirs(connection, path).then(() => ({}))
      }
    }
    throw { code: 'io', message: `unknown ${method}` }
  }
}
