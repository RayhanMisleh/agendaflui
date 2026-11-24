import { beforeEach, describe, expect, test } from 'vitest'
import { loginWithPassword } from '@/server/auth/session'
import { customerLandingPath, resolveStoreVisit, type CustomerVisit } from '@/server/auth/customer-access'
import { needsPetQuiz } from '@/server/auth/pet-onboarding'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makePet, makeUser } from '../setup/factories'

const REQ = { ip: '203.0.113.7', userAgent: 'teste' }

async function visita(niche: 'PET' | null): Promise<{ v: CustomerVisit; businessId: string; customerId: string }> {
  const b = await makeBusiness({ niche })
  const u = await makeUser({ password: 'senha-bem-longa' })
  const c = await makeCustomer(b.id, { userId: u.id })
  const s = await loginWithPassword({ email: u.email, password: 'senha-bem-longa', customerBusinessId: b.id }, new Date())
  const v = await resolveStoreVisit({ token: s.token, slug: b.slug, request: REQ })
  if (v.kind !== 'customer') throw new Error('esperava cliente')
  return { v, businessId: b.id, customerId: c.id }
}

beforeEach(resetDb)

describe('needsPetQuiz', () => {
  test('loja de pet shop e cliente sem pet ativo: pede o quiz e o destino leva a boas-vindas com a volta', async () => {
    const { v } = await visita('PET')
    expect(await needsPetQuiz(v)).toBe(true)
    expect(await customerLandingPath(v, `/${v.store.slug}/agendar`)).toBe(`/${v.store.slug}/boas-vindas?volta=${encodeURIComponent(`/${v.store.slug}/agendar`)}`)
  })

  test('com pet ativo não pede; só com pet arquivado pede', async () => {
    const { v, businessId, customerId } = await visita('PET')
    const pet = await makePet(businessId, customerId)
    expect(await needsPetQuiz(v)).toBe(false)
    expect(await customerLandingPath(v, null)).toBe(`/${v.store.slug}`)
    await prisma.pet.update({ where: { id: pet.id }, data: { archivedAt: new Date() } })
    expect(await needsPetQuiz(v)).toBe(true)
  })

  test('loja sem nicho nunca pede', async () => {
    const { v } = await visita(null)
    expect(await needsPetQuiz(v)).toBe(false)
  })
})
