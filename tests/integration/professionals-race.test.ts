import { prisma } from '@/server/db/client'
import { bookAppointment } from '@/server/domain/scheduling/appointments'
import { archiveProfessional } from '@/server/domain/team/professionals'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCtx, makeCustomer, makeProfessional, makeService } from '../setup/factories'

beforeEach(resetDb)

/** Segunda-feira, 08:00 em São Paulo. */
const AGORA = new Date('2026-11-16T11:00:00Z')
const HORA = new Date('2026-11-16T14:00:00Z')

test('arquivar e marcar o mesmo profissional em paralelo (10 vezes): nunca fica arquivado com agendamento futuro ativo', async () => {
  for (let i = 0; i < 10; i++) {
    await resetDb()
    const b = await makeBusiness()
    const tosa = await makeService(b.id, { durationMin: 30 })
    const p = await makeProfessional(b.id, { serviceIds: [tosa.id] })
    const c = await makeCustomer(b.id)
    const ctx = await makeCtx(b, { now: AGORA })
    const rs = await Promise.allSettled([
      archiveProfessional(ctx, p.id),
      bookAppointment(ctx, { customerId: c.id, professionalId: p.id, serviceIds: [tosa.id], startsAt: HORA }),
    ])
    const arquivou = rs[0].status === 'fulfilled'
    const marcou = rs[1].status === 'fulfilled'
    expect(arquivou && marcou).toBe(false)
    expect(arquivou || marcou).toBe(true)
    if (!arquivou) expect((rs[0] as PromiseRejectedResult).reason).toMatchObject({ reason: 'has_future_appointments' })
    const ficha = await prisma.professional.findUniqueOrThrow({ where: { id: p.id } })
    const futuros = await prisma.appointment.count({
      where: { professionalId: p.id, status: { in: ['PENDING', 'CONFIRMED'] }, endsAt: { gt: AGORA } },
    })
    expect(ficha.archivedAt !== null && futuros > 0).toBe(false)
    expect(arquivou).toBe(ficha.archivedAt !== null)
  }
})
