import { prisma } from '@/server/db/client'
import { DomainError } from '@/server/domain/errors'
import { createTimeBlock, deleteTimeBlock, listTimeBlocks } from '@/server/domain/team/time-blocks'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCtx, makeMembership, makeProfessional, makeUser } from '../setup/factories'

beforeEach(resetDb)

async function erroDe(p: Promise<unknown>): Promise<DomainError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError)
    return e as DomainError
  }
  throw new Error('Era esperado um erro, mas a chamada terminou sem erro.')
}

async function membroComPapel(business: { id: string }, role: 'MANAGER' | 'PROFESSIONAL') {
  const user = await makeUser()
  const m = await makeMembership(business.id, user.id, role)
  const ctx = await makeCtx(business, {
    actor: { kind: 'member', userId: user.id, membershipId: m.id, name: user.name, role },
  })
  return { ctx, user, membership: m }
}

const INICIO = new Date('2026-11-17T02:00:00Z')
const FIM = new Date('2026-11-17T04:00:00Z')

describe('createTimeBlock e listTimeBlocks', () => {
  test('cria, grava o autor e lista por datas locais no fuso da conta', async () => {
    const b = await makeBusiness({ timezone: 'America/Sao_Paulo' })
    const { ctx, user } = await membroComPapel(b, 'MANAGER')
    const p = await makeProfessional(b.id)
    const bloco = await createTimeBlock(ctx, { professionalId: p.id, startsAt: INICIO, endsAt: FIM, reason: '  Médico  ' })
    expect(bloco).toEqual({ id: bloco.id, professionalId: p.id, startsAt: INICIO, endsAt: FIM, reason: 'Médico' })
    const gravado = await prisma.timeBlock.findUniqueOrThrow({ where: { id: bloco.id } })
    expect(gravado.createdByType).toBe('MEMBER')
    expect(gravado.createdById).toBe(user.id)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'time_block.created' } })).toBe(1)

    // 02:00Z-04:00Z em São Paulo (UTC-3) é 16/11 23:00 a 17/11 01:00.
    const dia16 = await listTimeBlocks(ctx, { professionalId: p.id, from: '2026-11-16', to: '2026-11-16' })
    const dia17 = await listTimeBlocks(ctx, { professionalId: p.id, from: '2026-11-17', to: '2026-11-17' })
    const dia15 = await listTimeBlocks(ctx, { professionalId: p.id, from: '2026-11-15', to: '2026-11-15' })
    const dia18 = await listTimeBlocks(ctx, { professionalId: p.id, from: '2026-11-18', to: '2026-11-20' })
    expect(dia16.map((x) => x.id)).toEqual([bloco.id])
    expect(dia17.map((x) => x.id)).toEqual([bloco.id])
    expect(dia15).toEqual([])
    expect(dia18).toEqual([])
  })

  test('lista só o profissional pedido, em ordem de início', async () => {
    const b = await makeBusiness({ timezone: 'America/Sao_Paulo' })
    const ctx = await makeCtx(b)
    const p = await makeProfessional(b.id)
    const q = await makeProfessional(b.id)
    const tarde = await createTimeBlock(ctx, {
      professionalId: p.id,
      startsAt: new Date('2026-11-17T18:00:00Z'),
      endsAt: new Date('2026-11-17T19:00:00Z'),
    })
    const cedo = await createTimeBlock(ctx, {
      professionalId: p.id,
      startsAt: new Date('2026-11-17T12:00:00Z'),
      endsAt: new Date('2026-11-17T13:00:00Z'),
      reason: '   ',
    })
    await createTimeBlock(ctx, { professionalId: q.id, startsAt: INICIO, endsAt: FIM })
    const lista = await listTimeBlocks(ctx, { professionalId: p.id, from: '2026-11-17', to: '2026-11-17' })
    expect(lista.map((x) => x.id)).toEqual([cedo.id, tarde.id])
    expect(lista[0]?.reason).toBeNull()
  })

  test('valida datas, ordem, duração máxima e janela de consulta', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await makeProfessional(b.id)
    const antes = await erroDe(createTimeBlock(ctx, { professionalId: p.id, startsAt: FIM, endsAt: INICIO }))
    expect(antes.code).toBe('validation')
    expect((await erroDe(createTimeBlock(ctx, { professionalId: p.id, startsAt: INICIO, endsAt: INICIO }))).code).toBe(
      'validation',
    )
    const longo = new Date(INICIO.getTime() + 61 * 24 * 3_600_000)
    expect((await erroDe(createTimeBlock(ctx, { professionalId: p.id, startsAt: INICIO, endsAt: longo }))).code).toBe(
      'validation',
    )
    const sessenta = new Date(INICIO.getTime() + 60 * 24 * 3_600_000)
    expect((await createTimeBlock(ctx, { professionalId: p.id, startsAt: INICIO, endsAt: sessenta })).id).toBeTruthy()
    expect(
      (await erroDe(listTimeBlocks(ctx, { professionalId: p.id, from: '2026-11-17', to: '2026-11-16' }))).code,
    ).toBe('validation')
    expect(
      (await erroDe(listTimeBlocks(ctx, { professionalId: p.id, from: '2026-01-01', to: '2026-04-03' }))).code,
    ).toBe('validation')
    expect(
      (await listTimeBlocks(ctx, { professionalId: p.id, from: '2026-01-01', to: '2026-04-02' })).length,
    ).toBe(0)
    expect((await erroDe(listTimeBlocks(ctx, { professionalId: p.id, from: '17/11/2026', to: '2026-11-17' }))).code).toBe(
      'validation',
    )
  })

  test('não é recusado por existir agendamento no intervalo', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await makeProfessional(b.id)
    const c = await prisma.customer.create({ data: { businessId: b.id, name: 'C', origin: 'PANEL' } })
    await prisma.appointment.create({
      data: {
        businessId: b.id,
        customerId: c.id,
        professionalId: p.id,
        startsAt: INICIO,
        endsAt: FIM,
        status: 'CONFIRMED',
        source: 'PANEL',
        totalCents: 0,
        totalDurationMin: 120,
        createdByType: 'SYSTEM',
      },
    })
    const bloco = await createTimeBlock(ctx, { professionalId: p.id, startsAt: INICIO, endsAt: FIM })
    expect(bloco.id).toBeTruthy()
    expect(await prisma.appointment.count({ where: { businessId: b.id, status: 'CONFIRMED' } })).toBe(1)
  })

  test('profissional bloqueia a própria agenda mas não a do colega; cliente não lista', async () => {
    const b = await makeBusiness()
    const { ctx: prof, membership } = await membroComPapel(b, 'PROFESSIONAL')
    const meu = await makeProfessional(b.id, { membershipId: membership.id })
    const colega = await makeProfessional(b.id)
    expect((await createTimeBlock(prof, { professionalId: meu.id, startsAt: INICIO, endsAt: FIM })).id).toBeTruthy()
    expect(
      (await erroDe(createTimeBlock(prof, { professionalId: colega.id, startsAt: INICIO, endsAt: FIM }))).code,
    ).toBe('forbidden')
    const cliente = await makeCtx(b, { actor: { kind: 'customer', customerId: crypto.randomUUID(), name: 'C' } })
    expect(
      (await erroDe(listTimeBlocks(cliente, { professionalId: meu.id, from: '2026-11-17', to: '2026-11-17' }))).code,
    ).toBe('forbidden')
  })
})

describe('deleteTimeBlock', () => {
  test('apaga e audita; profissional só apaga o próprio', async () => {
    const b = await makeBusiness()
    const { ctx: prof, membership } = await membroComPapel(b, 'PROFESSIONAL')
    const meu = await makeProfessional(b.id, { membershipId: membership.id })
    const colega = await makeProfessional(b.id)
    const ctx = await makeCtx(b)
    const dele = await createTimeBlock(ctx, { professionalId: colega.id, startsAt: INICIO, endsAt: FIM })
    const meuBloco = await createTimeBlock(prof, { professionalId: meu.id, startsAt: INICIO, endsAt: FIM })
    expect((await erroDe(deleteTimeBlock(prof, dele.id))).code).toBe('forbidden')
    await deleteTimeBlock(prof, meuBloco.id)
    expect(await prisma.timeBlock.count({ where: { id: meuBloco.id } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'time_block.deleted' } })).toBe(1)
    await deleteTimeBlock(ctx, dele.id)
    expect(await prisma.timeBlock.count({ where: { businessId: b.id } })).toBe(0)
  })

  test('bloqueio de outra conta, inexistente ou id malformado dá not_found', async () => {
    const b = await makeBusiness()
    const outra = await makeBusiness()
    const ctx = await makeCtx(b)
    const ctxOutra = await makeCtx(outra)
    const pOutra = await makeProfessional(outra.id)
    const alheio = await createTimeBlock(ctxOutra, { professionalId: pOutra.id, startsAt: INICIO, endsAt: FIM })
    expect((await erroDe(deleteTimeBlock(ctx, alheio.id))).code).toBe('not_found')
    expect((await erroDe(deleteTimeBlock(ctx, crypto.randomUUID()))).code).toBe('not_found')
    expect((await erroDe(deleteTimeBlock(ctx, 'xyz'))).code).toBe('not_found')
    expect(await prisma.timeBlock.count({ where: { id: alheio.id } })).toBe(1)
  })
})
