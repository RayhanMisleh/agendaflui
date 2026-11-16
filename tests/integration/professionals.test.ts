import { prisma } from '@/server/db/client'
import {
  archiveProfessional,
  assertCanManageProfessional,
  createProfessional,
  getProfessional,
  listProfessionals,
  ownProfessionalId,
  updateProfessional,
} from '@/server/domain/team/professionals'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeBusiness,
  makeCtx,
  makeMembership,
  makeProfessional,
  makeService,
  makeUpload,
  makeUser,
  memberOf,
} from '../setup/factories'

beforeEach(resetDb)

function ctxCliente(business: { id: string }) {
  return makeCtx(business, { actor: { kind: 'customer', customerId: crypto.randomUUID(), name: 'Cliente' } })
}

async function agendar(
  businessId: string,
  professionalId: string,
  startsAt: Date,
  status: 'PENDING' | 'CONFIRMED' | 'CANCELED' = 'CONFIRMED',
) {
  const customer = await prisma.customer.create({ data: { businessId, name: 'Cliente', origin: 'PANEL' } })
  return prisma.appointment.create({
    data: {
      businessId,
      customerId: customer.id,
      professionalId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status,
      source: 'PANEL',
      totalCents: 5000,
      totalDurationMin: 30,
      createdByType: 'SYSTEM',
    },
  })
}

const AGORA = new Date('2026-11-16T15:00:00Z')

describe('createProfessional', () => {
  test('liga a todos os serviços não arquivados por padrão', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s1 = await makeService(b.id)
    const s2 = await makeService(b.id)
    await makeService(b.id, { archivedAt: new Date() })
    const p = await createProfessional(ctx, { name: '  Ana  ' })
    expect(p).toEqual({
      id: p.id,
      name: 'Ana',
      bio: null,
      avatarUrl: null,
      commissionBps: 0,
      active: true,
      displayOrder: 1,
      archived: false,
      membershipId: null,
      serviceIds: [s1.id, s2.id].sort(),
    })
    expect(await getProfessional(ctx, p.id)).toEqual(p)
    const logs = await prisma.auditLog.findMany({ where: { businessId: b.id, action: 'professional.created' } })
    expect(logs).toHaveLength(1)
  })

  test('serviceIds explícitos limitam a ligação; lista vazia não liga nenhum', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s1 = await makeService(b.id)
    await makeService(b.id)
    const p = await createProfessional(ctx, { name: 'Bia', serviceIds: [s1.id] })
    expect(p.serviceIds).toEqual([s1.id])
    const q = await createProfessional(ctx, { name: 'Caio', serviceIds: [] })
    expect(q.serviceIds).toEqual([])
    expect(q.displayOrder).toBe(2)
  })

  test('serviceIds de outra conta ou arquivado dão validation', async () => {
    const b = await makeBusiness()
    const outra = await makeBusiness()
    const ctx = await makeCtx(b)
    const alheio = await makeService(outra.id)
    const arquivado = await makeService(b.id, { archivedAt: new Date() })
    const e1 = await domainError(createProfessional(ctx, { name: 'X', serviceIds: [alheio.id] }))
    expect(e1.code).toBe('validation')
    expect(e1.fields).toHaveProperty('serviceIds')
    const e2 = await domainError(createProfessional(ctx, { name: 'X', serviceIds: [arquivado.id] }))
    expect(e2.code).toBe('validation')
    const e3 = await domainError(createProfessional(ctx, { name: 'X', serviceIds: ['nao-e-uuid'] }))
    expect(e3.code).toBe('validation')
    expect(await prisma.professional.count({ where: { businessId: b.id } })).toBe(0)
  })

  test('valida nome e comissão', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    expect((await domainError(createProfessional(ctx, { name: '   ' }))).fields).toHaveProperty('name')
    expect((await domainError(createProfessional(ctx, { name: 'a'.repeat(81) }))).fields).toHaveProperty('name')
    expect((await domainError(createProfessional(ctx, { name: 'A', commissionBps: 10001 }))).fields).toHaveProperty(
      'commissionBps',
    )
    expect((await domainError(createProfessional(ctx, { name: 'A', commissionBps: -1 }))).code).toBe('validation')
    const ok = await createProfessional(ctx, { name: 'A', commissionBps: 10000, bio: '  ', })
    expect(ok.commissionBps).toBe(10000)
    expect(ok.bio).toBeNull()
  })

  test('membershipId precisa ser vínculo ativo da conta e livre', async () => {
    const b = await makeBusiness()
    const outra = await makeBusiness()
    const ctx = await makeCtx(b)
    const u = await makeUser()
    const m = await makeMembership(b.id, u.id, 'PROFESSIONAL')
    const p = await createProfessional(ctx, { name: 'Ligada', membershipId: m.id })
    expect(p.membershipId).toBe(m.id)

    const repetido = await domainError(createProfessional(ctx, { name: 'Outra', membershipId: m.id }))
    expect(repetido.code).toBe('conflict')

    const uOutra = await makeUser()
    const mOutra = await makeMembership(outra.id, uOutra.id, 'PROFESSIONAL')
    expect((await domainError(createProfessional(ctx, { name: 'X', membershipId: mOutra.id }))).code).toBe('validation')

    const uInativo = await makeUser()
    const mInativo = await makeMembership(b.id, uInativo.id, 'PROFESSIONAL')
    await prisma.membership.update({ where: { id: mInativo.id }, data: { active: false } })
    expect((await domainError(createProfessional(ctx, { name: 'X', membershipId: mInativo.id }))).code).toBe('validation')
  })

  test('exige manage_team', async () => {
    const b = await makeBusiness()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    expect((await domainError(createProfessional(prof, { name: 'X' }))).code).toBe('forbidden')
    expect((await domainError(createProfessional(await ctxCliente(b), { name: 'X' }))).code).toBe('forbidden')
    const gerente = await ctxWithRole(b, 'MANAGER')
    expect((await createProfessional(gerente, { name: 'X' })).name).toBe('X')
  })
})

describe('listProfessionals e getProfessional', () => {
  test('lista ordenada; inativos e arquivados só com opção', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const a = await makeProfessional(b.id, { name: 'A', displayOrder: 2 })
    const c = await makeProfessional(b.id, { name: 'C', displayOrder: 1 })
    const inativo = await makeProfessional(b.id, { name: 'I', active: false, displayOrder: 3 })
    const arq = await makeProfessional(b.id, { name: 'Z', archivedAt: new Date(), displayOrder: 4 })
    expect((await listProfessionals(ctx)).map((p) => p.id)).toEqual([c.id, a.id])
    expect((await listProfessionals(ctx, { includeInactive: true })).map((p) => p.id)).toEqual([c.id, a.id, inativo.id])
    expect((await listProfessionals(ctx, { includeArchived: true })).map((p) => p.id)).toEqual([c.id, a.id, arq.id])
  })

  test('filtra por serviços: só quem faz todos', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s1 = await makeService(b.id)
    const s2 = await makeService(b.id)
    const ambos = await makeProfessional(b.id, { name: 'Ambos', serviceIds: [s1.id, s2.id], displayOrder: 1 })
    await makeProfessional(b.id, { name: 'Só um', serviceIds: [s1.id], displayOrder: 2 })
    await makeProfessional(b.id, { name: 'Nenhum', displayOrder: 3 })
    expect((await listProfessionals(ctx, { serviceIds: [s1.id, s2.id] })).map((p) => p.id)).toEqual([ambos.id])
    expect(await listProfessionals(ctx, { serviceIds: [s1.id] })).toHaveLength(2)
  })

  test('cliente só vê ativos e não arquivados, sem comissão nem membershipId', async () => {
    const b = await makeBusiness()
    const u = await makeUser()
    const m = await makeMembership(b.id, u.id, 'PROFESSIONAL')
    const ativo = await makeProfessional(b.id, { name: 'Ativa', commissionBps: 3000, membershipId: m.id })
    const inativo = await makeProfessional(b.id, { name: 'Inativa', active: false })
    const arq = await makeProfessional(b.id, { name: 'Arq', archivedAt: new Date() })
    const cliente = await ctxCliente(b)
    const lista = await listProfessionals(cliente, { includeInactive: true, includeArchived: true })
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ id: ativo.id, commissionBps: 0, membershipId: null })
    expect(await getProfessional(cliente, ativo.id)).toMatchObject({ commissionBps: 0, membershipId: null })
    expect((await domainError(getProfessional(cliente, inativo.id))).code).toBe('not_found')
    expect((await domainError(getProfessional(cliente, arq.id))).code).toBe('not_found')
    const equipe = await makeCtx(b)
    expect(await getProfessional(equipe, ativo.id)).toMatchObject({ commissionBps: 3000, membershipId: m.id })
  })

  test('avatarUrl vem do upload; id malformado ou de outra conta dá not_found', async () => {
    const b = await makeBusiness()
    const outra = await makeBusiness()
    const ctx = await makeCtx(b)
    const up = await makeUpload(b.id)
    const p = await makeProfessional(b.id, { avatarUploadId: up.id })
    expect((await getProfessional(ctx, p.id)).avatarUrl).toBe(`/arquivos/${up.path}`)
    const alheio = await makeProfessional(outra.id)
    expect((await domainError(getProfessional(ctx, alheio.id))).code).toBe('not_found')
    expect((await domainError(getProfessional(ctx, 'xyz'))).code).toBe('not_found')
  })
})

describe('updateProfessional', () => {
  test('altera campos e troca a ligação de serviços', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s1 = await makeService(b.id)
    const s2 = await makeService(b.id)
    const p = await makeProfessional(b.id, { name: 'Velho', serviceIds: [s1.id] })
    const r = await updateProfessional(ctx, p.id, { name: 'Novo', serviceIds: [s2.id], active: false })
    expect(r).toMatchObject({ name: 'Novo', active: false, serviceIds: [s2.id] })
    const sem = await updateProfessional(ctx, p.id, { bio: 'Olá' })
    expect(sem.serviceIds).toEqual([s2.id])
    expect(sem.bio).toBe('Olá')
    const logs = await prisma.auditLog.findMany({ where: { businessId: b.id, action: 'professional.updated' } })
    expect(logs).toHaveLength(2)
  })

  test('membershipId: pode manter o próprio, recusa o de outro e aceita null', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const u1 = await makeUser()
    const m1 = await makeMembership(b.id, u1.id, 'PROFESSIONAL')
    const u2 = await makeUser()
    const m2 = await makeMembership(b.id, u2.id, 'PROFESSIONAL')
    const p1 = await makeProfessional(b.id, { membershipId: m1.id })
    const p2 = await makeProfessional(b.id, { membershipId: m2.id })
    expect((await updateProfessional(ctx, p1.id, { membershipId: m1.id })).membershipId).toBe(m1.id)
    expect((await domainError(updateProfessional(ctx, p1.id, { membershipId: m2.id }))).code).toBe('conflict')
    expect((await updateProfessional(ctx, p2.id, { membershipId: null })).membershipId).toBeNull()
  })

  test('exige manage_team, recusa arquivado e id inexistente', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await makeProfessional(b.id)
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    expect((await domainError(updateProfessional(prof, p.id, { name: 'X' }))).code).toBe('forbidden')
    expect((await domainError(updateProfessional(ctx, crypto.randomUUID(), { name: 'X' }))).code).toBe('not_found')
    const arq = await makeProfessional(b.id, { archivedAt: new Date() })
    expect((await domainError(updateProfessional(ctx, arq.id, { name: 'X' }))).code).toBe('conflict')
  })
})

describe('archiveProfessional', () => {
  test('recusa com agendamentos futuros pendentes ou confirmados e diz quantos', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b, { now: AGORA })
    const s = await makeService(b.id)
    const p = await makeProfessional(b.id, { serviceIds: [s.id] })
    await agendar(b.id, p.id, new Date('2026-11-17T13:00:00Z'), 'CONFIRMED')
    await agendar(b.id, p.id, new Date('2026-11-18T13:00:00Z'), 'PENDING')
    const e = await domainError(archiveProfessional(ctx, p.id))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('has_future_appointments')
    expect(e.details?.count).toBe(2)
    expect(e.message).toContain('2')
    expect((await getProfessional(ctx, p.id)).archived).toBe(false)
  })

  test('arquiva com agendamento só no passado ou cancelado', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b, { now: AGORA })
    const s = await makeService(b.id)
    const p = await makeProfessional(b.id, { serviceIds: [s.id] })
    await agendar(b.id, p.id, new Date('2026-11-10T13:00:00Z'), 'CONFIRMED')
    await agendar(b.id, p.id, new Date('2026-11-20T13:00:00Z'), 'CANCELED')
    await archiveProfessional(ctx, p.id)
    expect((await getProfessional(ctx, p.id)).archived).toBe(true)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'professional.archived' } })).toBe(1)
    await archiveProfessional(ctx, p.id)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'professional.archived' } })).toBe(1)
  })

  test('exige manage_team', async () => {
    const b = await makeBusiness()
    const p = await makeProfessional(b.id)
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    expect((await domainError(archiveProfessional(prof, p.id))).code).toBe('forbidden')
  })
})

describe('ownProfessionalId e assertCanManageProfessional', () => {
  test('ownProfessionalId: membro ligado, dono sem ficha, cliente', async () => {
    const b = await makeBusiness()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    const ficha = await makeProfessional(b.id, { membershipId: memberOf(prof).membershipId })
    expect(await ownProfessionalId(prof)).toBe(ficha.id)
    expect(await ownProfessionalId(await makeCtx(b))).toBeNull()
    expect(await ownProfessionalId(await ctxCliente(b))).toBeNull()
    await prisma.professional.update({ where: { id: ficha.id }, data: { archivedAt: new Date() } })
    expect(await ownProfessionalId(prof)).toBeNull()
  })

  test('profissional gerencia o próprio mas não o colega; gerente gerencia qualquer um', async () => {
    const b = await makeBusiness()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    const meu = await makeProfessional(b.id, { membershipId: memberOf(prof).membershipId })
    const colega = await makeProfessional(b.id)
    await assertCanManageProfessional(prof, meu.id)
    expect((await domainError(assertCanManageProfessional(prof, colega.id))).code).toBe('forbidden')
    const gerente = await ctxWithRole(b, 'MANAGER')
    await assertCanManageProfessional(gerente, colega.id)
    expect((await domainError(assertCanManageProfessional(await ctxCliente(b), meu.id))).code).toBe('forbidden')
  })

  test('profissional inexistente ou de outra conta dá not_found', async () => {
    const b = await makeBusiness()
    const outra = await makeBusiness()
    const ctx = await makeCtx(b)
    const alheio = await makeProfessional(outra.id)
    expect((await domainError(assertCanManageProfessional(ctx, alheio.id))).code).toBe('not_found')
    expect((await domainError(assertCanManageProfessional(ctx, 'xyz'))).code).toBe('not_found')
  })
})
