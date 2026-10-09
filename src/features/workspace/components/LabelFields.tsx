import type { InputHTMLAttributes, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDropDownIcon, ChevronUpDownIcon } from '@/components/icons/Icons'
import { enabledLabelFields, isEnabledByDefault, isMissingValue, type LabelFieldKind, type LabelKey, type LabelRecord } from '@/features/recognition/label/labelFields'
import { useLabelFieldName } from '@/features/recognition/label/useLabelFieldName'
import { useLabelFormatter } from '@/features/recognition/label/useLabelFormatter'
import { isProductForm, PRODUCT_FORM_KEY, PRODUCT_FORMS } from '@/features/recognition/label/productForm'
import { useSettings } from '@/features/settings/store/useSettings'
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
  const inputs = [...event.currentTarget.form?.querySelectorAll<HTMLInputElement>('.label-field-input') ?? document.querySelectorAll<HTMLInputElement>('.label-field-input')]
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
  /**
   * Бирка без фото: пустое поле — «Не заполнено», а поля по умолчанию (производитель, размер, плавка,
   * вес) обязательны — пустые отмечены цветом ошибки, как невыбранная форма.
   */
  manual?: boolean
}

/**
 * Распознанная бирка в виде списка «название — значение»; в режиме правки редактируется.
 * Первая строка — форма поставки (пруток или катушка): её выбирают вручную, с фото она не читается;
 * выбор открывается касанием значения и в просмотре, без режима правки.
 * Дальше — только поля, выбранные в настройках («Расширенные» → «Поля»).
 */
export function LabelFields({ label, isEditing, onFieldChange, manual = false }: LabelFieldsProps) {
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
          const value = label[key] ?? null
          const name = fieldName(field)
          const missing = isMissingValue(value)
          const required = manual && isEnabledByDefault(key)
          return (
            <label className={`label-field${required && missing ? ' is-required' : ''}`} key={key}>
              <span className="label-field-name">{name}</span>
              {isEditing ? (
                <input
                  className="label-field-input"
                  aria-label={name}
                  // У размера и веса в правке — только число: единицы и пометки показывает просмотр.
                  value={formatter.editValue(field.kind, value, key)}
                  placeholder={required ? t('requiredField') : manual ? t('notFilled') : t('notRecognized')}
                  aria-required={required || undefined}
                  onChange={(event) => onFieldChange(key, event.target.value)}
                  onKeyDown={moveToNextField}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  {...(key === 'size' ? FIELD_KEYBOARD.weight : FIELD_KEYBOARD[field.kind])}
                />
              ) : (
                <span className={`label-field-value${missing ? ' is-missing' : ''}${required && missing ? ' is-required' : ''}`}>
                  {missing && manual ? (required ? t('requiredField') : t('notFilled')) : formatter.value(field.kind, value, key)}
                </span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

/** Свойства `ProductFormField`. */
interface ProductFormFieldProps {
  /** Текущее значение (`bara`, `bobina` или пусто). */
  value: string | number | null | undefined
  /** Режим правки: выбор в виде поля ввода; в просмотре — в виде значения строки. */
  isEditing: boolean
  /** Выбрано новое значение (румынское слово). */
  onChange: (value: string) => void
}

/**
 * Форма поставки — системный выбор (`<select>`: список на Android, меню или колесо на iOS) в обоих режимах.
 * В просмотре он выглядит как значение строки со значком выпадающего списка (Material — треугольник,
 * iOS — двойной уголок всплывающего меню) и открывается касанием, без карандаша; пока форма
 * не выбрана — «Не выбрана» цветом ошибки (без неё бирку не отправить). В правке — в стиле полей ввода.
 * В запись попадает румынское слово, подписи вариантов — на языке интерфейса.
 */
function ProductFormField({ value, isEditing, onChange }: ProductFormFieldProps) {
  const { t } = useTranslation('label')
  const selected = isProductForm(value) ? value : ''
  const name = t('productForm.name')
  const select = (
    <select
      className={isEditing ? 'label-field-input label-field-select' : `label-field-value label-field-picker${selected ? '' : ' is-missing is-required'}`}
      aria-label={name}
      aria-required="true"
      value={selected}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled>{t('productForm.placeholder')}</option>
      {PRODUCT_FORMS.map((form) => <option key={form} value={form}>{t(`productForm.${form}`)}</option>)}
    </select>
  )
  return (
    <label className={`label-field is-product-form${selected ? '' : ' is-required'}`}>
      <span className="label-field-name">{name}</span>
      {isEditing ? select : (
        <span className="label-field-picker-wrap">
          {select}
          {/* Нужный значок показывает CSS по платформе, как у шторок (Disclosure). */}
          <span className="label-field-picker-icon" aria-hidden="true">
            <ChevronUpDownIcon />
            <ArrowDropDownIcon />
          </span>
        </span>
      )}
    </label>
  )
}
