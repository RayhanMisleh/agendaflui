import { DEV_NAV, isNavActive } from '@/ui/shells/dev-nav'

test('o painel dev tem cinco destinos, na ordem do desenho', () => {
  expect(DEV_NAV.map((n) => [n.label, n.href])).toEqual([
    ['Visão geral', '/'],
    ['Contas', '/contas'],
    ['Sistema', '/sistema'],
    ['Auditoria', '/auditoria'],
    ['Admins', '/admins'],
  ])
})

test('não há destino para chaves de app', () => {
  expect(DEV_NAV.some((n) => n.href === '/chaves')).toBe(false)
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
  expect(isNavActive('/sistema/x', '/contas')).toBe(false)
})

test('os itens do dev têm rótulo curto para a barra do celular, sem perder o completo', () => {
  const curtos = DEV_NAV.map((n) => n.shortLabel ?? n.label)
  expect(curtos.slice(0, 3)).toEqual(['Geral', 'Contas', 'Sistema'])
  for (const c of curtos) expect(c.length).toBeLessThanOrEqual(9)
})
