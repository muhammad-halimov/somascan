/**
 * «Звонок» Somasync через Firebase Firestore (необязательно, «Хранилище → Google Drive → Firebase Firestore»).
 *
 * Somasync переносит бирки из копии журнала в Google Drive в журнал на сетевом диске и сам проверяет копию раз
 * в 15 с. Со «звонком» телефон после записи бирки обновляет документ `somascan-bells/<канал>`, а Somasync, который
 * слушает его, переносит бирку сразу. Канал — SHA-256 от id папки и имени таблицы: у телефона и Somasync он
 * одинаковый без отдельной настройки. Данных в Firestore нет: в документе — только время последнего звонка (поле,
 * которое меняется, чтобы Somasync получил уведомление); бирки остаются в Drive.
 *
 * Запрос — REST `documents:commit` с ключом Web API проекта Firebase (POST: нативный HTTP Android не умеет PATCH);
 * права — правилами Firestore (README, «Выгрузка в Google Drive»). Звонок не удался — не беда: Somasync всё равно
 * найдёт бирку при проверке копии.
 */
import type { FirestoreBellSettings } from '@/features/settings/store/settingsSchema'
import { sha256Hex } from '@/lib/encoding/sha256'

/** Коллекция «звонков». */
export const BELL_COLLECTION = 'somascan-bells'

/** Канал «звонка» таблицы: SHA-256 от `<id папки>/<имя таблицы с .xlsx>` (так же считает Somasync). */
export const bellChannel = (folderId: string, fileName: string) => sha256Hex(`${folderId}/${fileName}`)

/** Включён ли «звонок» и заданы ли проект и ключ. */
export const isBellConfigured = (bell: FirestoreBellSettings | undefined): bell is FirestoreBellSettings =>
  Boolean(bell?.enabled && bell.projectId.trim() && bell.apiKey.trim())

/**
 * Звонит Somasync: обновляет документ канала (только время звонка).
 * @throws {Error} Firestore ответил ошибкой (неверный проект или ключ, правила не пускают).
 */
export async function ringBell(bell: FirestoreBellSettings, folderId: string, fileName: string, fetcher: typeof fetch, now = Date.now()): Promise<void> {
  const project = bell.projectId.trim()
  const database = `projects/${project}/databases/(default)`
  const write = {
    update: {
      name: `${database}/documents/${BELL_COLLECTION}/${bellChannel(folderId, fileName)}`,
      fields: { at: { timestampValue: new Date(now).toISOString() } },
    },
  }
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents:commit?key=${encodeURIComponent(bell.apiKey.trim())}`
  const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: [write] }) })
  if (!response.ok) throw new Error(`Firestore HTTP ${response.status}`)
}
