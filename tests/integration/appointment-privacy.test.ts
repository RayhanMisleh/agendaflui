import { prisma } from '@/server/db/client'
import { getAgenda, getNextAppointment, listCustomerAppointments } from '@/server/domain/scheduling/agenda'
import {
  adjustAppointment,
  bookAppointment,
  cancelAppointment,
  completeAppointment,
  getAppointment,
  rescheduleAppointment,
} from '@/server/domain/scheduling/appointments'
import { getProfessional, listProfessionals } from '@/server/domain/team/professionals'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeAppointment,
  makeBusiness,
  makeCtx,
  makeCustomer,
  makeProfessional,
  makeService,
  makeWorkingHours,
  memberOf,
} from '../setup/factories'

beforeEach(resetDb)

/** Segunda-feira, 08:00 em São Paulo. */
const AGORA = new Date('2026-11-16T11:00:00Z')
const DEZ = new Date('2026-11-16T13:00:00Z')
const ONZE = new Date('2026-11-16T14:00:00Z')

async function montar() {
  const b = await makeBusiness()
  const tosa = await makeService(b.id, { durationMin: 30, priceCents: 5000 })
  const eu = await ctxWithRole(b, 'PROFESSIONAL', { now: AGORA })
  const minhaFicha = await makeProfessional(b.id, {
    name: 'Eu',
    commissionBps: 3000,
    membershipId: memberOf(eu).membershipId,
    serviceIds: [tosa.id],
  })
  const colega = await makeProfessional(b.id, { name: 'Colega', commissionBps: 5000, serviceIds: [tosa.id] })
  for (const p of [minhaFicha, colega]) await makeWorkingHours(b.id, p.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
  const cliente = await makeCustomer(b.id)
  const base = { customerId: cliente.id, serviceId: tosa.id }
  const meu = await makeAppointment(b.id, { ...base, professionalId: minhaFicha.id, startsAt: DEZ })
  const doColega = await makeAppointment(b.id, { ...base, professionalId: colega.id, startsAt: ONZE })
  for (const a of [meu, doColega]) {
    await prisma.appointment.update({ where: { id: a.id }, data: { commissionCents: 1500, notes: 'observação interna' } })
  }
  const gerente = await ctxWithRole(b, 'MANAGER', { now: AGORA })
  const clienteCtx = await makeCtx(b, { actor: { kind: 'customer', customerId: cliente.id, name: cliente.name }, now: AGORA })
  const suporte = await makeCtx(b, { actor: { kind: 'impersonator', adminId: crypto.randomUUID(), name: 'Suporte' }, now: AGORA })
  return { b, tosa, eu, minhaFicha, colega, cliente, meu, doColega, gerente, clienteCtx, suporte }
}

describe('comissão e observações do agendamento', () => {
  test('o profissional vê os campos internos do próprio agendamento', async () => {
    const s = await montar()
    const v = await getAppointment(s.eu, s.meu.id)
    expect(v.commissionCents).toBe(1500)
    expect(v.notes).toBe('observação interna')
  })

  test('na lista do cliente, o profissional vê os campos do próprio e não os do colega', async () => {
    const s = await montar()
    const { items } = await listCustomerAppointments(s.eu, { customerId: s.cliente.id, scope: 'upcoming' })
    const por = new Map(items.map((i) => [i.id, i]))
    expect(por.get(s.meu.id)).toMatchObject({ commissionCents: 1500, notes: 'observação interna' })
    expect(por.get(s.doColega.id)).toMatchObject({ commissionCents: null, notes: null })
  })

  test('no próximo agendamento do cliente, o do colega vem sem campos internos', async () => {
    const s = await montar()
    await prisma.appointment.delete({ where: { id: s.meu.id } })
    const proximo = await getNextAppointment(s.eu, s.cliente.id)
    expect(proximo?.id).toBe(s.doColega.id)
    expect(proximo).toMatchObject({ commissionCents: null, notes: null })
  })

  test('a agenda mostra os campos internos só do que é do profissional', async () => {
    const s = await montar()
    const dias = await getAgenda(s.eu, { from: '2026-11-16', to: '2026-11-16' })
    const todos = dias.flatMap((d) => d.professionals.flatMap((p) => p.appointments))
    expect(todos.length).toBeGreaterThan(0)
    for (const a of todos) {
      const meu = a.id === s.meu.id
      expect(a.commissionCents).toBe(meu ? 1500 : null)
      expect(a.notes).toBe(meu ? 'observação interna' : null)
    }
  })

  test('gerente e suporte veem tudo; o cliente não vê nada interno', async () => {
    const s = await montar()
    for (const ctx of [s.gerente, s.suporte]) {
      expect(await getAppointment(ctx, s.doColega.id)).toMatchObject({ commissionCents: 1500, notes: 'observação interna' })
      const { items } = await listCustomerAppointments(ctx, { customerId: s.cliente.id, scope: 'upcoming' })
      expect(items.every((i) => i.commissionCents === 1500 && i.notes === 'observação interna')).toBe(true)
    }
    const { items } = await listCustomerAppointments(s.clienteCtx, { scope: 'upcoming' })
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.commissionCents === null && i.notes === null)).toBe(true)
    expect(await getNextAppointment(s.clienteCtx)).toMatchObject({ commissionCents: null, notes: null })
  })

  test('as operações que devolvem a view seguem a mesma regra', async () => {
    const s = await montar()
    const cancelado = await cancelAppointment(s.eu, s.meu.id)
    expect(cancelado).toMatchObject({ commissionCents: 1500, notes: 'observação interna' })
    const novo = await bookAppointment(s.eu, {
      customerId: s.cliente.id,
      professionalId: s.minhaFicha.id,
      serviceIds: [s.tosa.id],
      startsAt: new Date('2026-11-16T15:00:00Z'),
      notes: 'minha nota',
    })
    expect(novo.notes).toBe('minha nota')
    const remarcado = await rescheduleAppointment(s.gerente, novo.id, { startsAt: new Date('2026-11-16T16:00:00Z') })
    expect(remarcado.notes).toBe('minha nota')
    const clienteMarca = await bookAppointment(s.clienteCtx, {
      professionalId: s.colega.id,
      serviceIds: [s.tosa.id],
      startsAt: new Date('2026-11-16T17:00:00Z'),
    })
    expect(clienteMarca).toMatchObject({ commissionCents: null, notes: null })
  })

  test('concluir pelo profissional devolve a comissão do próprio atendimento', async () => {
    const s = await montar()
    const feito = await completeAppointment(
      await ctxWithRole(s.b, 'MANAGER', { now: new Date('2026-11-16T14:30:00Z') }),
      s.meu.id,
    )
    expect(feito.commissionCents).toBe(Math.round(5000 * 0.3))
  })
})

describe('ajuste do valor', () => {
  test('profissional não altera o total, nem do próprio atendimento', async () => {
    const s = await montar()
    expect((await domainError(adjustAppointment(s.eu, s.meu.id, { totalCents: 1 }))).code).toBe('forbidden')
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: s.meu.id } })).totalCents).toBe(5000)
  })

  test('profissional ainda ajusta observações do próprio atendimento; gerente e suporte ajustam o total', async () => {
    const s = await montar()
    expect((await adjustAppointment(s.eu, s.meu.id, { notes: 'nova' })).notes).toBe('nova')
    expect((await adjustAppointment(s.gerente, s.meu.id, { totalCents: 7000 })).totalCents).toBe(7000)
    expect((await adjustAppointment(s.suporte, s.meu.id, { totalCents: 7100 })).totalCents).toBe(7100)
  })
})

describe('comissão na ficha do profissional', () => {
  test('o profissional vê a própria comissão e não a do colega', async () => {
    const s = await montar()
    expect((await getProfessional(s.eu, s.minhaFicha.id)).commissionBps).toBe(3000)
    expect((await getProfessional(s.eu, s.colega.id)).commissionBps).toBe(0)
    const lista = await listProfessionals(s.eu)
    expect(Object.fromEntries(lista.map((p) => [p.name, p.commissionBps]))).toEqual({ Eu: 3000, Colega: 0 })
  })

  test('gerente e suporte veem a comissão de todos; o cliente vê zero', async () => {
    const s = await montar()
    for (const ctx of [s.gerente, s.suporte]) {
      expect((await getProfessional(ctx, s.colega.id)).commissionBps).toBe(5000)
    }
    expect((await getProfessional(s.clienteCtx, s.colega.id)).commissionBps).toBe(0)
    expect((await listProfessionals(s.clienteCtx)).every((p) => p.commissionBps === 0)).toBe(true)
  })
})
