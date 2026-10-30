import { useTranslation } from 'react-i18next'
import { BellIcon, CheckIcon } from '@/components/icons/Icons'
import { ActionTextInput } from '@/components/ui/ActionTextInput'
import { Field } from '@/components/ui/Field'
import { FormSection } from '@/components/ui/FormSection'
import { List, ListItem } from '@/components/ui/List'
import { settingsStore } from '../../store/SettingsStore'
import { useSettings } from '../../store/useSettings'
import { useTableLock } from './useTableLock'

/**
 * «Звонок» Somasync через Firebase Firestore (`uploads/drive/firestoreBell.ts`): после записи бирки в Google Drive
 * телефон сообщает Somasync, и тот переносит её в журнал на сетевом диске сразу, а не при проверке копии.
 * Переключатель, ID проекта и ключ Web API — под одним замком, как путь к таблице: замок справа открывает их,
 * пока форма на экране.
 */
export function FirestoreBellField() {
  const { t } = useTranslation('settings')
  const { storage: { firestore } } = useSettings()
  const lock = useTableLock({ lock: t('storage.firestore.lock'), unlock: t('storage.firestore.unlock') })
  const { icon, label, tone, onClick } = lock.action
  return (
    <FormSection title={t('storage.firestore.title')} icon={<BellIcon />} hint={t('storage.firestore.sectionHint')}>
      <List label={t('storage.firestore.title')}>
        <ListItem
          itemRole="checkbox"
          className={lock.locked ? 'is-locked' : undefined}
          primary={t('storage.firestore.label')}
          secondary={t('storage.firestore.hint')}
          selected={firestore.enabled}
          disabled={lock.locked}
          trailing={firestore.enabled ? <CheckIcon /> : undefined}
          onClick={() => settingsStore.updateFirestore({ enabled: !firestore.enabled })}
          action={(
            <button type="button" className={`input-action${tone ? ` is-${tone}` : ''}`} aria-label={label} onClick={onClick}>
              {icon}
            </button>
          )}
        />
      </List>
      {firestore.enabled && (
        <>
          <Field label={t('storage.firestore.projectId')}>
            <ActionTextInput
              placeholder="somascan-12345"
              value={firestore.projectId}
              onChange={(projectId) => settingsStore.updateFirestore({ projectId })}
              locked={lock.locked}
              action={lock.action}
            />
          </Field>
          <Field label={t('storage.firestore.apiKey')}>
            <ActionTextInput
              placeholder="AIza…"
              value={firestore.apiKey}
              onChange={(apiKey) => settingsStore.updateFirestore({ apiKey })}
              locked={lock.locked}
              action={lock.action}
            />
          </Field>
        </>
      )}
    </FormSection>
  )
}
