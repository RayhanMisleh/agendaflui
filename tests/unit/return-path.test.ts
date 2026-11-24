import { safeReturnPath } from '@/shared/return-path'

const UUID = '0b6e66aa-0000-4000-8000-000000000001'

describe('safeReturnPath', () => {
  test('aceita a página da loja e caminhos dentro dela', () => {
    expect(safeReturnPath('a', '/a')).toBe('/a')
    expect(safeReturnPath('a', '/a/agendar')).toBe('/a/agendar')
    const q = `/a/agendar?pet=${UUID}&servicos=${UUID},${UUID}`
    expect(safeReturnPath('a', q)).toBe(q)
  })

  test('recusa outra loja, barra dupla, subida de pasta, esquema e barra invertida', () => {
    for (const ruim of ['/b/agendar', '//a', '/a/../b', 'https://x/a', '/a\\x', '/A', '/ab', '/a//x', '/a/x?y=<z>']) {
      expect(safeReturnPath('a', ruim), ruim).toBeNull()
    }
  })

  test('recusa texto longo demais, vazio e nulo', () => {
    expect(safeReturnPath('a', `/a/${'x'.repeat(298)}`)).toBeNull()
    expect(safeReturnPath('a', `/a/${'x'.repeat(297)}`)).not.toBeNull()
    expect(safeReturnPath('a', '')).toBeNull()
    expect(safeReturnPath('a', null)).toBeNull()
    expect(safeReturnPath('a', undefined)).toBeNull()
  })
})
