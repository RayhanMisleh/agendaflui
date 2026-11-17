import type { CSSProperties, ReactNode } from 'react'
import type { ThemeTokens } from './derive'

/**
 * Atributos que fazem um elemento ser um escopo de tema: as variáveis da marca em linha e os `data-*` que o CSS lê.
 * `data-theme` é o que liga os apelidos temporários de `tokens.css` à cor da conta; `data-scheme` escolhe dia ou noite.
 */
export function themeAttrs(theme: ThemeTokens): {
  style: CSSProperties & ThemeTokens['vars']
  'data-theme': ''
  'data-scheme': ThemeTokens['scheme']
  'data-material': ThemeTokens['material']
  'data-font': ThemeTokens['fontPair']
} {
  return {
    style: { ...theme.vars },
    'data-theme': '',
    'data-scheme': theme.scheme,
    'data-material': theme.material,
    'data-font': theme.fontPair,
  }
}

/** Aplica as variáveis da marca a tudo que estiver dentro. Pode ser aninhado. */
export function ThemeScope(p: {
  theme: ThemeTokens
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <div {...themeAttrs(p.theme)} data-testid={p.testId} className={p.className}>
      {p.children}
    </div>
  )
}
