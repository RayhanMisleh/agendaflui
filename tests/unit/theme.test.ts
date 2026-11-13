import { contrastRatio, hexToOklch, normalizeHex, oklchToHex } from '@/ui/theme/color'
import { deriveTheme } from '@/ui/theme/derive'

const base = { accent: '#E0A030', material: 'LEATHER', paper: 'WHITE', fontPair: 'CLASSIC' } as const
const COLORS = ['#0E4F5C','#7A1F2B','#FFFF00','#FFFFFF','#000000','#808080','#FF6600','#2F6B4F','#C9A227','#E91E63','#3F51B5','#9E9E9E']
const PAPERS = ['WHITE', 'CREAM', 'GRAY'] as const

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
test.each(COLORS)('texto sobre a capa é legível com %s', (primary) => {
  const t = deriveTheme({ ...base, primary })
  expect(contrastRatio(t.vars['--on-cover'], t.vars['--cover'])).toBeGreaterThanOrEqual(4.5)
})
test.each(COLORS)('destaque %s é legível como texto nos três papéis', (accent) => {
  for (const paper of PAPERS) {
    const t = deriveTheme({ ...base, primary: '#0E4F5C', accent, paper })
    expect(contrastRatio(t.vars['--accent-ink'], t.vars['--paper'])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t.vars['--on-accent'], t.vars['--accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t.vars['--ink-soft'], t.vars['--paper'])).toBeGreaterThanOrEqual(4.5)
  }
})
test('cor que precisou de ajuste gera aviso; cor boa não', () => {
  expect(deriveTheme({ ...base, primary: '#808080' }).warnings.length).toBeGreaterThan(0)
  expect(deriveTheme({ ...base, primary: '#0E4F5C' }).warnings).toEqual([])
})
test('avisos usam o texto combinado', () => {
  const t = deriveTheme({ ...base, primary: '#808080', accent: '#808080' })
  expect(t.warnings).toEqual([
    'A cor principal foi escurecida para o texto ficar legível.',
    'A cor de destaque foi escurecida para o texto ficar legível.',
  ])
})
test('material e par de fontes viram atributos', () => {
  const t = deriveTheme({ ...base, primary: '#0E4F5C', material: 'LINEN', fontPair: 'FRIENDLY' })
  expect([t.material, t.fontPair]).toEqual(['linen', 'friendly'])
})
test('cores de situação são legíveis em todo papel', () => {
  for (const paper of PAPERS) {
    const t = deriveTheme({ ...base, primary: '#0E4F5C', paper })
    for (const k of ['--ok', '--warn', '--bad'] as const)
      expect(contrastRatio(t.vars[k], t.vars['--paper'])).toBeGreaterThanOrEqual(4.5)
  }
})
test('deriveTheme é determinística', () => {
  const input = { ...base, primary: '#7A1F2B' }
  expect(deriveTheme(input)).toEqual(deriveTheme({ ...input }))
})
test.each(COLORS)('texto secundário na capa tem 4.5 com %s', (primary) => {
  const t = deriveTheme({ ...base, primary })
  expect(contrastRatio(t.vars['--on-cover-soft'], t.vars['--cover'])).toBeGreaterThanOrEqual(4.5)
})
test.each(['#0E4F5C', '#3A2A20', '#2F6B4F'])('texto secundário na capa tem folga de 5,5 com %s', (primary) => {
  const t = deriveTheme({ ...base, primary })
  expect(contrastRatio(t.vars['--on-cover-soft'], t.vars['--cover'])).toBeGreaterThanOrEqual(5.5)
})
test('o tema padrão em base.css bate com o derivado da marca', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync('src/ui/styles/base.css', 'utf8')
  const t = deriveTheme({ ...base, primary: '#0E4F5C' })
  expect(css).toContain(`--on-cover-soft: ${t.vars['--on-cover-soft']};`)
})
test('tinta e tinta suave se leem sobre o papel rebaixado', () => {
  for (const paper of PAPERS) {
    const t = deriveTheme({ ...base, primary: '#0E4F5C', paper })
    expect(contrastRatio(t.vars['--ink'], t.vars['--paper-sunk'])).toBeGreaterThanOrEqual(7)
    expect(contrastRatio(t.vars['--ink-soft'], t.vars['--paper-sunk'])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t.vars['--ink-faint'], t.vars['--paper'])).toBeGreaterThanOrEqual(3)
  }
})
test('realce, sombra e costura são cores diferentes e hex válido', () => {
  const t = deriveTheme({ ...base, primary: '#0E4F5C' })
  expect(new Set([t.vars['--cover-hi'], t.vars['--cover-lo'], t.vars['--cover-deep']]).size).toBe(3)
  for (const primary of ['#000000', '#FFFFFF']) {
    const x = deriveTheme({ ...base, primary })
    for (const v of Object.values(x.vars)) expect(v).toMatch(/^#[0-9A-F]{6}$/)
  }
})
test.each(COLORS)('ida e volta sRGB → OKLCH → sRGB preserva %s', (hex) => {
  const back = oklchToHex(hexToOklch(hex))
  for (const i of [1, 3, 5]) {
    const d = Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(back.slice(i, i + 2), 16))
    expect(d).toBeLessThanOrEqual(1)
  }
})
test('cor inválida em deriveTheme lança RangeError', () => {
  expect(() => deriveTheme({ ...base, primary: 'vermelho' })).toThrow(RangeError)
  expect(() => deriveTheme({ ...base, primary: '#0E4F5C', accent: '#12' })).toThrow(RangeError)
})
