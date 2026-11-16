import { checkWireContract } from '@/server/api/contract'
import { isoInstant, uuid } from '@/server/api/wire'
import { z } from '@/server/domain/errors'

const schema = z.object({
  id: uuid,
  quando: isoInstant,
  itens: z.array(z.object({ nome: z.string(), extra: z.object({ a: z.number() }).optional() })),
  nota: z.string().nullable(),
})

const ok = {
  id: '11111111-1111-4111-8111-111111111111',
  quando: '2027-01-15T08:00:00.000Z',
  itens: [{ nome: 'a' }, { nome: 'b', extra: { a: 1 } }],
  nota: null,
}

describe('checkWireContract', () => {
  test('JSON dentro do contrato: sem problema', async () => {
    expect(await checkWireContract(schema, ok)).toBeNull()
  })

  test('tipo errado e instante que não é ISO são problema, com o caminho', async () => {
    expect(await checkWireContract(schema, { ...ok, nota: 3 })).toMatch(/nota/)
    expect(await checkWireContract(schema, { ...ok, quando: '15/01/2027' })).toMatch(/quando/)
    expect(await checkWireContract(schema, { ...ok, id: 'x' })).toMatch(/id/)
  })

  test('campo a mais em qualquer nível é problema, com o caminho', async () => {
    expect(await checkWireContract(schema, { ...ok, vazou: 1 })).toMatch(/vazou/)
    expect(await checkWireContract(schema, { ...ok, itens: [{ nome: 'a' }, { nome: 'b', senha: 'x' }] })).toMatch(/itens\.1\.senha/)
    expect(await checkWireContract(schema, { ...ok, itens: [{ nome: 'b', extra: { a: 1, b: 2 } }] })).toMatch(/itens\.0\.extra\.b/)
  })

  test('campo opcional ausente ou presente e padrões do esquema não são problema', async () => {
    const comPadrao = z.object({ n: z.number().default(1), o: z.string().optional() })
    expect(await checkWireContract(comPadrao, {})).toBeNull()
    expect(await checkWireContract(comPadrao, { n: 2, o: 'x' })).toBeNull()
  })

  test('esquema que aceita campos livres (record, passthrough) não acusa campo extra', async () => {
    expect(await checkWireContract(z.object({ m: z.record(z.string(), z.number()) }), { m: { a: 1, b: 2 } })).toBeNull()
    expect(await checkWireContract(z.looseObject({ a: z.number() }), { a: 1, b: 2 })).toBeNull()
  })
})

describe('esquemas de fio', () => {
  test('isoInstant e uuid viram JSON Schema', () => {
    const js = z.toJSONSchema(z.object({ a: isoInstant, b: uuid }))
    expect(js.properties).toMatchObject({ a: { format: 'date-time' }, b: { format: 'uuid' } })
  })

  test('isoInstant aceita só instante ISO em UTC', () => {
    expect(isoInstant.safeParse('2027-01-15T08:00:00.000Z').success).toBe(true)
    expect(isoInstant.safeParse('2027-01-15T08:00:00-03:00').success).toBe(false)
    expect(isoInstant.safeParse('2027-01-15').success).toBe(false)
  })
})
