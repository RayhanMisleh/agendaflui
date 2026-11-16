import { prisma } from '@/server/db/client'
import { DomainError } from '@/server/domain/errors'
import {
  bookAppointment,
  cancelAppointment,
  completeAppointment,
  rescheduleAppointment,
  type AppointmentView,
} from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { makeAppointment, makeBusiness, makeCtx, makeCustomer, makeProfessional, makeService, makeWorkingHours } from '../setup/factories'

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

test('remarcações cruzadas A→B e B→A em paralelo, 10 vezes: sem deadlock, sem timeout e sem sobreposição', async () => {
  for (let n = 0; n < 10; n++) {
    const s = await montar(2)
    const [ana, caio] = s.profs
    if (!ana || !caio) throw new Error('faltam profissionais')
    const gerente = await makeCtx(s.b, { now: AGORA })
    const c1 = await makeCustomer(s.b.id)
    const c2 = await makeCustomer(s.b.id)
    const x = await makeAppointment(s.b.id, { customerId: c1.id, professionalId: ana.id, serviceId: s.tosa.id, startsAt: hora(10) })
    const y = await makeAppointment(s.b.id, { customerId: c2.id, professionalId: caio.id, serviceId: s.tosa.id, startsAt: hora(10) })
    const rs = await Promise.allSettled([
      rescheduleAppointment(gerente, x.id, { startsAt: hora(11), professionalId: caio.id }),
      rescheduleAppointment(gerente, y.id, { startsAt: hora(11), professionalId: ana.id }),
    ])
    for (const r of rs) {
      if (r.status === 'rejected') {
        const motivo = r.reason instanceof DomainError ? r.reason.message : String(r.reason)
        throw new Error(`remarcação cruzada falhou na repetição ${n}: ${motivo}`)
      }
    }
    const linhas = await prisma.appointment.findMany({ where: { businessId: s.b.id } })
    expect(linhas.map((l) => [l.id, l.professionalId]).sort()).toEqual(
      [[x.id, caio.id], [y.id, ana.id]].sort(),
    )
    for (const a of linhas) {
      for (const o of linhas) {
        if (a.id !== o.id && a.professionalId === o.professionalId) {
          expect(a.startsAt.getTime() < o.endsAt.getTime() && o.startsAt.getTime() < a.endsAt.getTime()).toBe(false)
        }
      }
    }
  }
})

test('cancelar e concluir em paralelo sobre um agendamento confirmado e já iniciado: um vence e o outro recebe invalid_transition', async () => {
  for (let n = 0; n < 10; n++) {
    const s = await montar()
    const profissional = s.profs[0]
    if (!profissional) throw new Error('sem profissional')
    const c = await makeCustomer(s.b.id)
    const ag = await makeAppointment(s.b.id, { customerId: c.id, professionalId: profissional.id, serviceId: s.tosa.id, startsAt: hora(10) })
    const depois = hora(11)
    const a = await makeCtx(s.b, { now: depois })
    const b = await makeCtx(s.b, { now: depois })
    const rs = await Promise.allSettled([cancelAppointment(a, ag.id), completeAppointment(b, ag.id)])
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(motivos(rs)).toEqual(['invalid_transition'])
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: ag.id } })
    expect(['CANCELED', 'COMPLETED']).toContain(row.status)
    expect(row.status === 'COMPLETED').toBe(row.completedAt !== null)
    expect(row.status === 'CANCELED').toBe(row.canceledAt !== null)
  }
})
