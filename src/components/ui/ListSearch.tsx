import { useTranslation } from 'react-i18next'
import { CloseIcon, SearchIcon } from '@/components/icons/Icons'
import './ListSearch.css'

/** С какой длины списка над ним появляется поиск: в коротком всё видно и так. */
export const LIST_SEARCH_MIN_ITEMS = 8

/** Свойства `ListSearch`. */
export interface ListSearchProps {
  /** Текст запроса. */
  value: string
  /** Новый текст запроса. */
  onChange: (value: string) => void
  /** Доступное имя поля (что ищем). */
  label: string
}

/**
 * Поле поиска над списком в шторке или выпадающем списке: лупа, текст, крестик очистки. На Android — заполненное
 * поле-«пилюля» Material 3, на iOS — поле поиска UIKit (UISearchBar). Список фильтрует вызывающий (`matchesSearch`).
 */
export function ListSearch({ value, onChange, label }: ListSearchProps) {
  const { t } = useTranslation('common')
  return (
    <div className="list-search" role="search">
      <SearchIcon />
      <input
        type="search"
        className="list-search-input"
        value={value}
        placeholder={t('search')}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {value && (
        <button
          type="button"
          className="list-search-clear"
          aria-label={t('searchClear')}
          // Крестик не уводит фокус из поля: можно сразу ввести новый запрос.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onChange('')}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}

/** Строка «Ничего не найдено» вместо пустого списка. */
export function ListSearchEmpty() {
  const { t } = useTranslation('common')
  return <p className="list-search-empty" role="status">{t('searchEmpty')}</p>
}
