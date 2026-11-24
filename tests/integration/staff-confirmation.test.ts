import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import type { DomainError } from '@/server/domain/errors'
import { adjustAppointment, bookAppointment, rescheduleAppointment } from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { confirmando } from '../setup/agenda'
import { domainError } from '../setup/expect'
import {
  makeAppointment,
  makeBusiness,
  makeCtx,
  makeCustomer,
  makePet,
  makeProfessional,
  makeService,
  makeServicePrice,
  makeWorkingHours,
} from '../setup/factories'

beforeEach(resetDb)

/** Segunda-feira, 08:00 em São Paulo. */
const AGORA = new Date('2026-11-16T11:00:00Z')
const hora = (h: number, m = 0): Date => new Date(Date.UTC(2026, 10, 16, h + 3, m))

type Issue = { kind: string; key: string; text: string }
const issuesDe = (e: DomainError) => e.details?.['issues'] as Issue[]
const ackDe = (e: DomainError) => e.details?.['acknowledgement'] as string

async function cena() {
  const b = await makeBusiness({ niche: 'PET' })
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30 } })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60, priceCents: 5000 })
  const tosa = await makeService(b.id, { name: 'Tosa', durationMin: 30, priceCents: 4000 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [banho.id, tosa.id] })
  const bia = await makeProfessional(b.id, { name: 'Bia', displayOrder: 2, serviceIds: [banho.id, tosa.id] })
  for (const p of [ana, bia]) await makeWorkingHours(b.id, p.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
  const dono = await makeCtx(b, { now: AGORA })
  const marina = await makeCustomer(b.id, { name: 'Marina' })
  const rex = await makePet(b.id, marina.id, { name: 'Rex', size: 'MEDIUM' })
  const paulo = await makeCustomer(b.id, { name: 'Paulo' })
  const mel = await makePet(b.id, paulo.id, { name: 'Mel', size: 'SMALL' })
  const doRex = await makeAppointment(b.id, { customerId: marina.id, professionalId: ana.id, serviceId: banho.id, startsAt: hora(14), petId: rex.id })
  const marca = (o: { ack?: string; start?: Date; prof?: string | null; services?: string[]; durationMin?: number }) =>
    bookAppointment(dono, {
      customerId: paulo.id,
      petId: mel.id,
      professionalId: o.prof === undefined ? ana.id : o.prof,
      serviceIds: o.services ?? [tosa.id],
      startsAt: o.start ?? hora(14, 30),
      ...(o.durationMin !== undefined ? { durationMin: o.durationMin } : {}),
      ...(o.ack !== undefined ? { acknowledged: o.ack } : {}),
    })
  return { b, banho, tosa, ana, bia, dono, marina, rex, paulo, mel, doRex, marca }
}

describe('confirmação de conflitos da equipe', () => {
  test('equipe marca em cima de Rex: needs_confirmation com a linha de Rex e nada gravado; com a impressão, grava', async () => {
    const s = await cena()
    const e = await domainError(s.marca({}))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('needs_confirmation')
    expect(issuesDe(e).map((i) => i.text)).toEqual(['14:00–15:00 já tem Rex (Banho)'])
    expect(await prisma.appointment.count({ where: { businessId: s.b.id } })).toBe(1)
    const v = await s.marca({ ack: ackDe(e) })
    expect(v.local.start).toBe('14:30')
    expect(await prisma.appointment.count({ where: { businessId: s.b.id } })).toBe(2)
  })

  test('fora do expediente, dia fechado e bloqueio têm o texto da spec', async () => {
    const s = await cena()
    const fora = await domainError(s.marca({ start: hora(7) }))
    expect(issuesDe(fora).map((i) => i.text)).toEqual(['Fora do expediente de Ana'])
    await prisma.businessClosure.create({
      data: { businessId: s.b.id, startDate: new Date('2026-11-16T00:00:00Z'), endDate: new Date('2026-11-16T00:00:00Z') },
    })
    const fechado = await domainError(s.marca({ start: hora(10) }))
    expect(issuesDe(fechado).map((i) => i.text)).toEqual(['Loja fechada neste dia'])
    await prisma.timeBlock.create({
      data: { businessId: s.b.id, professionalId: s.ana.id, startsAt: hora(12), endsAt: hora(13), reason: 'Almoço', createdByType: 'SYSTEM' },
    })
    const bloqueado = await domainError(s.marca({ start: hora(12) }))
    expect(issuesDe(bloqueado).map((i) => i.text)).toEqual(['Loja fechada neste dia', 'Agenda de Ana bloqueada das 12:00 às 13:00 (Almoço)'])
  })

  test('vários conflitos vêm na ordem closed, outside_hours, blocked, busy', async () => {
    const s = await cena()
    await prisma.businessClosure.create({
      data: { businessId: s.b.id, startDate: new Date('2026-11-16T00:00:00Z'), endDate: new Date('2026-11-16T00:00:00Z') },
    })
    await prisma.timeBlock.create({
      data: { businessId: s.b.id, professionalId: s.ana.id, startsAt: hora(17, 30), endsAt: hora(18, 30), createdByType: 'SYSTEM' },
    })
    await makeAppointment(s.b.id, { customerId: s.marina.id, professionalId: s.ana.id, serviceId: s.tosa.id, startsAt: hora(17, 30), petId: s.rex.id })
    const e = await domainError(s.marca({ start: hora(17, 30), durationMin: 60 }))
    expect(issuesDe(e).map((i) => i.kind)).toEqual(['closed', 'outside_hours', 'blocked', 'busy'])
  })

  test('impressão vencida: outro agendamento entra no mesmo horário depois do pedido → needs_confirmation de novo com 2 issues busy', async () => {
    const s = await cena()
    const primeira = await domainError(s.marca({}))
    await makeAppointment(s.b.id, { customerId: s.marina.id, professionalId: s.ana.id, serviceId: s.tosa.id, startsAt: hora(14, 30), petId: s.rex.id, isSqueezeIn: true })
    const segunda = await domainError(s.marca({ ack: ackDe(primeira) }))
    expect(segunda.reason).toBe('needs_confirmation')
    expect(issuesDe(segunda).map((i) => i.kind)).toEqual(['busy', 'busy'])
    expect(ackDe(segunda)).not.toBe(ackDe(primeira))
    expect(await prisma.appointment.count({ where: { businessId: s.b.id } })).toBe(2)
  })

  test('a impressão não serve para outro horário nem para outro profissional', async () => {
    const s = await cena()
    const e = await domainError(s.marca({}))
    expect((await domainError(s.marca({ ack: ackDe(e), start: hora(14, 15) }))).reason).toBe('needs_confirmation')
    await makeAppointment(s.b.id, { customerId: s.marina.id, professionalId: s.bia.id, serviceId: s.banho.id, startsAt: hora(14), petId: s.rex.id })
    expect((await domainError(s.marca({ ack: ackDe(e), prof: s.bia.id }))).reason).toBe('needs_confirmation')
  })

  test('equipe marca às 14:07 (fora da grade) sem conflito: grava sem pedir nada', async () => {
    const s = await cena()
    const v = await s.marca({ start: hora(15, 7) })
    expect(v.local.start).toBe('15:07')
  })

  test('equipe escolhe duração 47 min; 4 e 721 dão validation fields.durationMin', async () => {
    const s = await cena()
    const v = await s.marca({ start: hora(10), durationMin: 47 })
    expect(v.totalDurationMin).toBe(47)
    expect(v.endsAt.getTime() - v.startsAt.getTime()).toBe(47 * 60_000)
    for (const durationMin of [4, 721]) {
      const e = await domainError(s.marca({ start: hora(11), durationMin }))
      expect(e.code).toBe('validation')
      expect(e.fields?.['durationMin']).toBe('Use de 5 a 720 minutos.')
    }
  })

  test('cliente com durationMin → forbidden; cliente nunca recebe needs_confirmation', async () => {
    const s = await cena()
    const doCliente = await makeCtx(s.b, { actor: { kind: 'customer', customerId: s.paulo.id, name: s.paulo.name }, now: AGORA })
    const e = await domainError(
      bookAppointment(doCliente, { petId: s.mel.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: hora(10), durationMin: 30 }),
    )
    expect(e.code).toBe('forbidden')
    const ocupado = await domainError(bookAppointment(doCliente, { petId: s.mel.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: hora(14, 30) }))
    expect(['slot_taken', 'slot_unavailable']).toContain(ocupado.reason)
  })

  test('remarcar com durationMin 200 que invade bloqueio pede confirmação; confirmado grava', async () => {
    const s = await cena()
    const v = await s.marca({ start: hora(10) })
    await prisma.timeBlock.create({
      data: { businessId: s.b.id, professionalId: s.ana.id, startsAt: hora(12), endsAt: hora(13), createdByType: 'SYSTEM' },
    })
    const e = await domainError(rescheduleAppointment(s.dono, v.id, { startsAt: hora(10), durationMin: 200 }))
    expect(e.reason).toBe('needs_confirmation')
    const r = await rescheduleAppointment(s.dono, v.id, { startsAt: hora(10), durationMin: 200, acknowledged: ackDe(e) })
    expect(r.totalDurationMin).toBe(200)
    expect(r.local.end).toBe('13:20')
  })

  test('ajustar só a duração: encurtar grava direto; alongar sobre outro pede confirmação', async () => {
    const s = await cena()
    const v = await s.marca({ start: hora(12), durationMin: 120 })
    const curto = await adjustAppointment(s.dono, v.id, { durationMin: 60 })
    expect(curto.local.end).toBe('13:00')
    const e = await domainError(adjustAppointment(s.dono, v.id, { durationMin: 150 }))
    expect(e.reason).toBe('needs_confirmation')
    expect(issuesDe(e).map((i) => i.text)).toEqual(['14:00–15:00 já tem Rex (Banho)'])
    const longo = await adjustAppointment(s.dono, v.id, { durationMin: 150, acknowledged: ackDe(e) })
    expect(longo.local.end).toBe('14:30')
  })

  test('ajustar trocando o pet de médio para grande refaz itens e total pelo porte novo', async () => {
    const s = await cena()
    await makeServicePrice(s.b.id, s.banho.id, 'DOG_MEDIUM', { priceCents: 7000, durationMin: 60 })
    await makeServicePrice(s.b.id, s.banho.id, 'DOG_LARGE', { priceCents: 9000, durationMin: 90 })
    const grande = await makePet(s.b.id, s.paulo.id, { name: 'Zeus', size: 'LARGE' })
    const medio = await makePet(s.b.id, s.paulo.id, { name: 'Max', size: 'MEDIUM' })
    const v = await bookAppointment(s.dono, { customerId: s.paulo.id, petId: medio.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(10) })
    expect(v.totalCents).toBe(7000)
    const r = await adjustAppointment(s.dono, v.id, { petId: grande.id })
    expect(r.totalCents).toBe(9000)
    expect(r.totalDurationMin).toBe(90)
    expect(r.items[0]).toMatchObject({ priceCents: 9000, variant: 'DOG_LARGE' })
    expect(r.pet?.name).toBe('Zeus')
  })

  test('qualquer um: Ana ocupada e Bia livre grava com Bia; as duas ocupadas pede com o profissional de menos conflitos', async () => {
    const s = await cena()
    const v = await s.marca({ prof: null })
    expect(v.professional.name).toBe('Bia')
    const e = await domainError(s.marca({ prof: null, start: hora(14, 30) }))
    expect(e.reason).toBe('needs_confirmation')
    expect(['Ana', 'Bia']).toContain(e.details?.['professionalName'])
    const ok = await confirmando((ack) => s.marca({ prof: null, start: hora(14, 30), ...(ack ? { ack } : {}) }))
    expect(ok.local.start).toBe('14:30')
  })
})
