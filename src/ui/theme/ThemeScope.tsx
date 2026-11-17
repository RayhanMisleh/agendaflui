import type { CSSProperties, ReactNode } from 'react'
import type { ThemeTokens } from './derive'

/**
 * Atributos que fazem um elemento ser um escopo de tema: as variáveis da marca em linha e os `data-*` que o CSS lê.
 * `data-scheme` escolhe dia ou noite.
 */
export function themeAttrs(theme: ThemeTokens): {
  style: CSSProperties & ThemeTokens['vars']
  'data-theme': ''
  'data-scheme': ThemeTokens['scheme']
  'data-font': ThemeTokens['fontPair']
} {
  return {
    style: { ...theme.vars },
    'data-theme': '',
    'data-scheme': theme.scheme,
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

/**
 * O tema noite exato da marca (painel dev): sem variáveis em linha, só `data-scheme="night"`, que `tokens.css` resolve.
 * Pinta o próprio fundo e o texto, porque o `body` segue o dia.
 */
export function NightScope(p: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <div data-theme="" data-scheme="night" data-testid={p.testId} className={p.className} style={{ background: 'var(--ground)', color: 'var(--ink)' }}>
      {p.children}
    </div>
  )
}
