import { COVER_MATERIALS } from '@/shared/theme/derive'
import { SIDEBAR_FIELD_LABEL, SIDEBAR_OPTIONS } from '@/shared/theme/labels'

test('barra lateral: os quatro valores do banco, com rótulo e descrição de uma linha', () => {
  expect(SIDEBAR_FIELD_LABEL).toBe('Barra lateral')
  expect(SIDEBAR_OPTIONS.map((o) => o.value)).toEqual([...COVER_MATERIALS])
  expect(SIDEBAR_OPTIONS.map((o) => o.label)).toEqual(['Cheia', 'Suave', 'Noite', 'Clara'])
  for (const o of SIDEBAR_OPTIONS) expect(o.hint).toMatch(/^[^\n]+\.$/)
})
