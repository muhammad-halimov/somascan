import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, CloseIcon, PencilIcon, ResetIcon, SparklesIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { Button } from '@/components/ui/Button'
import { FormSection } from '@/components/ui/FormSection'
import { TextArea } from '@/components/ui/TextArea'
import { DEFAULT_LABEL_INSTRUCTIONS } from '@/features/recognition/label/labelPrompt'
import { useHeightTransition } from '@/hooks/useHeightTransition'
import { settingsStore } from '../store/SettingsStore'
import './PromptEditor.css'

/** Сколько строк видно у свёрнутого промпта. */
const COLLAPSED_LINES = 6

/** Свойства `PromptEditor`. */
export interface PromptEditorProps {
  /** Инструкция из настроек; пустая строка — инструкция по умолчанию. */
  value: string
}

/**
 * Высота свёрнутого поля: ровно `COLLAPSED_LINES` строк плюс внутренние отступы и рамка,
 * но не больше всего текста.
 */
function collapsedHeight(area: HTMLElement, fullHeight: number) {
  const style = getComputedStyle(area)
  const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
    .reduce((sum, key) => sum + (Number.parseFloat(style[key as 'paddingTop']) || 0), 0)
  return Math.min(fullHeight, Number.parseFloat(style.lineHeight) * COLLAPSED_LINES + chrome)
}

/**
 * Промпт — инструкция, которая отправляется модели вместе с фото. По умолчанию только для чтения
 * и свёрнут до нескольких строк. Карандаш включает правку (без автофокуса: клавиатура появляется,
 * только когда пользователь сам коснётся текста); рядом — «Вернуть по умолчанию» и «Отмена»
 * (возврат к тексту на момент начала правки). Изменения сохраняются сразу.
 * JSON со списком выбранных полей добавляется к инструкции автоматически (см. `buildLabelPrompt`).
 */
export function PromptEditor({ value }: PromptEditorProps) {
  const { t } = useTranslation(['settings', 'common'])
  const [isEditing, setIsEditing] = useState(false)
  /** В режиме чтения длинный промпт свёрнут до нескольких строк. */
  const [isExpanded, setIsExpanded] = useState(false)
  /** Промпт на момент начала правки — к нему возвращает «Отмена». */
  const snapshot = useRef(value)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const text = value || DEFAULT_LABEL_INSTRUCTIONS
  const isCustom = value !== ''

  useHeightTransition(areaRef, isEditing || isExpanded, collapsedHeight)

  /** Включает правку: поле становится редактируемым и раскрывается, фокус не ставится. */
  const startEditing = () => {
    snapshot.current = value
    setIsEditing(true)
  }

  /** Заканчивает правку и убирает клавиатуру. */
  const finishEditing = () => {
    setIsEditing(false)
    areaRef.current?.blur()
  }

  /** Отменяет правку: возвращает промпт, каким он был при её начале. */
  const cancelEditing = () => {
    settingsStore.setPrompt(snapshot.current)
    finishEditing()
  }

  return (
    <FormSection
      title={t('advanced.prompt')}
      icon={<SparklesIcon />}
      action={(
        <div className="form-section-actions">
          {isEditing ? (
            <>
              <ActionButton variant="ghost" icon={<ResetIcon />} caption={t('advanced.resetCaption')} label={t('advanced.promptReset')} disabled={!isCustom} onClick={() => settingsStore.setPrompt('')} />
              <ActionButton variant="ghost" icon={<CloseIcon />} caption={t('advanced.cancelCaption')} label={t('common:cancel')} onClick={cancelEditing} />
              <ActionButton variant="ghost" icon={<CheckIcon />} caption={t('advanced.doneCaption')} label={t('advanced.promptDone')} active onClick={finishEditing} />
            </>
          ) : (
            <ActionButton variant="ghost" icon={<PencilIcon />} caption={t('advanced.editCaption')} label={t('advanced.promptEdit')} onClick={startEditing} />
          )}
        </div>
      )}
      hint={t('advanced.promptHint')}
    >
      <TextArea
        ref={areaRef}
        className={`prompt-editor${isEditing ? ' is-editing' : ''}`}
        aria-label={t('advanced.prompt')}
        value={text}
        readOnly={!isEditing}
        rows={COLLAPSED_LINES}
        onChange={(next) => settingsStore.setPrompt(next)}
      />
      {!isEditing && (
        <div className="prompt-editor-actions">
          <Button onClick={() => setIsExpanded((current) => !current)}>
            {isExpanded ? t('advanced.promptCollapse') : t('advanced.promptExpand')}
          </Button>
        </div>
      )}
    </FormSection>
  )
}
