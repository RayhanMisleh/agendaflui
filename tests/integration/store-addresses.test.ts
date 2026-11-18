import { beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { anonymizeCustomer } from '@/server/domain/customers/customers'
import { createAddress, deleteAddress, listAddresses, lookupPostalCode, updateAddress, type AddressInput } from '@/server/domain/store/addresses'
import { IntegrationError } from '@/server/integrations/errors'
import { setIntegrationsForTests } from '@/server/integrations'
import { createGuestContext } from '@/server/auth/guest-context'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { cenaLoja, type CenaLoja } from '../setup/store'

beforeEach(resetDb)

let c: CenaLoja
beforeEach(async () => {
  setIntegrationsForTests(null)
  c = await cenaLoja()
})

const endereco = (o: Partial<AddressInput> = {}): AddressInput => ({
  label: 'Casa',
  recipientName: 'Maria da Silva',
  postalCode: '01310-100',
  street: 'Avenida Paulista',
  number: '1000',
  complement: 'Apto 12',
  district: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
  isDefault: false,
  ...o,
})

describe('consulta de CEP', () => {
  test('devolve o endereço da ViaCEP falsa e aceita o CEP com traço ou espaços', async () => {
    const r = await lookupPostalCode(c.ctxCliente, ' 01310-100 ')
    expect(r).toEqual({ address: { postalCode: '01310100', street: 'Rua das Flores', district: 'Centro', city: 'São Paulo', state: 'SP' }, unavailable: false })
  })

  test('CEP inexistente devolve address null e unavailable false', async () => {
    expect(await lookupPostalCode(c.ctxCliente, '00000000')).toEqual({ address: null, unavailable: false })
  })

  test('com a ViaCEP falhando devolve unavailable true, sem erro (todo tipo de falha)', async () => {
    for (const code of ['timeout', 'unavailable', 'rejected', 'invalid_response'] as const) {
      setIntegrationsForTests({ postalCodes: { lookup: async () => { throw new IntegrationError(code, 'falhou') } } })
      expect(await lookupPostalCode(c.ctxCliente, '01310100'), code).toEqual({ address: null, unavailable: true })
    }
  })

  test('um erro que não é de integração não é engolido', async () => {
    setIntegrationsForTests({ postalCodes: { lookup: async () => { throw new TypeError('bug') } } })
    await expect(lookupPostalCode(c.ctxCliente, '01310100')).rejects.toThrow('bug')
  })

  test('CEP mal formado é validation e nem consulta o serviço', async () => {
    const lookup = vi.fn(async () => null)
    setIntegrationsForTests({ postalCodes: { lookup } })
    for (const cep of ['1234-567', '1234567', '123456789', 'abcdefgh', '']) {
      const e = await domainError(lookupPostalCode(c.ctxCliente, cep))
      expect(e.code, cep).toBe('validation')
      expect(e.fields, cep).toHaveProperty('postalCode')
    }
    expect(lookup).not.toHaveBeenCalled()
  })

  test('visitante, equipe e módulo desligado são recusados', async () => {
    const visitante = await createGuestContext({ businessId: c.b.id, timeZone: 'America/Manaus', request: { ip: null, userAgent: null } })
    expect((await domainError(lookupPostalCode(visitante, '01310100'))).code).toBe('forbidden')
    expect((await domainError(lookupPostalCode(c.dono, '01310100'))).code).toBe('forbidden')
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(lookupPostalCode(c.ctxCliente, '01310100'))).code).toBe('module_disabled')
  })
})

describe('endereços do cliente', () => {
  test('cria, lista, edita e apaga; o CEP vira 8 dígitos e a UF fica em maiúsculas', async () => {
    const a = await createAddress(c.ctxCliente, endereco({ state: 'sp' }))
    expect(a).toMatchObject({ postalCode: '01310100', state: 'SP', recipientName: 'Maria da Silva', number: '1000' })
    expect(await listAddresses(c.ctxCliente)).toHaveLength(1)
    const b = await updateAddress(c.ctxCliente, a.id, { number: '2000', complement: null })
    expect(b).toMatchObject({ number: '2000', complement: null, street: 'Avenida Paulista' })
    await deleteAddress(c.ctxCliente, a.id)
    expect(await listAddresses(c.ctxCliente)).toEqual([])
  })

  test('UF inválida é erro no campo state', async () => {
    for (const uf of ['XX', 'S', 'SPP', '']) {
      const e = await domainError(createAddress(c.ctxCliente, endereco({ state: uf })))
      expect(Object.keys(e.fields ?? {}), uf).toEqual(['state'])
    }
    const a = await createAddress(c.ctxCliente, endereco())
    expect(Object.keys((await domainError(updateAddress(c.ctxCliente, a.id, { state: 'XX' }))).fields ?? {})).toEqual(['state'])
  })

  test('todas as 27 UFs valem', async () => {
    const ufs = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')
    expect(ufs).toHaveLength(27)
    for (const uf of ufs.slice(0, 10)) await createAddress(c.ctxCliente, endereco({ state: uf }))
    const outro = await cenaLoja()
    for (const uf of ufs.slice(10, 20)) await createAddress(outro.ctxCliente, endereco({ state: uf }))
    const mais = await cenaLoja()
    for (const uf of ufs.slice(20)) await createAddress(mais.ctxCliente, endereco({ state: uf }))
  })

  test('limites dos campos: nome 2 a 80, número 1 a 10, rua, bairro e cidade obrigatórios, CEP de 8 dígitos', async () => {
    const ruins: [string, Partial<AddressInput>][] = [
      ['recipientName', { recipientName: 'A' }],
      ['recipientName', { recipientName: 'x'.repeat(81) }],
      ['number', { number: '' }],
      ['number', { number: '12345678901' }],
      ['street', { street: ' ' }],
      ['district', { district: '' }],
      ['city', { city: '' }],
      ['postalCode', { postalCode: '1234567' }],
      ['complement', { complement: 'x'.repeat(81) }],
      ['label', { label: 'x'.repeat(31) }],
    ]
    for (const [campo, m] of ruins) expect(Object.keys((await domainError(createAddress(c.ctxCliente, endereco(m)))).fields ?? {}), campo).toContain(campo)
    expect(await prisma.address.count()).toBe(0)
  })

  test('o décimo primeiro endereço é recusado, também com criações simultâneas', async () => {
    for (let i = 0; i < 10; i++) await createAddress(c.ctxCliente, endereco({ number: String(i + 1) }))
    const e = await domainError(createAddress(c.ctxCliente, endereco({ number: '11' })))
    expect(e.code).toBe('conflict')
    expect(await prisma.address.count({ where: { customerId: c.cliente.id } })).toBe(10)
    const o = await cenaLoja()
    const r = await Promise.allSettled(Array.from({ length: 14 }, (_, i) => createAddress(o.ctxCliente, endereco({ number: String(i + 1) }))))
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(10)
    expect(await prisma.address.count({ where: { customerId: o.cliente.id } })).toBe(10)
  })

  test('um padrão só: marcar outro desmarca o anterior; o primeiro endereço já nasce padrão', async () => {
    const a = await createAddress(c.ctxCliente, endereco())
    expect(a.isDefault).toBe(true)
    const b = await createAddress(c.ctxCliente, endereco({ number: '2', isDefault: true }))
    expect(b.isDefault).toBe(true)
    let lista = await listAddresses(c.ctxCliente)
    expect(lista.filter((x) => x.isDefault).map((x) => x.id)).toEqual([b.id])
    await updateAddress(c.ctxCliente, a.id, { isDefault: true })
    lista = await listAddresses(c.ctxCliente)
    expect(lista.filter((x) => x.isDefault).map((x) => x.id)).toEqual([a.id])
    const naoPadrao = await createAddress(c.ctxCliente, endereco({ number: '3', isDefault: false }))
    expect(naoPadrao.isDefault).toBe(false)
  })

  test('marcações simultâneas de padrão deixam exatamente um', async () => {
    const ids: string[] = []
    for (let i = 0; i < 4; i++) ids.push((await createAddress(c.ctxCliente, endereco({ number: String(i + 1) }))).id)
    await Promise.allSettled(ids.map((id) => updateAddress(c.ctxCliente, id, { isDefault: true })))
    expect(await prisma.address.count({ where: { customerId: c.cliente.id, isDefault: true } })).toBe(1)
  })

  test('a lista traz o endereço padrão primeiro', async () => {
    const a = await createAddress(c.ctxCliente, endereco({ number: '1' }))
    const b = await createAddress(c.ctxCliente, endereco({ number: '2' }))
    const d = await createAddress(c.ctxCliente, endereco({ number: '3' }))
    const lista = (await listAddresses(c.ctxCliente)).map((x) => x.id)
    expect(lista[0]).toBe(a.id)
    expect([...lista].sort()).toEqual([a.id, b.id, d.id].sort())
    await updateAddress(c.ctxCliente, d.id, { isDefault: true })
    expect((await listAddresses(c.ctxCliente))[0]?.id).toBe(d.id)
  })

  test('cliente A lendo, editando ou apagando endereço de B (mesma conta) é not_found', async () => {
    const doOutro = await createAddress(c.ctxOutro, endereco({ recipientName: 'João Souza' }))
    expect(await listAddresses(c.ctxCliente)).toEqual([])
    expect((await domainError(updateAddress(c.ctxCliente, doOutro.id, { number: '9' }))).code).toBe('not_found')
    expect((await domainError(deleteAddress(c.ctxCliente, doOutro.id))).code).toBe('not_found')
    expect((await domainError(deleteAddress(c.ctxCliente, 'nao-uuid'))).code).toBe('not_found')
    expect((await prisma.address.findUniqueOrThrow({ where: { id: doOutro.id } })).number).toBe('1000')
  })

  test('endereço de outra conta é not_found', async () => {
    const b2 = await cenaLoja()
    const alheio = await createAddress(b2.ctxCliente, endereco())
    expect((await domainError(updateAddress(c.ctxCliente, alheio.id, { number: '9' }))).code).toBe('not_found')
    expect((await domainError(deleteAddress(c.ctxCliente, alheio.id))).code).toBe('not_found')
    expect(await listAddresses(c.ctxCliente)).toEqual([])
  })

  test('só o cliente do app tem endereços: equipe e visitante recusados; módulo desligado recusa', async () => {
    const visitante = await createGuestContext({ businessId: c.b.id, timeZone: 'America/Manaus', request: { ip: null, userAgent: null } })
    expect((await domainError(listAddresses(c.dono))).code).toBe('forbidden')
    expect((await domainError(createAddress(visitante, endereco()))).code).toBe('forbidden')
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(listAddresses(c.ctxCliente))).code).toBe('module_disabled')
    expect((await domainError(createAddress(c.ctxCliente, endereco()))).code).toBe('module_disabled')
  })

  test('anonimizar o cliente apaga os endereços dele e só dele', async () => {
    await createAddress(c.ctxCliente, endereco())
    await createAddress(c.ctxCliente, endereco({ number: '2' }))
    await createAddress(c.ctxOutro, endereco({ recipientName: 'João Souza' }))
    await anonymizeCustomer(c.dono, c.cliente.id)
    expect(await prisma.address.count({ where: { customerId: c.cliente.id } })).toBe(0)
    expect(await prisma.address.count({ where: { customerId: c.outro.id } })).toBe(1)
  })
})
