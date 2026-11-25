import { parseCartCookie } from '@/app/app/[slug]/(area)/loja/_lib/carrinho'

const A = '0b6e66aa-0000-4000-8000-00000000000a'
const B = '0b6e66aa-0000-4000-8000-00000000000b'
const uuid = (n: number): string => `0b6e66aa-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('parseCartCookie', () => {
  test('sem cookie ou com JSON quebrado: carrinho vazio', () => {
    expect(parseCartCookie(undefined)).toEqual([])
    expect(parseCartCookie('')).toEqual([])
    expect(parseCartCookie('{quebrado')).toEqual([])
    expect(parseCartCookie('{"productId":"x"}')).toEqual([])
    expect(parseCartCookie('"texto"')).toEqual([])
  })

  test('lê as linhas válidas', () => {
    expect(parseCartCookie(JSON.stringify([{ productId: A, quantity: 2 }, { productId: B, quantity: 1 }]))).toEqual([
      { productId: A, quantity: 2 },
      { productId: B, quantity: 1 },
    ])
  })

  test('linhas repetidas somam, em minúsculas e até 99', () => {
    const r = parseCartCookie(JSON.stringify([{ productId: A.toUpperCase(), quantity: 2 }, { productId: A, quantity: 3 }, { productId: B, quantity: 98 }, { productId: B, quantity: 5 }]))
    expect(r).toEqual([
      { productId: A, quantity: 5 },
      { productId: B, quantity: 99 },
    ])
  })

  test('25 linhas viram 20', () => {
    const lista = Array.from({ length: 25 }, (_, i) => ({ productId: uuid(i + 1), quantity: 1 }))
    const r = parseCartCookie(JSON.stringify(lista))
    expect(r).toHaveLength(20)
    expect(r[19]?.productId).toBe(uuid(20))
  })

  test('quantidade 0, negativa, quebrada ou em texto sai; id que não é uuid sai', () => {
    const r = parseCartCookie(
      JSON.stringify([
        { productId: A, quantity: 0 },
        { productId: A, quantity: -1 },
        { productId: A, quantity: 1.5 },
        { productId: A, quantity: '2' },
        { productId: 'nao-e-uuid', quantity: 1 },
        { quantity: 1 },
        null,
        7,
        { productId: B, quantity: 4 },
      ]),
    )
    expect(r).toEqual([{ productId: B, quantity: 4 }])
  })
})
