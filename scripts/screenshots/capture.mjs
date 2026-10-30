/**
 * Скриншоты окна для README (`docs/screenshots/<en|ru>/*.webp`) — как в мобильном приложении: собранное окно
 * (`dist/`) в Chrome без окна, тёмная тема, интерфейс на языке README (английский — для README.md, русский —
 * для README.ru.md). Главного процесса нет: `window.api` подменяется демо-данными (проекты, элементы и плавки
 * выдуманы), поэтому ни файлов, ни паролей, ни аккаунтов не нужно. Из шести кадров собирается обзор
 * (`overview.<en|ru>.webp`): кадры в ряд с подписями — одна картинка, которая масштабируется целиком.
 *
 * Запуск (macOS, нужен Google Chrome; другой путь, например Chromium на Linux, — переменная `CHROME`):
 *   npm run build && node scripts/screenshots/capture.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'docs/screenshots')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SERVER_PORT = 4181
const DEBUG_PORT = 9910
const TEMP = mkdtempSync(join(tmpdir(), 'somasync-shots-'))
/** Окно: ширина как у программы, высота — один экран. */
const WINDOW = { width: 560, height: 1060 }
/** Ширина кадра в обзоре. */
const OVERVIEW_TILE = 300
const LANGUAGES = ['en', 'ru']

/** Кадры: вкладка, место хранения, прокрутка к концу вкладки и подпись в обзоре. */
const SHOTS = [
  { name: 'run', tab: 0, target: 'smb', en: 'Home', ru: 'Главная' },
  { name: 'storage', tab: 1, target: 'smb', en: 'Network drive', ru: 'Сетевой диск' },
  { name: 'phones', tab: 1, target: 'smb', end: true, en: 'Phones', ru: 'Телефоны' },
  { name: 'drive', tab: 1, target: 'googleDrive', en: 'Google Drive', ru: 'Google Drive' },
  { name: 'links', tab: 2, target: 'smb', en: 'Links', ru: 'Связи' },
  { name: 'advanced', tab: 3, target: 'smb', en: '“Advanced”', ru: '«Расширенные»' },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- Демо-данные ----------------------------------------------------------------------------------

/** Время демо-прогона: 30 октября 2026, 09:10. */
const AT = Date.UTC(2026, 9, 30, 7, 10, 6)
const CONSUM = '09-Consum Otel 2026.xlsx'
const PROJECTS = ['PETRA DATE', 'NORD INFRA', 'LACUL VERDE']

/** Настройки окна. */
function settings(language, target) {
  const unc = (name) => `\\\\192.168.1.20\\Atelier\\${name}`
  return {
    running: true, write: true, language, theme: 'dark', target,
    files: {
      local: { consums: [''], sarjele: '', probe: '' },
      smb: { consums: [unc(CONSUM)], sarjele: unc('Sarjele din elemente.xlsx'), probe: unc('Probe otel.xlsx') },
      googleDrive: { consums: [CONSUM], sarjele: 'Sarjele din elemente.xlsx', probe: 'Probe otel.xlsx' },
    },
    locked: { consum: true, sarjele: true, probe: true, folder: true },
    sheet: '',
    smb: { host: '192.168.1.20', share: 'Atelier', domain: '', username: 'operator', password: '••••••••' },
    googleDrive: { account: 'user@example.com', folder: '', token: '' },
    projects: PROJECTS.map((name) => ({ name, aliases: [], sheet: name, prefix: '', create: true, enabled: true, locked: true })),
    intervalSec: 10, settleSec: 3, backupDays: 30, rule: 'latest',
    openAtLogin: true, autoProjects: true, trayMinimize: true, startMinimized: false, guardOpenFiles: true, bridge: true,
    firestore: { enabled: true, projectId: 'somascan-demo', apiKey: 'AIzaSyDemo-key' },
  }
}

const msg = (code, params) => (params ? { code, params } : { code })

/** Бирка с телефона, перенесённая в Probe. */
const bridged = (n, heat, producer, row) => ({ record: `SCN-261030-000${n}`, heat, producer, sheet: '2026', row, item: row - 6 })

/** Журнал: начало слежения, первый прогон с записью и бирки с телефонов. */
const JOURNAL = [
  { kind: 'event', id: 1, t: AT, level: 'info', msg: msg('event.watchWrite', { seconds: 10 }) },
  {
    kind: 'run', id: 2, t: AT, trigger: 'first', file: CONSUM, apply: true, outcome: 'wrote', finishedAt: AT + 4000,
    lines: [
      { level: 'info', msg: msg('tech.engine', { version: '1.0.0' }) },
      { level: 'info', msg: msg('tech.overview', { heats: 42, closed: 9, blocks: 37, rows: 18 }) },
      { level: 'ok', msg: msg('tech.sarjeleSaved', { blocks: 5, links: 6 }) },
    ],
    summary: {
      command: 'sync', applied: true, wrote: true, period: 'LUNA OCTOMBRIE 2026',
      counts: { heats: 42, closedHeats: 9, blocks: 37, rows: 18 },
      blocks: [
        { project: 'PETRA DATE', element: 'GRINDA 3', mode: 'create', kg: 1480, heats: ['250145', '250160'], missingKg: 300 },
        { project: 'NORD INFRA', element: 'GRINDA 7', mode: 'update', kg: 330, heats: ['250114'], missingKg: 0 },
        { project: 'PETRA DATE', element: 'PERETE P2', mode: 'create', kg: 1200, heats: ['250101'], missingKg: 0 },
        { project: 'NORD INFRA', element: 'STALP S4', mode: 'create', kg: 450, heats: ['250145'], missingKg: 0 },
        { project: 'LACUL VERDE', element: 'RADIER R1', mode: 'create', kg: 1600, heats: ['250114', '250131', '250145', '250152'], missingKg: 0 },
      ],
      ids: [{ id: 'NI-0001', project: 'NORD INFRA', element: 'GRINDA 7', action: 'linked' }],
      closed: ['250160', '250114', '250145'], reopened: [],
      shortages: [{ dia: 16, form: 'Bara', kg: 300, elements: ['GRINDA 3'], free: 0, closedLeft: 0 }],
      skipped: ['ST_100', 'ST_110'].map((element) => ({ project: 'PETRA DATE', element, reason: msg('skip.sharedBlock', { title: 'ST_100.110' }) })),
      unconfigured: [], sheets: ['LACUL VERDE'], oldHeats: [], notes: [], warnings: [], deferred: [],
      backup: '2026-10-30T07-10-06-000Z', verified: true, problems: [], restored: null, error: null, consumAfter: null, bridged: [],
    },
  },
  {
    kind: 'run', id: 3, t: AT + 1_260_000, trigger: 'bridge', file: 'Probe otel.xlsx', apply: true, outcome: 'wrote', finishedAt: AT + 1_263_000,
    lines: [
      { level: 'info', msg: msg('tech.bridgeRead', { records: 51, fresh: 2 }) },
      { level: 'ok', msg: msg('tech.bridgeSaved', { n: 2 }) },
    ],
    summary: {
      command: 'bridge', applied: true, wrote: true, period: '', counts: { heats: 0, closedHeats: 0, blocks: 0, rows: 0 },
      blocks: [], ids: [], closed: [], reopened: [], shortages: [], skipped: [], unconfigured: [], sheets: [], oldHeats: [], notes: [], warnings: [], deferred: [],
      backup: '2026-10-30T07-31-06-000Z', verified: true, problems: [], restored: null, error: null, consumAfter: null,
      bridged: [bridged(1, '250171', 'SOMACO', 49), bridged(2, '25R00206', 'Sovel', 50)],
    },
  },
]

/** Элемент Consum для вкладки «Связи». */
function element(project, name, row, kind, extra = {}) {
  return {
    source: CONSUM, project, rawProject: project, row, name, buc: 2, id: kind === 'skip' ? '' : `${project.slice(0, 2)}-000${row % 9}`,
    kind, via: kind === 'known' ? 'id' : kind === 'new' ? 'new' : null, why: null, sheet: project, newSheet: false,
    block: kind === 'known' ? { sheet: project, title: name, row: row * 4 } : null, changed: false, link: null, candidates: [], ...extra,
  }
}

/** Что «прочитал движок» для вкладки «Связи». */
const SCAN = {
  files: [CONSUM],
  links: {},
  registry: 6,
  projects: [['PETRA DATE', 3], ['NORD INFRA', 3], ['LACUL VERDE', 1]].map(([raw, rows]) => ({
    raw, rows, sources: [CONSUM], matched: { name: raw, how: 'exact', sheet: raw, sheetExists: true }, suggestProject: null, suggestSheet: null,
  })),
  sheets: [{ name: 'PETRA DATE', blocks: 3, unlinked: 2 }, { name: 'NORD INFRA', blocks: 4, unlinked: 1 }, { name: 'LACUL VERDE', blocks: 1, unlinked: 0 }],
  orphans: [{ sheet: 'PETRA DATE', title: 'ST_100.110', row: 40 }, { sheet: 'PETRA DATE', title: 'ST_090', row: 60 }, { sheet: 'NORD INFRA', title: 'GRINDA 5', row: 12 }],
  elements: [
    ...['ST_100', 'ST_110'].map((name, i) => element('PETRA DATE', name, 12 + i, 'skip', {
      why: msg('skip.sharedBlock', { title: 'ST_100.110' }),
      candidates: [{ sheet: 'PETRA DATE', title: 'ST_100.110', row: 40, filled: true, score: 0.92 }],
    })),
    element('PETRA DATE', 'GRINDA 3', 14, 'known'),
    element('NORD INFRA', 'GRINDA 7', 15, 'known'),
    element('NORD INFRA', 'STALP S4', 16, 'known'),
    element('NORD INFRA', 'PERETE P1', 17, 'known'),
    element('LACUL VERDE', 'RADIER R1', 18, 'known'),
  ],
}

/** Подмена `window.api` (главного процесса) на демо-данные — выполняется в окне до его скриптов. */
function stub(language, target) {
  const data = { settings: settings(language, target), journal: JOURNAL, scan: SCAN }
  return `(() => {
    const data = ${JSON.stringify(data)}
    const noop = () => () => {}
    const sheets = ['2025', '2026']
    window.api = {
      init: async () => ({ settings: data.settings, run: { status: 'watching', busy: null, nextCheckAt: Date.now() + 7400, lastCheckAt: Date.now(), lastRunAt: ${AT}, pending: [], bridge: { syncedAt: ${AT} + 1263000, waiting: false, problem: null, bell: null, bellError: null } }, journal: data.journal, version: '1.0.0', year: 2026, platform: 'win32' }),
      setSettings: async (patch) => Object.assign(data.settings, patch),
      start: async () => ({ ok: true }), stop: async () => {}, pick: async () => null,
      check: async (kind) => ({ ok: true, msg: { code: 'check.ok', params: { n: kind === 'probe' ? 2 : 3, date: ${AT} } }, sheets: kind === 'probe' ? sheets : ['PETRA DATE', 'NORD INFRA', 'LACUL VERDE'] }),
      scan: async () => data.scan, setLink: async () => ({}), createSheets: async () => ({ ok: true }),
      action: async () => ({ ok: true }), backups: async () => [], restore: async () => ({ ok: true }), confirm: async () => false,
      mountSmb: async () => ({ ok: true }), smbPassword: async () => '', driveSignIn: async () => ({ ok: true }), driveSignOut: async () => {}, bridgeBell: async () => {},
      clearJournal: async () => {}, open: async () => {},
      onJournal: noop, onNavigate: noop, onRun: noop, onSettings: noop,
    }
  })()`
}

// --- Окно из dist/ --------------------------------------------------------------------------------

/** Типы файлов сборки. */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

/** Раздаёт `dist/` (модули из `file://` Chrome не грузит). */
const server = http.createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '')
  try {
    const body = readFileSync(join(DIST, path || 'index.html'))
    res.writeHead(200, { 'Content-Type': TYPES[extname(path || 'index.html')] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end()
  }
})

// --- Chrome ---------------------------------------------------------------------------------------

/** Открывает Chrome без окна и возвращает функции протокола DevTools. */
async function openChrome(port) {
  const chrome = spawn(CHROME, [
    '--headless=new',
    // От root (контейнер, CI) Chrome без песочницы не запускается.
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(TEMP, `chrome-${port}`)}`,
    'about:blank',
  ], { stdio: 'ignore' })
  let target
  for (let attempt = 0; attempt < 50 && !target; attempt++) {
    await sleep(200)
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((candidate) => candidate.type === 'page')
    } catch {
      // Chrome ещё запускается.
    }
  }
  if (!target) throw new Error('Chrome не отвечает')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => socket.addEventListener('open', resolve))
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  const send = (method, params = {}) => new Promise((resolve) => {
    const next = ++id
    pending.set(next, resolve)
    socket.send(JSON.stringify({ id: next, method, params }))
  })
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
  const close = () => {
    socket.close()
    chrome.kill()
  }
  return { send, evaluate, close }
}

/** Снимает кадры одного языка: для каждого места хранения окно открывается заново со своими настройками. */
async function capture(language, port) {
  const dir = join(OUT, language)
  mkdirSync(dir, { recursive: true })
  for (const target of new Set(SHOTS.map((shot) => shot.target))) {
    const { send, evaluate, close } = await openChrome(port++)
    try {
      await send('Emulation.setDeviceMetricsOverride', { ...WINDOW, deviceScaleFactor: 2, mobile: false })
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
      await send('Page.enable')
      await send('Page.addScriptToEvaluateOnNewDocument', { source: stub(language, target) })
      await send('Page.navigate', { url: `http://127.0.0.1:${SERVER_PORT}/` })
      await sleep(1500)
      for (const shot of SHOTS.filter((s) => s.target === target)) {
        await evaluate(`document.querySelectorAll('[role="tab"]')[${shot.tab}].click()`)
        await sleep(900)
        // кадр конца вкладки (раздел «Телефоны» в «Хранилище»)
        if (shot.end) {
          await evaluate(`document.querySelector('.storage-stack > :last-child').scrollIntoView({ block: 'end' })`)
          await sleep(400)
        }
        // WebP вместо PNG: в несколько раз легче при том же виде.
        const { result } = await send('Page.captureScreenshot', { format: 'webp', quality: 88 })
        writeFileSync(join(dir, `${shot.name}.webp`), Buffer.from(result.data, 'base64'))
        console.log(`${language}/${shot.name}.webp`)
        // следующий кадр — снова с начала вкладки
        if (shot.end) await evaluate(`scrollTo(0, 0); for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0`)
      }
    } finally {
      close()
    }
  }
  return port
}

/**
 * Обзор для README: кадры в ряд с подписями на языке `language`. Фон прозрачный, подписи серые — читаются
 * и в светлой, и в тёмной теме GitHub.
 */
async function overview(language, port) {
  const page = join(TEMP, `overview-${language}.html`)
  const figures = SHOTS.map((shot) => `<figure><img src="${pathToFileURL(join(OUT, language, `${shot.name}.webp`))}" alt=""><figcaption>${shot[language]}</figcaption></figure>`).join('')
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; }
    body { font: 600 22px/1.25 Inter, ui-sans-serif, system-ui, sans-serif; color: #8c959f; }
    main { display: grid; grid-template-columns: repeat(${SHOTS.length}, ${OVERVIEW_TILE}px); gap: 34px 26px; padding: 6px; width: max-content; }
    figure { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 0; }
    img { display: block; width: ${OVERVIEW_TILE}px; aspect-ratio: ${WINDOW.width} / ${WINDOW.height}; border-radius: 14px; box-shadow: 0 0 0 1px rgb(140 149 159 / .4); }
    figcaption { text-align: center; }
  </style><main>${figures}</main>`)
  const { send, evaluate, close } = await openChrome(port)
  try {
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
    await send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false })
    await send('Page.enable')
    await send('Page.navigate', { url: pathToFileURL(page).href })
    await sleep(1500)
    const size = await evaluate(`(async () => {
      await Promise.all([...document.images].map((image) => image.decode()))
      const box = document.querySelector('main').getBoundingClientRect()
      return { width: Math.ceil(box.width), height: Math.ceil(box.height) }
    })()`)
    const { result } = await send('Page.captureScreenshot', { format: 'webp', quality: 90, clip: { x: 0, y: 0, ...size, scale: 1 }, captureBeyondViewport: true })
    writeFileSync(join(OUT, `overview.${language}.webp`), Buffer.from(result.data, 'base64'))
    console.log(`overview.${language}.webp`)
  } finally {
    close()
  }
}

// --- Запуск ---------------------------------------------------------------------------------------

await new Promise((resolve) => server.listen(SERVER_PORT, '127.0.0.1', resolve))
try {
  let port = DEBUG_PORT
  for (const language of LANGUAGES) {
    port = await capture(language, port)
    await overview(language, port++)
  }
} finally {
  server.close()
}
