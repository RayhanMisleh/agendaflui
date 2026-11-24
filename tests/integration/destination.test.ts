import { beforeEach, describe, expect, test } from 'vitest'
import { destinationFor, destinationForUser, loadDestinationFacts } from '@/server/auth/destination'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeMembership, makeUser } from '../setup/factories'

beforeEach(async () => {
  await resetDb()
})

describe('loadDestinationFacts', () => {
  test('vínculo inativo ou loja suspensa não conta como equipe', async () => {
    const u = await makeUser()
    const ativa = await makeBusiness()
    const suspensa = await makeBusiness({ status: 'SUSPENDED' })
    await prisma.membership.create({ data: { businessId: ativa.id, userId: u.id, role: 'OWNER', active: false } })
    await makeMembership(suspensa.id, u.id, 'OWNER')
    expect((await loadDestinationFacts(u.id, null)).staff).toBe(false)
    await prisma.membership.updateMany({ where: { businessId: suspensa.id }, data: { active: false } })
    await prisma.membership.updateMany({ where: { businessId: ativa.id }, data: { active: true } })
    expect((await loadDestinationFacts(u.id, null)).staff).toBe(true)
  })

  test('cliente arquivado, anonimizado, de balcão ou de loja suspensa não conta', async () => {
    const u = await makeUser()
    const [boa, arq, ano, balcao, susp] = [await makeBusiness(), await makeBusiness(), await makeBusiness(), await makeBusiness(), await makeBusiness({ status: 'SUSPENDED' })]
    await makeCustomer(boa.id, { userId: u.id })
    await makeCustomer(arq.id, { userId: u.id, archivedAt: new Date() })
    await makeCustomer(ano.id, { userId: u.id, anonymizedAt: new Date() })
    await makeCustomer(balcao.id, { email: u.email })
    await makeCustomer(susp.id, { userId: u.id })
    const f = await loadDestinationFacts(u.id, null)
    expect(f.stores.map((s) => s.businessId)).toEqual([boa.id])
    expect(f.stores[0]?.slug).toBe(boa.slug)
  })
})

test('destinationForUser: equipe → painel; cliente de uma loja → loja; ninguém → no_store', async () => {
  const equipe = await makeUser()
  const cliente = await makeUser()
  const ninguem = await makeUser()
  const b = await makeBusiness()
  await makeMembership(b.id, equipe.id, 'MANAGER')
  await makeCustomer(b.id, { userId: cliente.id })
  expect(await destinationForUser(equipe.id, null)).toEqual({ kind: 'painel' })
  expect(await destinationForUser(cliente.id, null)).toEqual({ kind: 'store', slug: b.slug })
  expect(await destinationForUser(ninguem.id, null)).toEqual({ kind: 'no_store' })
})

test('cliente de várias lojas: a última usada da sessão manda', async () => {
  const u = await makeUser()
  const [a, b] = [await makeBusiness(), await makeBusiness()]
  await makeCustomer(a.id, { userId: u.id, linkedAt: new Date('2026-11-01T00:00:00Z') })
  await makeCustomer(b.id, { userId: u.id, linkedAt: new Date('2026-11-02T00:00:00Z') })
  expect(await destinationForUser(u.id, null)).toEqual({ kind: 'store', slug: b.slug })
  expect(await destinationForUser(u.id, a.id)).toEqual({ kind: 'store', slug: a.slug })
})

test('sessão de suporte vai para o painel', async () => {
  expect(await destinationFor({ kind: 'support', admin: { id: 'x', name: 'Admin' }, activeBusinessId: 'y', businessName: 'Loja' })).toEqual({ kind: 'painel' })
})
