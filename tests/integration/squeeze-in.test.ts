import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import {
  adjustAppointment,
  bookAppointment,
  cancelAppointment,
  completeAppointment,
  getAppointment,
  markNoShow,
  rescheduleAppointment,
  undoOutcome,
} from '@/server/domain/scheduling/appointments'
import { getAvailability } from '@/server/domain/scheduling/availability'
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
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [tosa.id] })
  const bia = await makeProfessional(b.id, { name: 'Bia', displayOrder: 2, serviceIds: [tosa.id] })
  for (const p of [ana, bia]) await makeWorkingHours(b.id, p.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
  const dono = await makeCtx(b, { now: AGORA })
  const tarde = await makeCtx(b, { now: hora(12) })
  const cliente = await makeCustomer(b.id, { name: 'Marina' })
  const pet = await makePet(b.id, cliente.id, { name: 'Rex', size: 'MEDIUM' })
  const doCliente = await makeCtx(b, { actor: { kind: 'customer', customerId: cliente.id, name: cliente.name }, now: AGORA })
  const marcar = (o: { start: Date; durationMin?: number; prof?: string }) =>
    confirmando((acknowledged) =>
      bookAppointment(dono, {
        customerId: cliente.id,
        petId: pet.id,
        professionalId: o.prof ?? ana.id,
        serviceIds: [tosa.id],
        startsAt: o.start,
        durationMin: o.durationMin ?? 30,
        acknowledged,
      }),
    )
  const marca = async (id: string) => (await prisma.appointment.findUniqueOrThrow({ where: { id } })).isSqueezeIn
  return { b, tosa, ana, bia, dono, tarde, cliente, pet, doCliente, marcar, marca }
}

describe('marcar encaixe', () => {
  test('equipe confirma em cima de um normal → grava isSqueezeIn true', async () => {
    const s = await cena()
    const n = await s.marcar({ start: hora(10), durationMin: 60 })
    expect((await getAppointment(s.dono, n.id)).isSqueezeIn).toBe(false)
    const e = await s.marcar({ start: hora(10, 15) })
    expect(await s.marca(e.id)).toBe(true)
    expect((await getAppointment(s.dono, e.id)).isSqueezeIn).toBe(true)
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  })

  test('sobrepõe só um encaixe → fica normal (mas pediu confirmação)', async () => {
    const s = await cena()
    await s.marcar({ start: hora(10), durationMin: 60 })
    const enc = await s.marcar({ start: hora(10, 15), durationMin: 105 })
    expect(await s.marca(enc.id)).toBe(true)
    const x = await s.marcar({ start: hora(11, 30) })
    expect(await s.marca(x.id)).toBe(false)
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  })

  test('fora do expediente sem sobreposição → normal', async () => {
    const s = await cena()
    const v = await s.marcar({ start: hora(7) })
    expect(await s.marca(v.id)).toBe(false)
  })
})

describe('promoção', () => {
  test('promove em ordem de início contando os já promovidos', async () => {
    const s = await cena()
    const n = await s.marcar({ start: hora(10), durationMin: 90 })
    const a = await s.marcar({ start: hora(10), durationMin: 60 })
    const b = await s.marcar({ start: hora(10, 30), durationMin: 60 })
    expect([await s.marca(a.id), await s.marca(b.id)]).toEqual([true, true])
    await cancelAppointment(s.dono, n.id)
    expect(await s.marca(a.id)).toBe(false)
    expect(await s.marca(b.id)).toBe(true)
    const logs = await prisma.auditLog.findMany({ where: { businessId: s.b.id, action: 'appointment.squeeze_in_promoted' } })
    expect(logs.map((l) => l.targetId)).toEqual([a.id])
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  })

  test('faltou no normal promove o encaixe; concluir não promove', async () => {
    const s = await cena()
    const n = await s.marcar({ start: hora(10), durationMin: 60 })
    const e = await s.marcar({ start: hora(10, 15) })
    await completeAppointment(s.tarde, n.id)
    expect(await s.marca(e.id)).toBe(true)
    const m = await s.marcar({ start: hora(14), durationMin: 60 })
    const f = await s.marcar({ start: hora(14, 15) })
    await markNoShow(await makeCtx(s.b, { now: hora(15) }), m.id)
    expect(await s.marca(f.id)).toBe(false)
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  })

  test('remarcar o normal para outro horário promove o encaixe que ficou; para outro profissional também', async () => {
    const s = await cena()
    const n = await s.marcar({ start: hora(10), durationMin: 60 })
    const e = await s.marcar({ start: hora(10, 15) })
    await rescheduleAppointment(s.dono, n.id, { startsAt: hora(15) })
    expect(await s.marca(e.id)).toBe(false)
    const m = await s.marcar({ start: hora(12), durationMin: 60 })
    const f = await s.marcar({ start: hora(12, 15) })
    await rescheduleAppointment(s.dono, m.id, { startsAt: hora(12), professionalId: s.bia.id })
    expect(await s.marca(f.id)).toBe(false)
    expect(await s.marca(m.id)).toBe(false)
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  })

  test('remarcar o encaixe para horário livre: vira normal; o normal que ficou não muda', async () => {
    const s = await cena()
    const n = await s.marcar({ start: hora(10), durationMin: 60 })
    const e = await s.marcar({ start: hora(10, 15) })
    await rescheduleAppointment(s.dono, e.id, { startsAt: hora(16) })
    expect(await s.marca(e.id)).toBe(false)
    expect(await s.marca(n.id)).toBe(false)
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  })

  test('encurtar o normal (ajuste de duração) promove o encaixe que deixou de sobrepor', async () => {
    const s = await cena()
    const n = await s.marcar({ start: hora(10), durationMin: 120 })
    const e = await s.marcar({ start: hora(11, 15) })
    expect(await s.marca(e.id)).toBe(true)
    await adjustAppointment(s.dono, n.id, { durationMin: 60 })
    expect(await s.marca(e.id)).toBe(false)
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  })

  test('alongar o normal sobre outro normal: pede confirmação e vira encaixe; o encaixe do intervalo antigo é reavaliado', async () => {
    const s = await cena()
    const n = await s.marcar({ start: hora(10), durationMin: 60 })
    const m = await s.marcar({ start: hora(11), durationMin: 60 })
    const e = await s.marcar({ start: hora(10, 15) })
    expect(await s.marca(e.id)).toBe(true)
    const pedido = await domainError(adjustAppointment(s.dono, n.id, { durationMin: 120 }))
    expect(pedido.reason).toBe('needs_confirmation')
    await adjustAppointment(s.dono, n.id, { durationMin: 120, acknowledged: pedido.details?.['acknowledgement'] as string })
    expect(await s.marca(n.id)).toBe(true)
    expect(await s.marca(e.id)).toBe(false)
    expect(await s.marca(m.id)).toBe(false)
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  })

  test('cliente cancela o próprio normal: o encaixe de outro cliente é promovido', async () => {
    const s = await cena()
    const n = await bookAppointment(s.doCliente, { petId: s.pet.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: hora(14) })
    const e = await s.marcar({ start: hora(14, 15) })
    expect(await s.marca(e.id)).toBe(true)
    await cancelAppointment(s.doCliente, n.id)
    expect(await s.marca(e.id)).toBe(false)
  })
})

describe('desfazer', () => {
  test('desfazer falta: N faltou, S promovido; desfazer N pede confirmação e, confirmado, N vira encaixe', async () => {
    const s = await cena()
    const n = await s.marcar({ start: hora(10), durationMin: 60 })
    const e = await s.marcar({ start: hora(10, 15) })
    await markNoShow(s.tarde, n.id)
    expect(await s.marca(e.id)).toBe(false)
    const pedido = await domainError(undoOutcome(s.tarde, n.id))
    expect(pedido.reason).toBe('needs_confirmation')
    expect((pedido.details?.['issues'] as { kind: string }[]).map((i) => i.kind)).toEqual(['busy'])
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('NO_SHOW')
    const v = await undoOutcome(s.tarde, n.id, { acknowledged: pedido.details?.['acknowledgement'] as string })
    expect(v.status).toBe('CONFIRMED')
    expect(await s.marca(n.id)).toBe(true)
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  })

  test('desfazer concluído nunca pede confirmação', async () => {
    const s = await cena()
    const n = await s.marcar({ start: hora(10), durationMin: 60 })
    const e = await s.marcar({ start: hora(10, 15) })
    await completeAppointment(s.tarde, n.id)
    const v = await undoOutcome(s.tarde, n.id)
    expect(v.status).toBe('CONFIRMED')
    expect(await s.marca(n.id)).toBe(false)
    expect(await s.marca(e.id)).toBe(true)
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  })

  test('desfazer falta sem ninguém no horário: volta normal sem pedir nada', async () => {
    const s = await cena()
    const n = await s.marcar({ start: hora(10), durationMin: 60 })
    await markNoShow(s.tarde, n.id)
    expect((await undoOutcome(s.tarde, n.id)).status).toBe('CONFIRMED')
    expect(await s.marca(n.id)).toBe(false)
  })
})

describe('o cliente não vê o encaixe', () => {
  test('horário ocupado só por encaixe não aparece em getAvailability; a visão do cliente não tem a chave isSqueezeIn', async () => {
    const s = await cena()
    await s.marcar({ start: hora(10), durationMin: 60 })
    const e = await s.marcar({ start: hora(10, 30), durationMin: 90 })
    expect(await s.marca(e.id)).toBe(true)
    const r = await getAvailability(s.doCliente, { date: '2026-11-16', serviceIds: [s.tosa.id], petId: s.pet.id, professionalId: s.ana.id })
    const labels = r.slots.map((x) => x.label)
    expect(labels).not.toContain('11:00')
    expect(labels).not.toContain('11:30')
    expect(labels).toContain('12:00')
    const meu = await bookAppointment(s.doCliente, { petId: s.pet.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: hora(16) })
    expect('isSqueezeIn' in meu).toBe(false)
    expect('isSqueezeIn' in (await getAppointment(s.doCliente, meu.id))).toBe(false)
  })

  test('cliente remarca o próprio encaixe para horário livre: vira normal', async () => {
    const s = await cena()
    await s.marcar({ start: hora(15), durationMin: 60 })
    const meu = await prisma.appointment.findUniqueOrThrow({ where: { id: (await s.marcar({ start: hora(15, 15) })).id } })
    await prisma.appointment.update({ where: { id: meu.id }, data: { customerId: s.cliente.id } })
    await rescheduleAppointment(s.doCliente, meu.id, { startsAt: hora(11) })
    expect(await s.marca(meu.id)).toBe(false)
    expect(await invariantesDoEncaixe(s.b.id)).toEqual([])
  })

  test('cliente não consegue marcar no horário de um encaixe (slot_taken)', async () => {
    const s = await cena()
    await s.marcar({ start: hora(10), durationMin: 30 })
    await s.marcar({ start: hora(10, 15), durationMin: 75 })
    const e = await domainError(
      bookAppointment(s.doCliente, { petId: s.pet.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: hora(11) }),
    )
    expect(e.reason).toBe('slot_taken')
  })
})
