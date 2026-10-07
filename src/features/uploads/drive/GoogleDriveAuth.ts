/**
 * Вход через Google для Drive — обёртка над локальным плагином `GoogleDriveAuth`
 * (`android/.../GoogleDriveAuthPlugin.java`, `ios/App/App/GoogleDriveAuthPlugin.swift`).
 *
 * Android — Google Identity AuthorizationClient, iOS — Google Sign-In SDK. Оба выдают
 * короткоживущий access-токен с доступом к Drive; после первого входа токен берётся без
 * участия пользователя (`getAccessToken`), поэтому фоновая очередь пишет таблицу сама.
 * Если доступ отозван или вход не выполнен — `authRequired`: нужно войти заново в настройках.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { UploadError } from '../UploadError'

/** Область доступа: чтение и запись файлов на Drive пользователя (нужна для уже существующей папки). */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

/** Контракт нативного плагина. */
interface GoogleDriveAuthPlugin {
  /** Интерактивный вход: выбор аккаунта и согласие на доступ к Drive. */
  signIn(options: { scopes: string[] }): Promise<{ accessToken: string }>
  /** Токен без интерфейса; отказ `notSignedIn` / `authRequired`, если нужен вход. */
  getAccessToken(options: { scopes: string[] }): Promise<{ accessToken: string }>
  /** Выход: забыть аккаунт и отозвать доступ (Android отзывает доступ по почте аккаунта). */
  signOut(options: { email: string }): Promise<void>
}

/** Плагин есть только в нативных сборках. */
const GoogleDriveAuth = registerPlugin<GoogleDriveAuthPlugin>('GoogleDriveAuth')

/** Отказ плагина в виде `UploadError`. */
function toAuthError(error: unknown): UploadError {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  const detail = error instanceof Error ? error.message : String(error)
  if (code === 'UNIMPLEMENTED') return new UploadError('unavailable', { detail })
  if (code === 'notConfigured') return new UploadError('driveNotConfigured', { detail })
  if (code === 'cancelled') return new UploadError('cancelled', { detail })
  if (code === 'notSignedIn' || code === 'authRequired') return new UploadError('authRequired', { detail })
  return new UploadError('hostUnreachable', { detail })
}

/** Вход в Google и токены доступа к Drive. */
export class GoogleDriveSession {
  /** Интерактивный вход; возвращает токен. */
  async signIn(): Promise<string> {
    if (!Capacitor.isNativePlatform()) throw new UploadError('unavailable')
    try {
      return (await GoogleDriveAuth.signIn({ scopes: [DRIVE_SCOPE] })).accessToken
    } catch (error) {
      throw toAuthError(error)
    }
  }

  /** Свежий токен без участия пользователя. */
  async accessToken(): Promise<string> {
    if (!Capacitor.isNativePlatform()) throw new UploadError('unavailable')
    try {
      return (await GoogleDriveAuth.getAccessToken({ scopes: [DRIVE_SCOPE] })).accessToken
    } catch (error) {
      throw toAuthError(error)
    }
  }

  /** Выход из аккаунта `email`: доступ отзывается, при следующем входе можно выбрать другой аккаунт. */
  async signOut(email: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return
    await GoogleDriveAuth.signOut({ email }).catch(() => undefined)
  }
}

/** Общая сессия приложения. */
export const googleDriveSession = new GoogleDriveSession()
