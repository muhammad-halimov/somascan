/**
 * Распознавание на устройстве: поля бирки из текста OCR правилами (`LabelExtractor`).
 *
 * Фикстуры `fixtures/ocr/*.json` — настоящий текст с рамками, прочитанный OCR с фото бирок: OAM Ózd
 * (`scripts/screenshots/tag.jpg`) ровно и под наклоном 12°; та же бирка, снятая боком, — прочитанная как есть
 * (строки сверху вниз), повёрнутой правильно и вверх ногами; грязная бирка SOVEL; бирки ArcelorMittal (ровно,
 * боком, в перспективе), Acciaierie di Sicilia, ICECON (Icdas), Suez Steel (ровно, в ржавчине, съехавший столбец
 * значений), Çolakoğlu, Mescier, Diler, Moldova Steel Works и внутренняя бирка SOMACO; бирка Acciaierie di Sicilia
 * со строками, склеенными так, как это делает ML Kit (подпись и крупное значение на одной линии — одна строка).
 * Остальные бирки собраны из строк в тесте.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DEFAULT_KNOWN_SUPPLIERS } from '../src/features/recognition/label/knownSuppliers'
import { createDefaultLabelFields, enabledLabelFields, recognizedLabelFields, type LabelFieldDefinition } from '../src/features/recognition/label/labelFields'
import { companyDomains, supplierByDomain } from '../src/features/recognition/ocr/domainProducer'
import { crossCheckHeat } from '../src/features/recognition/ocr/heatCheck'
import { bestExtraction, extractLabel } from '../src/features/recognition/ocr/LabelExtractor'
import type { OcrCode, OcrPage } from '../src/features/recognition/ocr/ocrTypes'
import { matchSupplier } from '../src/features/recognition/ocr/supplierMatch'
import {
  findApproval, findCode39Text, findGrade, findMarkedSize, findOrphanHeat, findWeightLine, readCode, readDate, readGrade, readHeat, readSize, readTime, readWeightKg,
} from '../src/features/recognition/ocr/valueReaders'

/** Все поля, читаемые с фото (включены и выключенные по умолчанию). */
const ALL_FIELDS = createDefaultLabelFields().filter((field) => !field.manual).map((field) => ({ ...field, enabled: true }))

/** Поля по умолчанию: производитель, размер, плавка, вес. */
const DEFAULT_FIELDS = recognizedLabelFields(createDefaultLabelFields())

const fixture = (name: string): OcrPage => JSON.parse(readFileSync(new URL(`./fixtures/ocr/${name}.json`, import.meta.url), 'utf8')) as OcrPage

const extract = (page: OcrPage, fields: readonly LabelFieldDefinition[] = ALL_FIELDS, codes: OcrCode[] = []) =>
  extractLabel({ page, codes, fields, suppliers: DEFAULT_KNOWN_SUPPLIERS })

/** Строка бирки: текст и рамка в долях (x, y — левый верхний угол; высота строки по умолчанию 0,03). */
type Row = [text: string, x: number, y: number, width?: number]

/** Страница 1000×1000 из строк. */
function page(rows: readonly Row[], height = 0.03): OcrPage {
  const size = 1000
  return {
    rotation: 0,
    width: size,
    height: size,
    lines: rows.map(([text, x, y, width = text.length * 0.012]) => {
      const [left, top, right, bottom] = [x * size, y * size, (x + width) * size, (y + height) * size]
      return { text, corners: [left, top, right, top, right, bottom, left, bottom], confidence: 0.9 }
    }),
  }
}

test('бирка OAM Ózd: обязательные поля и остальное с настоящего OCR', () => {
  const { label, photo, score } = extract(fixture('oam-ozd'), ALL_FIELDS, [{ text: '25R00581/2650', format: 'qr' }])
  assert.equal(label.producer, 'OAM Ózdi Acélművek')
  assert.equal(label.size, '12 mm')
  assert.equal(label.heat, '25R00581')
  assert.equal(label.weight_kg, 2650)
  assert.equal(label.grade, 'B500C')
  assert.equal(label.batch, '581')
  assert.equal(label.production_date, '2025-02-12')
  assert.equal(label.mark, '8/7')
  assert.equal(label.product, 'Rebar in Coil/Betonacel tekercs')
  // Агреман из списка стандартов («RO-AT016-01/592-2025») — техническое одобрение.
  assert.match(String(label.standard), /^HU-Tekercs A-79\/2016; SR-.+; EN-.+$/)
  assert.equal(label.technical_approval, 'AT 016-01/592-2025')
  assert.equal(label.customer_name, null)
  assert.deepEqual(photo, { ok: true, issues: [] })
  assert.ok(score >= 8)
})

test('бирка OAM Ózd под наклоном 12°: строки выпрямляются', () => {
  const { label } = extract(fixture('oam-ozd-tilted'), DEFAULT_FIELDS)
  assert.deepEqual(label, { producer: 'OAM Ózdi Acélművek', size: '12 mm', heat: '25R00581', weight_kg: 2650 })
})

test('бирка снята боком: строки, прочитанные боком и вверх ногами, тоже разбираются, лучший поворот — правильный', () => {
  const sideways = extract(fixture('oam-ozd-sideways'))
  const upsideDown = extract(fixture('oam-ozd-upside-down'))
  const turned = extract(fixture('oam-ozd-turned'))
  // Прочитанное боком и вверх ногами разбирается в повёрнутых координатах — но такое фото стоит перечитать.
  assert.notEqual(sideways.turns, 0)
  assert.notEqual(upsideDown.turns, 0)
  assert.equal(turned.turns, 0)
  assert.equal(sideways.label.heat, '25R00581')
  assert.equal(upsideDown.label.heat, '25R00581')
  assert.equal(bestExtraction([sideways, upsideDown, turned]), turned)
  const { producer, size, heat, weight_kg } = turned.label
  assert.deepEqual({ producer, size, heat, weight_kg }, { producer: 'OAM Ózdi Acélművek', size: '12 mm', heat: '25R00581', weight_kg: 2650 })
})

/**
 * Страница, повёрнутая на `quarters` четвертей оборота по часовой стрелке: как если бы движок отдал рамки
 * повёрнутой бирки. `axisAligned` — рамки по осям фото (углы не по ходу текста), иначе — по ходу текста.
 */
function rotatePage(page: OcrPage, quarters: 1 | 2 | 3, axisAligned = false): OcrPage {
  const { width, height } = page
  const turn = (x: number, y: number): [number, number] =>
    quarters === 1 ? [height - y, x] : quarters === 2 ? [width - x, height - y] : [y, width - x]
  return {
    ...page,
    width: quarters === 2 ? width : height,
    height: quarters === 2 ? height : width,
    lines: page.lines.map((line) => {
      const points = [0, 1, 2, 3].map((point) => turn(line.corners[point * 2]!, line.corners[point * 2 + 1]!))
      if (!axisAligned) return { ...line, corners: points.flat() }
      const xs = points.map(([x]) => x)
      const ys = points.map(([, y]) => y)
      const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      return { ...line, corners: [left, top, right, top, right, bottom, left, bottom] }
    }),
  }
}

test('координаты движка повёрнуты на 90°, 180° или 270° — поля те же, что у ровной бирки', () => {
  const upright = extract(fixture('oam-ozd'), DEFAULT_FIELDS).label
  for (const quarters of [1, 2, 3] as const) {
    for (const axisAligned of [false, true]) {
      const turned = extract(rotatePage(fixture('oam-ozd'), quarters, axisAligned), DEFAULT_FIELDS)
      assert.deepEqual(turned.label, upright, `поворот ${quarters * 90}°${axisAligned ? ', рамки по осям' : ''}`)
      assert.notEqual(turned.turns, 0)
    }
  }
})

test('грязная бирка SOVEL: значения в строку, время с двоеточиями, смена без точки', () => {
  const { label } = extract(fixture('sovel'))
  assert.equal(label.size, '8 mm')
  assert.equal(label.heat, '5800')
  assert.equal(label.weight_kg, 1990)
  assert.equal(label.production_date, '2025-12-22')
  assert.equal(label.production_time, '01:38:42')
  assert.equal(label.shift, '3')
  assert.equal(label.serial_number, '4985800')
})

test('значения после двоеточия в той же строке, тонны в килограммах, дата и время', () => {
  const { label } = extract(page([
    ['SUEZ STEEL CO.', 0.3, 0.05],
    ['Product: Rebar', 0.1, 0.15],
    ['Grade: B500B', 0.1, 0.2],
    ['Size: 12 mm', 0.1, 0.25],
    ['Heat No: 251216', 0.1, 0.3],
    ['Bundle No: 4657 / 30', 0.1, 0.35],
    ['Weight: 2.0 Ton Approx', 0.1, 0.4],
    ['Date: 04/01/2026', 0.1, 0.45],
    ['Time: 11:27 PM', 0.1, 0.5],
  ]))
  assert.equal(label.producer, 'Suez Steel')
  assert.equal(label.product, 'Rebar')
  assert.equal(label.grade, 'B500B')
  assert.equal(label.size, '12 mm')
  assert.equal(label.heat, '251216')
  assert.equal(label.batch, '4657 / 30')
  assert.equal(label.weight_kg, 2000)
  assert.equal(label.production_date, '2026-01-04')
  assert.equal(label.production_time, '23:27')
})

test('таблица: подписи в шапке, значения под ними', () => {
  const { label } = extract(page([
    ['ArcelorMittal Kryvyi Rih', 0.1, 0.05],
    ['Heat / Плавка', 0.1, 0.3, 0.15],
    ['Size, mm', 0.4, 0.3, 0.1],
    ['Weight, kg', 0.7, 0.3, 0.12],
    ['253830', 0.12, 0.345, 0.08],
    ['8', 0.43, 0.345, 0.02],
    ['2140', 0.72, 0.345, 0.06],
  ]), DEFAULT_FIELDS)
  assert.deepEqual(label, { producer: 'ArcelorMittal', size: '8 mm', heat: '253830', weight_kg: 2140 })
})

test('две подписи в одной строке: значение не уходит к чужой подписи', () => {
  const { label } = extract(page([
    ['Heat No', 0.05, 0.2, 0.1],
    ['25R00581', 0.2, 0.2, 0.1],
    ['Weight', 0.5, 0.2, 0.1],
    ['1 990 kg', 0.65, 0.2, 0.1],
    ['Diameter', 0.05, 0.3, 0.1],
    ['Ø16', 0.2, 0.3, 0.05],
  ]), DEFAULT_FIELDS)
  assert.equal(label.heat, '25R00581')
  assert.equal(label.weight_kg, 1990)
  assert.equal(label.size, '16 mm')
  assert.equal(label.producer, null)
})

test('похожие знаки в номере поправляются по QR-коду', () => {
  const rows: Row[] = [['Heat:', 0.05, 0.2, 0.08], ['25ROO581', 0.3, 0.2, 0.1]]
  assert.equal(extract(page(rows), DEFAULT_FIELDS).label.heat, '25RO0581')
  assert.equal(extract(page(rows), DEFAULT_FIELDS, [{ text: '25R00581/2650', format: 'qr' }]).label.heat, '25R00581')
})

test('данные из кода с подписями тоже читаются', () => {
  const { label } = extract(page([['www.example.com', 0.1, 0.9]]), DEFAULT_FIELDS, [{ text: 'HEAT NO: 251216\nWEIGHT: 2140 KG', format: 'qr' }])
  assert.equal(label.heat, '251216')
  assert.equal(label.weight_kg, 2140)
})

test('своё поле ищется по названиям на всех языках', () => {
  const length: LabelFieldDefinition = { key: 'length', names: { en: 'Length', ro: 'Lungime' }, hint: '', kind: 'code', enabled: true, builtIn: false }
  const { label } = extract(page([['Lungime: 12 m', 0.1, 0.2]]), [...DEFAULT_FIELDS, length])
  assert.equal(label.length, '12 m')
})

test('оценка фото: без текста — нет бирки, без подписей — переснять', () => {
  assert.deepEqual(extract(page([])).photo, { ok: false, issues: ['noTag'] })
  assert.deepEqual(extract(page([['lorem ipsum dolor', 0.1, 0.1]])).photo, { ok: false, issues: [] })
})

test('поворот фото: лучшая страница — с подписями полей', () => {
  const sideways = extract(page([['lƎ', 0.1, 0.1], ['ʇɥƃıǝM', 0.1, 0.2]]))
  const upright = extract(fixture('oam-ozd'))
  assert.equal(bestExtraction([sideways, upright]), upright)
  assert.equal(bestExtraction([]), null)
})

test('вес: единицы из значения или подписи, тысячи, тонны', () => {
  const kg = { label: 'Weight (kg)' }
  assert.equal(readWeightKg('2650', kg), 2650)
  assert.equal(readWeightKg('2 650', kg), 2650)
  assert.equal(readWeightKg('2.650', kg), 2650)
  assert.equal(readWeightKg('1990 Kg', { label: '' }), 1990)
  assert.equal(readWeightKg('2.0 Ton Approx', { label: '' }), 2000)
  assert.equal(readWeightKg('2,65', { label: 'Net weight, t' }), 2650)
  assert.equal(readWeightKg('2.65', { label: '' }), 2650)
  assert.equal(readWeightKg('12', kg), null)
  assert.equal(readWeightKg('heavy', kg), null)
})

test('размер, плавка, дата, время', () => {
  const none = { label: '' }
  assert.equal(readSize('12', none), '12 mm')
  assert.equal(readSize('Ø 16mm', none), '16 mm')
  assert.equal(readSize('R20', none), 'R20')
  assert.equal(readSize('8-16mm', none), null)
  assert.equal(readSize('B500C', none), null)
  assert.equal(readHeat('No. 25R 00581', none), '25R00581')
  assert.equal(readHeat('25R0O581', none), '25R00581')
  assert.equal(readHeat('Charge', none), null)
  assert.equal(readDate('2025-02 -12', none), '2025-02-12')
  assert.equal(readDate('22/12/2025 11:27', none), '2025-12-22')
  assert.equal(readDate('04.01.26', none), '2026-01-04')
  assert.equal(readDate('31/02/2025', none), null)
  assert.equal(readTime('11:27 AM', none), '11:27')
  assert.equal(readTime('12:05:09 am', none), '00:05:09')
  assert.equal(readTime('12:30 Production', none), '12:30')
})

test('поставщик: без регистра и диакритики, с ошибкой OCR, короткие — отдельным словом', () => {
  const suppliers = DEFAULT_KNOWN_SUPPLIERS
  assert.deepEqual(matchSupplier('İÇDAŞ ÇELİK ENERJİ', suppliers), { name: 'Icdas', exact: true })
  assert.deepEqual(matchSupplier('ArcelorMitta1 Kryvyi Rih', suppliers), { name: 'ArcelorMittal', exact: false })
  assert.deepEqual(matchSupplier('MDA S.A.', suppliers), { name: 'MDA', exact: true })
  assert.equal(matchSupplier('Commda trading', suppliers), null)
})

test('почта и сайт завода: домены без бесплатной почты, поставщик из списка по домену', () => {
  assert.deepEqual(companyDomains(['E-mail: office @ oamkft . hu', 'www.suezsteel.com.eg', 'contact: john@gmail.com', 'https://www.oamkft.hu/en']), ['oamkft', 'suezsteel'])
  assert.deepEqual(companyDomains(['EN 10080.2012', 'B500C.dat', 'Kft. Hungary']), [])
  assert.equal(supplierByDomain(['oamkft'], DEFAULT_KNOWN_SUPPLIERS), 'OAM Ózdi Acélművek')
  assert.equal(supplierByDomain(['sovel'], DEFAULT_KNOWN_SUPPLIERS), 'Sovel')
  assert.equal(supplierByDomain(['suezsteel'], DEFAULT_KNOWN_SUPPLIERS), 'Suez Steel')
  assert.equal(supplierByDomain(['newmill'], DEFAULT_KNOWN_SUPPLIERS), null)
})

test('производитель по почте или сайту, когда названия на бирке нет; напечатанное название важнее', () => {
  const producer = (rows: readonly Row[]) => extract(page(rows), DEFAULT_FIELDS).label.producer
  const heat: Row = ['Heat No: 25R00581', 0.1, 0.2]
  assert.equal(producer([heat, ['E-mail: sales@sovel.gr', 0.1, 0.8]]), 'Sovel')
  assert.equal(producer([heat, ['www.oamkft.hu', 0.1, 0.8]]), 'OAM Ózdi Acélművek')
  assert.equal(producer([heat, ['info@newmill.com', 0.1, 0.8]]), 'Newmill')
  assert.equal(producer([heat, ['info@abc.ro', 0.1, 0.8]]), 'ABC')
  assert.equal(producer([heat, ['john.doe@gmail.com', 0.1, 0.8]]), null)
  assert.equal(producer([['Producer: Habas', 0.1, 0.1], heat, ['info@sovel.gr', 0.1, 0.8]]), 'Habas')
})

test('бирка Çolakoğlu: производитель по первому слову, размер Q16, марка из «Class C», вес диапазоном, одобрение в шапке', () => {
  const { label } = extract(fixture('colakoglu'))
  const { producer, size, heat, weight_kg, grade, technical_approval, work_order, customer_name, origin_country } = label
  assert.deepEqual(
    { producer, size, heat, weight_kg, grade, technical_approval, work_order, customer_name, origin_country },
    {
      producer: 'Colakoglu Metalurji',
      size: 'Q16',
      heat: 'TZA1324',
      weight_kg: 2500,
      grade: 'B500C',
      technical_approval: 'AT 016-01/593-2025',
      work_order: 'CM6389',
      customer_name: 'INTERTRANSCOM IMPEXS.RL.',
      origin_country: 'TURKEY',
    },
  )
})

test('бирка Suez Steel: подписи слева, значения под ними, вес в тоннах', () => {
  const { label } = extract(fixture('suez'))
  const { size, heat, weight_kg, grade, standard, technical_approval, production_date, serial_number } = label
  assert.deepEqual(
    { size, heat, weight_kg, grade, standard, technical_approval, production_date, serial_number },
    { size: 'R20', heat: '2620037', weight_kg: 2000, grade: 'B500C', standard: 'ST009:2011', technical_approval: '016-01-584-2025', production_date: '2026-01-04', serial_number: 'L620037025A2260104' },
  )
})

test('бирка Suez Steel в ржавчине: подпись плавки съедена («Hea.da») — плавка по виду и столбцу значений', () => {
  const { producer, size, heat, weight_kg } = extract(fixture('suez-rust'), DEFAULT_FIELDS).label
  assert.deepEqual({ producer, size, heat, weight_kg }, { producer: 'Suez Steel', size: 'R22', heat: '2620040', weight_kg: 2000 })
})

test('плавка без подписи: только строка, которая целиком похожа на номер плавки', () => {
  assert.equal(findOrphanHeat('2620040'), '2620040')
  assert.equal(findOrphanHeat('3557'), null)
  assert.equal(findOrphanHeat('05/01/2026'), null)
  assert.equal(findOrphanHeat('11:38AM'), null)
  assert.equal(findOrphanHeat('L620040055A2260105R22B500C'), null)
  assert.equal(findOrphanHeat('56 Approx'), null)
})

test('правила значений: марка с классом отдельно, диапазон веса, пометка Q, двоеточие в коде, номер одобрения', () => {
  const context = { label: '' }
  assert.equal(readGrade('B500DuctilityClassC acctoAT018', context), 'B500C')
  assert.equal(readGrade('B500 Ductility', { label: 'QUALITY:B500 Ductility Class C acc to AT' }), 'B500C')
  assert.equal(readGrade('BSt 500 S', context), 'BSt500S')
  assert.equal(readGrade('C acctoAT018', context), null)
  assert.equal(readGrade('St3sp', context), 'St3sp')
  assert.equal(readWeightKg('abt 2-2,5 mt', context), 2500)
  assert.equal(readWeightKg('2.0 Ton Approx', context), 2000)
  assert.equal(readSize('.Q16', context), 'Q16')
  assert.equal(readSize('Ф12', context), '12 mm')
  assert.equal(readCode('C:M6389', context), 'CM6389')
  assert.equal(findApproval('NEWAT 016-01/600-2025'), 'AT 016-01/600-2025')
  assert.equal(findApproval('EN 10080:2005'), null)
})

test('поставщик по отличительному первому слову названия, но не по общему', () => {
  const suppliers = DEFAULT_KNOWN_SUPPLIERS
  assert.deepEqual(matchSupplier('COLAKOGLU', suppliers), { name: 'Colakoglu Metalurji', exact: false })
  assert.equal(matchSupplier('Made in Moldova', suppliers), null)
  assert.equal(matchSupplier('Hellenic Republic', suppliers), null)
})

/** Основные поля бирки. */
const mainFields = (page: OcrPage) => {
  const { producer, grade, size, heat, batch, weight_kg, technical_approval, standard } = extract(page).label
  return { producer, grade, size, heat, batch, weight_kg, technical_approval, standard }
}

test('бирка ArcelorMittal: подпись в две строки (румынская над английской), значение между ними; «3500C» — B500C', () => {
  assert.deepEqual(mainFields(fixture('arcelor')), {
    producer: 'ArcelorMittal',
    grade: 'B500C',
    size: null,
    heat: '241182',
    batch: '4635/29',
    weight_kg: 2048,
    technical_approval: 'AT 003-01/195-2024',
    standard: null,
  })
})

test('бирка ArcelorMittal боком: обрезанные логотип и подпись размера, агреман из списка стандартов', () => {
  const { turns } = extract(fixture('arcelor-sideways'))
  assert.notEqual(turns, 0)
  assert.deepEqual(mainFields(fixture('arcelor-sideways')), {
    producer: 'ArcelorMittal',
    grade: 'B500C',
    size: '12 mm',
    heat: '251216',
    batch: '4657/30',
    weight_kg: 2048,
    technical_approval: 'AT 003-01/195-2024',
    standard: 'ST009-2011',
  })
})

test('бирка ArcelorMittal в перспективе: плавка не достаётся стандарту, вес с «kg» — без подписи', () => {
  const { producer, size, heat, batch, weight_kg, standard } = mainFields(fixture('arcelor-perspective'))
  assert.deepEqual({ producer, size, heat, batch, weight_kg, standard }, {
    producer: 'ArcelorMittal',
    size: '10 mm',
    heat: '260619',
    batch: '4839/24',
    weight_kg: 2066,
    standard: 'ST009-2011',
  })
})

test('бирка Acciaierie di Sicilia: плавка с точкой, «Ø mm 10,0»', () => {
  const { label } = extract(fixture('ads-sicilia'))
  const { producer, size, heat, weight_kg, production_date, grade } = label
  assert.deepEqual({ producer, size, heat, weight_kg, production_date, grade }, {
    producer: 'Acciaierie di Sicilia',
    size: '10 mm',
    heat: '2688.26',
    weight_kg: 1450,
    production_date: '2026-06-12',
    grade: null,
  })
})

test('бирка ICECON (Icdas): румынские подписи, «Ø» прочитан как ноль, класс пластичности отдельной строкой', () => {
  assert.deepEqual(mainFields(fixture('icecon')), {
    producer: 'Icdas',
    grade: 'B500C',
    size: '14 mm',
    heat: '2608-3-378-50',
    batch: '22',
    weight_kg: 1984,
    technical_approval: 'AT 016-01/573-2025',
    standard: null,
  })
})

test('бирка Suez Steel в перспективе: столбец значений съехал на строку от подписей — значения находят свои подписи', () => {
  const { label } = extract(fixture('suez-shifted'))
  const { production_date, heat, size, grade, standard, weight_kg, bar_count, mark, technical_approval, work_order, destination, serial_number } = label
  assert.deepEqual({ production_date, heat, size, grade, standard, weight_kg, bar_count, mark, technical_approval, work_order, destination, serial_number }, {
    production_date: '2026-02-05',
    heat: '2602N0697',
    size: 'R20',
    grade: 'B500C',
    standard: 'ST009:2011',
    weight_kg: 2000,
    bar_count: 67,
    mark: 'HADIDNA',
    technical_approval: '016-01-584-2025',
    work_order: 'RL0146/2025G',
    destination: 'Romania',
    serial_number: 'K6N0697032D3260205',
  })
})

test('бирка Suez Steel: логотип прочитан с ошибками («Suez Gtee»), лишняя буква в агремане', () => {
  const { producer, heat, size, technical_approval } = extract(fixture('suez-logo')).label
  assert.deepEqual({ producer, heat, size, technical_approval }, { producer: 'Suez Steel', heat: '2602N0668', size: 'R8', technical_approval: '016-01-584-2025' })
})

test('бирки Çolakoğlu, Mescier, Diler, Moldova Steel Works', () => {
  const { standard: _standard, ...colakoglu } = mainFields(fixture('colakoglu-q10'))
  assert.deepEqual(colakoglu, {
    producer: 'Colakoglu Metalurji', grade: 'B500C', size: 'Q10', heat: 'TY21948', batch: null, weight_kg: 2500, technical_approval: 'AT 016-01/593-2025',
  })
  const mescier = mainFields(fixture('mescier'))
  assert.deepEqual({ producer: mescier.producer, grade: mescier.grade, heat: mescier.heat }, { producer: 'Mescier', grade: 'S275JR', heat: '2501320' })
  const diler = mainFields(fixture('diler'))
  assert.deepEqual(
    { producer: diler.producer, grade: diler.grade, size: diler.size, heat: diler.heat, weight_kg: diler.weight_kg },
    { producer: 'Diler Demir Celik', grade: 'B500C', size: '20 mm', heat: '2505922', weight_kg: 1956.24 },
  )
  assert.deepEqual(mainFields(fixture('moldova')), {
    producer: 'Moldova Steel Works', grade: 'B500C', size: null, heat: '42600058', batch: '41', weight_kg: 2706, technical_approval: 'AT 003-01/200-2024', standard: null,
  })
})

test('внутренняя бирка SOMACO: «Kg: 780», марка слита с размером, плавка — номер под штрихкодом, производитель SOMACO', () => {
  const { producer, grade, weight_kg, heat } = extract(fixture('somaco')).label
  assert.deepEqual({ producer, grade, weight_kg, heat }, { producer: 'SOMACO', grade: 'B500C', weight_kg: 780, heat: 'B000713412E' })
  // SOMACO — производитель, даже когда списка поставщиков нет.
  assert.equal(extractLabel({ page: fixture('somaco'), codes: [], fields: ALL_FIELDS, suppliers: [] }).label.producer, 'SOMACO')
})

test('номер под штрихкодом Code 39 — плавка, только когда подписи плавки на бирке нет', () => {
  assert.equal(findCode39Text('*B000713412E*'), 'B000713412E')
  assert.equal(findCode39Text('*B0O0713412E'), 'B000713412E')
  assert.equal(findCode39Text('25R00581/2650*'), '25R00581/2650')
  assert.equal(findCode39Text('B000713412E'), null, 'без звёздочек — просто текст')
  assert.equal(findCode39Text('*TIMIS*'), null, 'без цифр')
  const rows: Row[] = [['Kg: 780', 0.6, 0.3], ['Lista: Tir 4', 0.1, 0.3], ['*B000713412E*', 0.4, 0.8]]
  assert.equal(extract(page(rows)).label.heat, 'B000713412E')
  // Штрихкод прочитан сам: его текст без звёздочек.
  assert.equal(extract(page(rows.slice(0, 2)), ALL_FIELDS, [{ text: 'B000713412E', format: 'code39' }]).label.heat, 'B000713412E')
  assert.equal(extract(page(rows.slice(0, 2)), ALL_FIELDS, [{ text: 'https://somaco.ro/b/1', format: 'qr' }]).label.heat, null)
  // Подпись плавки есть, а значение не прочлось: номер под штрихкодом у заводской бирки — другое поле.
  assert.equal(extract(page([...rows, ['Heat No:', 0.1, 0.5]])).label.heat, null)
})

test('столбец значений съехал от подписей: значения сдвинуты почти на строку вниз — пары по сдвигу', () => {
  const labels = ['Heat No:', 'Size:', 'Weight:', 'Grade:', 'Date:', 'Batch:']
  const values = ['251216', '12 mm', '2048', 'B500C', '12/02/2026', '4657/30']
  const rows: Row[] = [
    ...labels.map((text, index): Row => [text, 0.1, 0.1 + index * 0.04, 0.12]),
    ...values.map((text, index): Row => [text, 0.5, 0.13 + index * 0.04, 0.15]),
  ]
  const { heat, size, weight_kg, grade, production_date, batch } = extract(page(rows)).label
  assert.deepEqual(
    { heat, size, weight_kg, grade, production_date, batch },
    { heat: '251216', size: '12 mm', weight_kg: 2048, grade: 'B500C', production_date: '2026-02-12', batch: '4657/30' },
  )
})

test('подпись на двух языках в две строки: значение между строками — её', () => {
  const rows: Row[] = [['GREUTATEA', 0.1, 0.5, 0.15], ['WEIGHT', 0.1, 0.535, 0.1], ['2048', 0.5, 0.517, 0.08], ['Heat: 251216', 0.1, 0.3]]
  assert.equal(extract(page(rows)).label.weight_kg, 2048)
})

test('ML Kit склеил вторую строку подписи со значением («about kg 1450»): значение находится, перевёрнутая страница не побеждает', () => {
  const { turns, label } = extract(fixture('ads-sicilia-joined'))
  assert.equal(turns, 0)
  assert.deepEqual({ heat: label.heat, size: label.size, weight_kg: label.weight_kg }, { heat: '2688.26', size: '10 mm', weight_kg: 1450 })
})

test('бирка Moldova Steel Works, как её читает ML Kit: подписи на трёх языках, третья склеена с крупным значением, «№» — «Ne»', () => {
  const blocks: Array<[string, string, string, string]> = [
    ['Steel Grade', 'Mapka cTanu', 'Marca de otel', 'B500C / bare'],
    ['Standard', 'CTaHAapT', 'Standard', 'AT 003-01/200-2024'],
    ['Heat Ne', 'Nnaeka Ne', 'Sarja Ne', '42600058'],
    ['Size,mm', 'Pa3Mep,MM', 'Diametrul,mm', 'Ne 20'],
    ['Net weight,kg', 'Macca HeTTo,kr', 'Masa neta,kg', '2706'],
  ]
  // Строки — [текст, левый, верхний, правый, нижний край] в долях; подписи прижаты вправо к столбцу значений.
  const boxes: Array<[string, number, number, number, number]> = [['JSC "Moldova Steel Works"', 0.38, 0.18, 0.78, 0.21]]
  blocks.forEach(([first, second, third, value], index) => {
    const y = 0.3 + index * 0.085
    boxes.push([first, 0.34 - first.length * 0.011, y, 0.34, y + 0.02])
    boxes.push([second, 0.34 - second.length * 0.011, y + 0.026, 0.34, y + 0.046])
    boxes.push([`${third} ${value}`, 0.34 - third.length * 0.011, y + 0.018, 0.36 + value.length * 0.022, y + 0.072])
  })
  const lines = boxes.map(([text, left, top, right, bottom]) => ({
    text, corners: [left, top, right, top, right, bottom, left, bottom].map((value) => Math.round(value * 1000)), confidence: 0.9,
  }))
  const { turns, label } = extract({ rotation: 0, width: 1000, height: 1000, lines })
  assert.equal(turns, 0)
  const { producer, grade, technical_approval, heat, size, weight_kg } = label
  assert.deepEqual(
    { producer, grade, technical_approval, heat, size, weight_kg },
    { producer: 'Moldova Steel Works', grade: 'B500C', technical_approval: 'AT 003-01/200-2024', heat: '42600058', size: '20 mm', weight_kg: 2706 },
  )
})

test('подписи на трёх языках, средняя нечитаема: значение между крайними строками — их; испорченный «№» перед размером', () => {
  const blocks: Array<[string, string, string, string]> = [
    ['Heat Ne', 'Nnaeka Ne', 'Sarja Ne', '42600058'],
    ['Size,mm', 'Pa3Mep,MM', 'Diametrul,mm', 'Al° 20'],
    ['Net weight,kg', 'Macca HeTTo,kr', 'Masa neta,kg', '2706'],
  ]
  const boxes: Array<[string, number, number, number, number]> = []
  blocks.forEach(([first, second, third, value], index) => {
    const y = 0.3 + index * 0.085
    boxes.push([first, 0.34 - first.length * 0.011, y, 0.34, y + 0.02])
    boxes.push([second, 0.34 - second.length * 0.011, y + 0.026, 0.34, y + 0.046])
    boxes.push([third, 0.34 - third.length * 0.011, y + 0.052, 0.34, y + 0.072])
    // Крупное значение — по середине ячейки: ни с первой, ни с третьей строкой подписи вровень не стоит.
    boxes.push([value, 0.36, y + 0.012, 0.36 + value.length * 0.022, y + 0.058])
  })
  const lines = boxes.map(([text, left, top, right, bottom]) => ({
    text, corners: [left, top, right, top, right, bottom, left, bottom].map((value) => Math.round(value * 1000)), confidence: 0.9,
  }))
  const { heat, size, weight_kg } = extract({ rotation: 0, width: 1000, height: 1000, lines }).label
  assert.deepEqual({ heat, size, weight_kg }, { heat: '42600058', size: '20 mm', weight_kg: 2706 })
})

test('плавка в ржавчине сверяется с серийным номером: «2602N0888» (ML Kit) → «2602N0668», как в «L6N0668021B2260204»', () => {
  const page = fixture('suez-logo')
  const rusty = { ...page, lines: page.lines.map((line) => (line.text === '2602N0668' ? { ...line, text: '2602N0888', confidence: 0.62 } : line)) }
  assert.equal(extract(rusty).label.heat, '2602N0668')
  assert.equal(extract(page).label.heat, '2602N0668')
})

test('сверка плавки: повтор подтверждает, путаемые цифры исправляются из кода или более уверенного текста', () => {
  const serial = { text: 'Serial: L6N0668021B2260204', confidence: 0.9, exact: false }
  assert.equal(crossCheckHeat('2602N0888', 0.62, [serial]), '2602N0668')
  // Строка плавки прочитана увереннее серийного номера — плавка как есть.
  assert.equal(crossCheckHeat('2602N0888', 0.95, [serial]), '2602N0888')
  // Повтор как есть подтверждает плавку, даже если другой повтор прочитан иначе.
  assert.equal(crossCheckHeat('2602N0668', 0.5, [{ ...serial, text: 'K6N0688032D3260205', confidence: 0.99 }, { ...serial, confidence: 0.3 }]), '2602N0668')
  // Код читается без ошибок: ему веришь и без уверенности.
  assert.equal(crossCheckHeat('2620031', null, [{ text: 'L620037025A2260104R20B500C', confidence: null, exact: true }]), '2620037')
  // 1 и 6 OCR не путает; несвязанные номера ничего не меняют.
  assert.equal(crossCheckHeat('2602N0118', 0.5, [serial]), '2602N0118')
  assert.equal(crossCheckHeat('251216', 0.5, [{ text: 'B002714082 9Q-202419Q0620', confidence: 0.9, exact: false }]), '251216')
})

test('плавка без подписи: номер над таблицей (под DataMatrix) — другое поле, плавка — в строке таблицы', () => {
  // Строки — [текст, левый, верхний, правый, нижний край]; слева — вертикальная надпись во всю высоту бирки.
  const boxes: Array<[string, number, number, number, number]> = [
    ['ARCELORMITTAL KRYVYI RIH, MADE IN UKRAINE', 0.03, 0.05, 0.06, 0.6],
    ['260429395804', 0.45, 0.1, 0.7, 0.13],
    ['DESTINATION', 0.1, 0.2, 0.3, 0.23], ['Romania', 0.45, 0.2, 0.6, 0.23],
    ['SIZE', 0.1, 0.25, 0.2, 0.28], ['12 mm', 0.45, 0.25, 0.57, 0.28],
    ['CLASS/GRADE', 0.1, 0.3, 0.3, 0.33], ['B500C', 0.45, 0.3, 0.57, 0.33],
    ['241182', 0.45, 0.35, 0.57, 0.38],
    ['WEIGHT', 0.1, 0.4, 0.22, 0.43], ['2048 kg', 0.45, 0.4, 0.6, 0.43],
  ]
  const lines = boxes.map(([text, left, top, right, bottom]) => ({
    text, corners: [left, top, right, top, right, bottom, left, bottom].map((value) => Math.round(value * 1000)), confidence: 0.9,
  }))
  assert.equal(extract({ rotation: 0, width: 1000, height: 1000, lines }).label.heat, '241182')
})

test('правила значений с настоящих бирок', () => {
  const context = { label: '' }
  assert.equal(readHeat('2604 – 3 – 065 – 20', context), '2604-3-065-20')
  assert.equal(readHeat('2688.26', context), '2688.26')
  assert.equal(readHeat('：2501320', context), '2501320')
  assert.equal(readHeat('Ne 42600058', context), '42600058')
  assert.equal(readSize('Ne 20', context), '20 mm')
  assert.equal(readSize('Al° 20', context), '20 mm')
  assert.equal(readSize('Nº20', context), '20 mm')
  assert.equal(readSize('abc 200', context), null)
  assert.equal(readSize('012MM', context), '12 mm')
  assert.equal(readSize('10,0', context), '10 mm')
  assert.equal(readSize('、Q16', context), 'Q16')
  assert.equal(readGrade('3500C', context), 'B500C')
  assert.equal(readGrade('S 275 JR', context), 'S275JR')
  assert.equal(readGrade('014MM', context), null)
  assert.equal(readGrade('40-60', context), null)
  assert.equal(findGrade('13012B500C'), 'B500C')
  assert.equal(findGrade(':S275JR'), 'S275JR')
  assert.equal(findOrphanHeat('13012B500C'), null)
  assert.equal(findMarkedSize('12mm'), '12 mm')
  assert.equal(findMarkedSize('13 mm'), null)
  assert.equal(findWeightLine('2066 kg'), 2066)
  assert.equal(findWeightLine('2066'), null)
  assert.equal(findApproval('Technical agreement no. 016i-01-584-2025'), '016-01-584-2025')
  assert.equal(findApproval('AT003-1/195-2024'), 'AT 003-01/195-2024')
})

test('поставщик по логотипу с ошибками OCR и по обрезанному названию', () => {
  const suppliers = DEFAULT_KNOWN_SUPPLIERS
  assert.deepEqual(matchSupplier('Suez Gtee', suppliers), { name: 'Suez Steel', exact: false })
  assert.deepEqual(matchSupplier('ArcelorMit', suppliers), { name: 'ArcelorMittal', exact: false })
  assert.deepEqual(matchSupplier('COLAKOGLUE', suppliers), { name: 'Colakoglu Metalurji', exact: false })
  assert.deepEqual(matchSupplier('MIIL s NAME: ColakcgluR vietalurj A.S', suppliers), { name: 'Colakoglu Metalurji', exact: false })
  assert.equal(matchSupplier('Suez Canal', suppliers), null)
  assert.equal(matchSupplier('Arcer', suppliers), null)
})

test('по умолчанию заполняются только включённые поля', () => {
  const { label } = extract(fixture('oam-ozd'), DEFAULT_FIELDS)
  assert.deepEqual(Object.keys(label), enabledLabelFields(createDefaultLabelFields()).filter((field) => !field.manual).map((field) => field.key))
})
