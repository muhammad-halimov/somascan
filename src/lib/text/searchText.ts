/**
 * Поиск по спискам (поставщики, поля бирки): без регистра и диакритики, по словам запроса в любом порядке.
 */

/** Текст для сравнения: без регистра и диакритики («Ózdi» находится по «ozd»). */
export const foldSearchText = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()

/**
 * Подходит ли текст под запрос: каждое слово запроса есть в тексте — в любом месте и порядке
 * («steel suez» находит «Suez Steel»). Пустой запрос подходит ко всему.
 */
export function matchesSearch(text: string, query: string): boolean {
  const words = foldSearchText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const folded = foldSearchText(text)
  return words.every((word) => folded.includes(word))
}
