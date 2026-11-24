import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makePet } from '../setup/factories'

beforeEach(async () => {
  await resetDb()
})

describe('pets no banco', () => {
  test('cão sem porte é recusado pelo banco', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const c = await makeCustomer(b.id)
    await expect(makePet(b.id, c.id, { species: 'DOG', size: null })).rejects.toThrow(/pets_size_by_species_check/)
  })

  test('gato com porte é recusado pelo banco', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const c = await makeCustomer(b.id)
    await expect(makePet(b.id, c.id, { species: 'CAT', size: 'SMALL' })).rejects.toThrow(/pets_size_by_species_check/)
    await expect(makePet(b.id, c.id, { species: 'CAT', size: null })).resolves.toMatchObject({ species: 'CAT' })
  })

  test('mês de nascimento precisa ser o dia 1', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const c = await makeCustomer(b.id)
    await expect(makePet(b.id, c.id, { birthMonth: new Date('2024-03-15T00:00:00Z') })).rejects.toThrow(/pets_birth_month_check/)
    await expect(makePet(b.id, c.id, { birthMonth: new Date('2024-03-01T00:00:00Z') })).resolves.toBeDefined()
  })

  test('pet de outra conta não pode apontar para o cliente', async () => {
    const a = await makeBusiness({ niche: 'PET' })
    const b = await makeBusiness({ niche: 'PET' })
    const clienteDeB = await makeCustomer(b.id)
    await expect(makePet(a.id, clienteDeB.id)).rejects.toThrow(/pets_customer_id_same_business_fkey/)
  })

  test('opções do nicho precisam ser objeto', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    await expect(
      prisma.$executeRaw`UPDATE business_settings SET niche_options = '[]'::jsonb WHERE business_id = ${b.id}::uuid`,
    ).rejects.toThrow(/business_settings_niche_options_check/)
  })

  test('nome vazio é recusado', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const c = await makeCustomer(b.id)
    await expect(makePet(b.id, c.id, { name: '   ' })).rejects.toThrow(/pets_name_check/)
  })
})
