import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { listServicesForPet } from '@/server/domain/catalog/pet-services'
import { createService, getService, listServices, updateService } from '@/server/domain/catalog/services'
import { resolveServices } from '@/server/domain/scheduling/availability'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeCtx, makeCustomer, makePet, makeService, makeServicePrice } from '../setup/factories'

beforeEach(resetDb)

async function conta(servesCats = false) {
  const b = await makeBusiness({ niche: 'PET' })
  if (servesCats) await prisma.businessSettings.update({ where: { businessId: b.id }, data: { nicheOptions: { servesCats: true } } })
  const dono = await ctxWithRole(b, 'OWNER')
  const cliente = await makeCustomer(b.id)
  const ctxCliente = await makeCtx(b, { actor: { kind: 'customer', customerId: cliente.id, name: cliente.name } })
  return { b, dono, cliente, ctxCliente }
}

const porte = (variant: 'DOG_SMALL' | 'DOG_MEDIUM' | 'DOG_LARGE' | 'DOG_GIANT' | 'CAT', priceCents: number, durationMin: number) => ({
  variant,
  priceCents,
  durationMin,
})

describe('createService por variante', () => {
  test('cria BY_VARIANT com pequeno e médio: colunas guardam o menor preço e a menor duração', async () => {
    const { dono } = await conta()
    const s = await createService(dono, {
      name: 'Banho',
      pricingMode: 'BY_VARIANT',
      variantPrices: [porte('DOG_MEDIUM', 7000, 60), porte('DOG_SMALL', 5000, 30)],
    })
    expect(s.pricingMode).toBe('BY_VARIANT')
    expect(s.priceCents).toBe(5000)
    expect(s.durationMin).toBe(30)
    expect(s.prices.map((p) => p.variant)).toEqual(['DOG_SMALL', 'DOG_MEDIUM'])
  })

  test('BY_VARIANT sem linhas → validation fields.variantPrices', async () => {
    const { dono } = await conta()
    const e = await domainError(createService(dono, { name: 'Banho', pricingMode: 'BY_VARIANT', variantPrices: [] }))
    expect(e.code).toBe('validation')
    expect(e.fields?.['variantPrices']).toBe('Preencha o preço de pelo menos um porte.')
  })

  test('BY_VARIANT em conta sem nicho → validation fields.pricingMode', async () => {
    const b = await makeBusiness()
    const ctx = await ctxWithRole(b, 'OWNER')
    const e = await domainError(
      createService(ctx, { name: 'Banho', pricingMode: 'BY_VARIANT', variantPrices: [porte('DOG_SMALL', 5000, 30)] }),
    )
    expect(e.fields?.['pricingMode']).toBe('Preço por porte só existe em conta pet shop.')
  })

  test('SINGLE sem preço ou duração continua recusado', async () => {
    const { dono } = await conta()
    const e = await domainError(createService(dono, { name: 'Banho' }))
    expect(e.code).toBe('validation')
    expect(e.fields?.['priceCents']).toBeDefined()
  })

  test('variante repetida e duração fora do limite são recusadas', async () => {
    const { dono } = await conta()
    const dup = await domainError(
      createService(dono, { name: 'A', pricingMode: 'BY_VARIANT', variantPrices: [porte('DOG_SMALL', 1, 30), porte('DOG_SMALL', 2, 30)] }),
    )
    expect(dup.fields?.['variantPrices']).toBeDefined()
    const ruim = await domainError(
      createService(dono, { name: 'A', pricingMode: 'BY_VARIANT', variantPrices: [porte('DOG_SMALL', 1, 7)] }),
    )
    expect(ruim.code).toBe('validation')
  })
})

describe('updateService por variante', () => {
  test('gatos desligados: salvar só as linhas de cão mantém a linha de gato; religar gatos mostra ao cliente', async () => {
    const { b, dono, ctxCliente } = await conta()
    const s = await makeService(b.id, { name: 'Banho' })
    await makeServicePrice(b.id, s.id, 'DOG_SMALL', { priceCents: 5000, durationMin: 30 })
    await makeServicePrice(b.id, s.id, 'CAT', { priceCents: 3000, durationMin: 15 })
    const r = await updateService(dono, s.id, { variantPrices: [porte('DOG_SMALL', 6000, 45)] })
    expect(r.prices.map((p) => [p.variant, p.priceCents])).toEqual([['DOG_SMALL', 6000], ['CAT', 3000]])
    expect(r.priceCents).toBe(3000)
    expect((await getService(ctxCliente, s.id)).prices.map((p) => p.variant)).toEqual(['DOG_SMALL'])
    expect((await getService(ctxCliente, s.id)).priceCents).toBe(6000)
    await prisma.businessSettings.update({ where: { businessId: b.id }, data: { nicheOptions: { servesCats: true } } })
    expect((await getService(ctxCliente, s.id)).prices.map((p) => p.variant)).toEqual(['DOG_SMALL', 'CAT'])
  })

  test('gatos desligados: linha de gato enviada é ignorada e não conta como "ao menos uma"', async () => {
    const { b, dono } = await conta()
    const s = await makeService(b.id)
    await makeServicePrice(b.id, s.id, 'DOG_SMALL')
    const e = await domainError(updateService(dono, s.id, { variantPrices: [porte('CAT', 1000, 30)] }))
    expect(e.fields?.['variantPrices']).toBeDefined()
  })

  test('gatos ligados: omitir a linha de gato a apaga', async () => {
    const { b, dono } = await conta(true)
    const s = await makeService(b.id)
    await makeServicePrice(b.id, s.id, 'DOG_SMALL')
    await makeServicePrice(b.id, s.id, 'CAT')
    const r = await updateService(dono, s.id, { variantPrices: [porte('DOG_SMALL', 5000, 30)] })
    expect(r.prices.map((p) => p.variant)).toEqual(['DOG_SMALL'])
    expect(await prisma.servicePrice.count({ where: { serviceId: s.id } })).toBe(1)
  })

  test('trocar para SINGLE apaga as linhas e exige preço e duração; trocar para BY_VARIANT exige linhas', async () => {
    const { b, dono } = await conta()
    const s = await makeService(b.id)
    await makeServicePrice(b.id, s.id, 'DOG_SMALL')
    const sem = await domainError(updateService(dono, s.id, { pricingMode: 'SINGLE' }))
    expect(sem.fields?.['priceCents']).toBeDefined()
    const r = await updateService(dono, s.id, { pricingMode: 'SINGLE', priceCents: 4000, durationMin: 60 })
    expect(r).toMatchObject({ pricingMode: 'SINGLE', priceCents: 4000, durationMin: 60, prices: [] })
    expect(await prisma.servicePrice.count({ where: { serviceId: s.id } })).toBe(0)
    const volta = await domainError(updateService(dono, s.id, { pricingMode: 'BY_VARIANT' }))
    expect(volta.fields?.['variantPrices']).toBeDefined()
    const ok = await updateService(dono, s.id, { pricingMode: 'BY_VARIANT', variantPrices: [porte('DOG_LARGE', 9000, 90)] })
    expect(ok).toMatchObject({ pricingMode: 'BY_VARIANT', priceCents: 9000, durationMin: 90 })
  })

  test('editar só o nome de um serviço por porte não mexe nas linhas', async () => {
    const { b, dono } = await conta()
    const s = await makeService(b.id)
    await makeServicePrice(b.id, s.id, 'DOG_SMALL', { priceCents: 5000 })
    const r = await updateService(dono, s.id, { name: 'Novo nome' })
    expect(r.name).toBe('Novo nome')
    expect(r.prices).toHaveLength(1)
  })

  test('audita os campos de preço', async () => {
    const { b, dono } = await conta()
    const s = await makeService(b.id)
    await makeServicePrice(b.id, s.id, 'DOG_SMALL')
    await updateService(dono, s.id, { variantPrices: [porte('DOG_SMALL', 7000, 30)] })
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId: b.id, action: 'service.updated' } })
    expect(log.metadata).toMatchObject({ fields: ['variantPrices'] })
  })

  test('visão do cliente esconde a linha de gato com gatos desligados; equipe vê todas', async () => {
    const { b, dono, ctxCliente } = await conta()
    const s = await makeService(b.id)
    await makeServicePrice(b.id, s.id, 'DOG_SMALL')
    await makeServicePrice(b.id, s.id, 'CAT')
    expect((await listServices(dono))[0]?.prices).toHaveLength(2)
    expect((await listServices(ctxCliente))[0]?.prices).toHaveLength(1)
  })
})

describe('resolveServices com variante', () => {
  test('DOG_LARGE usa preço e tempo da linha e soma o total', async () => {
    const { b, dono } = await conta()
    const a = await makeService(b.id)
    await makeServicePrice(b.id, a.id, 'DOG_LARGE', { priceCents: 9000, durationMin: 90 })
    const c = await makeService(b.id, { priceCents: 2000, durationMin: 15 })
    const r = await resolveServices(dono, [a.id, c.id], dono.db, { variant: 'DOG_LARGE' })
    expect(r.items.map((i) => [i.priceCents, i.durationMin, i.variant])).toEqual([[9000, 90, 'DOG_LARGE'], [2000, 15, 'DOG_LARGE']])
    expect(r.totalCents).toBe(11000)
    expect(r.durationMin).toBe(105)
  })

  test('BY_VARIANT sem linha da variante → not_offered com "Tosa não é feito para Cão grande."', async () => {
    const { b, dono } = await conta()
    const s = await makeService(b.id, { name: 'Tosa' })
    await makeServicePrice(b.id, s.id, 'DOG_SMALL')
    const e = await domainError(resolveServices(dono, [s.id], dono.db, { variant: 'DOG_LARGE' }))
    expect(e.reason).toBe('not_offered')
    expect(e.fields?.['serviceIds']).toBe('Tosa não é feito para Cão grande.')
  })

  test('BY_VARIANT sem variante pede o pet', async () => {
    const { b, dono } = await conta()
    const s = await makeService(b.id, { name: 'Tosa' })
    await makeServicePrice(b.id, s.id, 'DOG_SMALL')
    const e = await domainError(resolveServices(dono, [s.id]))
    expect(e.fields?.['serviceIds']).toBe('Escolha o pet para ver o preço de Tosa.')
  })

  test('cliente com gato e gatos desligados → "A loja não atende gatos no momento." (serviço SINGLE)', async () => {
    const { b, ctxCliente } = await conta()
    const s = await makeService(b.id)
    const e = await domainError(resolveServices(ctxCliente, [s.id], ctxCliente.db, { variant: 'CAT' }))
    expect(e.message).toBe('A loja não atende gatos no momento.')
    expect(e.reason).toBe('not_offered')
  })

  test('cliente com gato e gatos ligados passa', async () => {
    const { b, ctxCliente } = await conta(true)
    const s = await makeService(b.id)
    await expect(resolveServices(ctxCliente, [s.id], ctxCliente.db, { variant: 'CAT' })).resolves.toBeDefined()
  })

  test('equipe com gato e gatos desligados: SINGLE passa; BY_VARIANT com linha de gato passa; sem linha recusa', async () => {
    const { b, dono } = await conta()
    const single = await makeService(b.id)
    const porGato = await makeService(b.id)
    await makeServicePrice(b.id, porGato.id, 'CAT', { priceCents: 7000, durationMin: 30 })
    const semGato = await makeService(b.id, { name: 'Tosa' })
    await makeServicePrice(b.id, semGato.id, 'DOG_SMALL')
    const ok = await resolveServices(dono, [single.id, porGato.id], dono.db, { variant: 'CAT' })
    expect(ok.items.map((i) => i.priceCents)).toEqual([5000, 7000])
    const e = await domainError(resolveServices(dono, [semGato.id], dono.db, { variant: 'CAT' }))
    expect(e.fields?.['serviceIds']).toBe('Tosa não é feito para Gato.')
  })
})

describe('listServicesForPet', () => {
  test('equipe vê o não oferecido com motivo; cliente só os oferecidos e só do próprio pet', async () => {
    const { b, dono, cliente, ctxCliente } = await conta()
    const pet = await makePet(b.id, cliente.id, { species: 'DOG', size: 'GIANT' })
    const banho = await makeService(b.id, { name: 'Banho' })
    const tosa = await makeService(b.id, { name: 'Tosa', displayOrder: 2 })
    await makeServicePrice(b.id, tosa.id, 'DOG_SMALL')
    const equipe = await listServicesForPet(dono, pet.id)
    expect(equipe.map((o) => [o.service.name, o.offered, o.reason])).toEqual([
      ['Banho', true, null],
      ['Tosa', false, 'Não atende Cão gigante'],
    ])
    expect(equipe[0]).toMatchObject({ priceCents: 5000, durationMin: 30 })
    expect(equipe[1]).toMatchObject({ priceCents: null, durationMin: null })
    const meu = await listServicesForPet(ctxCliente, pet.id)
    expect(meu.map((o) => o.service.id)).toEqual([banho.id])
    const outro = await makeCustomer(b.id)
    const alheio = await makePet(b.id, outro.id)
    const e = await domainError(listServicesForPet(ctxCliente, alheio.id))
    expect(e.code).toBe('not_found')
  })

  test('gato com gatos desligados: cliente não vê nada; equipe vê tudo oferecido', async () => {
    const { b, dono, cliente, ctxCliente } = await conta()
    const gato = await makePet(b.id, cliente.id, { species: 'CAT', size: null })
    await makeService(b.id)
    expect(await listServicesForPet(ctxCliente, gato.id)).toEqual([])
    expect((await listServicesForPet(dono, gato.id))[0]?.offered).toBe(true)
  })
})
