import { describe, expect, test } from 'vitest'
import { contrastRatio } from '@/shared/theme/color'
import { deriveTheme } from '@/shared/theme/derive'
import { FONT_PAIRS, previewTheme, RELIEF_MIN_DELTA_L, type ThemeWarning } from '@/shared/theme/preview'

const base = { primary: '#0e4f5c', accent: '#e0a030', material: 'ENAMEL', paper: 'WHITE', fontPair: 'CLASSIC' } as const
const PAPERS = ['WHITE', 'CREAM', 'GRAY'] as const
const EXTREMAS = [
  ['branco puro', '#ffffff'],
  ['preto', '#000000'],
  ['amarelo neon', '#ffff00'],
  ['igual ao papel', '#fbfaf7'],
] as const

/** Todo par texto/fundo que o painel usa, com o mínimo de contraste de cada um. */
function pares(t: Record<string, string>): [string, string, number][] {
  const v = (k: string): string => t[k] ?? ''
  return [
    ['--on-cover', '--cover', 4.5],
    ['--on-cover-soft', '--cover', 4.5],
    ['--on-accent', '--accent', 4.5],
    ['--accent-ink', '--paper', 4.5],
    ['--ink', '--paper', 4.5],
    ['--ink-soft', '--paper', 4.5],
    ['--ink-soft', '--paper-sunk', 4.5],
    ['--ok', '--paper', 4.5],
    ['--warn', '--paper', 4.5],
    ['--bad', '--paper', 4.5],
    ['--ink-faint', '--paper', 3],
  ].map(([fg, bg, min]) => {
    expect(v(fg as string), `token ${fg as string} existe`).not.toBe('')
    return [v(fg as string), v(bg as string), min as number]
  })
}

describe('previewTheme: cores extremas', () => {
  test.each(EXTREMAS)('%s como cor principal e como destaque: todo par texto/fundo passa de 4,5', (_nome, cor) => {
    for (const paper of PAPERS) {
      for (const entrada of [
        { ...base, paper, primary: cor },
        { ...base, paper, accent: cor },
        { ...base, paper, primary: cor, accent: cor },
      ]) {
        const { tokens } = previewTheme(entrada)
        for (const [fg, bg, min] of pares(tokens)) {
          expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min)
        }
      }
    }
  })

  test('branco puro, preto, amarelo neon e cor igual ao papel perdem o relevo da capa', () => {
    for (const [nome, cor] of EXTREMAS) {
      expect(previewTheme({ ...base, primary: cor }).warnings, nome).toContain('relief_collapsed')
    }
  })

  test('branco, amarelo e cor igual ao papel têm texto escuro legível e não avisam de texto trocado', () => {
    for (const cor of ['#ffffff', '#ffff00', '#fbfaf7']) {
      const r = previewTheme({ ...base, primary: cor })
      expect(r.warnings).toEqual(['relief_collapsed'])
      expect(contrastRatio(r.tokens['--on-cover'] ?? '', r.tokens['--cover'] ?? '')).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('preto: texto claro, sem texto trocado, só o relevo some', () => {
    const r = previewTheme({ ...base, primary: '#000000' })
    expect(r.warnings).toEqual(['relief_collapsed'])
    expect(r.tokens['--on-cover']?.toLowerCase()).toBe('#ffffff')
  })

  test('cinza médio que não dá contraste: o motor troca a cor e avisa text_adjusted', () => {
    const r = previewTheme({ ...base, primary: '#808080' })
    expect(r.warnings).toEqual(['text_adjusted'])
    expect(r.tokens['--cover']?.toLowerCase()).not.toBe('#808080')
  })

  test('destaque que não dá contraste: accent_adjusted; os dois ajustados saem na mesma ordem sempre', () => {
    expect(previewTheme({ ...base, accent: '#808080' }).warnings).toEqual(['accent_adjusted'])
    const dois: ThemeWarning[] = previewTheme({ ...base, primary: '#808080', accent: '#808080' }).warnings
    expect(dois).toEqual(['text_adjusted', 'accent_adjusted'])
  })

  test('destaque branco ou preto não derruba nada (sem texto trocado nem relevo exigido do destaque)', () => {
    expect(previewTheme({ ...base, accent: '#ffffff' }).warnings).toEqual([])
    expect(previewTheme({ ...base, accent: '#000000' }).warnings).toEqual([])
  })
})

describe('previewTheme: cores comuns', () => {
  test.each(['#0e4f5c', '#7a1f2b', '#2f6b4f', '#3f51b5', '#c2185b'])('%s sem avisos', (primary) => {
    for (const paper of PAPERS) expect(previewTheme({ ...base, primary, paper }).warnings).toEqual([])
  })

  test('a marca AgendaFlui padrão não avisa nada', () => {
    expect(previewTheme(base).warnings).toEqual([])
  })
})

describe('previewTheme: mesmos tokens do painel', () => {
  test('tokens são exatamente as variáveis do deriveTheme e `theme` traz material e fonte', () => {
    const entrada = { ...base, primary: '#7a1f2b', material: 'LEATHER', paper: 'CREAM', fontPair: 'MODERN' } as const
    const r = previewTheme(entrada)
    const painel = deriveTheme(entrada)
    expect(r.tokens).toEqual(painel.vars)
    expect(r.theme).toEqual(painel)
    expect([r.theme.material, r.theme.fontPair]).toEqual(['leather', 'modern'])
  })

  test('aceita maiúsculas e minúsculas e é determinística', () => {
    expect(previewTheme({ ...base, primary: '#7A1F2B' })).toEqual(previewTheme({ ...base, primary: '#7a1f2b' }))
  })

  test('cor ainda incompleta (digitando) não quebra: usa a cor padrão e segue', () => {
    expect(() => previewTheme({ ...base, primary: '#7a12', accent: 'red' })).not.toThrow()
    expect(previewTheme({ ...base, primary: '#7a12' }).tokens).toEqual(previewTheme(base).tokens)
  })
})

describe('constantes', () => {
  test('o limiar do relevo e a lista de pares de fontes estão declarados', () => {
    expect(RELIEF_MIN_DELTA_L).toBeGreaterThan(0)
    expect(RELIEF_MIN_DELTA_L).toBeLessThan(8)
    expect([...FONT_PAIRS]).toEqual(['CLASSIC', 'MODERN', 'FRIENDLY'])
  })
})
