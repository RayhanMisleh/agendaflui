import { describe, expect, test } from 'vitest'
import { decideDestination, destinationPath } from '@/server/auth/destination'

const loja = (slug: string, dia: number) => ({ businessId: `id-${slug}`, slug, linkedAt: new Date(Date.UTC(2026, 10, dia)) })

describe('decideDestination', () => {
  test('equipe ativa vai para /painel mesmo sendo cliente de lojas', () => {
    expect(decideDestination({ staff: true, stores: [loja('a', 1), loja('b', 2)], lastStoreId: 'id-a' })).toEqual({ kind: 'painel' })
  })

  test('cliente de uma loja vai para /<slug>', () => {
    expect(decideDestination({ staff: false, stores: [loja('a', 1)], lastStoreId: null })).toEqual({ kind: 'store', slug: 'a' })
  })

  test('cliente de várias vai para a última usada na sessão', () => {
    expect(decideDestination({ staff: false, stores: [loja('a', 1), loja('b', 2), loja('c', 3)], lastStoreId: 'id-a' })).toEqual({ kind: 'store', slug: 'a' })
  })

  test('cliente de várias sem última usada vai para a ligação mais recente', () => {
    expect(decideDestination({ staff: false, stores: [loja('a', 1), loja('c', 9), loja('b', 2)], lastStoreId: null })).toEqual({ kind: 'store', slug: 'c' })
  })

  test('última usada que não está mais entre as lojas é ignorada', () => {
    expect(decideDestination({ staff: false, stores: [loja('a', 1), loja('b', 2)], lastStoreId: 'id-sumiu' })).toEqual({ kind: 'store', slug: 'b' })
  })

  test('sem equipe e sem loja: no_store', () => {
    expect(decideDestination({ staff: false, stores: [], lastStoreId: 'id-a' })).toEqual({ kind: 'no_store' })
  })

  test('empate de data na ligação mais recente desempata pelo slug (resultado estável)', () => {
    expect(decideDestination({ staff: false, stores: [loja('z', 5), loja('m', 5)], lastStoreId: null })).toEqual({ kind: 'store', slug: 'm' })
  })

  test('destinationPath: /painel, /<slug> e / para no_store', () => {
    expect(destinationPath({ kind: 'painel' })).toBe('/painel')
    expect(destinationPath({ kind: 'store', slug: 'minha-loja' })).toBe('/minha-loja')
    expect(destinationPath({ kind: 'no_store' })).toBe('/')
  })
})
