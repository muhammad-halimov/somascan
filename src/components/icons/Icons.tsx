/**
 * Встроенные SVG-иконки.
 *
 * Иконки декоративные (`aria-hidden`): доступное имя несёт кнопка, в которой лежит иконка.
 * Обводка, заливка и размер задаются CSS контейнера, поэтому одна иконка подходит везде.
 */
import lmStudioLogoUrl from '@/assets/brands/lmstudio.png'
import './Icons.css'

/** Стрелка из лотка: список загрузок. */
export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" />
    </svg>
  )
}

/** Шестерня: настройки. Залитое тело с «дыркой» (см. ActionButton.css). */
export function SettingsIcon() {
  return (
    <svg className="settings-glyph" viewBox="0 0 24 24" aria-hidden="true">
      {/* Отверстие в центре — настоящее (evenodd), а не круг цвета фона: иначе на стекле iOS 26 и поверх волны Android виден лишний диск. */}
      <path
        className="settings-glyph-body"
        fillRule="evenodd"
        d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.6-.21l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54a7.3 7.3 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.6.21L2.72 8.47a.5.5 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32a.5.5 0 0 0 .6.21l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54a7.3 7.3 0 0 0 1.62-.94l2.39.96a.5.5 0 0 0 .6-.21l1.92-3.32a.5.5 0 0 0-.12-.61l-2.03-1.58ZM12 14.65a2.65 2.65 0 1 1 0-5.3 2.65 2.65 0 0 1 0 5.3Z"
      />
    </svg>
  )
}

/** Крестик: закрыть панель или режим, сбросить. */
export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m18 6-12 12M6 6l12 12" />
    </svg>
  )
}

/** Круговые стрелки: повернуть фото. */
export function RotateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 0 0-14.2-4.8L4 8m0 0V4m0 4h4m-4 5a8 8 0 0 0 14.2 4.8L20 16m0 0v4m0-4h-4" />
    </svg>
  )
}

/** Карандаш: редактировать. */
export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 5 4 4M4 20l4.2-.9L19 8.3a2.1 2.1 0 0 0-3-3L5.2 16.1 4 20Z" />
    </svg>
  )
}

/** Стрелка против часовой: сброс настроек, повтор распознавания. */
export function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

/** Стрелка вправо: следующий шаг. */
export function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12h15m-6-6 6 6-6 6" />
    </svg>
  )
}

/** Плюс: добавить фото. */
export function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** Галочка: выбранный пункт или статус «завершено». */
export function CheckIcon() {
  return (
    <svg className="action-check-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 13 4 4L19 7" />
    </svg>
  )
}

/** Корзина: удалить запись. */
export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
    </svg>
  )
}

/** Открытый глаз: показать скрытое значение. */
export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/** Перечёркнутый глаз: скрыть значение. */
export function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" />
    </svg>
  )
}

/** Пустой лоток: пустой список. */
export function EmptyInboxIcon() {
  return (
    <svg className="empty-inbox-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 12h-6l-2 3h-4l-2-3H2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7Z" />
      <path d="M5.45 5.11 2 12v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
      <path d="m9 9 3-3 3 3M12 6v6" />
    </svg>
  )
}

/** Две круговые стрелки: обновить список. */
export function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M21 21v-5h-5" />
    </svg>
  )
}

/** Солнце: включить светлую тему. */
export function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

/** Луна: включить тёмную тему. */
export function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  )
}

/** Минус: уменьшить масштаб. */
export function ZoomOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  )
}

/**
 * Стрелка по часовой стрелке: повернуть фото.
 * Пара к `ResetIcon` (стрелка против часовой) из того же набора.
 */
export function RotateClockwiseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}

/** Логотип Google («G») в фирменных цветах — для кнопки «Войти через Google». */
export function GoogleLogo() {
  return (
    <svg className="google-logo brand-icon" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

/** Ползунки: основные настройки. */
export function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
    </svg>
  )
}

/** Цилиндр базы данных: хранилище. */
export function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  )
}

/** Гаечный ключ: дополнительные настройки. */
export function WrenchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
    </svg>
  )
}



/** Календарь: срок давности моделей. */
export function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}

/** Бесконечность: без ограничения. */
export function InfinityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z" />
    </svg>
  )
}

/** Картинка: размер фото. */
export function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
    </svg>
  )
}

/** Рамка с углами: оригинальный размер фото. */
export function MaximizeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  )
}

/** Звёздочка-«вспышка» в фирменном цвете Claude: провайдер Anthropic. */
export function ClaudeLogo() {
  return (
    <svg className="brand-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v18M3 12h18M5.64 5.64l12.72 12.72M18.36 5.64 5.64 18.36" fill="none" stroke="#D97757" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

/** Три переплетённых лепестка (по мотивам знака OpenAI): провайдер OpenAI. */
export function OpenAILogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="12" rx="9" ry="4" />
      <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)" />
    </svg>
  )
}

/** Логотип Google Drive в фирменных цветах. */
export function GoogleDriveLogo() {
  return (
    <svg className="brand-icon" viewBox="0 0 87.3 78" aria-hidden="true">
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" />
      <path fill="#ea4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
      <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  )
}

/** Официальный логотип LM Studio (растровый, из `src/assets/brands`). */
export function LMStudioLogo() {
  return <img className="brand-icon brand-image" src={lmStudioLogoUrl} width={20} height={20} alt="" aria-hidden="true" draggable={false} />
}

/** Логотип Windows (четыре синих квадрата): сетевой диск Windows (SMB). */
export function WindowsLogo() {
  return (
    <svg className="brand-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#0078D4" d="M2 2h9.5v9.5H2zM12.5 2H22v9.5h-9.5zM2 12.5h9.5V22H2zM12.5 12.5H22V22h-9.5z" />
    </svg>
  )
}

/** Глобус: язык интерфейса. */
export function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

/** Искры: ИИ-провайдер. */
export function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
      <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
    </svg>
  )
}

/** Слои: модели. */
export function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 2 10 5-10 5L2 7l10-5Z" />
      <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
    </svg>
  )
}

/** Звено цепи: адрес сервера. */
export function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

/** Ключ: API-ключ. */
export function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  )
}

/** Папка: расположение таблицы. */
export function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}

/** Человек: учётная запись. */
export function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </svg>
  )
}

/** Таблица: файл .xlsx. */
export function TableIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M12 3v18" />
    </svg>
  )
}

/** Таблица с лупой: проверить, есть ли таблица. */
export function TableSearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
      <path d="M3 9h18M3 15h9M12 3v18" />
      <circle cx="17.5" cy="17.5" r="3.5" />
      <path d="m22 22-2-2" />
    </svg>
  )
}

/** Список: списки моделей. */
export function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}

/** Буква «i» в круге: справка, «о приложении». */
export function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  )
}

/** Вилка: проверка подключения. */
export function PlugIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22v-5M9 8V2M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  )
}

/** Бирка: данные с бирки. */
export function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42Z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  )
}

/** Завод: известные поставщики. */
export function FactoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 20V9l6 4V9l6 4V4h6v16Z" />
      <path d="M2 20h20" />
      <path d="M7 16h1M12 16h1M17 16h1" />
    </svg>
  )
}

/** Палитра: тема оформления. */
export function PaletteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2Z" />
    </svg>
  )
}

/** Часы: запись ждёт своей очереди на выгрузку. */
export function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

/** Треугольник с восклицательным знаком: запись не удалась. */
export function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  )
}

/** Галочка-уголок вниз: шторка раскрывается (в раскрытом виде поворачивается вверх). */
export function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/** Два уголка вверх и вниз: значок всплывающего меню выбора iOS (chevron.up.chevron.down). */
export function ChevronUpDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="chevron-up-down-icon">
      <path d="m7 9 5-5 5 5M7 15l5 5 5-5" />
    </svg>
  )
}

/** Залитый треугольник вниз: значок выпадающего списка Material (arrow_drop_down). */
export function ArrowDropDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="arrow-drop-down-icon">
      <path d="M7 10l5 5 5-5z" />
    </svg>
  )
}

/** Сетка 3 × 3: все бирки на экране (до девяти фото). */
export function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="3.5" width="4.5" height="4.5" rx="1.2" />
      <rect x="9.75" y="3.5" width="4.5" height="4.5" rx="1.2" />
      <rect x="16" y="3.5" width="4.5" height="4.5" rx="1.2" />
      <rect x="3.5" y="9.75" width="4.5" height="4.5" rx="1.2" />
      <rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1.2" />
      <rect x="16" y="9.75" width="4.5" height="4.5" rx="1.2" />
      <rect x="3.5" y="16" width="4.5" height="4.5" rx="1.2" />
      <rect x="9.75" y="16" width="4.5" height="4.5" rx="1.2" />
      <rect x="16" y="16" width="4.5" height="4.5" rx="1.2" />
    </svg>
  )
}

/**
 * «Назад» в стиле платформы: на iOS — уголок (chevron.backward), иначе — стрелка Material (arrow_back).
 * Рисуются обе, лишнюю прячет CSS (см. Icons.css).
 */
export function BackIcon() {
  return (
    <>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="back-icon-ios">
        <path d="m14.5 5-7 7 7 7" />
      </svg>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="back-icon-material">
        <path d="M20 12H4m6-6-6 6 6 6" />
      </svg>
    </>
  )
}

/** Восклицательный знак: требует внимания (например, у бирки не выбрана форма). */
export function ExclamationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5.5v8.5" />
      <path d="M12 18.6h.01" />
    </svg>
  )
}
