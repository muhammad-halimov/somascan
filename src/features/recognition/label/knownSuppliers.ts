/**
 * Известные поставщики — заводы, чей металл приходит на склад.
 *
 * Список подставляется в промпт: если название завода на бирке читается плохо и модель
 * прочла что-то отдалённо похожее, она берёт написание из списка вместо выдуманного.
 * Чётко напечатанное название переписывается как есть (новый поставщик тоже возможен).
 * Список по умолчанию собран из журнала проб стали для лаборатории (2016–2026, столбец «Producator»):
 * варианты написания и опечатки одного завода сведены в одно название.
 */

/** Поставщики по умолчанию, по алфавиту. */
export const DEFAULT_KNOWN_SUPPLIERS: readonly string[] = [
  'Abinsk ESW',
  'Acciaierie di Sicilia',
  'Alfa Acciai',
  'ArcelorMittal',
  'Colakoglu Metalurji',
  'Comsid',
  'COS Targoviste',
  'Damila',
  'Diler Demir Celik',
  'Donalam',
  'Ductil Steel',
  'Elmarakby Steel',
  'EuropMetal',
  'Feralpi Siderurgica',
  'Ferriere Nord',
  'Habas',
  'Halro Steel',
  'Hellenic Halyvourgia',
  'Icdas',
  'Kaptan Demir Celik',
  'MDA',
  'Metinvest',
  'Mitliv',
  'Moldova Steel Works',
  'OAM Ózdi Acélművek',
  'Pittini',
  'Power Steel',
  'Procema',
  'Promet Steel',
  'Sidenor',
  'Sovel',
  'Stomana Industry',
  'Suez Steel',
  'Tosyali Algerie',
  'Yesilyurt Demir',
]

/** Наибольшая длина одного названия: защищает промпт от случайно вставленного длинного текста. */
export const SUPPLIER_NAME_MAX_LENGTH = 80

/** Приводит название к виду для хранения: без лишних пробелов и не длиннее предела. */
export const cleanSupplierName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, SUPPLIER_NAME_MAX_LENGTH)

/** Ключ сравнения: одно и то же название в разном регистре — один поставщик. */
export const supplierKey = (name: string) => cleanSupplierName(name).toLocaleLowerCase()

/** Сравнение для сортировки по алфавиту без учёта регистра и диакритики. */
const collator = new Intl.Collator('en', { sensitivity: 'base' })

/**
 * Чистит список: убирает пустые названия и повторы (без учёта регистра), сортирует по алфавиту.
 * @param names Названия в любом порядке.
 */
export function normalizeSuppliers(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of names) {
    const clean = cleanSupplierName(name)
    const key = clean.toLocaleLowerCase()
    if (!clean || seen.has(key)) continue
    seen.add(key)
    result.push(clean)
  }
  return result.sort(collator.compare)
}

/** Совпадает ли список со списком по умолчанию. */
export const isDefaultSuppliers = (names: readonly string[]) =>
  names.length === DEFAULT_KNOWN_SUPPLIERS.length && names.every((name, index) => name === DEFAULT_KNOWN_SUPPLIERS[index])
