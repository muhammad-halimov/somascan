/**
 * Мелочи разбора XML частей книг и документов (`.xlsx`, `.docx`) регулярными выражениями — без парсера XML:
 * текст без сущностей, текст для XML, значение атрибута. Общие у движка и главного процесса.
 */

/** Именованные сущности XML. */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Текст XML без сущностей: «&amp;» → «&», «&#10;» → перенос строки. */
export const unescapeXml = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
    return ENTITIES[code] ?? all
  })

/** Текст для XML (содержимое элемента). */
export const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Значение атрибута тега («w:x», «r:id») или `null`. */
export const xmlAttr = (tag: string, name: string): string | null => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null
