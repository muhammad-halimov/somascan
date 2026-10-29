/**
 * Скриншоты приложения для README (`docs/screenshots/<android|ios>/<en|ru>/*.webp`): собранное приложение
 * в Chrome без окна, в виде телефона — Android (Material) и iPhone (iOS 26, Liquid Glass), тёмная тема,
 * интерфейс на языке README (английский — для README.md, русский — для README.ru.md). Обе платформы
 * снимаются на экране одного размера, поэтому все кадры одинаковые. Из десяти кадров платформы собирается
 * обзор (`overview.<en|ru>.webp`): сетка 5 × 2 с подписями — одна картинка, которая масштабируется целиком,
 * и кадры в ней всегда одного размера.
 *
 * Распознаёт поддельный LM Studio, который поднимает сам скрипт: первая и третья бирка распознаны целиком,
 * у второй нет веса (видно обязательное поле). Фото — `tag.jpg` рядом. Ключей, паролей и настоящих
 * хранилищ нет: настройки, список листов и история «Загрузок» подкладываются в `localStorage`.
 *
 * Запуск (macOS, нужен Google Chrome; другой путь, например Chromium на Linux, — переменная `CHROME`):
 *   npm run build && node scripts/screenshots/capture.mjs
 */
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

/** Экран телефона в точках — один для обеих платформ, чтобы кадры Android и iPhone были одного размера (×2 — 804 × 1748). */
const SCREEN = { width: 402, height: 874 }

/** Устройства: user-agent, по которому приложение выбирает оформление. */
const DEVICES = {
  android: {
    ...SCREEN,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  },
  ios: {
    ...SCREEN,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  },
}

/** Кадры в порядке обзора и их подписи на языках README. */
const SHOTS = [
  { name: '01-main', en: 'Main screen', ru: 'Главный экран' },
  { name: '02-result', en: 'Recognized tag', ru: 'Распознанная бирка' },
  { name: '03-editing', en: 'Editing', ru: 'Правка' },
  { name: '04-no-photo', en: 'Tag without a photo', ru: 'Бирка без фото' },
  { name: '05-grid', en: '3 × 3 grid', ru: 'Сетка 3 × 3' },
  { name: '06-uploads', en: '“Uploads”', ru: '«Загрузки»' },
  { name: '07-settings-model', en: 'LM Studio model', ru: 'Модель LM Studio' },
  { name: '08-settings-storage', en: 'Network drive', ru: 'Сетевой диск' },
  { name: '09-settings-drive', en: 'Google Drive', ru: 'Google Drive' },
  { name: '10-settings-advanced', en: '“Advanced”', ru: '«Расширенные»' },
]

/** Языки README: интерфейс на скриншотах и подписи обзора. */
const LANGUAGES = ['en', 'ru']

/**
 * Надписи интерфейса, по которым скрипт нажимает кнопки и ищет разделы, — из переводов приложения,
 * чтобы снимать на любом языке.
 */
function interfaceText(language) {
  const read = (namespace) => JSON.parse(readFileSync(join(ROOT, `src/locales/${language}/${namespace}.json`), 'utf8'))
  const workspace = read('workspace')
  const settings = read('settings')
  return {
    edit: workspace.editing.editCaption,
    done: workspace.editing.closeCaption,
    noPhoto: workspace.photo.noPhoto,
    grid: workspace.grid.open,
    general: settings.tabs.general,
    storage: settings.tabs.storage,
    advanced: settings.tabs.advanced,
    model: settings.general.model,
    googleAccount: settings.storage.googleDrive.account,
    rules: settings.storage.rules,
  }
}

/** Ширина кадра в обзоре, px: README показывает обзор шириной ~830 точек — на экранах Retina это ровно ×2. */
const OVERVIEW_TILE = 300

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

const settings = (target, language) => ({
  general: {
    language,
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
    // Плавка не та, что на фото: иначе распознанная бирка была бы повтором уже отправленной.
    record(3, 4, { producer: 'OAM Ózdi Acélművek', size: '12', heat: '25R00412', weight_kg: 2610, product_form: 'bobina' }, 389),
    record(2, 11, { producer: 'Arcelor-Mittal', size: '10', heat: '253830', weight_kg: 8126, product_form: 'bobina' }, 388),
    record(1, 26, { producer: 'Icdas', size: '16', heat: '2501-3-328-50', weight_kg: 5050, product_form: 'bara' }, 387),
  ]
}

// --- Chrome ---------------------------------------------------------------------------------------

/** Открывает Chrome без окна и возвращает функции протокола DevTools. */
async function openChrome(port) {
  const chrome = spawn(CHROME, [
    '--headless=new',
    // От root (контейнер, CI) Chrome без песочницы не запускается.
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
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
async function capture(platform, language, port) {
  const device = DEVICES[platform]
  const text = interfaceText(language)
  const dir = join(OUT, platform, language)
  mkdirSync(dir, { recursive: true })
  recognitions = 0
  const { send, evaluate, close } = await openChrome(port)
  const shot = async (name) => {
    await sleep(500)
    // WebP вместо PNG: в несколько раз легче при том же виде.
    const { result } = await send('Page.captureScreenshot', { format: 'webp', quality: 88 })
    writeFileSync(join(dir, `${name}.webp`), Buffer.from(result.data, 'base64'))
    console.log(`${platform}/${language}/${name}.webp`)
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
      localStorage.setItem('somascan.settings.v1', ${JSON.stringify(JSON.stringify(settings(target, language)))})
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
    await click('.action-button', text.edit)
    await sleep(1200)
    await shot('03-editing')
    await click('.action-button', text.done)
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
    await click('.action-button', text.noPhoto)
    await sleep(1500)
    await shot('04-no-photo')

    await click('.action-button', text.grid)
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
    await click('.tab', text.general)
    await sleep(1200)
    await evaluate(`document.querySelector('.disclosure button, .disclosure [role=button]')?.click()`)
    await sleep(1500)
    await scrollToSection(text.model)
    await shot('07-settings-model')
    await click('.tab', text.storage)
    await sleep(1500)
    // Низ группы таблицы: путь, лист и правила записи.
    await evaluate(`document.querySelector('.list[aria-label="${text.rules}"]')?.scrollIntoView({ block: 'end' })`)
    await sleep(600)
    await shot('08-settings-storage')
    await click('.tab', text.advanced)
    await sleep(1500)
    await shot('10-settings-advanced')

    // Google Drive — с его списком листов (см. `tableSheets`), поэтому заново.
    await load('googleDrive')
    await evaluate(`document.querySelectorAll('.header-actions .action-button')[1].click()`)
    await sleep(1200)
    await click('.tab', text.storage)
    await sleep(1500)
    await scrollToSection(text.googleAccount)
    await shot('09-settings-drive')
  } finally {
    close()
  }
}

/**
 * Обзор платформы для README: десять кадров сеткой 5 × 2 с подписями на языке `language`. Фон прозрачный,
 * подписи серые — читаются и в светлой, и в тёмной теме GitHub.
 */
async function overview(platform, language, port) {
  const dir = join(OUT, platform)
  const page = join(TEMP, `overview-${platform}-${language}.html`)
  const figures = SHOTS.map((shot) => `<figure><img src="${pathToFileURL(join(dir, language, `${shot.name}.webp`))}" alt=""><figcaption>${shot[language]}</figcaption></figure>`).join('')
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; }
    body { font: 600 22px/1.25 Inter, ui-sans-serif, system-ui, sans-serif; color: #8c959f; }
    main { display: grid; grid-template-columns: repeat(5, ${OVERVIEW_TILE}px); gap: 34px 26px; padding: 6px; width: max-content; }
    figure { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 0; }
    img { display: block; width: ${OVERVIEW_TILE}px; aspect-ratio: ${SCREEN.width} / ${SCREEN.height}; border-radius: 22px; box-shadow: 0 0 0 1px rgb(140 149 159 / .4); }
    figcaption { text-align: center; }
  </style><main>${figures}</main>`)
  const { send, evaluate, close } = await openChrome(port)
  try {
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
    await send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1600, deviceScaleFactor: 1, mobile: false })
    await send('Page.enable')
    await send('Page.navigate', { url: pathToFileURL(page).href })
    await sleep(1500)
    const size = await evaluate(`(async () => {
      await Promise.all([...document.images].map((image) => image.decode()))
      const box = document.querySelector('main').getBoundingClientRect()
      return { width: Math.ceil(box.width), height: Math.ceil(box.height) }
    })()`)
    const { result } = await send('Page.captureScreenshot', { format: 'webp', quality: 90, clip: { x: 0, y: 0, ...size, scale: 1 }, captureBeyondViewport: true })
    writeFileSync(join(dir, `overview.${language}.webp`), Buffer.from(result.data, 'base64'))
    console.log(`${platform}/overview.${language}.webp`)
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
  let port = DEBUG_PORT
  for (const platform of ['android', 'ios']) {
    for (const language of LANGUAGES) {
      await capture(platform, language, port++)
      await overview(platform, language, port++)
    }
  }
} finally {
  preview.kill()
  lmStudio.close()
}
