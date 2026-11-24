import { beforeEach, describe, expect, test } from 'vitest'
import { alterarVinculo } from '@/server/domain/platform/access-core'
import { enqueueCalendarForProfessionalsRaw } from '@/server/calendar/backfill'
import { updatePersonProfile } from '@/server/auth/person-account'
import { prisma } from '@/server/db/client'
import { anonymizeCustomer, updateCustomer } from '@/server/domain/customers/customers'
import {
  adjustAppointment,
  bookAppointment,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  markNoShow,
  rescheduleAppointment,
  undoOutcome,
} from '@/server/domain/scheduling/appointments'
import { updatePet } from '@/server/domain/pets/pets'
import { updateProfessional } from '@/server/domain/team/professionals'
import { fakeGoogleAuthority } from '@/server/integrations/fakes'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeBusiness,
  makeCtx,
  makeCustomer,
  makeMembership,
  makePet,
  makeProfessional,
  makeService,
  makeUser,
  makeWorkingHours,
} from '../setup/factories'

beforeEach(async () => {
  await resetDb()
  fakeGoogleAuthority().reset()
})

const MANHA = { startMin: 540, endMin: 720 }
const TARDE = { startMin: 780, endMin: 1080 }
/** Segunda-feira, 08:00 em São Paulo. */
const SEGUNDA_08H = new Date('2026-11-16T11:00:00Z')
const hora = (h: number, m = 0): Date => new Date(Date.UTC(2026, 10, 16, h + 3, m))

async function montar() {
  const b = await makeBusiness()
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30 } })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60 })
  const tosa = await makeService(b.id, { name: 'Tosa', durationMin: 30 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [banho.id, tosa.id] })
  await makeWorkingHours(b.id, ana.id, 'MONDAY', [MANHA, TARDE])
  const gerente = await makeCtx(b, { now: SEGUNDA_08H })
  const cliente = await makeCustomer(b.id)
  return { b, banho, tosa, ana, gerente, cliente }
}

type Montagem = Awaited<ReturnType<typeof montar>>

const marcar = (s: Montagem, startsAt = hora(10), customerId = s.cliente.id) =>
  bookAppointment(s.gerente, { customerId, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt })

const comoCliente = (s: Montagem) =>
  makeCtx(s.b, { actor: { kind: 'customer', customerId: s.cliente.id, name: s.cliente.name }, now: SEGUNDA_08H })

const linha = (appointmentId: string) => prisma.calendarSync.findUniqueOrThrow({ where: { appointmentId } })

describe('a fila acompanha o agendamento', () => {
  test('marcar cria a linha com generation 1 e synced 0; remarcar, ajustar, cancelar, faltar, concluir e desfazer sobem a geração', async () => {
    const s = await montar()
    const v = await marcar(s)
    expect(await linha(v.id)).toMatchObject({ generation: 1, syncedGeneration: 0, placedUserId: null })

    await rescheduleAppointment(s.gerente, v.id, { startsAt: hora(14) })
    expect((await linha(v.id)).generation).toBe(2)
    await adjustAppointment(s.gerente, v.id, { totalCents: 7000 })
    expect((await linha(v.id)).generation).toBe(3)
    await cancelAppointment(s.gerente, v.id)
    expect((await linha(v.id)).generation).toBe(4)

    const w = await marcar(s, hora(9), (await makeCustomer(s.b.id)).id)
    const depois = await makeCtx(s.b, { now: hora(12) })
    await completeAppointment(depois, w.id)
    expect((await linha(w.id)).generation).toBe(2)
    await undoOutcome(depois, w.id)
    expect((await linha(w.id)).generation).toBe(3)
    await markNoShow(depois, w.id)
    expect((await linha(w.id)).generation).toBe(4)
  })

  test('confirmar um pendente sobe a geração', async () => {
    const s = await montar()
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { autoConfirm: false } })
    const v = await bookAppointment(await comoCliente(s), { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(10) })
    expect(v.status).toBe('PENDING')
    await confirmAppointment(s.gerente, v.id)
    expect((await linha(v.id)).generation).toBe(2)
  })

  test('enfileirar zera tentativas, falha e espera de uma linha que tinha desistido', async () => {
    const s = await montar()
    const v = await marcar(s)
    await prisma.calendarSync.update({
      where: { appointmentId: v.id },
      data: { attempts: 6, failedAt: new Date(), lastError: 'unavailable', nextAttemptAt: new Date() },
    })
    await rescheduleAppointment(s.gerente, v.id, { startsAt: hora(14) })
    expect(await linha(v.id)).toMatchObject({ generation: 2, attempts: 0, failedAt: null, lastError: null, nextAttemptAt: null })
  })

  test('a marcação grava mesmo sem nenhuma ligação e sem chamar o Google', async () => {
    const s = await montar()
    const v = await marcar(s)
    expect(v.status).toBe('CONFIRMED')
    expect(fakeGoogleAuthority().calls).toEqual([])
  })

  test('marcação recusada não deixa linha na fila', async () => {
    const s = await montar()
    const e = await domainError(bookAppointment(await comoCliente(s), { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: new Date('2026-11-16T13:10:00Z') }))
    expect(e.reason).toBe('slot_unavailable')
    expect(await prisma.calendarSync.count()).toBe(0)
  })

  test('falha da marcação (needs_confirmation) não deixa linha na fila', async () => {
    const s = await montar()
    // 12:00 é o intervalo do almoço: a equipe precisa confirmar.
    const e = await domainError(marcar(s, hora(12)))
    expect(e.reason).toBe('needs_confirmation')
    expect(await prisma.calendarSync.count()).toBe(0)
  })
})

describe('mudanças que não passam pelo agendamento', () => {
  test('mudar o nome, o animal ou o porte do pet reenfileira os futuros dele; outro campo não', async () => {
    const s = await montar()
    await prisma.business.update({ where: { id: s.b.id }, data: { niche: 'PET' } })
    const rex = await makePet(s.b.id, s.cliente.id, { name: 'Rex' })
    const futuro = await bookAppointment(s.gerente, { customerId: s.cliente.id, petId: rex.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(10) })
    const passado = await bookAppointment(s.gerente, { customerId: s.cliente.id, petId: rex.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(14) })
    await prisma.appointment.updateMany({ where: { id: passado.id }, data: { startsAt: new Date('2026-11-10T12:00:00Z'), endsAt: new Date('2026-11-10T13:00:00Z') } })

    await updatePet(s.gerente, rex.id, { breed: 'Vira-lata' })
    expect((await linha(futuro.id)).generation).toBe(1)
    await updatePet(s.gerente, rex.id, { name: 'Rex Junior' })
    expect((await linha(futuro.id)).generation).toBe(2)
    await updatePet(s.gerente, rex.id, { size: 'LARGE' })
    expect((await linha(futuro.id)).generation).toBe(3)
    expect((await linha(passado.id)).generation).toBe(1)
  })

  test('anonimizar reenfileira só os agendamentos que já estão numa agenda', async () => {
    const s = await montar()
    const pessoa = await makeUser()
    const outro = await makeCustomer(s.b.id)
    const naAgenda = await marcar(s, hora(9), outro.id)
    const semAgenda = await marcar(s, hora(14), outro.id)
    await prisma.calendarSync.update({ where: { appointmentId: naAgenda.id }, data: { placedUserId: pessoa.id, syncedGeneration: 1 } })
    await prisma.calendarSync.update({ where: { appointmentId: semAgenda.id }, data: { syncedGeneration: 1 } })
    // Concluído e já enviado: o anonimizar não o cancela, então só a fila o reescreve.
    await prisma.appointment.updateMany({ where: { id: naAgenda.id }, data: { status: 'COMPLETED', startsAt: new Date('2026-11-10T12:00:00Z'), endsAt: new Date('2026-11-10T13:00:00Z') } })
    const antes = (await linha(naAgenda.id)).generation
    const antesSem = (await linha(semAgenda.id)).generation
    await anonymizeCustomer(s.gerente, outro.id)
    expect((await linha(naAgenda.id)).generation).toBeGreaterThan(antes)
    // O que não estava numa agenda e foi cancelado pelo anonimizar sobe uma vez só (o cancelamento), não duas.
    expect((await linha(semAgenda.id)).generation).toBe(antesSem + 1)
  })

  test('trocar o nome do cliente (pela equipe ou pela própria pessoa) reenfileira só o que já está numa agenda', async () => {
    const s = await montar()
    const dona = await makeUser()
    const pessoa = await makeUser()
    const cliente = await makeCustomer(s.b.id, { userId: pessoa.id, name: 'Marina' })
    const naAgenda = await marcar(s, hora(9), cliente.id)
    const semAgenda = await marcar(s, hora(14), cliente.id)
    await prisma.calendarSync.update({ where: { appointmentId: naAgenda.id }, data: { placedUserId: dona.id, syncedGeneration: 1 } })
    await prisma.calendarSync.update({ where: { appointmentId: semAgenda.id }, data: { syncedGeneration: 1 } })

    await updateCustomer(s.gerente, cliente.id, { notes: 'só uma nota' })
    expect((await linha(naAgenda.id)).generation).toBe(1)
    await updateCustomer(s.gerente, cliente.id, { name: 'Marina Souza' })
    expect((await linha(naAgenda.id)).generation).toBe(2)
    // A pessoa troca o nome com o relógio real: o agendamento precisa estar no futuro dele.
    await prisma.appointment.updateMany({ where: { id: naAgenda.id }, data: { startsAt: new Date('2099-01-05T12:00:00Z'), endsAt: new Date('2099-01-05T13:00:00Z') } })
    await updatePersonProfile(pessoa.id, { name: 'Marina Souza Lima' })
    expect((await linha(naAgenda.id)).generation).toBe(3)
    expect((await linha(semAgenda.id)).generation).toBe(1)
  })

  test('religar o profissional a outro vínculo reenfileira os futuros', async () => {
    const s = await montar()
    const dona = await ctxWithRole(s.b, 'OWNER', { now: SEGUNDA_08H })
    const [u1, u2] = [await makeUser(), await makeUser()]
    const [m1, m2] = [await makeMembership(s.b.id, u1.id, 'PROFESSIONAL'), await makeMembership(s.b.id, u2.id, 'PROFESSIONAL')]
    await prisma.professional.update({ where: { id: s.ana.id }, data: { membershipId: m1.id } })
    const v = await marcar(s)
    await prisma.calendarSync.update({ where: { appointmentId: v.id }, data: { syncedGeneration: 1 } })
    await updateProfessional(dona, s.ana.id, { membershipId: m2.id })
    expect((await linha(v.id)).generation).toBe(2)
    // Mesmo vínculo de novo e outros campos: nada sobe.
    await updateProfessional(dona, s.ana.id, { membershipId: m2.id, name: 'Ana Maria' })
    expect((await linha(v.id)).generation).toBe(2)
  })

  test('desativar e reativar o vínculo reenfileira os futuros do profissional ligado', async () => {
    const s = await montar()
    const dona = await ctxWithRole(s.b, 'OWNER', { now: SEGUNDA_08H })
    const u = await makeUser()
    const m = await makeMembership(s.b.id, u.id, 'PROFESSIONAL')
    await prisma.professional.update({ where: { id: s.ana.id }, data: { membershipId: m.id } })
    const v = await marcar(s)
    const autor = { kind: 'conta', ctx: dona } as const
    await alterarVinculo(autor, s.b.id, m.id, (a) => ({ role: a.role, active: false }), SEGUNDA_08H)
    expect((await linha(v.id)).generation).toBe(2)
    await alterarVinculo(autor, s.b.id, m.id, (a) => ({ role: a.role, active: true }), SEGUNDA_08H)
    expect((await linha(v.id)).generation).toBe(3)
    // Mudar só o papel não mexe na agenda.
    await alterarVinculo(autor, s.b.id, m.id, (a) => ({ role: 'MANAGER', active: a.active }), SEGUNDA_08H)
    expect((await linha(v.id)).generation).toBe(3)
  })

  test('enqueueCalendarForProfessionalsRaw: só os futuros do profissional, e em paralelo com uma remarcação as duas subidas valem (generation 3)', async () => {
    const s = await montar()
    const v = await marcar(s)
    const passado = await makeCustomer(s.b.id)
    const velho = await prisma.appointment.create({
      data: {
        businessId: s.b.id, customerId: passado.id, professionalId: s.ana.id, startsAt: new Date('2026-11-01T12:00:00Z'), endsAt: new Date('2026-11-01T13:00:00Z'),
        status: 'COMPLETED', source: 'PANEL', totalCents: 1, totalDurationMin: 60, createdByType: 'SYSTEM',
      },
    })
    const raw = () =>
      prisma.$transaction((tx) => enqueueCalendarForProfessionalsRaw(tx, { businessId: s.b.id, professionalIds: [s.ana.id], now: SEGUNDA_08H }))
    const [, tocadas] = await Promise.all([rescheduleAppointment(s.gerente, v.id, { startsAt: hora(14) }), raw()])
    expect(tocadas).toBe(1)
    expect((await linha(v.id)).generation).toBe(3)
    expect(await prisma.calendarSync.count({ where: { appointmentId: velho.id } })).toBe(0)
  })
})
