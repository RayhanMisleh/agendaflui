import { prisma } from '@/server/db/client'
import { appointmentIcs } from '@/server/domain/scheduling/ics'
import { rescheduleAppointment } from '@/server/domain/scheduling/appointments'
import { getAvailability, listAvailableDays } from '@/server/domain/scheduling/availability'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeAppointment, makeBusiness, makeCtx, makeCustomer, makePet, makeProfessional, makeService, makeServicePrice, makeWorkingHours } from '../setup/factories'

beforeEach(resetDb)

/** Segunda-feira, 08:00 em São Paulo. */
const SEGUNDA_08H = new Date('2026-11-16T11:00:00Z')
const sp = (dia: number, h: number, min = 0): Date => new Date(Date.UTC(2026, 10, dia, h + 3, min))
const QUARTA = '2026-11-18'

async function montar(now: Date = SEGUNDA_08H) {
  const b = await makeBusiness()
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30, customerChangeWindowMin: 120 } })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60 })
  const ana = await makeProfessional(b.id, { name: 'Ana', serviceIds: [banho.id] })
  await makeWorkingHours(b.id, ana.id, 'WEDNESDAY', [{ startMin: 540, endMin: 1020 }])
  const marina = await makeCustomer(b.id, { name: 'Marina' })
  const joao = await makeCustomer(b.id, { name: 'João' })
  const thor = await makeAppointment(b.id, { customerId: marina.id, professionalId: ana.id, serviceId: banho.id, startsAt: sp(18, 14) })
  const dele = await makeAppointment(b.id, { customerId: joao.id, professionalId: ana.id, serviceId: banho.id, startsAt: sp(18, 11) })
  const ctxMarina = await makeCtx(b, { actor: { kind: 'customer', customerId: marina.id, name: marina.name }, now })
  const ctxJoao = await makeCtx(b, { actor: { kind: 'customer', customerId: joao.id, name: joao.name }, now })
  return { b, banho, ana, marina, joao, thor, dele, ctxMarina, ctxJoao }
}

const horas = (slots: { label: string }[]): string[] => slots.map((s) => s.label)

describe('remarcar com os horários livres', () => {
  test('remarcar 30 min para frente: 14:30 aparece e rescheduleAppointment grava', async () => {
    const s = await montar()
    const comum = await getAvailability(s.ctxMarina, { date: QUARTA, serviceIds: [s.banho.id] })
    expect(horas(comum.slots)).not.toContain('14:30')
    const livre = await getAvailability(s.ctxMarina, { date: QUARTA, rescheduling: s.thor.id })
    expect(horas(livre.slots)).toContain('14:30')
    expect(horas(livre.slots)).toContain('14:00')
    const novo = livre.slots.find((x) => x.label === '14:30')
    expect(novo).toBeDefined()
    const r = await rescheduleAppointment(s.ctxMarina, s.thor.id, { startsAt: novo?.startsAt ?? new Date(0) })
    expect(r.local.start).toBe('14:30')
  })

  test('o horário de outro cliente continua ocupado na lista de remarcar', async () => {
    const s = await montar()
    const livre = await getAvailability(s.ctxMarina, { date: QUARTA, rescheduling: s.thor.id })
    // O de João vai das 11:00 às 12:00: nenhum início de 60 min cobre esse intervalo.
    for (const h of ['10:30', '11:00', '11:30']) expect(horas(livre.slots)).not.toContain(h)
    expect(horas(livre.slots)).toContain('12:00')
  })

  test('rescheduling de agendamento de outro cliente → not_found', async () => {
    const s = await montar()
    expect((await domainError(getAvailability(s.ctxMarina, { date: QUARTA, rescheduling: s.dele.id }))).code).toBe('not_found')
    expect((await domainError(listAvailableDays(s.ctxMarina, { from: QUARTA, to: QUARTA, rescheduling: s.dele.id }))).code).toBe('not_found')
    expect((await domainError(getAvailability(s.ctxMarina, { date: QUARTA, rescheduling: 'nao-e-id' }))).code).toBe('not_found')
  })

  test('rescheduling fora do prazo → recusa de prazo', async () => {
    const s = await montar(sp(18, 13, 30))
    const e = await domainError(getAvailability(s.ctxMarina, { date: QUARTA, rescheduling: s.thor.id }))
    expect(e).toMatchObject({ code: 'conflict', reason: 'too_late' })
    expect((await domainError(listAvailableDays(s.ctxMarina, { from: QUARTA, to: QUARTA, rescheduling: s.thor.id }))).reason).toBe('too_late')
  })

  test('rescheduling de agendamento cancelado → recusa', async () => {
    const s = await montar()
    await prisma.appointment.update({ where: { id: s.thor.id }, data: { status: 'CANCELED' } })
    expect((await domainError(getAvailability(s.ctxMarina, { date: QUARTA, rescheduling: s.thor.id }))).reason).toBe('invalid_transition')
  })

  test('listAvailableDays com rescheduling marca o dia do próprio horário como disponível', async () => {
    const s = await montar()
    // Quarta com um expediente de uma hora só e o horário da própria cliente: ocupada para quem não está remarcando.
    await prisma.workingHours.deleteMany({ where: { professionalId: s.ana.id } })
    await makeWorkingHours(s.b.id, s.ana.id, 'WEDNESDAY', [{ startMin: 14 * 60, endMin: 15 * 60 }])
    await prisma.appointment.delete({ where: { id: s.dele.id } })
    const sem = await listAvailableDays(s.ctxMarina, { from: QUARTA, to: QUARTA, serviceIds: [s.banho.id] })
    expect(sem).toEqual([{ date: QUARTA, weekday: 'WEDNESDAY', available: false }])
    const com = await listAvailableDays(s.ctxMarina, { from: QUARTA, to: QUARTA, rescheduling: s.thor.id })
    expect(com).toEqual([{ date: QUARTA, weekday: 'WEDNESDAY', available: true }])
  })

  test('sem rescheduling o próprio horário ocupa (comportamento antigo)', async () => {
    const s = await montar()
    const r = await getAvailability(s.ctxMarina, { date: QUARTA, serviceIds: [s.banho.id] })
    for (const h of ['13:30', '14:00', '14:30']) expect(horas(r.slots)).not.toContain(h)
  })

  test('visitante sem login não usa rescheduling', async () => {
    const s = await montar()
    const guest = await makeCtx(s.b, { actor: { kind: 'guest' }, now: SEGUNDA_08H })
    expect((await domainError(getAvailability(guest, { date: QUARTA, rescheduling: s.thor.id }))).code).toBe('forbidden')
  })

  test('a equipe remarca qualquer agendamento do escopo e vê os mesmos horários', async () => {
    const s = await montar()
    const dono = await makeCtx(s.b, { now: SEGUNDA_08H })
    const livre = await getAvailability(dono, { date: QUARTA, rescheduling: s.thor.id })
    expect(horas(livre.slots)).toContain('14:30')
  })
})

describe('arquivo de agenda do agendamento', () => {
  test('só o do próprio cliente; outro cliente → not_found', async () => {
    const s = await montar()
    const i = { storeName: 'Focinho Feliz', address: 'Rua das Flores, 10', url: 'https://app.exemplo.test/loja/horarios' }
    const f = await appointmentIcs(s.ctxMarina, s.thor.id, i)
    expect(f.filename).toBe('horario-2026-11-18.ics')
    expect(f.body).toContain('SUMMARY:Banho em Focinho Feliz\r\n')
    expect(f.body).toContain('DTSTART:20261118T170000Z\r\n')
    expect(f.body.replace(/\r\n /g, '')).toContain('DESCRIPTION:Com Ana.\\nPara mudar\\, abra https://app.exemplo.test/loja/horarios.\r\n')
    expect((await appointmentIcs(s.ctxMarina, s.thor.id, { ...i, petName: 'Thor' })).body).toContain('SUMMARY:Banho para Thor em Focinho Feliz')
    expect((await domainError(appointmentIcs(s.ctxMarina, s.dele.id, i))).code).toBe('not_found')
  })
})

describe('remarcar em loja de pet shop', () => {
  test('sem petId, a duração vem do porte do pet do agendamento; o .ics leva o nome do pet', async () => {
    const s = await montar()
    await prisma.business.update({ where: { id: s.b.id }, data: { niche: 'PET' } })
    await makeServicePrice(s.b.id, s.banho.id, 'DOG_LARGE', { priceCents: 9000, durationMin: 90 })
    const rex = await makePet(s.b.id, s.marina.id, { name: 'Rex', species: 'DOG', size: 'LARGE' })
    await prisma.appointment.update({ where: { id: s.thor.id }, data: { petId: rex.id } })
    const livre = await getAvailability(s.ctxMarina, { date: QUARTA, rescheduling: s.thor.id })
    expect(livre).toMatchObject({ durationMin: 90, totalCents: 9000 })
    const dias = await listAvailableDays(s.ctxMarina, { from: QUARTA, to: QUARTA, rescheduling: s.thor.id })
    expect(dias.length).toBe(1)
    const i = { storeName: 'Focinho Feliz', address: null, url: 'https://app.exemplo.test/loja/horarios' }
    expect((await appointmentIcs(s.ctxMarina, s.thor.id, i)).body).toContain('SUMMARY:Banho para Rex em Focinho Feliz')
  })
})
