import { Fragment, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AddIcon, CheckIcon, CloseIcon, FactoryIcon, PencilIcon, ResetIcon, TrashIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { Button } from '@/components/ui/Button'
import { Disclosure } from '@/components/ui/Disclosure'
import { Field } from '@/components/ui/Field'
import { FormSection } from '@/components/ui/FormSection'
import { List, ListItem } from '@/components/ui/List'
import { TextInput } from '@/components/ui/TextInput'
import { cleanSupplierName, isDefaultSuppliers, SUPPLIER_NAME_MAX_LENGTH, supplierKey } from '@/features/recognition/label/knownSuppliers'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { settingsStore } from '../store/SettingsStore'
import './LabelFieldEditor.css'
import './LabelFieldsPicker.css'
import './KnownSuppliersPicker.css'

/** Свойства `KnownSuppliersPicker`. */
export interface KnownSuppliersPickerProps {
  /** Известные поставщики из настроек. */
  value: readonly string[]
}

/** Какой поставщик сейчас редактируется: название существующего или новый. */
type EditTarget = { kind: 'supplier'; name: string } | { kind: 'new' } | null

/**
 * Известные поставщики: список заводов, с которым модель сверяет плохо читаемое название
 * производителя (см. `buildLabelPrompt`).
 *
 * Список в шторке, как и поля: в свёрнутом виде видно, сколько поставщиков и какие.
 * Карандаш включает правку: касание строки открывает форму (переименовать или удалить),
 * внизу — «Добавить поставщика». Слева от «Готово» — «Вернуть стандартные» и «Отмена»
 * (возврат к списку на момент начала правки).
 */
export function KnownSuppliersPicker({ value }: KnownSuppliersPickerProps) {
  const { t } = useTranslation(['settings', 'common'])
  const [isEditing, setIsEditing] = useState(false)
  /** Шторка со списком: по умолчанию свёрнута, чтобы длинный список не загораживал остальные настройки. */
  const [isOpen, setIsOpen] = useState(false)
  const [target, setTarget] = useState<EditTarget>(null)
  /** Список на момент начала правки — к нему возвращает «Отмена». */
  const snapshot = useRef(value)

  const save = (name: string) => (next: string) => {
    if (settingsStore.renameKnownSupplier(name, next)) setTarget(null)
  }

  const add = (name: string) => {
    if (settingsStore.addKnownSupplier(name)) setTarget(null)
  }

  const remove = async (name: string) => {
    const confirmed = await NativeDialogs.confirm({
      title: t('advanced.supplierDeleteTitle'),
      message: t('advanced.supplierDeleteMessage', { name }),
      okButtonTitle: t('advanced.fieldDelete'),
      cancelButtonTitle: t('common:cancel'),
    })
    if (!confirmed) return
    settingsStore.removeKnownSupplier(name)
    setTarget(null)
  }

  const resetAll = async () => {
    const confirmed = await NativeDialogs.confirm({
      title: t('advanced.suppliersResetTitle'),
      message: t('advanced.suppliersResetMessage'),
      okButtonTitle: t('advanced.fieldsReset'),
      cancelButtonTitle: t('common:cancel'),
    })
    if (!confirmed) return
    settingsStore.resetKnownSuppliers()
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

  /** Отменяет все изменения списка, сделанные с начала правки. */
  const cancelEditing = () => {
    settingsStore.setKnownSuppliers(snapshot.current)
    finishEditing()
  }

  /** Занято ли название другим поставщиком (без учёта регистра). */
  const isTaken = (name: string, except?: string) =>
    value.some((current) => current !== except && supplierKey(current) === supplierKey(name))

  return (
    <FormSection
      title={t('advanced.suppliers')}
      icon={<FactoryIcon />}
      action={(
        <div className="form-section-actions">
          {isEditing ? (
            <>
              <ActionButton variant="ghost" icon={<ResetIcon />} caption={t('advanced.resetCaption')} label={t('advanced.fieldsReset')} disabled={isDefaultSuppliers(value)} onClick={() => void resetAll()} />
              <ActionButton variant="ghost" icon={<CloseIcon />} caption={t('advanced.cancelCaption')} label={t('common:cancel')} onClick={cancelEditing} />
              <ActionButton variant="ghost" icon={<CheckIcon />} caption={t('advanced.doneCaption')} label={t('advanced.promptDone')} active onClick={finishEditing} />
            </>
          ) : (
            <ActionButton variant="ghost" icon={<PencilIcon />} caption={t('advanced.editCaption')} label={t('advanced.promptEdit')} onClick={startEditing} />
          )}
        </div>
      )}
      hint={isEditing ? t('advanced.suppliersEditHint') : t('advanced.suppliersHint')}
    >
      <Disclosure
        open={isOpen}
        onToggle={() => setIsOpen((current) => !current)}
        summary={value.length > 0 ? t('advanced.suppliersSummary', { count: value.length }) : t('advanced.suppliersEmpty')}
        details={value.join(', ') || undefined}
      >
        {value.length > 0 && (
          <List label={t('advanced.suppliers')} className="label-fields-picker">
            {value.map((name) => {
              if (!isEditing) return <ListItem key={name} primary={name} />
              const isSupplierOpen = target?.kind === 'supplier' && target.name === name
              return (
                <Fragment key={name}>
                  <ListItem
                    primary={name}
                    selected={isSupplierOpen}
                    trailing={<PencilIcon />}
                    onClick={() => setTarget(isSupplierOpen ? null : { kind: 'supplier', name })}
                  />
                  {isSupplierOpen && (
                    <li className="label-fields-picker-form">
                      <SupplierEditor
                        name={name}
                        isTaken={(next) => isTaken(next, name)}
                        onSave={save(name)}
                        onCancel={() => setTarget(null)}
                        onDelete={() => void remove(name)}
                      />
                    </li>
                  )}
                </Fragment>
              )
            })}
          </List>
        )}

        {isEditing && target?.kind === 'new' && (
          <SupplierEditor name={null} isTaken={(next) => isTaken(next)} onSave={add} onCancel={() => setTarget(null)} />
        )}

        <div className="label-fields-picker-actions">
          {isEditing && target?.kind !== 'new' && (
            <Button icon={<AddIcon />} onClick={() => setTarget({ kind: 'new' })}>{t('advanced.supplierAdd')}</Button>
          )}
        </div>
      </Disclosure>
    </FormSection>
  )
}

/** Свойства `SupplierEditor`. */
interface SupplierEditorProps {
  /** Название редактируемого поставщика; `null` — новый. */
  name: string | null
  /** Есть ли уже другой поставщик с таким названием. */
  isTaken: (name: string) => boolean
  /** Сохранить название. */
  onSave: (name: string) => void
  /** Закрыть без сохранения. */
  onCancel: () => void
  /** Удалить поставщика (только существующего). */
  onDelete?: () => void
}

/** Форма поставщика: одно название; повтор уже известного поставщика не сохраняется. */
function SupplierEditor({ name, isTaken, onSave, onCancel, onDelete }: SupplierEditorProps) {
  const { t } = useTranslation(['settings', 'common'])
  const [draft, setDraft] = useState(name ?? '')
  const clean = cleanSupplierName(draft)
  const taken = clean !== '' && isTaken(clean)
  const canSave = clean !== '' && !taken && clean !== name

  return (
    <div className="label-field-editor known-supplier-editor anim-enter">
      <Field label={t('advanced.supplierName')}>
        <TextInput
          value={draft}
          placeholder={t('advanced.supplierNamePlaceholder')}
          autoCapitalize="words"
          maxLength={SUPPLIER_NAME_MAX_LENGTH}
          aria-invalid={taken || undefined}
          onChange={setDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSave) onSave(clean)
          }}
        />
      </Field>
      {taken && <span className="known-supplier-taken" role="alert">{t('advanced.supplierTaken')}</span>}
      <div className="label-field-editor-actions">
        {onDelete && (
          <Button className="is-danger" icon={<TrashIcon />} onClick={onDelete}>{t('advanced.fieldDelete')}</Button>
        )}
        <span className="label-field-editor-spacer" />
        <Button icon={<CloseIcon />} onClick={onCancel}>{t('common:cancel')}</Button>
        <Button icon={<CheckIcon />} disabled={!canSave} onClick={() => onSave(clean)}>{t('advanced.fieldSave')}</Button>
      </div>
    </div>
  )
}
