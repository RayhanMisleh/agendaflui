import type { CSSProperties, ReactNode } from 'react'
import type { ThemeTokens } from './derive'

/** Aplica as variáveis da marca a tudo que estiver dentro. Pode ser aninhado. */
export function ThemeScope(p: { theme: ThemeTokens; children: ReactNode; className?: string }) {
  const style: CSSProperties & ThemeTokens['vars'] = { ...p.theme.vars }
  return (
    <div
      style={style}
      data-material={p.theme.material}
      data-font={p.theme.fontPair}
      className={p.className}
    >
      {p.children}
    </div>
  )
}
