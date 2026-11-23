import { contrastRatio, hexToOklch, normalizeHex, oklchToHex } from '@/ui/theme/color'
import { COVER_MATERIALS, deriveTheme, type ThemeVar } from '@/ui/theme/derive'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'

const base = { accent: '#F2A93B', material: 'LEATHER' } as const
const COLORS = ['#0B6E66', '#7A1F2B', '#FFFF00', '#FFFFFF', '#000000', '#808080', '#FF6600', '#2F6B4F', '#C9A227', '#E91E63', '#3F51B5', '#9E9E9E']
const ACCENTS = ['#F2A93B', '#000000', '#FFFFFF', '#808080', '#1F2A44']

// Valores de design-tokens/agenda-flui-tokens.json (a marca), copiados aqui porque a pasta da marca fica fora do repositório.
const MARCA_DIA: Partial<Record<ThemeVar, string>> = {
  '--brand': '#0B6E66',
  '--brand-strong': '#08534D',
  '--brand-tint': '#D7EFEB',
  '--on-brand': '#FFFFFF',
  '--accent': '#F2A93B',
  '--accent-tint': '#FCEBD0',
  '--ground': '#F3F8F6',
  '--surface': '#FFFFFF',
  '--ink': '#0F2A27',
  '--ink-muted': '#4A615D',
  '--line': '#D3E2DE',
  '--success': '#1E8A4C',
  '--danger': '#C8412F',
}

test('normaliza formatos soltos', () => {
  expect(normalizeHex('#abc')).toBe('#AABBCC')
  expect(normalizeHex('aabbcc')).toBe('#AABBCC')
  expect(normalizeHex(' #AaBbCc ')).toBe('#AABBCC')
})
test('recusa o que não é cor', () => {
  for (const bad of ['', '#12', 'vermelho', '#GGGGGG', '#1234567']) expect(() => normalizeHex(bad)).toThrow(RangeError)
})
test('contraste conhecido', () => {
  expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0)
  expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1)
})
test.each(COLORS)('ida e volta sRGB → OKLCH → sRGB preserva %s', (hex) => {
  const back = oklchToHex(hexToOklch(hex))
  for (const i of [1, 3, 5]) {
    const d = Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(back.slice(i, i + 2), 16))
    expect(d).toBeLessThanOrEqual(1)
  }
})

describe('a marca Agenda Flui no dia', () => {
  const t = deriveTheme(AGENDAFLUI_BRAND)
  test('o padrão é Água, Caramelo, barra Cheia, fundo Espuma e o par da marca', () => {
    expect(AGENDAFLUI_BRAND).toMatchObject({ primary: '#0B6E66', accent: '#F2A93B', material: 'LEATHER' })
  })
  test.each(Object.entries(MARCA_DIA))('%s bate com o JSON da marca', (nome, valor) => {
    expect(t.vars[nome as ThemeVar]).toBe(valor)
  })
  test('texto na cor da conta é a própria Água; texto sobre o destaque é a tinta; sem avisos', () => {
    expect(t.vars['--brand-text']).toBe('#0B6E66')
    expect(t.vars['--on-accent']).toBe('#0F2A27')
    expect(t.signals).toEqual([])
    expect(t.scheme).toBe('day')
  })
  test('as fontes são sempre o par da marca', () => {
    expect(t.vars['--font-display']).toContain('Bricolage')
    expect(t.vars['--font-sans']).toContain('Figtree')
  })
})

describe('fundo e barra lateral', () => {
  test('Espuma toma a matiz da cor da conta', () => {
    const o = hexToOklch(deriveTheme({ ...AGENDAFLUI_BRAND, primary: '#7A1F2B' }).vars['--ground'])
    const dh = Math.abs(((o.h - hexToOklch('#7A1F2B').h + 540) % 360) - 180)
    expect(dh).toBeLessThan(40)
    expect(o.c).toBeGreaterThan(0.002)
    expect(o.l).toBeGreaterThan(96)
  })
  test('Cheia usa a cor da conta; Suave a Bolha; Noite a tinta escura; Clara a superfície', () => {
    const v = (material: (typeof COVER_MATERIALS)[number]) => deriveTheme({ ...AGENDAFLUI_BRAND, material }).vars
    expect(v('LEATHER')['--side-bg']).toBe('#0B6E66')
    expect(v('LEATHER')['--side-active-bg']).toBe('#FFFFFF')
    expect(v('LINEN')['--side-bg']).toBe('#D7EFEB')
    expect(v('LINEN')['--side-active-bg']).toBe('#0B6E66')
    expect(v('WOOD')['--side-bg']).toBe('#0F2A27')
    expect(v('ENAMEL')['--side-bg']).toBe('#FFFFFF')
    expect(v('ENAMEL')['--side-active-bg']).toBe('#D7EFEB')
  })
})

describe('contraste por força bruta (dia e noite)', () => {
  const pares: Array<[ThemeVar, ThemeVar]> = [
    ['--ink', '--ground'], ['--ink', '--surface'], ['--ink-muted', '--ground'], ['--ink-muted', '--surface'],
    ['--on-brand', '--brand'], ['--on-brand', '--brand-strong'],
    ['--brand-text', '--ground'], ['--brand-text', '--surface'], ['--brand-text', '--brand-tint'],
    ['--ink', '--brand-tint'], ['--ink', '--accent-tint'], ['--ink', '--success-tint'], ['--ink', '--danger-tint'],
    ['--on-accent', '--accent'],
    ['--side-ink', '--side-bg'], ['--side-ink-muted', '--side-bg'], ['--side-active-ink', '--side-active-bg'],
  ]
  for (const scheme of ['day', 'night'] as const) {
    test(`todo par texto/fundo promete 4,5 (${scheme})`, () => {
      for (const primary of COLORS) {
        for (const accent of ACCENTS) {
          for (const material of COVER_MATERIALS) {
            const t = deriveTheme({ primary, accent, material, scheme })
            for (const [fg, bg] of pares) {
              const r = contrastRatio(t.vars[fg], t.vars[bg])
              expect(r, `${scheme} ${primary}/${accent}/${material}: ${fg} sobre ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
            }
          }
        }
      }
    })
  }
  test('toda cor sai em hex #RRGGBB', () => {
    for (const primary of ['#000000', '#FFFFFF']) {
      const x = deriveTheme({ ...base, primary })
      for (const [k, v] of Object.entries(x.vars)) if (!k.startsWith('--font')) expect(v, k).toMatch(/^#[0-9A-F]{6}$/)
    }
  })
})

test('a noite usa os fundos e a tinta da marca', () => {
  const v = deriveTheme({ ...AGENDAFLUI_BRAND, scheme: 'night' }).vars
  expect([v['--ground'], v['--surface'], v['--ink'], v['--line']]).toEqual(['#0C1A18', '#13241F', '#E8F2EF', '#24403A'])
  expect(deriveTheme({ ...AGENDAFLUI_BRAND, scheme: 'night' }).scheme).toBe('night')
})

test('deriveTheme é determinística', () => {
  const input = { ...base, primary: '#7A1F2B' }
  expect(deriveTheme(input)).toEqual(deriveTheme({ ...input }))
})
test('cor inválida em deriveTheme lança RangeError', () => {
  expect(() => deriveTheme({ ...base, primary: 'vermelho' })).toThrow(RangeError)
  expect(() => deriveTheme({ ...base, primary: '#0B6E66', accent: '#12' })).toThrow(RangeError)
})

describe('tema neutro em src/shared', () => {
  test('os caminhos antigos reexportam as mesmas funções do caminho novo', async () => {
    const color = await import('@/shared/theme/color')
    const derive = await import('@/shared/theme/derive')
    expect(color.normalizeHex).toBe(normalizeHex)
    expect(color.contrastRatio).toBe(contrastRatio)
    expect(derive.deriveTheme).toBe(deriveTheme)
  })
})
