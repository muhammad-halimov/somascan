/**
 * Скриншоты приложения для README (`docs/screenshots/<android|ios>/*.webp`): собранное приложение в Chrome
 * без окна, в виде телефона — Android (Material) и iPhone (iOS 26, Liquid Glass), тёмная тема, русский язык.
 *
 * Распознаёт поддельный LM Studio, который поднимает сам скрипт: первая и третья бирка распознаны целиком,
 * у второй нет веса (видно обязательное поле). Фото — `tag.jpg` рядом. Ключей, паролей и настоящих
 * хранилищ нет: настройки, список листов и история «Загрузок» подкладываются в `localStorage`.
 *
 * Запуск (macOS, нужен Google Chrome; другой путь — переменная `CHROME`):
 *   npm run build && node scripts/screenshots/capture.mjs
 */
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const PHOTO = join(ROOT, 'scripts/screenshots/tag.jpg')
const OUT = join(ROOT, 'docs/screenshots')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PREVIEW_PORT = 4180
/** Порт LM Studio по умолчанию: адрес в настройках — короткий `lmstudio.local` (имя ведёт на этот компьютер). */
const LMS_PORT = 1234
const LMS_HOST = 'lmstudio.local'
const DEBUG_PORT = 9890

/** Копии фото с разными именами: поле выбора файлов не берёт один и тот же файл дважды. */
const TEMP = mkdtempSync(join(tmpdir(), 'somascan-shots-'))
const PHOTOS = [1, 2, 3].map((n) => {
  const copy = join(TEMP, `tag-${n}.jpg`)
  copyFileSync(PHOTO, copy)
  return copy
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Устройства: размер экрана в точках и user-agent, по которому приложение выбирает оформление. */
const DEVICES = {
  android: {
    width: 412,
    height: 915,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  },
  ios: {
    width: 393,
    height: 852,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  },
}

// --- Поддельный LM Studio -------------------------------------------------------------------------

const MODELS = [
  { id: 'qwen2.5-vl-7b-instruct', loaded: true, context: 32768, quantization: 'Q4_K_M' },
  { id: 'gemma-3-12b-it', loaded: false, context: 131072, quantization: 'Q4_K_M' },
  { id: 'llava-v1.6-mistral-7b', loaded: false, context: 4096, quantization: 'Q5_K_M' },
]
const TAG = { producer: 'OAM Ózdi Acélművek', size: '12 mm', heat: '25R00581', weight_kg: 2650, grade: 'B500C' }
let recognitions = 0

const lmStudio = http.createServer((request, response) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
  const json = (body) => {
    response.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors)
    response.end()
    return
  }
  request.resume()
  request.on('end', async () => {
    if (request.url === '/api/v0/models') {
      return json({ data: MODELS.map((model) => ({ id: model.id, type: 'vlm', state: model.loaded ? 'loaded' : 'not-loaded', max_context_length: model.context, quantization: model.quantization })) })
    }
    if (request.url === '/api/v1/models') {
      return json({ models: MODELS.map((model) => ({ type: 'llm', key: model.id, loaded_instances: model.loaded ? [{ id: model.id }] : [] })) })
    }
    if (request.url === '/v1/chat/completions') {
      recognitions += 1
      await sleep(600)
      // У второй бирки модель «не прочитала» вес.
      const label = recognitions === 2 ? { ...TAG, weight_kg: null } : TAG
      return json({ choices: [{ message: { content: JSON.stringify({ ...label, _photo: { ok: true, issues: [] } }) } }] })
    }
    response.writeHead(404, cors)
    response.end('{}')
  })
})

// --- Данные в localStorage -----------------------------------------------------------------------

const SMB = { host: '192.168.1.20', share: 'Laborator', filePath: 'Probe otel.xlsx', domain: '', username: 'scanner', password: 'demo-password' }
const DRIVE = { account: 'user@example.com', folder: '', fileName: 'Probe otel.xlsx' }
const SHEETS = ['2026', '2025', '2024', '2023']

/**
 * Список листов таблицы, как после проверки (`TableCheckStore`, ключ — расположение таблицы): с ним вкладка
 * «Хранилище» не проверяет таблицу сама — в браузере проверка не прошла бы (хранилища только в приложении).
 */
const tableSheets = (target) => ({
  location: target === 'smb'
    ? ['smb', SMB.host, SMB.share, SMB.filePath].join('|').toLowerCase()
    : ['googleDrive', DRIVE.account, DRIVE.folder, DRIVE.fileName].join('|'),
  names: SHEETS,
})

const settings = (target) => ({
  general: {
    language: 'ru',
    provider: 'lmstudio',
    endpoints: { lmstudio: LMS_HOST },
    models: { lmstudio: MODELS[0].id },
  },
  storage: {
    target,
    smb: SMB,
    googleDrive: DRIVE,
    sheet: '',
    strictLayout: true,
  },
})

/** История «Загрузок»: три записанные бирки. */
function uploads() {
  const now = Date.now()
  const record = (n, minutesAgo, label, row) => ({
    id: `demo-${n}-${['7f3a', 'b21c', '0e94'][n - 1]}`,
    createdAt: now - minutesAgo * 60_000,
    localNumber: `SCN-261011-${['7F3A', 'B21C', '0E94'][n - 1]}`,
    label,
    columns: [],
    status: 'completed',
    attempts: 1,
    completedAt: now - minutesAgo * 60_000 + 20_000,
    rowNumber: row,
    sheet: '2026',
    item: row - 6,
  })
  return [
    record(3, 4, { producer: 'OAM Ózdi Acélművek', size: '12', heat: '25R00581', weight_kg: 2650, product_form: 'bobina' }, 389),
    record(2, 11, { producer: 'Arcelor-Mittal', size: '10', heat: '253830', weight_kg: 8126, product_form: 'bobina' }, 388),
    record(1, 26, { producer: 'Icdas', size: '16', heat: '2501-3-328-50', weight_kg: 5050, product_form: 'bara' }, 387),
  ]
}

// --- Chrome ---------------------------------------------------------------------------------------

/** Открывает Chrome без окна и возвращает функции протокола DevTools. */
async function openChrome(port) {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(TEMP, `chrome-${port}`)}`,
    `--host-resolver-rules=MAP ${LMS_HOST} 127.0.0.1`,
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

/** Снимает одно устройство. */
async function capture(platform, port) {
  const device = DEVICES[platform]
  const dir = join(OUT, platform)
  mkdirSync(dir, { recursive: true })
  recognitions = 0
  const { send, evaluate, close } = await openChrome(port)
  const shot = async (name) => {
    await sleep(500)
    // WebP вместо PNG: в несколько раз легче при том же виде.
    const { result } = await send('Page.captureScreenshot', { format: 'webp', quality: 88 })
    writeFileSync(join(dir, `${name}.webp`), Buffer.from(result.data, 'base64'))
    console.log(`${platform}/${name}.webp`)
  }
  /** Нажимает первый элемент `selector`, в тексте которого есть `text`. */
  const click = async (selector, text) => {
    const found = await evaluate(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate) => candidate.textContent.includes(${JSON.stringify(text)}))
      element?.click()
      return Boolean(element)
    })()`)
    if (!found) throw new Error(`${platform}: не найдено «${text}» (${selector})`)
  }
  /** Ждёт, пока выражение станет истинным. */
  const until = async (expression, timeoutMs = 10_000) => {
    for (let waited = 0; waited < timeoutMs; waited += 200) {
      if (await evaluate(expression)) return
      await sleep(200)
    }
    throw new Error(`${platform}: не дождались ${expression}`)
  }
  /** Прокручивает лист настроек к группе с заголовком `title`. */
  const scrollToSection = async (title) => {
    await evaluate(`[...document.querySelectorAll('.form-section-title')].find((heading) => heading.textContent.includes(${JSON.stringify(title)}))?.scrollIntoView({ block: 'start' })`)
    await sleep(600)
  }
  const setFiles = async (files) => {
    const { root } = (await send('DOM.getDocument')).result
    const { nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })).result
    await send('DOM.setFileInputFiles', { nodeId, files })
  }
  const seed = async (target) => {
    await evaluate(`(() => {
      localStorage.setItem('somascan.settings.v1', ${JSON.stringify(JSON.stringify(settings(target)))})
      localStorage.setItem('somascan.uploads.v2', ${JSON.stringify(JSON.stringify(uploads()))})
      localStorage.setItem('somascan.tableSheets.v1', ${JSON.stringify(JSON.stringify(tableSheets(target)))})
    })()`)
  }
  /** Открывает приложение заново с настройками для хранилища `target`. */
  const load = async (target) => {
    await seed(target)
    await send('Page.reload')
    await sleep(2500)
    // Системные диалоги в браузере — window.alert/confirm: не даём им остановить страницу.
    await evaluate(`window.alert = () => {}; window.confirm = () => false`)
  }

  try {
    await send('Emulation.setUserAgentOverride', { userAgent: device.userAgent })
    await send('Emulation.setDeviceMetricsOverride', { width: device.width, height: device.height, deviceScaleFactor: 2, mobile: true })
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await send('Page.enable')
    await send('DOM.enable')
    await send('Page.navigate', { url: `http://127.0.0.1:${PREVIEW_PORT}/` })
    await sleep(1500)
    await load('smb')

    await shot('01-main')

    // Бирка с фото: распознана, форма выбрана.
    await setFiles([PHOTOS[0]])
    await until(`document.querySelectorAll('.label-field').length > 2`)
    await evaluate(`(() => {
      const select = document.querySelector('.label-field.is-product-form select')
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'bobina')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await sleep(1200)
    await shot('02-result')

    // Правка.
    await click('.action-button', 'Правка')
    await sleep(1200)
    await shot('03-editing')
    await click('.action-button', 'Готово')
    await sleep(1200)

    // Ещё две бирки с фото и одна без фото — для сетки.
    // По одному: поле выбора берёт столько фото, сколько свободно ячеек на момент нажатия «Фото» (без него — одно).
    await setFiles([PHOTOS[1]])
    await sleep(1500)
    await setFiles([PHOTOS[2]])
    await until(`!document.querySelector('.notes-card .is-recognizing, .photo-card .is-recognizing')`, 15_000)
    await sleep(2500)
    await click('.notes-items .tab', '+')
    await sleep(800)
    await click('.action-button', 'Без фото')
    await sleep(1500)
    await shot('04-no-photo')

    await click('.action-button', 'Сетка')
    await sleep(1800)
    await shot('05-grid')

    // «Загрузки».
    await evaluate(`document.querySelectorAll('.header-actions .action-button')[0].click()`)
    await sleep(1200)
    await shot('06-uploads')
    await evaluate(`document.querySelectorAll('.header-actions .action-button')[0].click()`)
    await sleep(900)

    // Настройки.
    await evaluate(`document.querySelectorAll('.header-actions .action-button')[1].click()`)
    await sleep(1200)
    await click('.tab', 'Основные')
    await sleep(1200)
    await evaluate(`document.querySelector('.disclosure button, .disclosure [role=button]')?.click()`)
    await sleep(1500)
    await scrollToSection('Модель')
    await shot('07-settings-model')
    await click('.tab', 'Хранилище')
    await sleep(1500)
    // Низ группы таблицы: путь, лист и правила записи.
    await evaluate(`document.querySelector('.list[aria-label="Правила записи"]')?.scrollIntoView({ block: 'end' })`)
    await sleep(600)
    await shot('08-settings-storage')
    await click('.tab', 'Расширенные')
    await sleep(1500)
    await shot('10-settings-advanced')

    // Google Drive — с его списком листов (см. `tableSheets`), поэтому заново.
    await load('googleDrive')
    await evaluate(`document.querySelectorAll('.header-actions .action-button')[1].click()`)
    await sleep(1200)
    await click('.tab', 'Хранилище')
    await sleep(1500)
    await scrollToSection('Аккаунт Google')
    await shot('09-settings-drive')
  } finally {
    close()
  }
}

// --- Запуск ---------------------------------------------------------------------------------------

await new Promise((resolve) => lmStudio.listen(LMS_PORT, '127.0.0.1', resolve))
const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' })
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(`http://127.0.0.1:${PREVIEW_PORT}/`)
      break
    } catch {
      await sleep(250)
    }
  }
  await capture('android', DEBUG_PORT)
  await capture('ios', DEBUG_PORT + 1)
} finally {
  preview.kill()
  lmStudio.close()
}
