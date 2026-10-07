import { Fragment, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AddIcon, CheckIcon, CloseIcon, PencilIcon, ResetIcon, TagIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { Button } from '@/components/ui/Button'
import { Disclosure } from '@/components/ui/Disclosure'
import { FormSection } from '@/components/ui/FormSection'
import { List, ListItem } from '@/components/ui/List'
import { isDefaultLabelFields, type LabelFieldDefinition, type LabelKey } from '@/features/recognition/label/labelFields'
import { useLabelFieldName } from '@/features/recognition/label/useLabelFieldName'
import { LANGUAGES } from '@/i18n/languages'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { settingsStore } from '../store/SettingsStore'
import { LabelFieldEditor, type LabelFieldDraft } from './LabelFieldEditor'
import './LabelFieldsPicker.css'

/** Свойства `LabelFieldsPicker`. */
export interface LabelFieldsPickerProps {
  /** Поля бирки из настроек. */
  value: readonly LabelFieldDefinition[]
}

/** Какое поле сейчас редактируется: ключ существующего или новое. */
type EditTarget = { kind: 'field'; key: LabelKey } | { kind: 'new' } | null

/**
 * Поля, которые модель читает с фото.
 *
 * Список в шторке: в свёрнутом виде видно, сколько и какие поля выбраны, — длинный список
 * не загораживает остальные настройки. Обычный режим — выбор нескольких полей галочками
 * (последнее включённое снять нельзя).
 * Карандаш включает правку: касание строки открывает форму поля (названия на языках —
 * английское обязательно, остальные по желанию — и пояснение для модели), внизу можно
 * добавить своё поле. Слева от «Готово» — «Вернуть стандартные» и «Отмена» (возврат к набору
 * полей на момент начала правки).
 */
export function LabelFieldsPicker({ value }: LabelFieldsPickerProps) {
  const { t, i18n } = useTranslation(['settings', 'label', 'common'])
  const fieldName = useLabelFieldName()
  const [isEditing, setIsEditing] = useState(false)
  /** Шторка со списком полей: по умолчанию свёрнута, чтобы не загораживать остальные настройки. */
  const [isOpen, setIsOpen] = useState(false)
  const [target, setTarget] = useState<EditTarget>(null)
  /** Поля на момент начала правки — к ним возвращает «Отмена». */
  const snapshot = useRef(value)
  const enabledCount = value.filter((field) => field.enabled).length
  /** Включённые поля через запятую — подробности в заголовке шторки. */
  const enabledNames = value.filter((field) => field.enabled).map((field) => fieldName(field)).join(', ')

  /** Названия встроенного поля по умолчанию на всех языках — подсказки в пустых полях формы. */
  const defaultNamesOf = (field: LabelFieldDefinition) => field.builtIn
    ? Object.fromEntries(LANGUAGES.map((language) => [language, i18n.getFixedT(language, 'label')(`fields.${field.key}` as 'fields.contract')]))
    : {}

  const save = (key: LabelKey) => (draft: LabelFieldDraft) => {
    settingsStore.updateLabelField(key, draft)
    setTarget(null)
  }

  const add = (draft: LabelFieldDraft) => {
    if (settingsStore.addLabelField(draft)) setTarget(null)
  }

  const remove = async (field: LabelFieldDefinition) => {
    const confirmed = await NativeDialogs.confirm({
      title: t('advanced.fieldDeleteTitle'),
      message: t('advanced.fieldDeleteMessage', { name: fieldName(field) }),
      okButtonTitle: t('advanced.fieldDelete'),
      cancelButtonTitle: t('common:cancel'),
    })
    if (!confirmed) return
    settingsStore.removeLabelField(field.key)
    setTarget(null)
  }

  const resetAll = async () => {
    const confirmed = await NativeDialogs.confirm({
      title: t('advanced.fieldsResetTitle'),
      message: t('advanced.fieldsResetMessage'),
      okButtonTitle: t('advanced.fieldsReset'),
      cancelButtonTitle: t('common:cancel'),
    })
    if (!confirmed) return
    settingsStore.resetLabelFields()
    setTarget(null)
  }

  /** Включает правку и раскрывает шторку: править можно только видимый список. */
  const startEditing = () => {
    snapshot.current = value
    setIsEditing(true)
    setIsOpen(true)
  }

  const finishEditing = () => {
    setIsEditing(false)
    setTarget(null)
  }

  /** Отменяет все изменения полей, сделанные с начала правки. */
  const cancelEditing = () => {
    settingsStore.setLabelFields([...snapshot.current])
    finishEditing()
  }

  return (
    <FormSection
      title={t('advanced.fields')}
      icon={<TagIcon />}
      action={(
        <div className="form-section-actions">
          {isEditing ? (
            <>
              <ActionButton variant="ghost" icon={<ResetIcon />} caption={t('advanced.resetCaption')} label={t('advanced.fieldsReset')} disabled={isDefaultLabelFields(value)} onClick={() => void resetAll()} />
              <ActionButton variant="ghost" icon={<CloseIcon />} caption={t('advanced.cancelCaption')} label={t('common:cancel')} onClick={cancelEditing} />
              <ActionButton variant="ghost" icon={<CheckIcon />} caption={t('advanced.doneCaption')} label={t('advanced.promptDone')} active onClick={finishEditing} />
            </>
          ) : (
            <ActionButton variant="ghost" icon={<PencilIcon />} caption={t('advanced.editCaption')} label={t('advanced.promptEdit')} onClick={startEditing} />
          )}
        </div>
      )}
      hint={isEditing ? t('advanced.fieldsEditHint') : t('advanced.fieldsHint')}
    >
      <Disclosure
        className="label-fields-disclosure"
        open={isOpen}
        onToggle={() => setIsOpen((current) => !current)}
        summary={t('advanced.fieldsSummary', { count: enabledCount, total: value.length })}
        details={enabledNames}
      >
        <List label={t('advanced.fields')} className="label-fields-picker">
          {value.map((field) => {
            const name = fieldName(field)
            const isFieldOpen = target?.kind === 'field' && target.key === field.key
            if (isEditing) {
              return (
                <Fragment key={field.key}>
                  <ListItem
                    primary={name}
                    secondary={field.builtIn ? undefined : t('advanced.fieldCustom')}
                    selected={isFieldOpen}
                    trailing={<PencilIcon />}
                    onClick={() => setTarget(isFieldOpen ? null : { kind: 'field', key: field.key })}
                  />
                  {isFieldOpen && (
                    <li className="label-fields-picker-form">
                      <LabelFieldEditor
                        field={field}
                        defaultNames={defaultNamesOf(field)}
                        onSave={save(field.key)}
                        onCancel={() => setTarget(null)}
                        onDelete={field.builtIn ? undefined : () => void remove(field)}
                      />
                    </li>
                  )}
                </Fragment>
              )
            }
            return (
              <ListItem
                key={field.key}
                itemRole="checkbox"
                primary={name}
                selected={field.enabled}
                disabled={field.enabled && enabledCount === 1}
                trailing={field.enabled ? <CheckIcon /> : undefined}
                onClick={() => settingsStore.toggleLabelField(field.key)}
              />
            )
          })}
        </List>

        {isEditing && target?.kind === 'new' && (
          <LabelFieldEditor field={null} onSave={add} onCancel={() => setTarget(null)} />
        )}

        <div className="label-fields-picker-actions">
          {isEditing ? (
            target?.kind !== 'new' && (
              <Button icon={<AddIcon />} onClick={() => setTarget({ kind: 'new' })}>{t('advanced.fieldAdd')}</Button>
            )
          ) : enabledCount < value.length && (
            <Button icon={<CheckIcon />} onClick={() => settingsStore.enableAllLabelFields()}>{t('advanced.fieldsAll')}</Button>
          )}
        </div>
      </Disclosure>
    </FormSection>
  )
}
