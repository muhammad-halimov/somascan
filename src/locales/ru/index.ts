/**
 * Переводы для «ru», по одному JSON-файлу на пространство имён (фичу).
 * Ключи должны совпадать с `src/locales/en`; `src/i18n/resources.ts` проверяет это при компиляции.
 */
import common from './common.json'
import errors from './errors.json'
import label from './label.json'
import settings from './settings.json'
import uploads from './uploads.json'
import workspace from './workspace.json'

export default { common, workspace, label, settings, uploads, errors }
