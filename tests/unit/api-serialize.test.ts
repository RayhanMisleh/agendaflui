import { toJson } from '@/server/api/serialize'
import { fromEpochMs } from '@/server/time'

describe('toJson', () => {
  test('Date vira texto ISO em UTC', () => {
    expect(toJson(fromEpochMs(1_800_000_000_000))).toBe('2027-01-15T08:00:00.000Z')
  })

  test('bigint seguro vira número; fora do limite seguro vira texto', () => {
    expect(toJson(42n)).toBe(42)
    expect(toJson(9_007_199_254_740_993n)).toBe('9007199254740993')
    expect(toJson(-9_007_199_254_740_993n)).toBe('-9007199254740993')
  })

  test('undefined some dos objetos, null fica e arrays e objetos aninhados são percorridos', () => {
    const entrada = {
      a: undefined,
      b: null,
      c: [fromEpochMs(0), { d: 1n, e: undefined }],
      f: { g: 'x', h: true, i: 1.5 },
    }
    expect(toJson(entrada)).toEqual({
      b: null,
      c: ['1970-01-01T00:00:00.000Z', { d: 1 }],
      f: { g: 'x', h: true, i: 1.5 },
    })
    expect(Object.keys(toJson(entrada) as object)).not.toContain('a')
  })

  test('objeto sem protótipo é aceito', () => {
    const o = Object.create(null) as Record<string, unknown>
    o.x = 1
    expect(toJson(o)).toEqual({ x: 1 })
  })

  test('Map, Set, instância de classe e Buffer são erro de programação', () => {
    class Dinheiro {
      constructor(public valor: number) {}
    }
    expect(() => toJson(new Map())).toThrow(/serializ/i)
    expect(() => toJson(new Set())).toThrow(/serializ/i)
    expect(() => toJson(new Dinheiro(1))).toThrow(/Dinheiro/)
    expect(() => toJson({ preco: new Dinheiro(1) })).toThrow(/preco/)
    expect(() => toJson(Buffer.from('x'))).toThrow(/serializ/i)
  })

  test('função, símbolo, número não finito e Date inválido são erro de programação', () => {
    expect(() => toJson(() => 1)).toThrow()
    expect(() => toJson(Symbol('x'))).toThrow()
    expect(() => toJson(Number.NaN)).toThrow()
    expect(() => toJson(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => toJson(fromEpochMs(Number.NaN))).toThrow()
  })

  test('referência circular é erro de programação, não estouro de pilha', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => toJson(a)).toThrow(/circular/i)
  })
})

describe('toJson e a chave __proto__', () => {
  test('chave própria __proto__ é recusada (nada de trocar o protótipo da saída)', () => {
    const malicioso = JSON.parse('{"__proto__":{"x":1},"a":1}') as unknown
    expect(() => toJson(malicioso)).toThrow(/__proto__/)
    expect(() => toJson({ itens: [malicioso] })).toThrow(/__proto__/)
  })
})
