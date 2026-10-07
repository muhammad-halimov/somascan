/**
 * Форма поставки — поле, которое не читается с фото: оператор выбирает его сам в режиме правки
 * (карандаш) из двух вариантов — пруток или катушка. Без выбора бирку нельзя отправить «Далее».
 *
 * Значение хранится и пишется в таблицу только по-румынски (`bara` / `bobina`) — на любом языке
 * интерфейса; переводы — только для показа (`label:productForm.*`).
 */
import { isMissingValue, type LabelRecord } from './labelFields'

/** Ключ поля в записи бирки и колонки в таблице (не пересекается с полями модели). */
export const PRODUCT_FORM_KEY = 'product_form'

/** Допустимые значения: румынские слова, как они попадают в таблицу. */
export const PRODUCT_FORMS = ['bara', 'bobina'] as const

/** Форма поставки: пруток (`bara`) или катушка (`bobina`). */
export type ProductForm = (typeof PRODUCT_FORMS)[number]

/** Проверка, что значение — допустимая форма. */
export const isProductForm = (value: unknown): value is ProductForm =>
  typeof value === 'string' && (PRODUCT_FORMS as readonly string[]).includes(value)

/** Выбрана ли форма у бирки. */
export const hasProductForm = (label: LabelRecord) => !isMissingValue(label[PRODUCT_FORM_KEY]) && isProductForm(label[PRODUCT_FORM_KEY])
