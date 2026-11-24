import { clienteNav, maisItems } from '@/ui/shells/cliente-nav'

const ativos = (path: string, pets = true) => clienteNav('a-loja', { pets }, path).filter((i) => i.active).map((i) => i.label)

describe('clienteNav', () => {
  test('cinco itens na ordem Início, Agendar, Horários, Pets, Mais', () => {
    const itens = clienteNav('a-loja', { pets: true }, '/a-loja')
    expect(itens.map((i) => i.label)).toEqual(['Início', 'Agendar', 'Horários', 'Pets', 'Mais'])
    expect(itens.map((i) => i.href)).toEqual(['/a-loja', '/a-loja/agendar', '/a-loja/horarios', '/a-loja/pets', '/a-loja/mais'])
    for (const i of itens) expect((i.shortLabel ?? '').length).toBeLessThanOrEqual(8)
  })

  test('Pets some sem nicho pet', () => {
    expect(clienteNav('a-loja', { pets: false }, '/a-loja').map((i) => i.label)).toEqual(['Início', 'Agendar', 'Horários', 'Mais'])
  })

  test('Início só ativo em /a-loja; Horários ativo em /a-loja/horarios/x', () => {
    expect(ativos('/a-loja')).toEqual(['Início'])
    expect(ativos('/a-loja/horarios/abc')).toEqual(['Horários'])
    expect(ativos('/a-loja/agendar')).toEqual(['Agendar'])
    expect(ativos('/a-loja/pets')).toEqual(['Pets'])
    expect(ativos('/a-loja/boas-vindas')).toEqual([])
  })

  test('Mais fica ativo em Mais, Prêmios e Loja (e subpáginas)', () => {
    for (const p of ['/a-loja/mais', '/a-loja/premios', '/a-loja/premios/extrato', '/a-loja/loja/carrinho']) expect(ativos(p), p).toEqual(['Mais'])
  })

  test('um slug que começa igual não ativa o item de outra loja', () => {
    expect(ativos('/a-loja-nova/agendar')).toEqual([])
  })
})

describe('maisItems', () => {
  test('sem loyalty e sem store traz só Minha conta', () => {
    expect(maisItems('a-loja', { loyalty: false, store: false }).map((i) => [i.label, i.href])).toEqual([['Minha conta', '/conta']])
  })

  test('módulo ligado entra na ordem Prêmios, Loja, Minha conta', () => {
    expect(maisItems('a-loja', { loyalty: true, store: true }).map((i) => i.label)).toEqual(['Prêmios', 'Loja', 'Minha conta'])
    expect(maisItems('a-loja', { loyalty: false, store: true }).map((i) => i.label)).toEqual(['Loja', 'Minha conta'])
  })
})
