import { prisma } from '@/server/db/client'
import { anonymizeCustomer, archiveCustomer } from '@/server/domain/customers/customers'
import { bookAppointment } from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCtx, makeCustomer, makeProfessional, makeService } from '../setup/factories'

beforeEach(resetDb)

const AGORA = new Date('2026-11-16T15:00:00Z')

async function cenario() {
  const b = await makeBusiness()
  const tosa = await makeService(b.id, { durationMin: 30 })
  const p1 = await makeProfessional(b.id, { serviceIds: [tosa.id] })
  const p2 = await makeProfessional(b.id, { serviceIds: [tosa.id] })
  const c = await makeCustomer(b.id)
  const ctx = await makeCtx(b, { now: AGORA })
  return { b, tosa, p1, p2, c, ctx }
}

const ativosFuturos = (customerId: string) =>
  prisma.appointment.count({
    where: { customerId, status: { in: ['PENDING', 'CONFIRMED'] }, endsAt: { gt: AGORA } },
  })

test('anonimizar e marcar para o mesmo cliente em paralelo (10 vezes): nunca sobra agendamento ativo futuro de cliente anonimizado', async () => {
  for (let i = 0; i < 10; i++) {
    await resetDb()
    const { tosa, p1, p2, c, ctx } = await cenario()
    // Um futuro já existente, para a anonimização ter o que cancelar enquanto a marcação corre.
    await bookAppointment(ctx, { customerId: c.id, professionalId: p1.id, serviceIds: [tosa.id], startsAt: new Date('2026-11-18T13:00:00Z') })
    await Promise.allSettled([
      anonymizeCustomer(ctx, c.id),
      bookAppointment(ctx, { customerId: c.id, professionalId: p2.id, serviceIds: [tosa.id], startsAt: new Date('2026-11-19T13:00:00Z') }),
    ])
    const cliente = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
    expect(cliente.anonymizedAt).not.toBeNull()
    expect(await ativosFuturos(c.id)).toBe(0)
  }
})

test('arquivar e marcar para o mesmo cliente em paralelo (10 vezes): nunca fica arquivado com agendamento ativo futuro', async () => {
  for (let i = 0; i < 10; i++) {
    await resetDb()
    const { tosa, p1, c, ctx } = await cenario()
    await Promise.allSettled([
      archiveCustomer(ctx, c.id),
      bookAppointment(ctx, { customerId: c.id, professionalId: p1.id, serviceIds: [tosa.id], startsAt: new Date('2026-11-19T13:00:00Z') }),
    ])
    const cliente = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
    expect(cliente.archivedAt !== null && (await ativosFuturos(c.id)) > 0).toBe(false)
  }
})

test('anonimizar enquanto o agendamento do cliente é remarcado para outro profissional (10 vezes): nada ativo no fim', async () => {
  const { rescheduleAppointment } = await import('@/server/domain/scheduling/appointments')
  for (let i = 0; i < 10; i++) {
    await resetDb()
    const { tosa, p1, p2, c, ctx } = await cenario()
    const ag = await bookAppointment(ctx, { customerId: c.id, professionalId: p1.id, serviceIds: [tosa.id], startsAt: new Date('2026-11-18T13:00:00Z') })
    await Promise.allSettled([
      anonymizeCustomer(ctx, c.id),
      rescheduleAppointment(ctx, ag.id, { startsAt: new Date('2026-11-19T13:00:00Z'), professionalId: p2.id }),
    ])
    expect(await ativosFuturos(c.id)).toBe(0)
  }
})
