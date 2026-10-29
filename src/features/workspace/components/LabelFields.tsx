import type { InputHTMLAttributes, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { HEAT_KEY } from '@/features/recognition/label/heatNumber'
import { enabledLabelFields, isEnabledByDefault, isMissingValue, SHEET_KEY, type LabelFieldKind, type LabelKey, type LabelRecord, type LabelValue } from '@/features/recognition/label/labelFields'
import { useLabelFieldName } from '@/features/recognition/label/useLabelFieldName'
import { useLabelFormatter } from '@/features/recognition/label/useLabelFormatter'
import { isProductForm, PRODUCT_FORM_KEY, PRODUCT_FORMS } from '@/features/recognition/label/productForm'
import { useSettings } from '@/features/settings/store/useSettings'
import { tableCheckStore } from '@/features/uploads/store/TableCheckStore'
import { useStore } from '@/lib/store/useStore'
import { listedSupplier } from '../utils/producerChoice'
import type { HeatDuplicate } from '../utils/sendReadiness'
import { DropdownField } from './DropdownField'
import './LabelFields.css'

/** Клавиатура по виду поля: коды — заглавными без автозамены, названия — с заглавной буквы, числа — цифрами. */
const FIELD_KEYBOARD: Record<LabelFieldKind, Pick<InputHTMLAttributes<HTMLInputElement>, 'inputMode' | 'autoCapitalize'>> = {
  code: { inputMode: 'text', autoCapitalize: 'characters' },
  text: { inputMode: 'text', autoCapitalize: 'words' },
  number: { inputMode: 'numeric', autoCapitalize: 'none' },
  weight: { inputMode: 'decimal', autoCapitalize: 'none' },
  date: { inputMode: 'text', autoCapitalize: 'none' },
  time: { inputMode: 'text', autoCapitalize: 'none' },
}

/** Enter («Далее») переводит к следующему полю, на последнем («Готово») убирает клавиатуру. */
function moveToNextField(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  const selector = 'input.label-field-input, input.label-field-dropdown-text'
  const inputs = [...event.currentTarget.form?.querySelectorAll<HTMLInputElement>(selector) ?? document.querySelectorAll<HTMLInputElement>(selector)]
  const next = inputs[inputs.indexOf(event.currentTarget) + 1]
  if (next) next.focus()
  else event.currentTarget.blur()
}

/** Свойства `LabelFields`. */
export interface LabelFieldsProps {
  /** Распознанная бирка. */
  label: LabelRecord
  /** Показывать поля ввода вместо значений только для чтения. */
  isEditing: boolean
  /** Вызывается при правке поля. */
  onFieldChange: (key: LabelKey, value: string) => void
  /** Бирка без фото: пустое поле — «Не заполнено» (у распознанной — «Не распознано»). */
  manual?: boolean
  /** Плавка повторяется (`heatDuplicates`): поле — цветом ошибки, под ним — с чем совпала. */
  heatDuplicate?: HeatDuplicate | null
}

/**
 * Распознанная бирка в виде списка «название — значение»; в режиме правки редактируется.
 * Первая строка — форма поставки (пруток или катушка): её выбирают вручную, с фото она не читается;
 * выбор открывается касанием значения и в просмотре, без режима правки.
 * Дальше — только поля, выбранные в настройках («Расширенные» → «Поля»); поле «Лист» (куда записать
 * бирку) выбирают, как форму, из списка — с фото оно не читается. Производителя в правке выбирают
 * из известных поставщиков (`ProducerField`).
 */
export function LabelFields({ label, isEditing, onFieldChange, manual = false, heatDuplicate = null }: LabelFieldsProps) {
  const { t } = useTranslation('label')
  const formatter = useLabelFormatter()
  const fieldName = useLabelFieldName()
  const { advanced } = useSettings()
  const fields = enabledLabelFields(advanced.labelFields)

  return (
    <div className={`label-fields anim-enter${isEditing ? ' is-editing' : ''}`} aria-label={t('title')}>
      <div className="label-fields-list">
        <ProductFormField value={label[PRODUCT_FORM_KEY]} isEditing={isEditing} onChange={(value) => onFieldChange(PRODUCT_FORM_KEY, value)} />
        {fields.map((field) => {
          const { key } = field
          if (key === SHEET_KEY) {
            return <SheetField key={key} name={fieldName(field)} value={label[key]} isEditing={isEditing} onChange={(value) => onFieldChange(key, value)} />
          }
          if (key === PRODUCER_KEY && isEditing && advanced.knownSuppliers.length > 0) {
            return <ProducerField key={key} name={fieldName(field)} value={label[key]} suppliers={advanced.knownSuppliers} onChange={(value) => onFieldChange(key, value)} />
          }
          const value = label[key] ?? null
          const name = fieldName(field)
          const missing = isMissingValue(value)
          // Поля по умолчанию (производитель, размер, плавка, вес) обязательны у любой бирки: пустые — цветом
          // ошибки, как невыбранная форма; у бирки без фото — «Обязательное поле», у распознанной — «Не распознано».
          const required = isEnabledByDefault(key)
          const duplicate = key === HEAT_KEY && !missing ? heatDuplicate : null
          const duplicateNote = duplicate && (duplicate.kind === 'tag'
            ? t('duplicateHeat.tag', { number: duplicate.number })
            : t('duplicateHeat.sent', { record: duplicate.localNumber }))
          return (
            <label className={`label-field${(required && missing) || duplicate ? ' is-required' : ''}${duplicate ? ' is-duplicate' : ''}`} key={key}>
              <span className="label-field-name">{name}</span>
              {isEditing ? (
                <input
                  className="label-field-input"
                  aria-label={name}
                  // У размера и веса в правке — только число: единицы и пометки показывает просмотр.
                  value={formatter.editValue(field.kind, value, key)}
                  placeholder={required ? t('requiredField') : manual ? t('notFilled') : t('notRecognized')}
                  aria-required={required || undefined}
                  aria-invalid={duplicate ? true : undefined}
                  onChange={(event) => onFieldChange(key, event.target.value)}
                  onKeyDown={moveToNextField}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  {...(key === 'size' ? FIELD_KEYBOARD.weight : FIELD_KEYBOARD[field.kind])}
                />
              ) : (
                <span className={`label-field-value${missing ? ' is-missing' : ''}${(required && missing) || duplicate ? ' is-required' : ''}`}>
                  {missing && manual ? (required ? t('requiredField') : t('notFilled')) : formatter.value(field.kind, value, key)}
                </span>
              )}
              {duplicateNote && <span className="label-field-note" role="alert">{duplicateNote}</span>}
            </label>
          )
        })}
      </div>
    </div>
  )
}

/** Ключ поля «Производитель». */
const PRODUCER_KEY = 'producer'

/** Свойства `ProducerField`. */
interface ProducerFieldProps {
  /** Название строки. */
  name: string
  /** Текущее значение. */
  value: LabelValue | undefined
  /** Известные поставщики из настроек (по алфавиту). */
  suppliers: readonly string[]
  /** Новое значение. */
  onChange: (value: string) => void
}

/**
 * Производитель в правке: выпадающий список известных поставщиков (название из списка совпадает без учёта
 * регистра). Название не из списка (так распознано) остаётся в поле как есть; карандаш слева от уголка
 * делает текст полем ввода на том же месте — так вписывают своё название или правят распознанное.
 */
function ProducerField({ name, value, suppliers, onChange }: ProducerFieldProps) {
  const { t } = useTranslation('label')
  const text = value === null || value === undefined ? '' : String(value)
  return (
    <DropdownField
      name={name}
      value={text}
      selected={listedSupplier(text, suppliers)}
      options={suppliers.map((supplier) => ({ value: supplier, label: supplier }))}
      placeholder={t('requiredField')}
      isEditing
      required
      className="is-producer"
      onChange={onChange}
      own={{ label: t('producer.own'), placeholder: t('producer.ownPlaceholder'), keyboard: FIELD_KEYBOARD.text, onKeyDown: moveToNextField }}
    />
  )
}

/** Свойства полей выбора бирки. */
interface ChoiceFieldProps {
  /** Текущее значение поля бирки. */
  value: string | number | null | undefined
  /** Режим правки. */
  isEditing: boolean
  /** Выбрано новое значение. */
  onChange: (value: string) => void
}

/**
 * Форма поставки: пока не выбрана — «Не выбрана» цветом ошибки (без неё бирку не отправить).
 * В запись попадает румынское слово, подписи вариантов — на языке интерфейса.
 */
function ProductFormField({ value, isEditing, onChange }: ChoiceFieldProps) {
  const { t } = useTranslation('label')
  return (
    <DropdownField
      name={t('productForm.name')}
      value={isProductForm(value) ? value : ''}
      options={PRODUCT_FORMS.map((form) => ({ value: form, label: t(`productForm.${form}`) }))}
      placeholder={t('productForm.placeholder')}
      isEditing={isEditing}
      required
      className="is-product-form"
      onChange={onChange}
    />
  )
}

/**
 * Лист журнала, куда записать бирку: первым вариантом «как в настройках» (лист из «Хранилища» или лист
 * текущего года), дальше — листы таблицы из последней проверки (и выбранный, если его нет в списке).
 */
function SheetField({ name, value, isEditing, onChange }: ChoiceFieldProps & { name: string }) {
  const { t } = useTranslation('label')
  const { storage } = useSettings()
  useStore(tableCheckStore)
  const sheets = tableCheckStore.sheetsFor(storage)
  const selected = typeof value === 'string' ? value : ''
  const fallback = storage.sheet || t('sheet.currentYear', { year: new Date().getFullYear() })
  const options = [
    { value: '', label: t('sheet.default', { sheet: fallback }) },
    ...sheets.map((sheet) => ({ value: sheet, label: sheet })),
    ...(selected && !sheets.includes(selected) ? [{ value: selected, label: selected }] : []),
  ]
  return <DropdownField name={name} value={selected} options={options} placeholder={options[0]!.label} isEditing={isEditing} className="is-sheet" onChange={onChange} />
}
