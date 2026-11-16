import { DEV_NAV, isNavActive } from '@/ui/shells/dev-nav'

test('o painel dev tem seis destinos, na ordem do desenho', () => {
  expect(DEV_NAV.map((n) => [n.label, n.href])).toEqual([
    ['Visão geral', '/'],
    ['Contas', '/contas'],
    ['Chaves e API', '/chaves'],
    ['Sistema', '/sistema'],
    ['Auditoria', '/auditoria'],
    ['Admins', '/admins'],
  ])
})

test('a raiz só ativa a Visão geral', () => {
  expect(isNavActive('/', '/')).toBe(true)
  expect(isNavActive('/contas', '/')).toBe(false)
})

test('subpáginas ativam o destino pai', () => {
  expect(isNavActive('/contas', '/contas')).toBe(true)
  expect(isNavActive('/contas/abc', '/contas')).toBe(true)
  expect(isNavActive('/contas/nova', '/contas')).toBe(true)
})

test('um prefixo parecido não ativa o destino errado', () => {
  expect(isNavActive('/contas-antigas', '/contas')).toBe(false)
  expect(isNavActive('/chaves/x', '/contas')).toBe(false)
})
