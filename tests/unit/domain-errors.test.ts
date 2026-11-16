import type { TenantContext } from '@/server/auth/actor'
import { authorize, DomainError, z, isRecordNotFound, orNotFound, parse, zodFields } from '@/server/domain/errors'

const schema = z.object({ name: z.string().min(1, 'Informe o nome.'), price: z.number().int() })

function capturar(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  return undefined
}

test('parse devolve o valor válido', () => {
  expect(parse(schema, { name: 'Corte', price: 3000 })).toEqual({ name: 'Corte', price: 3000 })
})

test('parse converte ZodError em DomainError validation com os campos', () => {
  const err = capturar(() => parse(schema, { name: '', price: 1.5 }))
  expect(err).toBeInstanceOf(DomainError)
  const e = err as DomainError
  expect(e.code).toBe('validation')
  expect(e.fields?.['name']).toBe('Informe o nome.')
  expect(e.fields?.['price']).toBeDefined()
})

test('parse usa caminho com pontos e a primeira mensagem de cada campo', () => {
  const aninhado = z.object({ a: z.object({ b: z.string().min(2, 'Curto.').regex(/^x/, 'Começa com x.') }) })
  const e = capturar(() => parse(aninhado, { a: { b: '' } })) as DomainError
  expect(e.fields?.['a.b']).toBe('Curto.')
})

test('orNotFound devolve o valor ou lança not_found', () => {
  expect(orNotFound({ id: 1 }, 'Serviço')).toEqual({ id: 1 })
  const e = capturar(() => orNotFound(null, 'Serviço')) as DomainError
  expect(e).toBeInstanceOf(DomainError)
  expect(e.code).toBe('not_found')
  expect(e.message).toBe('Serviço não encontrado.')
  expect((capturar(() => orNotFound(undefined, 'Cliente')) as DomainError).code).toBe('not_found')
})

test('authorize lança forbidden para cliente e passa para dono', () => {
  const base = { businessId: 'b', timeZone: 'America/Sao_Paulo' } as unknown as TenantContext
  const cliente = { ...base, actor: { kind: 'customer', customerId: 'c', name: 'C' } } as TenantContext
  const dono = {
    ...base,
    actor: { kind: 'member', userId: 'u', membershipId: 'm', name: 'D', role: 'OWNER' },
  } as TenantContext
  const e = capturar(() => authorize(cliente, 'view_clients')) as DomainError
  expect(e).toBeInstanceOf(DomainError)
  expect(e.code).toBe('forbidden')
  expect(e.message).toBe('Você não tem permissão para fazer isso.')
  expect(() => authorize(dono, 'manage_account')).not.toThrow()
})

test('DomainError guarda reason, fields e details', () => {
  const e = new DomainError('conflict', 'Horário ocupado.', { reason: 'slot_taken', details: { n: 1 } })
  expect(e.name).toBe('DomainError')
  expect(e.reason).toBe('slot_taken')
  expect(e.details).toEqual({ n: 1 })
})

test('isRecordNotFound reconhece P2025', () => {
  expect(isRecordNotFound({ code: 'P2025' })).toBe(true)
  expect(isRecordNotFound({ code: 'P2002' })).toBe(false)
  expect(isRecordNotFound(new Error('x'))).toBe(false)
  expect(isRecordNotFound(null)).toBe(false)
})

test('mensagens do Zod saem em português e erro na raiz vai para _', () => {
  const e = capturar(() => parse(z.object({ price: z.number().int() }), { price: 1.5 })) as DomainError
  expect(e.fields?.['price']).toBeDefined()
  expect(e.fields?.['price']).not.toMatch(/expected|invalid|received/i)
  const raiz = capturar(() => parse(z.string(), 5)) as DomainError
  expect(raiz.fields?.['_']).toBeDefined()
  expect(raiz.fields?.['']).toBeUndefined()
})

describe('zodFields', () => {
  test('caminho vira chave, primeira mensagem de cada caminho vale, raiz vira "_"', () => {
    const r = z.object({ a: z.object({ b: z.string() }), c: z.array(z.number()) }).safeParse({ a: { b: 1 }, c: ['x', 'y'] })
    if (r.success) throw new Error('era para falhar')
    expect(Object.keys(zodFields(r.error)).sort()).toEqual(['a.b', 'c.0', 'c.1'])
    const raiz = z.string().safeParse(1)
    if (raiz.success) throw new Error('era para falhar')
    expect(Object.keys(zodFields(raiz.error))).toEqual(['_'])
  })

  test('chave desconhecida: "_" por padrão (como parse), um campo por chave com perUnknownKey', () => {
    const r = z.strictObject({ a: z.string() }).safeParse({ a: 'x', b: 1, c: 2 })
    if (r.success) throw new Error('era para falhar')
    expect(Object.keys(zodFields(r.error))).toEqual(['_'])
    expect(Object.keys(zodFields(r.error, { perUnknownKey: true })).sort()).toEqual(['b', 'c'])
  })
})
