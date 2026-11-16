import { prisma } from '@/server/db/client'
import { bookAppointment, type AppointmentView } from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCtx, makeCustomer, makeProfessional, makeService, makeWorkingHours } from '../setup/factories'

beforeEach(resetDb)

/** Segunda-feira, 08:00 em São Paulo. */
const AGORA = new Date('2026-11-16T11:00:00Z')
const hora = (h: number, m = 0): Date => new Date(Date.UTC(2026, 10, 16, h + 3, m))

async function montar(professionals = 1) {
  const b = await makeBusiness()
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30 } })
  const tosa = await makeService(b.id, { name: 'Tosa', durationMin: 30, priceCents: 5000 })
  const profs = []
  for (let i = 0; i < professionals; i++) {
    const p = await makeProfessional(b.id, { name: `Prof ${i}`, displayOrder: i, serviceIds: [tosa.id] })
    await makeWorkingHours(b.id, p.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
    profs.push(p)
  }
  return { b, tosa, profs }
}

/** Um contexto de cliente do app, com cliente e cliente Prisma por conta próprios. */
async function cliente(b: { id: string }) {
  const c = await makeCustomer(b.id)
  return makeCtx(b, { actor: { kind: 'customer', customerId: c.id, name: c.name }, now: AGORA })
}

type Resultado = PromiseSettledResult<AppointmentView>
const motivos = (rs: Resultado[]) =>
  rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => (r.reason as { reason?: string }).reason)

test('20 pedidos simultâneos no mesmo horário e profissional: exatamente 1 passa e os outros 19 dão slot_taken', async () => {
  const s = await montar()
  const ctxs = await Promise.all(Array.from({ length: 20 }, () => cliente(s.b)))
  const profissional = s.profs[0]
  if (!profissional) throw new Error('sem profissional')
  const rs = await Promise.allSettled(
    ctxs.map((ctx) => bookAppointment(ctx, { professionalId: profissional.id, serviceIds: [s.tosa.id], startsAt: hora(10) })),
  )
  expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(motivos(rs)).toEqual(Array(19).fill('slot_taken'))
  expect(await prisma.appointment.count({ where: { businessId: s.b.id } })).toBe(1)
  expect(await prisma.appointmentItem.count({ where: { businessId: s.b.id } })).toBe(1)
})

test('o mesmo pedido enviado 2 vezes em paralelo, pelo mesmo cliente, gera 1 agendamento', async () => {
  const s = await montar()
  const c = await makeCustomer(s.b.id)
  const a = await makeCtx(s.b, { actor: { kind: 'customer', customerId: c.id, name: c.name }, now: AGORA })
  const b = await makeCtx(s.b, { actor: { kind: 'customer', customerId: c.id, name: c.name }, now: AGORA })
  const profissional = s.profs[0]
  if (!profissional) throw new Error('sem profissional')
  const pedido = { professionalId: profissional.id, serviceIds: [s.tosa.id], startsAt: hora(10) }
  const rs = await Promise.allSettled([bookAppointment(a, pedido), bookAppointment(b, pedido)])
  expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(motivos(rs)).toEqual(['slot_taken'])
  expect(await prisma.appointment.count({ where: { businessId: s.b.id } })).toBe(1)
})

test('10 marcações simultâneas em horários diferentes e sem sobreposição: todas passam', async () => {
  const s = await montar()
  const profissional = s.profs[0]
  if (!profissional) throw new Error('sem profissional')
  const horarios = [hora(9), hora(9, 30), hora(10), hora(10, 30), hora(11), hora(11, 30), hora(13), hora(13, 30), hora(14), hora(14, 30)]
  const ctxs = await Promise.all(horarios.map(() => cliente(s.b)))
  const rs = await Promise.allSettled(
    ctxs.map((ctx, i) =>
      bookAppointment(ctx, { professionalId: profissional.id, serviceIds: [s.tosa.id], startsAt: horarios[i] ?? hora(9) }),
    ),
  )
  expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(10)
  expect(await prisma.appointment.count({ where: { businessId: s.b.id } })).toBe(10)
})

test('qualquer profissional com 2 profissionais e 3 pedidos no mesmo horário: 2 passam em profissionais diferentes e 1 dá slot_taken', async () => {
  const s = await montar(2)
  const ctxs = await Promise.all(Array.from({ length: 3 }, () => cliente(s.b)))
  const rs = await Promise.allSettled(
    ctxs.map((ctx) => bookAppointment(ctx, { professionalId: null, serviceIds: [s.tosa.id], startsAt: hora(10) })),
  )
  const feitos = rs.filter((r): r is PromiseFulfilledResult<AppointmentView> => r.status === 'fulfilled')
  expect(feitos).toHaveLength(2)
  expect(new Set(feitos.map((r) => r.value.professional.id)).size).toBe(2)
  expect(motivos(rs)).toEqual(['slot_taken'])
  expect(await prisma.appointment.count({ where: { businessId: s.b.id } })).toBe(2)
})
