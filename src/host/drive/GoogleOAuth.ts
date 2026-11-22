/**
 * Вход в Google для Drive — OAuth 2.0 для приложений на компьютере: страница входа открывается в браузере
 * системы, Google возвращает код на локальный адрес `http://127.0.0.1:<порт>` (его слушает программа),
 * код меняется на токены с PKCE. Долгоживущий refresh-токен даёт свежий access-токен без участия
 * пользователя, поэтому слежение работает и после перезапуска.
 *
 * Клиент OAuth — тип «Приложение для компьютера» (Desktop app) в Google Cloud, с включённым Drive API.
 * Берётся из сборки (`SOMASYNC_GOOGLE_CLIENT_ID`, `SOMASYNC_GOOGLE_CLIENT_SECRET`) или из файла
 * `google-oauth.json` в папке данных программы — в том виде, как его скачивает Google Cloud Console
 * (`{"installed": {"client_id", "client_secret", …}}`). Секрет такого клиента по правилам Google не тайна:
 * он есть в каждой копии программы.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { isRecord } from '@/shared/settings'

/** Область доступа: чтение и запись файлов на Drive пользователя (таблицы уже лежат в его папке). */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

/** Файл клиента OAuth в папке данных. */
export const CLIENT_FILE = 'google-oauth.json'

/** Сколько ждать входа в браузере, мс. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

/** Через сколько секунд страница после входа закрывается, а программа выходит на передний план. */
export const RETURN_SECONDS = 5

/** Клиент OAuth. */
export interface OAuthClient {
  clientId: string
  clientSecret: string
}

/** Токены после входа или обновления. */
export interface OAuthTokens {
  accessToken: string
  /** Когда access-токен истечёт (мс). */
  expiresAt: number
  /** Есть только после входа. */
  refreshToken?: string
}

/** Почему вход или обновление не удались. */
export type OAuthErrorCode = 'notConfigured' | 'cancelled' | 'authRequired' | 'network' | 'failed'

/** Ошибка входа с кодом. */
export class OAuthError extends Error {
  readonly code: OAuthErrorCode
  constructor(code: OAuthErrorCode, detail = '') {
    super(detail || code)
    this.name = 'OAuthError'
    this.code = code
  }
}

/** Клиент из сборки: `define` в `vite.host.config.ts`; без него — `null`. */
declare const __GOOGLE_OAUTH_CLIENT__: OAuthClient | null | undefined

/**
 * Клиент из JSON: формат Google Cloud Console (`installed` или `web`) или плоский `{client_id, client_secret}`.
 * @returns `null`, если нет id клиента.
 */
export function parseClient(raw: unknown): OAuthClient | null {
  const src = isRecord(raw) ? (isRecord(raw.installed) ? raw.installed : isRecord(raw.web) ? raw.web : raw) : null
  const clientId = typeof src?.client_id === 'string' ? src.client_id.trim() : ''
  const clientSecret = typeof src?.client_secret === 'string' ? src.client_secret.trim() : ''
  return clientId ? { clientId, clientSecret } : null
}

/** Клиент OAuth: из сборки, иначе из `google-oauth.json` в папке данных; `null` — Google Drive не настроен. */
export function loadClient(dataDir: string): OAuthClient | null {
  const built = typeof __GOOGLE_OAUTH_CLIENT__ === 'undefined' ? null : __GOOGLE_OAUTH_CLIENT__
  if (built?.clientId) return built
  try {
    return parseClient(JSON.parse(fs.readFileSync(path.join(dataDir, CLIENT_FILE), 'utf8')))
  } catch {
    return null
  }
}

/** base64url без `=`. */
const base64url = (bytes: Buffer) => bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Пара PKCE: секрет (остаётся в программе) и его хеш (уходит в адрес входа). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32))
  return { verifier, challenge: base64url(crypto.createHash('sha256').update(verifier).digest()) }
}

/** Адрес страницы входа Google. */
export function authUrl(client: OAuthClient, redirectUri: string, challenge: string, state: string): string {
  const query = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    // refresh-токен — каждый раз: без него после перезапуска пришлось бы входить снова
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`
}

/** Запрос к серверу токенов Google. */
async function tokenRequest(params: Record<string, string>, fetcher: typeof fetch): Promise<OAuthTokens> {
  let response: Response
  try {
    response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      // зависший сервер токенов не держит цикл слежения
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw new OAuthError('network', error instanceof Error ? error.message : String(error))
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const detail = [body.error, body.error_description].filter((x) => typeof x === 'string').join(': ') || `HTTP ${response.status}`
    // отозванный или устаревший доступ — нужен новый вход
    throw new OAuthError(body.error === 'invalid_grant' ? 'authRequired' : 'failed', detail)
  }
  return {
    accessToken: String(body.access_token ?? ''),
    expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
    ...(typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : {}),
  }
}

/** Свежий access-токен по refresh-токену. */
export function refreshAccess(client: OAuthClient, refreshToken: string, fetcher: typeof fetch = fetch): Promise<OAuthTokens> {
  return tokenRequest({ client_id: client.clientId, client_secret: client.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }, fetcher)
}

/** Отзывает доступ (выход): после этого refresh-токен недействителен. Сбой сети не мешает выходу. */
export async function revoke(token: string, fetcher: typeof fetch = fetch): Promise<void> {
  await fetcher(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined)
}

/** Тексты страницы после входа — по-английски: браузер не знает языка программы. */
const PAGE_TEXT = {
  done: { title: 'Signed in to Google', note: 'Somasync has access to Google Drive.' },
  failed: { title: 'Sign-in was not completed', note: 'Return to Somasync and try again.' },
} as const

/**
 * Страница, которую браузер показывает после входа: итог и обратный отсчёт; через `RETURN_SECONDS` с вкладка
 * закрывается. Браузер может не дать скрипту закрыть вкладку, открытую не им, — тогда просит закрыть её вручную.
 */
export function resultPage(ok: boolean): string {
  const { title, note } = PAGE_TEXT[ok ? 'done' : 'failed']
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Somasync</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#1f2328;--dim:#5b6470;--accent:${ok ? '#1e8e3e' : '#c5221f'}}
@media (prefers-color-scheme:dark){:root{--bg:#141619;--card:#1e2126;--text:#e7e9ec;--dim:#a2a9b3;--accent:${ok ? '#5bb974' : '#f28b82'}}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:420px;margin:24px;padding:32px;text-align:center;background:var(--card);border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.mark{width:48px;height:48px;margin:0 auto 12px;display:grid;place-items:center;border-radius:50%;background:var(--accent);color:#fff;font-size:26px;line-height:1}
h1{margin:0 0 6px;font-size:20px}p{margin:0;color:var(--dim)}#count{margin-top:16px;font-size:14px}
</style>
<main><div class="mark" aria-hidden="true">${ok ? '&#10003;' : '!'}</div><h1>${title}</h1><p>${note}</p><p id="count" role="status">Returning to Somasync in <b id="s">${RETURN_SECONDS}</b> s…</p></main>
<script>
let left=${RETURN_SECONDS};const s=document.getElementById('s'),count=document.getElementById('count');
const tick=setInterval(()=>{left-=1;if(left>0){s.textContent=left;return}clearInterval(tick);window.close();setTimeout(()=>{count.textContent='You can close this tab now.'},300)},1000);
</script></html>`
}

/**
 * Вход в браузере: слушает `127.0.0.1` на свободном порту, открывает страницу входа, ждёт ответа Google
 * с кодом и меняет код на токены.
 * @param open Открывает адрес в браузере системы.
 * @param back Возврат в программу: через `RETURN_SECONDS` с после страницы итога (когда она закрывается).
 */
export function signIn(client: OAuthClient, open: (url: string) => void, back: () => void = () => {}, fetcher: typeof fetch = fetch): Promise<OAuthTokens> {
  const { verifier, challenge } = pkcePair()
  const state = base64url(crypto.randomBytes(16))
  return new Promise((resolve, reject) => {
    let redirectUri = ''
    const finish = (error: OAuthError | null, tokens?: OAuthTokens) => {
      clearTimeout(timer)
      server.close()
      if (error) reject(error)
      else resolve(tokens!)
    }
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', redirectUri)
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      const ok = !!code && url.searchParams.get('state') === state
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(resultPage(ok))
      setTimeout(back, RETURN_SECONDS * 1000).unref()
      if (!ok) {
        finish(new OAuthError(url.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'failed', url.searchParams.get('error') ?? 'state'))
        return
      }
      tokenRequest({ code: code!, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }, fetcher)
        .then((tokens) => finish(null, tokens), (error: unknown) => finish(error instanceof OAuthError ? error : new OAuthError('failed', String(error))))
    })
    const timer = setTimeout(() => finish(new OAuthError('cancelled', 'timeout')), SIGN_IN_TIMEOUT_MS)
    server.on('error', (error) => finish(new OAuthError('failed', error.message)))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      redirectUri = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
      open(authUrl(client, redirectUri, challenge, state))
    })
  })
}
