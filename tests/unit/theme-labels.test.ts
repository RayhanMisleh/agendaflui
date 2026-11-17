import { COVER_MATERIALS, FONT_PAIRS, PAPER_TONES } from '@/shared/theme/derive'
import { FONT_PAIR_OPTIONS, GROUND_FIELD_LABEL, GROUND_OPTIONS, labelOf, SIDEBAR_FIELD_LABEL, SIDEBAR_OPTIONS } from '@/shared/theme/labels'

test('barra lateral: os quatro valores do banco, com rótulo e descrição de uma linha', () => {
  expect(SIDEBAR_FIELD_LABEL).toBe('Barra lateral')
  expect(SIDEBAR_OPTIONS.map((o) => o.value)).toEqual([...COVER_MATERIALS])
  expect(SIDEBAR_OPTIONS.map((o) => o.label)).toEqual(['Cheia', 'Suave', 'Noite', 'Clara'])
  for (const o of SIDEBAR_OPTIONS) expect(o.hint).toMatch(/^[^\n]+\.$/)
})

test('fundo: Branco, Espuma e Neutro', () => {
  expect(GROUND_FIELD_LABEL).toBe('Fundo')
  expect(GROUND_OPTIONS.map((o) => o.value)).toEqual([...PAPER_TONES])
  expect(GROUND_OPTIONS.map((o) => o.label)).toEqual(['Branco', 'Espuma', 'Neutro'])
})

test('pares de fontes: CLASSIC é o par da marca', () => {
  expect(FONT_PAIR_OPTIONS.map((o) => o.value)).toEqual([...FONT_PAIRS])
  expect(labelOf(FONT_PAIR_OPTIONS, 'CLASSIC')).toBe('Agenda Flui')
  expect(FONT_PAIR_OPTIONS[0]?.hint).toContain('Bricolage Grotesque')
  expect(FONT_PAIR_OPTIONS[0]?.hint).toContain('Figtree')
})
