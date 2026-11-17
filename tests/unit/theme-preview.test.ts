import { describe, expect, test } from 'vitest'
import { contrastRatio } from '@/shared/theme/color'
import { deriveTheme, THEME_WARNING_TEXT } from '@/shared/theme/derive'
import { FONT_PAIRS, previewTheme, SIDEBAR_GROUND_MIN_CONTRAST, type ThemeWarning } from '@/shared/theme/preview'

const base = { primary: '#0b6e66', accent: '#f2a93b', material: 'LEATHER', paper: 'CREAM', fontPair: 'CLASSIC' } as const
const PAPERS = ['WHITE', 'CREAM', 'GRAY'] as const
const MATERIALS = ['LEATHER', 'LINEN', 'WOOD', 'ENAMEL'] as const
const EXTREMAS = [
  ['branco puro', '#ffffff'],
  ['preto', '#000000'],
  ['amarelo neon', '#ffff00'],
  ['igual ao fundo', '#f3f8f6'],
] as const

/** Todo par texto/fundo que o painel promete, com o mínimo de contraste de cada um. */
const PARES: [string, string][] = [
  ['--ink', '--ground'], ['--ink', '--surface'], ['--ink-muted', '--ground'], ['--ink-muted', '--surface'],
  ['--on-brand', '--brand'], ['--brand-text', '--ground'], ['--brand-text', '--surface'], ['--brand-text', '--brand-tint'],
  ['--on-accent', '--accent'], ['--ink', '--brand-tint'], ['--ink', '--accent-tint'],
  ['--side-ink', '--side-bg'], ['--side-ink-muted', '--side-bg'], ['--side-active-ink', '--side-active-bg'],
]

describe('previewTheme: cores extremas', () => {
  test.each(EXTREMAS)('%s como cor da conta e como destaque: todo par texto/fundo passa de 4,5', (_nome, cor) => {
    for (const paper of PAPERS) {
      for (const material of MATERIALS) {
        for (const entrada of [
          { ...base, paper, material, primary: cor },
          { ...base, paper, material, accent: cor },
          { ...base, paper, material, primary: cor, accent: cor },
        ]) {
          const { tokens } = previewTheme(entrada)
          for (const [fg, bg] of PARES) {
            expect(tokens[fg], fg).toBeTruthy()
            expect(contrastRatio(tokens[fg] ?? '', tokens[bg] ?? ''), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
  })

  test('branco puro e amarelo neon: texto escuro sobre a cor, texto da conta escurecido, text_adjusted', () => {
    for (const cor of ['#ffffff', '#ffff00']) {
      const r = previewTheme({ ...base, primary: cor })
      expect(r.tokens['--on-brand']).toBe('#0F2A27')
      expect(r.tokens['--brand-text']).not.toBe(cor.toUpperCase())
      expect(r.warnings).toContain('text_adjusted')
    }
  })

  test('preto: texto claro sobre a cor e nada de aviso de texto', () => {
    const r = previewTheme({ ...base, primary: '#000000' })
    expect(r.tokens['--on-brand']).toBe('#FFFFFF')
    expect(r.warnings).not.toContain('text_adjusted')
  })

  test('cinza médio que não dá contraste: o motor escurece a cor e avisa text_adjusted', () => {
    const r = previewTheme({ ...base, primary: '#808080' })
    expect(r.warnings).toEqual(['text_adjusted'])
    expect(r.tokens['--brand']?.toLowerCase()).not.toBe('#808080')
    expect(r.tokens['--on-brand']).toBe('#FFFFFF')
  })

  test('destaque que a tinta não lê: clareia e avisa accent_adjusted; os dois saem sempre na mesma ordem', () => {
    const r = previewTheme({ ...base, accent: '#808080' })
    expect(r.warnings).toEqual(['accent_adjusted'])
    expect(r.tokens['--accent']?.toLowerCase()).not.toBe('#808080')
    const dois: ThemeWarning[] = previewTheme({ ...base, primary: '#808080', accent: '#808080' }).warnings
    expect(dois).toEqual(['text_adjusted', 'accent_adjusted'])
  })

  test('destaque branco não avisa; destaque preto clareia', () => {
    expect(previewTheme({ ...base, accent: '#ffffff' }).warnings).toEqual([])
    expect(previewTheme({ ...base, accent: '#000000' }).warnings).toEqual(['accent_adjusted'])
  })
})

describe('previewTheme: barra lateral contra o fundo', () => {
  test('o limiar está declarado', () => {
    expect(SIDEBAR_GROUND_MIN_CONTRAST).toBe(1.15)
  })

  test.each(PAPERS)('barra Clara (branca) sobre o fundo %s se confunde: sidebar_near_ground', (paper) => {
    expect(previewTheme({ ...base, paper, material: 'ENAMEL' }).warnings).toContain('sidebar_near_ground')
  })

  test('barra Suave só avisa quando a Bolha fica perto do fundo', () => {
    for (const paper of PAPERS) {
      for (const primary of ['#0b6e66', '#7a1f2b', '#3f51b5']) {
        const t = deriveTheme({ ...base, paper, primary, material: 'LINEN' })
        const perto = contrastRatio(t.vars['--side-bg'], t.vars['--ground']) < SIDEBAR_GROUND_MIN_CONTRAST
        expect(previewTheme({ ...base, paper, primary, material: 'LINEN' }).warnings.includes('sidebar_near_ground'), `${primary} ${paper}`).toBe(perto)
      }
    }
  })

  test('barras Cheia e Noite com cor comum nunca avisam', () => {
    for (const material of ['LEATHER', 'WOOD'] as const) {
      for (const paper of PAPERS) expect(previewTheme({ ...base, paper, material }).warnings).toEqual([])
    }
  })

  test('as mensagens antigas (relevo e capa contra papel) não existem mais', () => {
    expect(Object.keys(THEME_WARNING_TEXT).sort()).toEqual(['accent_adjusted', 'invalid_color', 'sidebar_near_ground', 'text_adjusted'])
  })
})

describe('previewTheme: cores comuns', () => {
  test.each(['#0e4f5c', '#7a1f2b', '#2f6b4f', '#3f51b5', '#c2185b'])('%s sem avisos com barra Cheia', (primary) => {
    for (const paper of PAPERS) expect(previewTheme({ ...base, primary, paper }).warnings).toEqual([])
  })

  test('a marca Agenda Flui padrão não avisa nada', () => {
    expect(previewTheme(base).warnings).toEqual([])
  })
})

describe('previewTheme: mesmos tokens do painel', () => {
  test('tokens são exatamente as variáveis do deriveTheme e `theme` traz material, fonte e esquema', () => {
    const entrada = { ...base, primary: '#7a1f2b', material: 'LEATHER', paper: 'CREAM', fontPair: 'MODERN' } as const
    const r = previewTheme(entrada)
    const painel = deriveTheme(entrada)
    expect(r.tokens).toEqual(painel.vars)
    expect(r.theme).toEqual(painel)
    expect([r.theme.material, r.theme.fontPair, r.theme.scheme]).toEqual(['leather', 'modern', 'day'])
  })

  test('aceita maiúsculas e minúsculas e é determinística', () => {
    expect(previewTheme({ ...base, primary: '#7A1F2B' })).toEqual(previewTheme({ ...base, primary: '#7a1f2b' }))
  })

  test('cor fora do formato do servidor (#RRGGBB) usa o padrão e devolve invalid_color', () => {
    for (const ruim of ['#7a12', '#FFF', 'fff', '0e4f5c', 'red', '', '#12345g']) {
      const r = previewTheme({ ...base, primary: ruim })
      expect(r.warnings, ruim).toEqual(['invalid_color'])
      expect(r.tokens).toEqual(previewTheme(base).tokens)
    }
    expect(previewTheme({ ...base, accent: '#FFF' }).warnings).toEqual(['invalid_color'])
    expect(previewTheme({ ...base, primary: 'x', accent: 'y' }).warnings).toEqual(['invalid_color'])
  })
})

test('a lista de pares de fontes está declarada', () => {
  expect([...FONT_PAIRS]).toEqual(['CLASSIC', 'MODERN', 'FRIENDLY'])
})
