/**
 * Пустой шаблон журнала проб (`template/Probe otel.xlsx`): из него создаётся журнал,
 * если файла по пути из настроек ещё нет. Шаблон собран из настоящего журнала скриптом
 * `scripts/lab-table/make-template.ts` — та же шапка, оформление и размеченные строки, без данных.
 */
import { UploadError } from '../UploadError'
import templateUrl from './template/Probe otel.xlsx?url'

/** Загружает шаблон из ресурсов приложения. */
export async function loadTableTemplate(): Promise<Uint8Array> {
  const response = await fetch(templateUrl)
  if (!response.ok) throw new UploadError('io', { detail: `template: HTTP ${response.status}` })
  return new Uint8Array(await response.arrayBuffer())
}
