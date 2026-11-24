import { beforeEach, describe, expect, test } from 'vitest'
import { findOpenStore, joinStore, storeRelation } from '@/server/auth/store-join'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeMembership, makeUser } from '../setup/factories'

const AGORA = new Date('2026-11-23T12:00:00.000Z')

beforeEach(async () => {
  await resetDb()
})

describe('findOpenStore', () => {
  test('acha a loja ativa pelo slug; formato inválido, reservado, inexistente ou suspensa dão null', async () => {
    const b = await makeBusiness({ slug: 'pet-bom' })
    await makeBusiness({ slug: 'pet-fechado', status: 'SUSPENDED' })
    expect(await findOpenStore('pet-bom')).toMatchObject({ businessId: b.id, slug: 'pet-bom' })
    for (const ruim of ['pet-fechado', 'nao-existe', 'painel', 'entrar', 'Pet Bom', '-x', '', 'a'.repeat(41)]) {
      expect(await findOpenStore(ruim), ruim).toBeNull()
    }
  })
})

describe('joinStore', () => {
  test('cliente novo pela loja: cliente criado e ligado com o e-mail da pessoa', async () => {
    const b = await makeBusiness()
    const u = await makeUser({ name: 'Ana Souza', phone: '5511988887777' })
    const r = await joinStore(u.id, b.id, AGORA)
    expect(r.kind).toBe('joined')
    const c = await prisma.customer.findFirstOrThrow({ where: { businessId: b.id } })
    expect(c).toMatchObject({ userId: u.id, email: u.email, name: 'Ana Souza', phone: '5511988887777', origin: 'APP', linkedAt: AGORA })
    expect(r).toMatchObject({ customerId: c.id })
  })

  test('adota o cliente de balcão com o mesmo e-mail e mantém histórico e observações', async () => {
    const b = await makeBusiness()
    const u = await makeUser({ name: 'Ana Pessoa', email: 'ana@exemplo.test', phone: '5511977776666' })
    const balcao = await makeCustomer(b.id, { name: 'Ana da Loja', email: 'ana@exemplo.test', notes: 'Alérgica a perfume', isClubMember: true, phone: null })
    const r = await joinStore(u.id, b.id, AGORA)
    expect(r).toEqual({ kind: 'adopted', customerId: balcao.id })
    expect(await prisma.customer.count({ where: { businessId: b.id } })).toBe(1)
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: balcao.id } })).toMatchObject({
      userId: u.id,
      linkedAt: AGORA,
      name: 'Ana da Loja',
      notes: 'Alérgica a perfume',
      isClubMember: true,
      phone: '5511977776666',
    })
  })

  test('adoção não troca o telefone que o balcão já tinha', async () => {
    const b = await makeBusiness()
    const u = await makeUser({ email: 'ana@exemplo.test', phone: '5511977776666' })
    const balcao = await makeCustomer(b.id, { email: 'ana@exemplo.test', phone: '5511900000001' })
    await joinStore(u.id, b.id, AGORA)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: balcao.id } })).phone).toBe('5511900000001')
  })

  test('balcão arquivado ou vínculo arquivado: blocked, sem reativar nem criar', async () => {
    const b = await makeBusiness()
    const c = await makeBusiness()
    const u = await makeUser({ email: 'ana@exemplo.test' })
    const balcao = await makeCustomer(b.id, { email: 'ana@exemplo.test', archivedAt: new Date() })
    await makeCustomer(c.id, { userId: u.id, archivedAt: new Date() })
    expect(await joinStore(u.id, b.id, AGORA)).toEqual({ kind: 'blocked' })
    expect(await joinStore(u.id, c.id, AGORA)).toEqual({ kind: 'blocked' })
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: balcao.id } })).toMatchObject({ userId: null, archivedAt: expect.any(Date) })
    expect(await prisma.customer.count({ where: { businessId: b.id } })).toBe(1)
    expect(await prisma.customer.count({ where: { businessId: c.id } })).toBe(1)
  })

  test('já cliente: already, sem segundo cadastro', async () => {
    const b = await makeBusiness()
    const u = await makeUser()
    const c = await makeCustomer(b.id, { userId: u.id })
    expect(await joinStore(u.id, b.id, AGORA)).toEqual({ kind: 'already', customerId: c.id })
    expect(await prisma.customer.count({ where: { businessId: b.id } })).toBe(1)
  })

  test('duas entradas simultâneas: um cliente só', async () => {
    const b = await makeBusiness()
    const u = await makeUser()
    const rs = await Promise.all([joinStore(u.id, b.id, AGORA), joinStore(u.id, b.id, AGORA), joinStore(u.id, b.id, AGORA)])
    expect(rs.filter((r) => r.kind === 'joined')).toHaveLength(1)
    expect(rs.every((r) => r.kind === 'joined' || r.kind === 'already')).toBe(true)
    expect(await prisma.customer.count({ where: { businessId: b.id, userId: u.id } })).toBe(1)
  })

  test('pessoa com conta pendente (e-mail não verificado) não entra numa loja', async () => {
    const b = await makeBusiness()
    const u = await makeUser({ password: null })
    await expect(joinStore(u.id, b.id, AGORA)).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('storeRelation', () => {
  test('abrir a loja com sessão não cria cliente (só lê)', async () => {
    const b = await makeBusiness()
    const u = await makeUser()
    expect(await storeRelation(u.id, b.id)).toEqual({ isCustomer: false, isStaff: false, blocked: false })
    expect(await storeRelation(null, b.id)).toEqual({ isCustomer: false, isStaff: false, blocked: false })
    expect(await prisma.customer.count()).toBe(0)
  })

  test('cliente ativo: isCustomer; arquivado: blocked; balcão arquivado com o e-mail: blocked', async () => {
    const [a, b, c] = [await makeBusiness(), await makeBusiness(), await makeBusiness()]
    const u = await makeUser({ email: 'ana@exemplo.test' })
    await makeCustomer(a.id, { userId: u.id })
    await makeCustomer(b.id, { userId: u.id, archivedAt: new Date() })
    await makeCustomer(c.id, { email: 'ana@exemplo.test', archivedAt: new Date() })
    expect(await storeRelation(u.id, a.id)).toEqual({ isCustomer: true, isStaff: false, blocked: false })
    expect(await storeRelation(u.id, b.id)).toEqual({ isCustomer: false, isStaff: false, blocked: true })
    expect(await storeRelation(u.id, c.id)).toEqual({ isCustomer: false, isStaff: false, blocked: true })
  })

  test('equipe da loja: isStaff', async () => {
    const b = await makeBusiness()
    const u = await makeUser()
    await makeMembership(b.id, u.id, 'MANAGER')
    expect(await storeRelation(u.id, b.id)).toMatchObject({ isStaff: true, isCustomer: false })
  })
})
