import type { InputHTMLAttributes, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDropDownIcon, ChevronUpDownIcon } from '@/components/icons/Icons'
import { enabledLabelFields, isEnabledByDefault, isMissingValue, SHEET_KEY, type LabelFieldKind, type LabelKey, type LabelRecord } from '@/features/recognition/label/labelFields'
import { useLabelFieldName } from '@/features/recognition/label/useLabelFieldName'
import { useLabelFormatter } from '@/features/recognition/label/useLabelFormatter'
import { isProductForm, PRODUCT_FORM_KEY, PRODUCT_FORMS } from '@/features/recognition/label/productForm'
import { useSettings } from '@/features/settings/store/useSettings'
import { tableCheckStore } from '@/features/uploads/store/TableCheckStore'
import { useStore } from '@/lib/store/useStore'
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
 * Дальше — только поля, выбранные в настройках («Расширенные» → «Поля»); поле «Лист» (куда записать
 * бирку) выбирают, как форму, из списка — с фото оно не читается.
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
          if (key === SHEET_KEY) {
            return <SheetField key={key} name={fieldName(field)} value={label[key]} isEditing={isEditing} onChange={(value) => onFieldChange(key, value)} />
          }
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

/** Свойства `PickerField`. */
interface PickerFieldProps {
  /** Название строки (и доступное имя выбора). */
  name: string
  /** Выбранное значение; пустая строка — первый вариант (не выбрано / по умолчанию). */
  value: string
  /** Варианты: значение и подпись на языке интерфейса. */
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  /** Режим правки: выбор в виде поля ввода; в просмотре — в виде значения строки. */
  isEditing: boolean
  /** Пустое значение — ошибка (без него бирку не отправить): подпись и значок цветом ошибки. */
  required?: boolean
  /** Дополнительный класс строки. */
  className?: string
  /** Выбрано новое значение. */
  onChange: (value: string) => void
}

/**
 * Строка карточки с системным выбором (`<select>`: список на Android, меню или колесо на iOS) в обоих
 * режимах. В просмотре он выглядит как значение строки со значком выпадающего списка (Material —
 * треугольник, iOS — двойной уголок всплывающего меню) и открывается касанием, без карандаша; пустое
 * значение — приглушённо (или цветом ошибки, если оно обязательно). В правке — в стиле полей ввода.
 */
function PickerField({ name, value, options, isEditing, required = false, className = '', onChange }: PickerFieldProps) {
  const missing = value === ''
  const select = (
    <select
      className={isEditing ? 'label-field-input label-field-select' : `label-field-value label-field-picker${missing ? ` is-missing${required ? ' is-required' : ''}` : ''}`}
      aria-label={name}
      aria-required={required || undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  )
  return (
    <label className={`label-field${className ? ` ${className}` : ''}${required && missing ? ' is-required' : ''}`}>
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
  const options = [
    { value: '', label: t('productForm.placeholder'), disabled: true },
    ...PRODUCT_FORMS.map((form) => ({ value: form, label: t(`productForm.${form}`) })),
  ]
  return (
    <PickerField
      name={t('productForm.name')}
      value={isProductForm(value) ? value : ''}
      options={options}
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
  return <PickerField name={name} value={selected} options={options} isEditing={isEditing} className="is-sheet" onChange={onChange} />
}
