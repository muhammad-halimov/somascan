import { useEffect, type RefObject } from 'react'

/** Атрибут `<html>`: рабочая область прокручена — под шапку заехало содержимое (`platform-ios.css`). */
const ATTRIBUTE = 'data-content-under-header'

/**
 * Отмечает на `<html>`, что под шапкой есть содержимое — рабочая область `ref` прокручена от начала. Пока она
 * в начале, под шапкой ровный фон, и мягкий край шапки (Liquid Glass) не размывает: размытие ровного фона его
 * не меняет, а GPU пересчитывал бы край на каждом кадре движения фото у верхней кромки.
 */
export function useContentUnderHeader(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const workspace = ref.current
    if (!workspace) return
    const root = document.documentElement
    const update = () => root.toggleAttribute(ATTRIBUTE, workspace.scrollTop > 0)
    update()
    workspace.addEventListener('scroll', update, { passive: true })
    return () => {
      workspace.removeEventListener('scroll', update)
      root.removeAttribute(ATTRIBUTE)
    }
  }, [ref])
}
