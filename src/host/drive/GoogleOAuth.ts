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

/** Страница, которую браузер показывает после входа. */
export interface SignInPages {
  /** Вход выполнен — можно вернуться в программу. */
  done: string
  /** Вход не выполнен (отказ или ошибка). */
  failed: string
}

/** Простая страница с одной строкой. */
const page = (text: string) => `<!doctype html><meta charset="utf-8"><title>Somasync</title><body style="font:16px system-ui;padding:48px;text-align:center">${text.replace(/</g, '&lt;')}</body>`

/**
 * Вход в браузере: слушает `127.0.0.1` на свободном порту, открывает страницу входа, ждёт ответа Google
 * с кодом и меняет код на токены.
 * @param open Открывает адрес в браузере системы.
 */
export function signIn(client: OAuthClient, open: (url: string) => void, pages: SignInPages, fetcher: typeof fetch = fetch): Promise<OAuthTokens> {
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
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(ok ? pages.done : pages.failed))
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
