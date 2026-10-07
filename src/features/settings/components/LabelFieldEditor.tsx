import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, CloseIcon, TrashIcon } from '@/components/icons/Icons'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { TextArea } from '@/components/ui/TextArea'
import { TextInput } from '@/components/ui/TextInput'
import type { LabelFieldDefinition } from '@/features/recognition/label/labelFields'
import { LANGUAGE_OPTIONS } from '@/i18n/languages'
import './LabelFieldEditor.css'

/** Что сохраняет редактор: названия на языках и пояснение для модели. */
export type LabelFieldDraft = Pick<LabelFieldDefinition, 'names' | 'hint'>

/** Свойства `LabelFieldEditor`. */
export interface LabelFieldEditorProps {
  /** Редактируемое поле; `null` — новое поле. */
  field: LabelFieldDefinition | null
  /** Названия по умолчанию (у встроенных полей) — показываются подсказками в пустых полях ввода. */
  defaultNames?: Partial<Record<string, string>>
  /** Сохранить изменения. */
  onSave: (draft: LabelFieldDraft) => void
  /** Закрыть без сохранения. */
  onCancel: () => void
  /** Удалить поле (только свои поля). */
  onDelete?: () => void
}

/**
 * Форма поля бирки: название по-английски (обязательно для своих полей; у встроенных пустое —
 * значит «по умолчанию»), названия на остальных языках (по желанию) и пояснение для модели.
 */
export function LabelFieldEditor({ field, defaultNames = {}, onSave, onCancel, onDelete }: LabelFieldEditorProps) {
  const { t } = useTranslation(['settings', 'common'])
  const [names, setNames] = useState<LabelFieldDraft['names']>(field?.names ?? {})
  const [hint, setHint] = useState(field?.hint ?? '')
  const englishRequired = !field?.builtIn
  const canSave = !englishRequired || Boolean(names.en?.trim())

  return (
    <div className="label-field-editor anim-enter">
      {LANGUAGE_OPTIONS.map(({ code, nativeName, flag }) => {
        const required = code === 'en' && englishRequired
        return (
          <Field key={code} label={`${flag} ${nativeName}${required ? ' *' : code === 'en' ? '' : ` · ${t('advanced.fieldOptional')}`}`}>
            <TextInput
              value={names[code] ?? ''}
              placeholder={defaultNames[code] ?? (code === 'en' ? t('advanced.fieldNamePlaceholder') : names.en ?? '')}
              autoCapitalize="sentences"
              aria-required={required || undefined}
              onChange={(value) => setNames((current) => ({ ...current, [code]: value }))}
            />
          </Field>
        )
      })}
      <Field label={t('advanced.fieldHint')}>
        <TextArea value={hint} rows={3} placeholder={t('advanced.fieldHintPlaceholder')} onChange={setHint} />
      </Field>
      <div className="label-field-editor-actions">
        {onDelete && (
          <Button className="is-danger" icon={<TrashIcon />} onClick={onDelete}>{t('advanced.fieldDelete')}</Button>
        )}
        <span className="label-field-editor-spacer" />
        <Button icon={<CloseIcon />} onClick={onCancel}>{t('common:cancel')}</Button>
        <Button icon={<CheckIcon />} disabled={!canSave} onClick={() => onSave({ names, hint })}>{t('advanced.fieldSave')}</Button>
      </div>
    </div>
  )
}
