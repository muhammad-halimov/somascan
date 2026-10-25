/**
 * Синтетические книги для проверок: маленькие Consum, Sarjele и Probe того же строения, что настоящие
 * (настоящие файлы завода в репозиторий не кладутся).
 *
 *   Probe, лист «2026»: шапка в строках 5–6, плавки с 7-й строки (кол-во, плавка, производитель, Ø бобины / Ø прутка).
 *   Consum, лист «Decont Lunar»: месяц в строке 2, шапка 7–9 (ELEMENT в C, расход с AK), проект — объединение в A.
 *   Sarjele, лист проекта: блок «EL-1» итогового вида (Model ID | Model | ø | Sarje | Name | KG), строка без плавки.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'

/** Название проекта и листа. */
export const PROJECT = 'PROIECT TEST'
/** Коды материала. */
export const CODE_BOB8 = 11044001
export const CODE_BAR10 = 11044002

/** Тонкая рамка. */
const thin = { style: 'thin', color: { argb: 'FF000000' } } as const
const box: Partial<ExcelJS.Borders> = { left: thin, right: thin, top: thin, bottom: thin }

/** Плавка в Probe. */
export interface ProbeHeat {
  sarja: string
  qty: number
  producer: string
  bob?: number
  bar?: number
}

/** Probe: лист «2026». */
export async function writeProbe(file: string, heats: ProbeHeat[]): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('2026')
  ws.getCell('A5').value = 'Data'
  ws.getCell('B5').value = 'Cantitatea'
  ws.getCell('C5').value = 'Sarja'
  ws.getCell('D5').value = 'Producator'
  ws.getCell('E6').value = 'Bobina'
  ws.getCell('F6').value = 'Bara'
  heats.forEach((h, i) => {
    const r = 7 + i
    ws.getCell(r, 2).value = h.qty
    ws.getCell(r, 3).value = h.sarja
    ws.getCell(r, 4).value = h.producer
    if (h.bob) ws.getCell(r, 5).value = h.bob
    if (h.bar) ws.getCell(r, 6).value = h.bar
  })
  await wb.xlsx.writeFile(file)
}

/** Строка Consum: элемент и расход по кодам. */
export interface ConsumRow {
  name: string
  buc: number
  bob8?: number
  bar10?: number
}

/** Consum: лист «Decont Lunar», один проект. */
export async function writeConsum(file: string, rows: ConsumRow[], month = 'OCTOMBRIE'): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Decont Lunar')
  ws.getCell('C2').value = `LUNA ${month} 2026`
  ws.getCell('C7').value = 'ELEMENT'
  ws.getCell('D7').value = 'Buc'
  ws.getCell(7, 37).value = 'Ø8'
  ws.getCell(8, 37).value = 'BOBINA'
  ws.getCell(9, 37).value = CODE_BOB8
  ws.getCell(7, 38).value = 'Ø10'
  ws.getCell(8, 38).value = 'BARA'
  ws.getCell(9, 38).value = CODE_BAR10
  ws.getCell(6, 40).value = 'TOTAL / ELEMENT'
  ws.getCell(6, 40).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8392B' } }
  ws.getCell(6, 41).value = 'ID sync'
  rows.forEach((x, i) => {
    const r = 10 + i
    ws.getCell(r, 2).value = i + 1
    ws.getCell(r, 3).value = x.name
    ws.getCell(r, 4).value = x.buc
    if (x.bob8) ws.getCell(r, 37).value = x.bob8
    if (x.bar10) ws.getCell(r, 38).value = x.bar10
  })
  ws.getCell('A10').value = PROJECT
  ws.mergeCells(10, 1, 9 + Math.max(rows.length, 2), 1)
  await wb.xlsx.writeFile(file)
}

/** Sarjele: лист проекта с одним блоком «EL-1» (строка Ø8 Bobina без плавки). */
export async function writeSarjele(file: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(PROJECT)
  // заголовок: название (C2:F2) и дата (G2); шапка в строке 3: B Model ID … G KG
  ws.getCell('C2').value = 'EL-1'
  ws.mergeCells('C2:F2')
  ws.getCell('G2').value = '01.10.26'
  ;['Model ID', 'Model', 'ø', 'Sarje', 'Name', 'KG'].forEach((h, i) => (ws.getCell(3, 2 + i).value = h))
  ws.getCell('B4').value = CODE_BOB8
  ws.getCell('C4').value = 'Bobina'
  ws.getCell('D4').value = 8
  for (let r = 2; r <= 4; r++) for (let c = 3; c <= 7; c++) ws.getCell(r, c).border = box
  await wb.xlsx.writeFile(file)
}

/** Папка с тремя книгами для одного прогона. */
export interface Workspace {
  dir: string
  consum: string
  sarjele: string
  probe: string
  links: string
  /** Окружение движка. */
  env: NodeJS.ProcessEnv
}

/** Создаёт временную папку с книгами по умолчанию. */
export async function makeWorkspace(): Promise<Workspace> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somasync-test-'))
  const ws: Workspace = {
    dir,
    consum: path.join(dir, 'Consum.xlsx'),
    sarjele: path.join(dir, 'Sarjele.xlsx'),
    probe: path.join(dir, 'Probe.xlsx'),
    links: path.join(dir, 'links.json'),
    env: {},
  }
  ws.env = {
    PROJECTS_CFG: JSON.stringify([{ name: PROJECT, aliases: [], sheet: PROJECT, prefix: 'PT', enabled: true, create: true }]),
    PROBE_SHEETS: '2026',
    LINKS: ws.links,
    ACTIVE_SOURCES: JSON.stringify(['Consum.xlsx']),
    BACKUP_DAYS: '30',
  }
  await writeProbe(ws.probe, [
    { sarja: 'H100', qty: 1000, producer: 'ALFA', bob: 8 },
    { sarja: 'H200', qty: 500, producer: 'BETA', bob: 8 },
    { sarja: 'H300', qty: 200, producer: 'GAMA', bar: 10 },
  ])
  await writeConsum(ws.consum, [
    { name: 'EL-1', buc: 2, bob8: 300 },
    { name: 'EL-2', buc: 4, bar10: 200 },
  ])
  await writeSarjele(ws.sarjele)
  return ws
}

/** Значение ячейки как текст. */
export async function cellAt(file: string, sheet: string, address: string): Promise<string> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const v = wb.getWorksheet(sheet)!.getCell(address).value
  return v == null ? '' : String(v)
}
