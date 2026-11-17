import { readFileSync } from 'node:fs'
import { contrastRatio } from '@/ui/theme/color'
import { THEME_VARS, deriveTheme } from '@/ui/theme/derive'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'

const css = readFileSync(new URL('../../../src/ui/styles/tokens.css', import.meta.url), 'utf8')
const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Declarações do primeiro bloco cujo seletor é exatamente `seletor`. */
function bloco(seletor: string): Record<string, string> {
  const m = new RegExp(`(?:^|\\})\\s*${seletor.replace(/[[\]'.]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(semComentarios)
  expect(m, `bloco ${seletor}`).not.toBeNull()
  return Object.fromEntries(Array.from(m![1]!.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)).map((d) => [d[1]!, d[2]!.trim()]))
}

describe('tokens.css', () => {
  const raiz = bloco(':root')

  test('declara todos os nomes do contrato, com os valores da marca no dia', () => {
    const esperado = deriveTheme(AGENDAFLUI_BRAND).vars
    for (const nome of THEME_VARS) {
      if (nome.startsWith('--font')) continue
      expect(raiz[nome]?.toUpperCase(), nome).toBe(esperado[nome])
    }
  })

  test('raios, espaços e sombra da marca', () => {
    expect(raiz['--radius-chip']).toBe('10px')
    expect(raiz['--radius-card']).toBe('16px')
    expect(raiz['--radius-block']).toBe('28px')
    expect(raiz['--radius-pill']).toBe('999px')
    expect(['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6'].map((k) => raiz[k])).toEqual(['4px', '8px', '16px', '24px', '40px', '72px'])
    expect(raiz['--shadow-pop']).toContain('24px 48px -20px')
  })

  test('escala de texto e fontes da marca', () => {
    for (const k of ['--text-display', '--text-h1', '--text-h2', '--text-h3', '--text-body-lg', '--text-body', '--text-small']) expect(raiz[k], k).toBeTruthy()
    expect(raiz['--text-display-ls']).toBe('-0.03em')
    expect(raiz['--text-h1-ls']).toBe('-0.02em')
    expect(raiz['--text-h2-ls']).toBe('-0.015em')
    expect(raiz['--font-display']).toContain('Bricolage Grotesque')
    expect(raiz['--font-sans']).toContain('Figtree')
  })

  test('o tema noite traz os valores do JSON da marca e passa 4,5 nos pares de texto', () => {
    const n = bloco("[data-scheme='night']")
    expect(n).toMatchObject({
      '--brand': '#3CC4B4', '--brand-strong': '#6EDBCD', '--brand-tint': '#12403B', '--on-brand': '#062421',
      '--accent': '#F5B85A', '--accent-tint': '#4A3514', '--ground': '#0C1A18', '--surface': '#13241F',
      '--ink': '#E8F2EF', '--ink-muted': '#9DB3AE', '--line': '#24403A', '--success': '#4CC47E', '--danger': '#F07A68',
    })
    for (const [fg, bg] of [['--ink', '--ground'], ['--ink-muted', '--surface'], ['--brand-text', '--surface'], ['--on-brand', '--brand'], ['--side-ink', '--side-bg'], ['--side-ink-muted', '--side-bg'], ['--side-active-ink', '--side-active-bg']] as const) {
      expect(contrastRatio(n[fg] ?? '', n[bg] ?? ''), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('anel de foco em caramelo e seleção em brand-tint', () => {
    expect(semComentarios).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--accent\);[^}]*outline-offset:\s*2px/)
    expect(semComentarios).toMatch(/::selection\s*\{[^}]*background:\s*var\(--brand-tint\)/)
  })

  test('os apelidos temporários estão todos marcados "R2 remove"', () => {
    const linhas = css.split('\n').filter((l) => /^\s*--(cover|on-cover|paper|ink-soft|ink-faint|ok|warn|bad|accent-hi|accent-lo|accent-ink|font-ui|font-stamp)[a-z-]*:/.test(l))
    expect(linhas.length).toBeGreaterThanOrEqual(19)
    for (const l of linhas) expect(l).toContain('/* R2 remove */')
  })
})
