import { beforeEach, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { DomainError } from '@/server/domain/errors'
import { bookAppointment, cancelAppointment } from '@/server/domain/scheduling/appointments'
import { confirmando } from '../setup/agenda'
import { resetDb } from '../setup/db'
import { invariantesDoEncaixe } from '../setup/encaixe'
import { domainError } from '../setup/expect'
import { makeBusiness, makeCtx, makeCustomer, makePet, makeProfessional, makeService, makeWorkingHours } from '../setup/factories'

beforeEach(resetDb)

/** Segunda-feira, 08:00 em São Paulo; expediente 09:00–18:00. */
const AGORA = new Date('2026-11-16T11:00:00Z')
const hora = (h: number, m = 0): Date => new Date(Date.UTC(2026, 10, 16, h + 3, m))

async function cena() {
  const b = await makeBusiness({ niche: 'PET' })
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30 } })
  const tosa = await makeService(b.id, { name: 'Tosa', durationMin: 30, priceCents: 4000 })
  const ana = await makeProfessional(b.id, { name: 'Ana', serviceIds: [tosa.id] })
  await makeWorkingHours(b.id, ana.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
  const cliente = await makeCustomer(b.id, { name: 'Marina' })
  const pet = await makePet(b.id, cliente.id, { name: 'Rex' })
  const marcar = async (ctx: Awaited<ReturnType<typeof makeCtx>>, o: { start: Date; durationMin?: number; ack?: string }) =>
    bookAppointment(ctx, {
      customerId: cliente.id,
      petId: pet.id,
      professionalId: ana.id,
      serviceIds: [tosa.id],
      startsAt: o.start,
      durationMin: o.durationMin ?? 30,
      ...(o.ack !== undefined ? { acknowledged: o.ack } : {}),
    })
  return { b, tosa, ana, cliente, pet, marcar }
}

test('duas marcações da equipe no mesmo horário livre, ao mesmo tempo, sem confirmação: 1 normal gravado e a outra needs_confirmation', async () => {
  for (let n = 0; n < 5; n++) {
    const s = await cena()
    const [x, y] = await Promise.all([makeCtx(s.b, { now: AGORA }), makeCtx(s.b, { now: AGORA })])
    const rs = await Promise.allSettled([s.marcar(x, { start: hora(10) }), s.marcar(y, { start: hora(10) })])
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const perdeu = rs.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(perdeu?.reason).toBeInstanceOf(DomainError)
    expect((perdeu?.reason as DomainError).reason).toBe('needs_confirmation')
    const linhas = await prisma.appointment.findMany({ where: { businessId: s.b.id } })
    expect(linhas.map((l) => l.isSqueezeIn)).toEqual([false])
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  }
})

test('banco: dois normais sobrepostos por insert direto → 23P01 appointments_no_overlap; normal + encaixe passa', async () => {
  const s = await cena()
  const base = {
    businessId: s.b.id,
    customerId: s.cliente.id,
    professionalId: s.ana.id,
    status: 'CONFIRMED' as const,
    source: 'PANEL' as const,
    totalCents: 0,
    totalDurationMin: 60,
    createdByType: 'SYSTEM' as const,
  }
  await prisma.appointment.create({ data: { ...base, startsAt: hora(10), endsAt: hora(11) } })
  const erro: unknown = await prisma.appointment.create({ data: { ...base, startsAt: hora(10, 30), endsAt: hora(11, 30) } }).catch((e: unknown) => e)
  expect(erro).toBeInstanceOf(Error)
  expect(JSON.stringify(erro, Object.getOwnPropertyNames(erro))).toContain('23P01')
  await prisma.appointment.create({ data: { ...base, startsAt: hora(10, 30), endsAt: hora(11, 30), isSqueezeIn: true } })
  expect(await prisma.appointment.count({ where: { businessId: s.b.id } })).toBe(2)
})

test('10 encaixes confirmados em paralelo sobre o mesmo normal: todos gravam como encaixe e as invariantes valem', async () => {
  const s = await cena()
  const dono = await makeCtx(s.b, { now: AGORA })
  await s.marcar(dono, { start: hora(10), durationMin: 300 })
  const inicios = Array.from({ length: 10 }, (_, i) => hora(10 + Math.floor(i / 2), (i % 2) * 30))
  const ctxs = await Promise.all(inicios.map(() => makeCtx(s.b, { now: AGORA })))
  const acks = await Promise.all(
    inicios.map(async (start) => {
      const e = await domainError(s.marcar(dono, { start }))
      return e.details?.['acknowledgement'] as string
    }),
  )
  const rs = await Promise.allSettled(inicios.map((start, i) => s.marcar(ctxs[i] ?? dono, { start, ack: acks[i] ?? '' })))
  expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(10)
  const encaixes = await prisma.appointment.count({ where: { businessId: s.b.id, isSqueezeIn: true } })
  expect(encaixes).toBe(10)
  expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
})

test('cancelar o normal e confirmar um encaixe em paralelo: as invariantes valem em qualquer ordem (5 vezes)', async () => {
  for (let n = 0; n < 5; n++) {
    const s = await cena()
    const dono = await makeCtx(s.b, { now: AGORA })
    const normal = await s.marcar(dono, { start: hora(10), durationMin: 60 })
    await confirmando((ack) => s.marcar(dono, { start: hora(10, 15), ...(ack ? { ack } : {}) }))
    const pedido = await domainError(s.marcar(dono, { start: hora(10, 30), durationMin: 60 }))
    const ack = pedido.details?.['acknowledgement'] as string
    const [a, b] = await Promise.all([makeCtx(s.b, { now: AGORA }), makeCtx(s.b, { now: AGORA })])
    const rs = await Promise.allSettled([cancelAppointment(a, normal.id), s.marcar(b, { start: hora(10, 30), durationMin: 60, ack })])
    expect(rs[0].status).toBe('fulfilled')
    if (rs[1].status === 'rejected') expect((rs[1].reason as DomainError).reason).toBe('needs_confirmation')
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  }
})
