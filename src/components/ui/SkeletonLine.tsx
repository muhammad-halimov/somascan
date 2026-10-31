/** Свойства `SkeletonLine`. */
export interface SkeletonLineProps {
  /** Класс полосы (ширина по месту). */
  className?: string
}

/**
 * Силуэт строки текста, пока содержимое загружается: переливающаяся полоса (`.skeleton-line`). Перед ней —
 * пустой символ нулевой ширины: он задаёт строке высоту и базовую линию шрифта, как у текста, который появится
 * на её месте, — при появлении текста ничего не сдвигается.
 */
export function SkeletonLine({ className }: SkeletonLineProps) {
  return (
    <>
      {'\u200B'}
      <span className={`skeleton-line skeleton${className ? ` ${className}` : ''}`} />
    </>
  )
}
