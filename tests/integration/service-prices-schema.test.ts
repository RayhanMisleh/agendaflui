import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeService, makeServicePrice } from '../setup/factories'

beforeEach(async () => {
  await resetDb()
})

describe('service_prices no banco', () => {
  test('a mesma variante duas vezes no serviço é recusada', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const s = await makeService(b.id)
    await makeServicePrice(b.id, s.id, 'DOG_SMALL')
    await expect(makeServicePrice(b.id, s.id, 'DOG_SMALL')).rejects.toThrow(/service_prices_service_id_variant_key/)
    await expect(makeServicePrice(b.id, s.id, 'DOG_MEDIUM')).resolves.toMatchObject({ variant: 'DOG_MEDIUM' })
  })

  test('duração fora da regra é recusada pelo CHECK', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const s = await makeService(b.id)
    await expect(makeServicePrice(b.id, s.id, 'CAT', { durationMin: 7 })).rejects.toThrow(/service_prices_duration_min_check/)
    await expect(makeServicePrice(b.id, s.id, 'CAT', { durationMin: 605 })).rejects.toThrow(/service_prices_duration_min_check/)
  })

  test('preço negativo é recusado pelo CHECK', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const s = await makeService(b.id)
    await expect(makeServicePrice(b.id, s.id, 'CAT', { priceCents: -1 })).rejects.toThrow(/service_prices_price_cents_check/)
  })

  test('serviço de outra conta é recusado pela FK composta', async () => {
    const a = await makeBusiness({ niche: 'PET' })
    const b = await makeBusiness({ niche: 'PET' })
    const s = await makeService(b.id)
    await expect(
      prisma.servicePrice.create({ data: { businessId: a.id, serviceId: s.id, variant: 'CAT', priceCents: 1000, durationMin: 30 } }),
    ).rejects.toThrow(/service_prices_service_id_same_business_fkey/)
  })

  test('apagar o serviço apaga as linhas', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const s = await makeService(b.id)
    await makeServicePrice(b.id, s.id, 'CAT')
    await prisma.service.delete({ where: { id: s.id } })
    expect(await prisma.servicePrice.count()).toBe(0)
  })
})
