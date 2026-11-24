import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeAppointment, makeBusiness, makeCalendarConnection, makeCustomer, makeProfessional, makeService, makeUser } from '../setup/factories'

beforeEach(async () => {
  await resetDb()
})

/** Prisma 7 + adaptador pg: o erro do Postgres vem em meta.driverAdapterError.cause. */
function textoDoErro(e: unknown): string {
  const cause = (e as { meta?: { driverAdapterError?: { cause?: { message?: string; constraint?: string } } } }).meta?.driverAdapterError?.cause
  return `${cause?.constraint ?? ''} ${cause?.message ?? ''} ${e instanceof Error ? e.message : ''}`
}

async function recusa(promessa: Promise<unknown>, restricao: string): Promise<void> {
  const erro = await promessa.then(
    () => null,
    (e: unknown) => e,
  )
  expect(erro, `esperava recusa por ${restricao}`).not.toBeNull()
  expect(textoDoErro(erro)).toContain(restricao)
}

async function agendamento(businessId: string) {
  const [c, p, s] = [await makeCustomer(businessId), await makeProfessional(businessId), await makeService(businessId)]
  return makeAppointment(businessId, { customerId: c.id, professionalId: p.id, serviceId: s.id, startsAt: new Date('2026-12-01T12:00:00Z') })
}

describe('calendar_connections', () => {
  test('calendar_connections_token_by_status recusa CONNECTED sem token e REVOKED com token', async () => {
    const u = await makeUser()
    const agora = new Date()
    await recusa(
      prisma.calendarConnection.create({ data: { userId: u.id, googleSub: 'g', status: 'CONNECTED', connectedAt: agora } }),
      'calendar_connections_token_by_status',
    )
    await recusa(
      prisma.calendarConnection.create({ data: { userId: u.id, googleSub: 'g', status: 'REVOKED', connectedAt: agora, revokedAt: agora, refreshTokenEnc: 'x' } }),
      'calendar_connections_token_by_status',
    )
  })

  test('calendar_connections_revoked_at recusa REVOKED sem revoked_at', async () => {
    const u = await makeUser()
    await recusa(
      prisma.calendarConnection.create({ data: { userId: u.id, googleSub: 'g', status: 'REVOKED', connectedAt: new Date() } }),
      'calendar_connections_revoked_at',
    )
  })

  test('a fábrica cria ligação ativa com o token selado e desligada sem token', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const ativa = await makeCalendarConnection(a.id)
    expect(ativa.status).toBe('CONNECTED')
    expect(ativa.refreshTokenEnc).toMatch(/^v1\./)
    const off = await makeCalendarConnection(b.id, { status: 'REVOKED' })
    expect(off.refreshTokenEnc).toBeNull()
    expect(off.revokedAt).not.toBeNull()
  })

  test('apagar a pessoa apaga a ligação e anula placed_user_id', async () => {
    const b = await makeBusiness()
    const ap = await agendamento(b.id)
    const u = await makeUser()
    await makeCalendarConnection(u.id)
    await prisma.calendarSync.create({ data: { businessId: b.id, appointmentId: ap.id, placedUserId: u.id } })
    await prisma.user.delete({ where: { id: u.id } })
    expect(await prisma.calendarConnection.count()).toBe(0)
    expect((await prisma.calendarSync.findFirstOrThrow()).placedUserId).toBeNull()
  })
})

describe('calendar_syncs', () => {
  test('calendar_syncs_generation_check recusa synced_generation maior que generation', async () => {
    const b = await makeBusiness()
    const ap = await agendamento(b.id)
    await recusa(
      prisma.calendarSync.create({ data: { businessId: b.id, appointmentId: ap.id, generation: 1, syncedGeneration: 2 } }),
      'calendar_syncs_generation_check',
    )
  })

  test('calendar_syncs_attempts_check recusa mais de 6 tentativas', async () => {
    const b = await makeBusiness()
    const ap = await agendamento(b.id)
    await recusa(prisma.calendarSync.create({ data: { businessId: b.id, appointmentId: ap.id, attempts: 7 } }), 'calendar_syncs_attempts_check')
  })

  test('agendamento de outra conta é recusado por calendar_syncs_appointment_same_business_fkey', async () => {
    const [a, b] = [await makeBusiness(), await makeBusiness()]
    const ap = await agendamento(a.id)
    await recusa(prisma.calendarSync.create({ data: { businessId: b.id, appointmentId: ap.id } }), 'calendar_syncs_appointment_same_business_fkey')
  })

  test('um agendamento tem uma linha só, e apagar o agendamento apaga a linha', async () => {
    const b = await makeBusiness()
    const ap = await agendamento(b.id)
    await prisma.calendarSync.create({ data: { businessId: b.id, appointmentId: ap.id } })
    await recusa(prisma.calendarSync.create({ data: { businessId: b.id, appointmentId: ap.id } }), 'calendar_syncs')
    await prisma.appointment.delete({ where: { id: ap.id } })
    expect(await prisma.calendarSync.count()).toBe(0)
  })
})

describe('scheduler_runs', () => {
  test('scheduler_runs_kind_check aceita calendar', async () => {
    const agora = new Date()
    await prisma.schedulerRun.create({ data: { kind: 'calendar', startedAt: agora, finishedAt: agora, ok: true, summary: '' } })
    expect(await prisma.schedulerRun.count({ where: { kind: 'calendar' } })).toBe(1)
  })
})
