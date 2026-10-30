/**
 * Правила полей бирки для распознавания на устройстве: как поле подписано на бирках разных заводов
 * (на английском, румынском, венгерском, польском, турецком, украинском и русском) и как читается его значение.
 *
 * Подписи сравниваются без регистра, диакритики, пробелов и знаков (`foldText`), поэтому «Heat No», «HEAT NO.»
 * и «heat no:» — одна подпись. Если одна подпись — часть другой («product» в «production date»),
 * побеждает более длинная. Свои поля пользователя ищутся по их названиям на всех языках.
 */
import type { LabelFieldDefinition, LabelFieldKind, LabelKey, LabelValue } from '../label/labelFields'
import { foldText } from './foldText'
import {
  isStrongGrade, isStrongHeat, isStrongSize, isStrongWeight, readApproval, readCode, readCount, readDate, readGrade, readHeat,
  readNumberedCode, readSize, readStandard, readText, readTime, readWeightKg, type ValueReader,
} from './valueReaders'

/** Правило одного поля. */
export interface FieldRule {
  /** Ключ поля. */
  key: LabelKey
  /** Подписи поля в сложенном виде (`foldText`). */
  labels: readonly string[]
  /** Чтение значения. */
  read: ValueReader
  /** Значение выглядит ровно как значение этого поля (плавка `25R00581`, размер `12 mm`): такой кандидат сильнее. */
  strong?: (value: LabelValue) => boolean
  /** Значений может быть несколько (стандарты): собираются все, через «; ». */
  multi?: boolean
  /**
   * Подписи, которые считаются подписью только в начале строки (сложенные): «Kg: 780» — подпись веса,
   * а «2048 kg» — значение.
   */
  leadingLabels?: readonly string[]
}

/** Подписи и чтение встроенных полей. */
interface BuiltInRule {
  labels: readonly string[]
  leadingLabels?: readonly string[]
  read: ValueReader
  strong?: (value: LabelValue) => boolean
  multi?: boolean
}

/**
 * Встроенные поля: подписи с бирок (ArcelorMittal Кривой Рог, Suez Steel, OAM Ózd, SOVEL и др.).
 * РИСК: слова, которые бывают и в значениях («coil» в «Rebar in coil», «mill» в названии завода),
 * сюда не входят — иначе строка значения считалась бы подписью; вместо них — «coil no», «bundle no».
 */
const BUILT_IN_RULES: Readonly<Record<LabelKey, BuiltInRule>> = {
  producer: {
    labels: ['producer', 'manufacturer', 'manufactured by', 'produced by', "mill's name", 'mill name', 'miils name', 'steel mill', 'gyarto', 'gyartja', 'producent', 'producator', 'fabricant', 'hersteller', 'uretici', 'производитель', 'изготовитель', 'виробник'],
    read: readText,
  },
  product: {
    labels: ['product', 'produs', 'termek', 'wyrob', 'urun', 'description', 'продукция', 'продукція', 'продукт'],
    read: readText,
  },
  grade: {
    labels: ['grade', 'steel grade', 'class', 'clasa', 'quality', 'calitate', 'calitatea', 'calitate otel', 'minoseg', 'minosites', 'jakosc', 'marca', 'marka', 'gatunek', 'kalite', 'sinif', 'qualita', 'calidad', 'nuance', 'stahlgute', 'марка', 'класс', 'клас'],
    read: readGrade,
    strong: isStrongGrade,
  },
  standard: {
    labels: ['standard', 'standards', 'szabvany', 'norma', 'norm', 'стандарт', 'normativ'],
    read: readStandard,
    multi: true,
  },
  technical_approval: {
    labels: ['technical approval', 'technical agreement', 'technical doc', 'technical documentation', 'agrement tehnic', 'agrement', 'muszaki dok', 'dokumentacja techniczna', 'aprobare tehnica'],
    read: readApproval,
  },
  quality_doc: {
    labels: ['certificate', 'quality certificate', 'certificate of quality', 'certificat', 'certificat de calitate', 'certyfikat', 'inspection certificate', 'tanusitvany', 'swiadectwo', 'сертификат', 'сертифікат'],
    read: readNumberedCode,
  },
  size: {
    // «sze» — частая ошибка OCR в «SIZE(mm)»; «Ø mm» (Acciaierie di Sicilia) OCR читает и как «0 mm».
    labels: ['size', 'sze', 'ø mm', '0 mm', 'diameter', 'diam', 'dimension', 'dimensiune', 'diametru', 'diametro', 'diametre', 'durchmesser', 'atmero', 'przekroj', 'srednica', 'cap', 'nominal size', 'диаметр', 'діаметр', 'размер', 'розмір'],
    read: readSize,
    strong: isStrongSize,
  },
  heat: {
    labels: ['heat', 'heat no', 'charge', 'sarja', 'sarje', 'adag', 'wytop', 'colada', 'colata', 'coulee', 'schmelze', 'dokum', 'cast no', 'melt', 'плавка', 'плавки'],
    read: readHeat,
    strong: isStrongHeat,
  },
  batch: {
    labels: ['batch', 'coil no', 'coil nr', 'coil number', 'bundle no', 'bundle nr', 'bundle number', 'bund nr', 'package', 'lot', 'lotto', 'fascio', 'paquete', 'colis', 'partea', 'partei', 'partida', 'numarul rulului', 'numarul ruloului', 'numarul lotului', 'lotului', 'koteg', 'paczka', 'pachet', 'paket', 'demet', 'партия', 'партія', 'пакет'],
    read: readNumberedCode,
  },
  weight_kg: {
    labels: ['weight', 'net weight', 'gross weight', 'greutate', 'greutatea', 'tomeg', 'waga', 'masa', 'agirlik', 'gewicht', 'peso', 'poids', 'вес', 'масса', 'вага', 'маса'],
    leadingLabels: ['kg', 'кг'],
    read: readWeightKg,
    strong: isStrongWeight,
  },
  bar_count: {
    labels: ['n of bars', 'no of bars', 'number of bars', 'bars', 'pieces', 'pcs', 'bucati', 'buc', 'darab', 'sztuk', 'adet', 'количество', 'кількість'],
    read: readCount,
  },
  production_date: {
    labels: ['date', 'p date', 'production date', 'prod date', 'data', 'datum', 'fecha', 'tarih', 'data fabricatiei', 'gyartasi datum', 'дата'],
    read: readDate,
  },
  production_time: {
    labels: ['time', 'p time', 'production time', 'ora', 'ido', 'czas', 'saat', 'время', 'час'],
    read: readTime,
  },
  shift: {
    labels: ['shift', 'shift no', 'schimb', 'schimbul', 'muszak', 'zmiana', 'vardiya', 'смена', 'зміна'],
    read: readCode,
  },
  contract: {
    labels: ['contract', 'contract no', 'kontrakt', 'szerzodes', 'umowa', 'sozlesme', 'договор', 'договір'],
    read: readNumberedCode,
  },
  work_order: {
    labels: ['work order', 'production order', 'order no', 'comanda', 'rendeles', 'zamowienie', 'siparis', 'заказ', 'замовлення'],
    read: readNumberedCode,
  },
  customer_name: {
    labels: ['customer', 'customer name', 'client', 'buyer', 'cumparator', 'vevo', 'odbiorca', 'musteri', 'заказчик', 'покупатель', 'замовник'],
    read: readText,
  },
  destination: {
    labels: ['destination', 'destinatie', 'destinatia', 'customer country', 'country of destination', 'rendeltetesi hely', 'miejsce docelowe', 'назначение', 'призначення'],
    read: readText,
  },
  customer_ref: {
    labels: ['customer ref', 'customer reference', 'cumparator ref', 'comparator ref', 'buyer ref', 'ref no', 'reference'],
    read: readNumberedCode,
  },
  serial_number: {
    labels: ['serial number', 'serial no', 'serial', 'code', 'cod', 'kod', 'sorszam', 'код'],
    read: readNumberedCode,
  },
  mark: {
    labels: ['mark', 'rolling mark', 'marking', 'size mark', 'size mark color', 'hengerlesi azonosito', 'azonosito', 'znak walcowniczy', 'kroczacy'],
    read: readCode,
  },
  packing: {
    labels: ['packing', 'packaging', 'form of delivery', 'ambalare', 'ambalaj', 'csomagolas', 'opakowanie', 'упаковка'],
    read: readText,
  },
  origin_country: {
    labels: ['made in', 'country of origin', 'origin', 'produs in', 'producer country', 'tara de origine', 'kraj pochodzenia', 'szarmazasi hely', 'страна', 'країна'],
    read: readText,
  },
}

/** Чтение своих полей по их виду. */
const KIND_READERS: Readonly<Record<LabelFieldKind, ValueReader>> = {
  code: readCode,
  text: readText,
  number: readCount,
  weight: readWeightKg,
  date: readDate,
  time: readTime,
}

/** Подписи без повторов и пустых, в сложенном виде. */
const foldLabels = (labels: readonly string[]) => [...new Set(labels.map(foldText).filter((label) => label.length >= 2))]

/** Названия поля, заданные пользователем, на всех языках. */
const ownNames = (field: LabelFieldDefinition) => Object.values(field.names).filter((name): name is string => typeof name === 'string')

/**
 * Правила для разбора бирки: все встроенные поля (подписи выключенных тоже нужны — их значения не должны
 * достаться другим полям) и свои поля из настроек. Названия, заданные пользователем, — тоже подписи.
 * @param fields Поля из настроек (включённые и выключенные).
 */
export function buildFieldRules(fields: readonly LabelFieldDefinition[]): FieldRule[] {
  const byKey = new Map(fields.map((field) => [field.key, field]))
  const rules: FieldRule[] = Object.entries(BUILT_IN_RULES).map(([key, rule]) => {
    const field = byKey.get(key)
    return {
      key,
      ...rule,
      labels: foldLabels([...rule.labels, ...(field ? ownNames(field) : [])]),
      ...(rule.leadingLabels ? { leadingLabels: foldLabels(rule.leadingLabels) } : {}),
    }
  })
  for (const field of fields) {
    if (field.builtIn || field.manual || field.key in BUILT_IN_RULES) continue
    rules.push({ key: field.key, labels: foldLabels(ownNames(field)), read: KIND_READERS[field.kind] })
  }
  return rules
}
