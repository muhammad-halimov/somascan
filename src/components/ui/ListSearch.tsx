import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon, SearchIcon } from '@/components/icons/Icons'
import { HEIGHT_EASING, heightDurationFor } from '@/hooks/useHeightTransition'
import './ListSearch.css'

/** С какой длины списка в нём появляется поиск: в коротком всё видно и так. */
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
 * Поиск — первая строка самого списка (`<List>`), а не отдельное поле над ним: та же поверхность меню
 * на Android (снизу линия, в фокусе — акцентная, как у поля) и та же группа на iOS (строка с лупой
 * и разделителем, как ячейка). Список фильтрует вызывающий (`matchesSearch`).
 *
 * Строк становится меньше или больше — высота раскрытой шторки (`.disclosure-content`) плавно едет
 * к новой с той же кривой, что и раскрытие, а не прыгает.
 */
export function ListSearch({ value, onChange, label }: ListSearchProps) {
  const { t } = useTranslation('common')
  const rowRef = useRef<HTMLLIElement>(null)
  /** Шторка и её высота до смены запроса — от неё едет высота после фильтрации. */
  const before = useRef<{ content: HTMLElement; height: number } | null>(null)

  const change = (next: string) => {
    const content = rowRef.current?.closest<HTMLElement>('.disclosure-content')
    before.current = content ? { content, height: content.getBoundingClientRect().height } : null
    onChange(next)
  }

  // Строки уже отфильтрованы (DOM обновлён): высота едет от прежней к новой, потом снова свободна.
  useLayoutEffect(() => {
    const start = before.current
    before.current = null
    if (!start) return
    const { content, height } = start
    const target = content.scrollHeight
    if (Math.abs(target - height) < 1 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const duration = Math.round(heightDurationFor(Math.abs(target - height)) * 0.7)
    content.style.transition = 'none'
    content.style.maxHeight = `${height}px`
    void content.offsetHeight
    content.style.transition = `max-height ${duration}ms ${HEIGHT_EASING}`
    content.style.maxHeight = `${target}px`
    const timer = window.setTimeout(() => {
      content.style.transition = ''
      content.style.maxHeight = 'none'
    }, duration + 40)
    return () => window.clearTimeout(timer)
  }, [value])

  return (
    <li ref={rowRef} className="list-search" role="search">
      <SearchIcon />
      <input
        type="search"
        className="list-search-input"
        value={value}
        placeholder={t('search')}
        aria-label={label}
        onChange={(event) => change(event.target.value)}
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
          onClick={() => change('')}
        >
          <CloseIcon />
        </button>
      )}
    </li>
  )
}

/** Строка списка «Ничего не найдено» — вместо строк, когда запросу ничего не подошло. */
export function ListSearchEmpty() {
  const { t } = useTranslation('common')
  return <li className="list-search-empty" role="status">{t('searchEmpty')}</li>
}
