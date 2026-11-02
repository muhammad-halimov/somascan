import type { CSSProperties } from 'react'
import type { FrozenGlass } from './frozenGlass'

/**
 * Слой неподвижного стекла окна (`useFrozenGlass`): размытый снимок экрана во весь экран, сдвинутый так, что
 * совпадает с экраном, — под содержимым окна, обрезан его скруглённым краем. Свой слой композитора: растрируется
 * один раз, а когда окно меняет высоту, меняется только обрезка. Затемнение и тон окна — в CSS (`platform-ios.css`).
 */
export function FrozenGlassLayer({ glass }: { glass: FrozenGlass | null }) {
  if (!glass) return null
  const style = { '--frozen-glass-image': `url("${glass.url}")`, width: glass.width, height: glass.height } as CSSProperties
  return <div className="frozen-glass" aria-hidden="true" style={style} />
}
