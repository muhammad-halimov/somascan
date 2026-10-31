import { Fragment, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, CloseIcon, ExportIcon, ImportIcon, PencilIcon, ResetIcon, ScanTextIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { Button } from '@/components/ui/Button'
import { Disclosure } from '@/components/ui/Disclosure'
import { FormSection } from '@/components/ui/FormSection'
import { List, ListItem } from '@/components/ui/List'
import { TextArea } from '@/components/ui/TextArea'
import type { LabelFieldDefinition } from '@/features/recognition/label/labelFields'
import { useLabelFieldName } from '@/features/recognition/label/useLabelFieldName'
import {
  DEFAULT_RULE_LABELS,
  isDefaultRuleLabels,
  normalizeRuleLabels,
  parseRulesJson,
  ruleLabelsFor,
  RULES_FILE_NAME,
  RULE_GROUPS,
  rulesToJson,
  type RuleGroup,
  type RuleLabels,
} from '@/features/recognition/ocr/ruleLabels'
import { MAX_TEXT_FILE_BYTES, PickedFileError, pickTextFile, shareTextFile } from '@/lib/platform/files'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { settingsStore } from '../store/SettingsStore'
import './LabelFieldEditor.css'
import './LabelFieldsPicker.css'
import './RecognitionRulesPicker.css'

/** Свойства `RecognitionRulesPicker`. */
export interface RecognitionRulesPickerProps {
  /** Изменённые подписи из настроек (остальные — стандартные). */
  value: RuleLabels
  /** Поля из настроек: порядок и названия полей в списке. */
  fields: readonly LabelFieldDefinition[]
  /** Правила сейчас не действуют (распознают ИИ-модели): причина вместо пояснения. */
  unavailable?: string
}

/** Текст ошибки для сообщения. */
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Правило в списке: подписи поля или правило из группы (`RULE_GROUPS`). */
interface RuleEntry {
  key: string
  /** Название строки. */
  name: string
  /** Пояснение под полем ввода в правке. */
  editHint: string
  /** Что показать, если список пуст. */
  empty: string
}

/**
 * Правила распознавания на устройстве: подписи, по которым телефон находит поля на бирке (`ruleLabels.ts`).
 * В шторке — поля с их подписями; карандаш включает правку: касание поля открывает его подписи (по одной
 * на строку), «Стандартные» возвращает список по умолчанию. Слева от «Готово» — «Вернуть стандартные»
 * для всех полей и «Отмена» (возврат к правилам на момент начала правки).
 *
 * «Экспорт» и «Импорт» — правила в файле JSON, чтобы дополнить подписи на одном телефоне и раздать коллегам.
 * Импорт заменяет подписи полей, которые есть в файле, остальные не трогает.
 * Свои поля ищутся по их названиям («Поля»), здесь их нет.
 *
 * Ниже подписей полей — группы правил (`RULE_GROUPS`), каждая со своим заголовком: «Бирки канатов» (слова на бирке,
 * номер партии без подписи) и «Производитель» (свой склад, общие слова в названиях, бесплатная почта); правятся так же.
 */
export function RecognitionRulesPicker({ value, fields, unavailable }: RecognitionRulesPickerProps) {
  const { t } = useTranslation(['settings', 'common'])
  const fieldName = useLabelFieldName()
  const [isEditing, setIsEditing] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  /** Поле, подписи которого открыты в правке. */
  const [target, setTarget] = useState<string | null>(null)
  /** Правила на момент начала правки — к ним возвращает «Отмена». */
  const snapshot = useRef(value)
  // Встроенные поля, читаемые с фото, в порядке настроек; затем группы правил бирок канатов и производителя.
  const fieldEntries: RuleEntry[] = fields
    .filter((field) => field.builtIn && !field.manual && field.key in DEFAULT_RULE_LABELS)
    .map((field) => ({ key: field.key, name: fieldName(field), editHint: t('advanced.rulesLabelsHint'), empty: t('advanced.rulesNoLabels') }))
  const groups = (Object.keys(RULE_GROUPS) as RuleGroup[]).map((group) => ({
    group,
    entries: RULE_GROUPS[group].map((key): RuleEntry => ({
      key,
      name: t(`advanced.rulesItems.${key}.name`),
      editHint: t(`advanced.rulesItems.${key}.hint`),
      empty: t('advanced.rulesItemsEmpty'),
    })),
  }))
  const ruleCount = fieldEntries.length + groups.reduce((sum, { entries }) => sum + entries.length, 0)
  const changed = Object.keys(value).length

  /** Строка правила; в правке касание открывает его список (по одному значению на строку). */
  const renderRule = ({ key, name, editHint, empty }: RuleEntry) => {
    const labels = ruleLabelsFor(value, key)
    const secondary = `${key in value ? `${t('advanced.rulesChangedMark')} · ` : ''}${labels.join(', ') || empty}`
    if (!isEditing) return <ListItem key={key} primary={name} secondary={secondary} />
    const isRuleOpen = target === key
    return (
      <Fragment key={key}>
        <ListItem primary={name} secondary={secondary} selected={isRuleOpen} trailing={<PencilIcon />} onClick={() => setTarget(isRuleOpen ? null : key)} />
        {isRuleOpen && (
          <li className="label-fields-picker-form">
            <RuleLabelsEditor
              ruleKey={key}
              name={name}
              hint={editHint}
              labels={labels}
              onSave={(next) => {
                settingsStore.setRuleLabels(key, next)
                setTarget(null)
              }}
              onCancel={() => setTarget(null)}
            />
          </li>
        )}
      </Fragment>
    )
  }

  const exportRules = async () => {
    try {
      await shareTextFile(RULES_FILE_NAME, rulesToJson(value), 'application/json', t('advanced.rulesExport'))
    } catch (error) {
      await NativeDialogs.alert({ title: t('advanced.rulesExportFailedTitle'), message: errorText(error), buttonTitle: t('common:ok') })
    }
  }

  /** Импорт: подписи полей из файла заменяют их подписи на телефоне; поля, которых нет в файле, не меняются. */
  const importRules = async () => {
    const fail = (message: string) => NativeDialogs.alert({ title: t('advanced.rulesImportFailedTitle'), message, buttonTitle: t('common:ok') })
    let text: string | null
    try {
      text = await pickTextFile({ mimeType: 'application/json', extension: '.json' })
    } catch (error) {
      if (error instanceof PickedFileError && error.reason === 'wrongType') await fail(t('advanced.suppliersImportNotJson'))
      else if (error instanceof PickedFileError) await fail(t('advanced.suppliersImportTooLarge', { size: MAX_TEXT_FILE_BYTES / 1024 / 1024 }))
      else await fail(errorText(error))
      return
    }
    if (text === null) return
    const imported = parseRulesJson(text)
    if (!imported) {
      await fail(t('advanced.rulesImportInvalid'))
      return
    }
    settingsStore.setAllRuleLabels({ ...value, ...imported })
    await NativeDialogs.alert({
      title: t('advanced.rulesImportedTitle'),
      message: t('advanced.rulesImportedMessage', { count: Object.keys(imported).length }),
      buttonTitle: t('common:ok'),
    })
  }

  const resetAll = async () => {
    const confirmed = await NativeDialogs.confirm({
      title: t('advanced.rulesResetTitle'),
      message: t('advanced.rulesResetMessage'),
      okButtonTitle: t('advanced.fieldsReset'),
      cancelButtonTitle: t('common:cancel'),
    })
    if (!confirmed) return
    settingsStore.setAllRuleLabels()
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

  const cancelEditing = () => {
    settingsStore.setAllRuleLabels(snapshot.current)
    finishEditing()
  }

  return (
    <FormSection
      title={t('advanced.rules')}
      icon={<ScanTextIcon />}
      unavailable={unavailable}
      action={(
        <div className="form-section-actions">
          {isEditing ? (
            <>
              <ActionButton variant="ghost" icon={<ResetIcon />} caption={t('advanced.resetCaption')} label={t('advanced.fieldsReset')} disabled={changed === 0} onClick={() => void resetAll()} />
              <ActionButton variant="ghost" icon={<CloseIcon />} caption={t('advanced.cancelCaption')} label={t('common:cancel')} onClick={cancelEditing} />
              <ActionButton variant="ghost" icon={<CheckIcon />} caption={t('advanced.doneCaption')} label={t('advanced.promptDone')} active onClick={finishEditing} />
            </>
          ) : (
            <>
              <ActionButton variant="ghost" icon={<ExportIcon />} caption={t('advanced.exportCaption')} label={t('advanced.rulesExport')} onClick={() => void exportRules()} />
              <ActionButton variant="ghost" icon={<ImportIcon />} caption={t('advanced.importCaption')} label={t('advanced.rulesImport')} onClick={() => void importRules()} />
              <ActionButton variant="ghost" icon={<PencilIcon />} caption={t('advanced.editCaption')} label={t('advanced.promptEdit')} onClick={startEditing} />
            </>
          )}
        </div>
      )}
      hint={isEditing ? t('advanced.rulesEditHint') : t('advanced.rulesHint')}
    >
      <Disclosure
        open={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
        summary={t('advanced.rulesSummary', { count: ruleCount })}
        details={changed > 0 ? t('advanced.rulesChanged', { count: changed }) : t('advanced.rulesDefault')}
      >
        <span className="rules-picker-heading">{t('advanced.rulesGroups.fields')}</span>
        <List label={t('advanced.rulesGroups.fields')} className="label-fields-picker rules-picker">
          {fieldEntries.map(renderRule)}
        </List>
        {groups.map(({ group, entries }) => (
          <Fragment key={group}>
            <span className="rules-picker-heading">{t(`advanced.rulesGroups.${group}`)}</span>
            <List label={t(`advanced.rulesGroups.${group}`)} className="label-fields-picker rules-picker">
              {entries.map(renderRule)}
            </List>
          </Fragment>
        ))}
      </Disclosure>
    </FormSection>
  )
}

/** Свойства `RuleLabelsEditor`. */
interface RuleLabelsEditorProps {
  ruleKey: string
  /** Название правила (доступное имя поля ввода). */
  name: string
  /** Пояснение под полем ввода. */
  hint: string
  /** Значения сейчас. */
  labels: readonly string[]
  onSave: (labels: string[]) => void
  onCancel: () => void
}

/** Список одного правила: по одному значению на строку; «Стандартные» подставляет список по умолчанию (сохраняется кнопкой). */
function RuleLabelsEditor({ ruleKey, name, hint, labels, onSave, onCancel }: RuleLabelsEditorProps) {
  const { t } = useTranslation(['settings', 'common'])
  const [draft, setDraft] = useState(labels.join('\n'))
  const next = normalizeRuleLabels(draft.split('\n'))
  const isDefault = isDefaultRuleLabels(ruleKey, next)

  return (
    <div className="label-field-editor anim-enter">
      <TextArea
        aria-label={name}
        value={draft}
        rows={Math.min(10, Math.max(4, labels.length))}
        autoCapitalize="none"
        spellCheck={false}
        onChange={setDraft}
      />
      <span className="form-section-hint">{hint}</span>
      <div className="label-field-editor-actions">
        <Button icon={<ResetIcon />} disabled={isDefault} onClick={() => setDraft((DEFAULT_RULE_LABELS[ruleKey] ?? []).join('\n'))}>{t('advanced.rulesDefaultButton')}</Button>
        <span className="label-field-editor-spacer" />
        <Button icon={<CloseIcon />} onClick={onCancel}>{t('common:cancel')}</Button>
        <Button icon={<CheckIcon />} onClick={() => onSave(next)}>{t('advanced.fieldSave')}</Button>
      </div>
    </div>
  )
}
