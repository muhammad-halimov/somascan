/**
 * Подписи полей для распознавания на устройстве — правила, которые можно менять в «Расширенных» → «Правила»:
 * как поле подписано на бирках разных заводов (на английском, румынском, венгерском, польском, турецком,
 * украинском и русском). Подписи сравниваются без регистра, диакритики, пробелов и знаков (`foldText`),
 * поэтому «Şarjă», «SARJA» и «sarja:» — одна подпись.
 *
 * По умолчанию — `DEFAULT_RULE_LABELS` (собраны с бирок ArcelorMittal Кривой Рог, Suez Steel, OAM Ózd, SOVEL
 * и др.). В настройках хранятся только изменённые списки (`advanced.ruleLabels`), остальные берутся отсюда.
 * РИСК: слова, которые бывают и в значениях («coil» в «Rebar in coil», «mill» в названии завода),
 * в подписи не входят — иначе строка значения считалась бы подписью; вместо них — «coil no», «bundle no».
 *
 * Здесь же — правила, которые не подписи полей (`NON_FIELD_RULE_KEYS`): по каким словам бирка считается канатом
 * и как выглядит её номер партии, производитель своих бирок, общие слова в названиях заводов, бесплатная почта.
 * В «Правилах» они в том же списке, что и подписи полей, и правятся так же.
 */
import { foldText } from './foldText'

/** Подписи встроенных полей по умолчанию. */
export const DEFAULT_RULE_LABELS: Readonly<Record<string, readonly string[]>> = {
  producer: ['producer', 'manufacturer', 'manufactured by', 'produced by', "mill's name", 'mill name', 'miils name', 'steel mill', 'gyarto', 'gyartja', 'producent', 'producator', 'fabricant', 'hersteller', 'uretici', 'производитель', 'изготовитель', 'виробник'],
  product: ['product', 'produs', 'termek', 'wyrob', 'urun', 'description', 'продукция', 'продукція', 'продукт'],
  grade: ['grade', 'steel grade', 'class', 'clasa', 'quality', 'calitate', 'calitatea', 'calitate otel', 'minoseg', 'minosites', 'jakosc', 'marca', 'marka', 'gatunek', 'kalite', 'sinif', 'qualita', 'calidad', 'nuance', 'stahlgute', 'марка', 'класс', 'клас'],
  standard: ['standard', 'standards', 'szabvany', 'norma', 'norm', 'стандарт', 'normativ'],
  technical_approval: ['technical approval', 'technical agreement', 'technical doc', 'technical documentation', 'agrement tehnic', 'agrement', 'muszaki dok', 'dokumentacja techniczna', 'aprobare tehnica'],
  quality_doc: ['certificate', 'quality certificate', 'certificate of quality', 'certificat', 'certificat de calitate', 'certyfikat', 'inspection certificate', 'tanusitvany', 'swiadectwo', 'сертификат', 'сертифікат'],
  // «sze» — частая ошибка OCR в «SIZE(mm)»; «Ø mm» (Acciaierie di Sicilia) OCR читает и как «0 mm».
  size: ['size', 'sze', 'ø mm', '0 mm', 'diameter', 'diam', 'dimension', 'dimensiune', 'diametru', 'diametro', 'diametre', 'durchmesser', 'atmero', 'przekroj', 'srednica', 'cap', 'nominal size', 'диаметр', 'діаметр', 'размер', 'розмір'],
  heat: ['heat', 'heat no', 'charge', 'sarja', 'sarje', 'adag', 'wytop', 'colada', 'colata', 'coulee', 'schmelze', 'dokum', 'cast no', 'melt', 'плавка', 'плавки'],
  batch: ['batch', 'coil no', 'coil nr', 'coil number', 'bundle no', 'bundle nr', 'bundle number', 'bund nr', 'package', 'lot', 'lotto', 'fascio', 'paquete', 'colis', 'partea', 'partei', 'partida', 'numarul rulului', 'numarul ruloului', 'numarul lotului', 'lotului', 'koteg', 'paczka', 'pachet', 'paket', 'demet', 'партия', 'партія', 'пакет'],
  weight_kg: ['weight', 'net weight', 'gross weight', 'greutate', 'greutatea', 'tomeg', 'waga', 'masa', 'agirlik', 'gewicht', 'peso', 'poids', 'вес', 'масса', 'вага', 'маса'],
  bar_count: ['n of bars', 'no of bars', 'number of bars', 'bars', 'pieces', 'pcs', 'bucati', 'buc', 'darab', 'sztuk', 'adet', 'количество', 'кількість'],
  production_date: ['date', 'p date', 'production date', 'prod date', 'data', 'datum', 'fecha', 'tarih', 'data fabricatiei', 'gyartasi datum', 'дата'],
  production_time: ['time', 'p time', 'production time', 'ora', 'ido', 'czas', 'saat', 'время', 'час'],
  shift: ['shift', 'shift no', 'schimb', 'schimbul', 'muszak', 'zmiana', 'vardiya', 'смена', 'зміна'],
  contract: ['contract', 'contract no', 'kontrakt', 'szerzodes', 'umowa', 'sozlesme', 'договор', 'договір'],
  work_order: ['work order', 'production order', 'order no', 'comanda', 'rendeles', 'zamowienie', 'siparis', 'заказ', 'замовлення'],
  customer_name: ['customer', 'customer name', 'client', 'buyer', 'cumparator', 'vevo', 'odbiorca', 'musteri', 'заказчик', 'покупатель', 'замовник'],
  destination: ['destination', 'destinatie', 'destinatia', 'customer country', 'country of destination', 'rendeltetesi hely', 'miejsce docelowe', 'назначение', 'призначення'],
  customer_ref: ['customer ref', 'customer reference', 'cumparator ref', 'comparator ref', 'buyer ref', 'ref no', 'reference'],
  serial_number: ['serial number', 'serial no', 'serial', 'code', 'cod', 'kod', 'sorszam', 'код'],
  mark: ['mark', 'rolling mark', 'marking', 'size mark', 'size mark color', 'hengerlesi azonosito', 'azonosito', 'znak walcowniczy', 'kroczacy'],
  packing: ['packing', 'packaging', 'form of delivery', 'ambalare', 'ambalaj', 'csomagolas', 'opakowanie', 'упаковка'],
  origin_country: ['made in', 'country of origin', 'origin', 'produs in', 'producer country', 'tara de origine', 'kraj pochodzenia', 'szarmazasi hely', 'страна', 'країна'],
  // ---- Правила, которые не подписи полей (`NON_FIELD_RULE_KEYS`) ----
  /** Слова бирок канатов (PC strand): плавки на них нет — её место занимает номер партии или бухты (`strandTag.ts`). */
  strand_words: ['strand', 'toroane', 'litze', 'канат'],
  /**
   * Шаблоны номера партии или бухты каната, когда подпись не прочитана: 9 — цифра, A — буква, X — буква или цифра,
   * дефис — разделитель, прочее — как есть. BPM: «260909G392-06-2», D&D Drótáru: «26D0222».
   */
  strand_lot_masks: ['999999A999-99-9', '99A9999'],
  /** Производитель своих бирок склада (после резки и гибки): завод на них не назван (`LabelExtractor`). */
  house_supplier: ['SOMACO'],
  /** Первые слова названий заводов, по которым одним завод не узнать: страна, город, «сталь» (`supplierMatch.ts`). */
  generic_supplier_words: ['acciaierie', 'ferriere', 'hellenic', 'moldova', 'promet', 'stomana', 'power', 'suez', 'alfa', 'diler'],
  /** Бесплатная и общая почта: по её домену завод не узнать (`domainProducer.ts`). */
  free_mail_domains: ['gmail', 'googlemail', 'yahoo', 'ymail', 'outlook', 'hotmail', 'live', 'msn', 'icloud', 'aol', 'gmx', 'mail', 'yandex', 'rambler', 'inbox', 'list', 'ukr', 'proton', 'protonmail', 'zoho', 'abv', 'web'],
}

/** Правила, которые не подписи полей: в «Правилах» — в том же списке, после подписей полей. */
export const NON_FIELD_RULE_KEYS = ['strand_words', 'strand_lot_masks', 'house_supplier', 'generic_supplier_words', 'free_mail_domains'] as const

/** Изменённые подписи по ключам полей (только отличающиеся от стандартных). */
export type RuleLabels = Record<string, string[]>

/** Наибольшая длина одной подписи. */
export const RULE_LABEL_MAX_LENGTH = 60

/** Наибольшее число подписей у поля. */
export const RULE_LABELS_MAX = 200

/** Имя файла экспорта правил. */
export const RULES_FILE_NAME = 'somascan-rules.json'

/** Подпись к виду для хранения: без лишних пробелов и не длиннее предела. */
export const cleanRuleLabel = (label: string) => label.replace(/\s+/g, ' ').trim().slice(0, RULE_LABEL_MAX_LENGTH)

/** Ключ сравнения: как подписи сравниваются на бирке (без регистра, диакритики, пробелов и знаков). */
const ruleKey = (label: string) => foldText(label)

/** Подписи без пустых, без повторов (в сравнении на бирке) и не больше предела. */
export function normalizeRuleLabels(labels: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of labels) {
    if (typeof raw !== 'string') continue
    const label = cleanRuleLabel(raw)
    const key = ruleKey(label)
    if (key.length < 2 || seen.has(key)) continue
    seen.add(key)
    result.push(label)
    if (result.length >= RULE_LABELS_MAX) break
  }
  return result
}

/** Подписи поля: изменённые или стандартные. */
export const ruleLabelsFor = (overrides: Readonly<Record<string, readonly string[]>>, key: string): readonly string[] =>
  overrides[key] ?? DEFAULT_RULE_LABELS[key] ?? []

/** Совпадают ли подписи со стандартными (порядок и написание не важны — важно, что ищется на бирке). */
export function isDefaultRuleLabels(key: string, labels: readonly string[]): boolean {
  const defaults = new Set((DEFAULT_RULE_LABELS[key] ?? []).map(ruleKey))
  const own = new Set(normalizeRuleLabels(labels).map(ruleKey))
  return own.size === defaults.size && [...own].every((label) => defaults.has(label))
}

/** Изменённые подписи из любого источника (настройки, файл): только известные поля, без стандартных списков. */
export function compactRuleLabels(source: unknown): RuleLabels {
  const result: RuleLabels = {}
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return result
  for (const [key, labels] of Object.entries(source)) {
    if (!(key in DEFAULT_RULE_LABELS) || !Array.isArray(labels)) continue
    const normalized = normalizeRuleLabels(labels)
    if (!isDefaultRuleLabels(key, normalized)) result[key] = normalized
  }
  return result
}

/** Экспорт: все подписи всех полей (и стандартные, и изменённые) — файл можно править и раздать коллегам. */
export function rulesToJson(overrides: Readonly<Record<string, readonly string[]>>): string {
  const labels = Object.fromEntries(Object.keys(DEFAULT_RULE_LABELS).map((key) => [key, [...ruleLabelsFor(overrides, key)]]))
  return `${JSON.stringify({ app: 'somascan', rules: 1, labels }, null, 2)}\n`
}

/**
 * Импорт: `{ "labels": { "<поле>": [подписи] } }` или сам объект с полями; BOM в начале допускается.
 * @returns Подписи из файла по полям (только известные поля) или `null`, если это не правила.
 */
export function parseRulesJson(text: string): RuleLabels | null {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return null
  }
  const source = typeof data === 'object' && data !== null && !Array.isArray(data) && 'labels' in data ? (data as { labels: unknown }).labels : data
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null
  const result: RuleLabels = {}
  for (const [key, labels] of Object.entries(source)) {
    if (key in DEFAULT_RULE_LABELS && Array.isArray(labels)) result[key] = normalizeRuleLabels(labels)
  }
  return Object.keys(result).length > 0 ? result : null
}
