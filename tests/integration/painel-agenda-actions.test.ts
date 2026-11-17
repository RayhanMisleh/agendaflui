import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { getAgendaPage } from '@/server/domain/scheduling/agenda-page'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeAppointment, makeBusiness, makeCustomer, makeProfessional, makeService, makeWorkingHours, memberOf } from '../setup/factories'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { ajustarAtendimento, avisarLivre, marcarHorario, mudarSituacao } from '@/app/painel/(app)/agenda/actions'
import { bloquearHorario } from '@/app/painel/(app)/equipe/actions'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const MANAUS = 'America/Manaus'
/** Terça-feira 17/11/2026, 08:00 em Manaus (UTC-4). */
const AGORA = new Date('2026-11-17T12:00:00Z')
const mn = (dia: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, dia, h + 4, m))
const EXPEDIENTE = [
  { startMin: 540, endMin: 720 },
  { startMin: 780, endMin: 1080 },
]

function form(campos: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item)
  return fd
}

async function montar(now: Date = AGORA) {
  const b = await makeBusiness({ timezone: MANAUS })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60, priceCents: 8000 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [banho.id] })
  const caio = await makeProfessional(b.id, { name: 'Caio', displayOrder: 2, serviceIds: [banho.id] })
  for (const p of [ana, caio]) await makeWorkingHours(b.id, p.id, 'TUESDAY', EXPEDIENTE)
  const dono = await ctxWithRole(b, 'OWNER', { now })
  const cliente = await makeCustomer(b.id, { name: 'Marina Souza', email: 'marina@exemplo.com' })
  const outro = await makeCustomer(b.id, { name: 'Paulo Lima' })
  return { b, banho, ana, caio, dono, cliente, outro }
}
type M = Awaited<ReturnType<typeof montar>>

let m: M
beforeEach(async () => {
  await resetDb()
  m = await montar()
  guards.requireTenant.mockResolvedValue(m.dono)
})
afterEach(() => guards.requireTenant.mockReset())

const marcacao = (extra: Record<string, string | string[]> = {}) =>
  form({ customerId: m.cliente.id, serviceIds: [m.banho.id], professionalId: m.ana.id, date: '2026-11-17', time: '10:00', ...extra })

async function comoProfissional(quem: 'ana' | 'caio') {
  const ctx = await ctxWithRole(m.b, 'PROFESSIONAL', { now: AGORA })
  await prisma.professional.update({ where: { id: (quem === 'ana' ? m.ana : m.caio).id }, data: { membershipId: memberOf(ctx).membershipId } })
  return ctx
}

describe('página da agenda', () => {
  test('sem data, hoje é o dia local da conta: 23:30 em Manaus ainda é o dia 17 (já é 18 em UTC)', async () => {
    const tarde = await montar(new Date('2026-11-18T02:00:00Z'))
    await makeAppointment(tarde.b.id, { customerId: tarde.cliente.id, professionalId: tarde.ana.id, serviceId: tarde.banho.id, startsAt: new Date('2026-11-18T03:30:00Z'), durationMin: 30 })
    const page = await getAgendaPage(tarde.dono, {})
    expect(page.date).toBe('2026-11-17')
    expect(page.today).toBe('2026-11-17')
    const ana = page.day?.columns.find((c) => c.id === tarde.ana.id)
    expect(ana?.slips.map((s) => [s.startLabel, s.customerName])).toEqual([['23:30', 'Marina Souza']])
    expect(page.day?.endMin).toBe(1440)
  })

  test('?data= vale como dia local e a visão da semana traz sete dias de segunda a domingo', async () => {
    await makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(18, 9) })
    const page = await getAgendaPage(m.dono, { visao: 'semana', data: '2026-11-18' })
    expect(page.view).toBe('semana')
    expect(page.week?.map((d) => d.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'])
    const quarta = page.week?.find((d) => d.date === '2026-11-18')
    expect(quarta?.count).toBe(1)
    expect(quarta?.items[0]).toMatchObject({ startLabel: '09:00', customerName: 'Marina Souza' })
    expect(page.prevDate).toBe('2026-11-11')
    expect(page.nextDate).toBe('2026-11-25')
  })

  test('profissional que pede a agenda do colega recebe a própria, nunca a do colega', async () => {
    await makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 10) })
    await makeAppointment(m.b.id, { customerId: m.outro.id, professionalId: m.caio.id, serviceId: m.banho.id, startsAt: mn(17, 11) })
    const ctx = await comoProfissional('ana')
    const page = await getAgendaPage(ctx, { profissional: m.caio.id })
    expect(page.scope).toBe('own')
    expect(page.filter).toBe(m.ana.id)
    expect(page.professionals.map((p) => p.name)).toEqual(['Ana'])
    expect(page.day?.columns.map((c) => c.name)).toEqual(['Ana'])
    expect(page.day?.columns[0]?.slips.map((s) => s.customerName)).toEqual(['Marina Souza'])
    expect(Object.values(page.details).map((d) => d.customer.name)).toEqual(['Marina Souza'])
  })

  test('dono vê todas as colunas lado a lado ou filtra um profissional', async () => {
    const todos = await getAgendaPage(m.dono, {})
    expect(todos.day?.columns.map((c) => c.name)).toEqual(['Ana', 'Caio'])
    const so = await getAgendaPage(m.dono, { profissional: m.caio.id })
    expect(so.day?.columns.map((c) => c.name)).toEqual(['Caio'])
    expect(so.filter).toBe(m.caio.id)
  })

  test('as vagas livres respeitam o expediente e o que já está ocupado', async () => {
    await makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 10) })
    const page = await getAgendaPage(m.dono, { data: '2026-11-17' })
    const ana = page.day?.columns[0]
    // Agora são 08:00: a vaga de 09:00 às 10:00 e a de 11:00 às 12:00 existem; a tarde inteira também.
    expect(ana?.gaps.map((g) => [g.startLabel, g.endLabel])).toEqual([['09:00', '10:00'], ['11:00', '12:00'], ['13:00', '18:00']])
  })

  test('bloqueio criado aparece na coluna do profissional, com horário e motivo', async () => {
    const r = await bloquearHorario(ini, form({ id: m.ana.id, startDate: '2026-11-17', startTime: '12:00', endDate: '2026-11-17', endTime: '13:00', reason: 'Almoço' }))
    expect(r.ok).toBe(true)
    const page = await getAgendaPage(m.dono, { data: '2026-11-17' })
    expect(page.day?.columns[0]?.blocks).toEqual([expect.objectContaining({ startLabel: '12:00', endLabel: '13:00', label: 'Almoço', topMin: 180, heightMin: 60 })])
  })

  test('o próximo atendimento e os pendentes pedem atenção', async () => {
    await makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 9) })
    await makeAppointment(m.b.id, { customerId: m.outro.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 14), status: 'PENDING' })
    await makeAppointment(m.b.id, { customerId: m.outro.id, professionalId: m.caio.id, serviceId: m.banho.id, startsAt: mn(17, 15) })
    const page = await getAgendaPage(m.dono, { data: '2026-11-17' })
    const marca = Object.fromEntries((page.day?.columns ?? []).flatMap((c) => c.slips).map((s) => [s.startLabel, s.attention]))
    expect(marca).toEqual({ '09:00': true, '14:00': true, '15:00': false })
  })

  test('horário de verão: a ficha segue o relógio da parede e a duração real quando o relógio volta', async () => {
    const b = await makeBusiness({ timezone: 'America/New_York' })
    const serv = await makeService(b.id, { name: 'Corte', durationMin: 60 })
    const prof = await makeProfessional(b.id, { name: 'Lia', serviceIds: [serv.id] })
    const cli = await makeCustomer(b.id, { name: 'Cora' })
    const dono = await ctxWithRole(b, 'OWNER', { now: new Date('2026-03-01T12:00:00Z') })
    // 08/03/2026: às 02:00 os relógios vão para 03:00. 01:30 EST (06:30Z) + 60 min termina 03:30 EDT.
    await makeAppointment(b.id, { customerId: cli.id, professionalId: prof.id, serviceId: serv.id, startsAt: new Date('2026-03-08T06:30:00Z') })
    const primavera = await getAgendaPage(dono, { data: '2026-03-08' })
    const fatia = primavera.day?.columns[0]?.slips[0]
    expect(fatia).toMatchObject({ startLabel: '01:30', endLabel: '03:30' })
    expect(fatia?.box.heightMin).toBe(120)
    // 01/11/2026: às 02:00 os relógios voltam para 01:00. 01:30 EDT (05:30Z) + 60 min termina 01:30 EST.
    const dono2 = await ctxWithRole(b, 'OWNER', { now: new Date('2026-10-25T12:00:00Z') })
    await makeAppointment(b.id, { customerId: cli.id, professionalId: prof.id, serviceId: serv.id, startsAt: new Date('2026-11-01T05:30:00Z') })
    const outono = await getAgendaPage(dono2, { data: '2026-11-01' })
    const outra = outono.day?.columns[0]?.slips[0]
    expect(outra?.box).toMatchObject({ heightMin: 60 })
    expect(outra?.startLabel).toBe('01:30')
  })
})

describe('marcar horário', () => {
  test('marca na hora escolhida, também fora da grade da conta (a equipe pode)', async () => {
    const r = await marcarHorario(ini, marcacao({ time: '10:10' }))
    expect(r.ok).toBe(true)
    const a = await prisma.appointment.findFirstOrThrow({ where: { businessId: m.b.id } })
    expect(a.startsAt).toEqual(mn(17, 10, 10))
    expect(a.professionalId).toBe(m.ana.id)
  })

  test('aceita o instante exato de um horário oferecido pelo servidor', async () => {
    const r = await marcarHorario(ini, marcacao({ date: '', time: '', startsAt: mn(17, 11).toISOString() }))
    expect(r.ok).toBe(true)
    expect((await prisma.appointment.findFirstOrThrow({ where: { businessId: m.b.id } })).startsAt).toEqual(mn(17, 11))
  })

  test('sem cliente ou sem serviço, o erro volta no campo certo e nada é gravado', async () => {
    const semCliente = await marcarHorario(ini, marcacao({ customerId: '' }))
    expect(semCliente.ok).toBe(false)
    expect(semCliente.fields.customerId).toBeTruthy()
    const semServico = await marcarHorario(ini, form({ customerId: m.cliente.id, professionalId: m.ana.id, date: '2026-11-17', time: '10:00' }))
    expect(semServico.ok).toBe(false)
    expect(semServico.fields.serviceIds).toBeTruthy()
    expect(await prisma.appointment.count({ where: { businessId: m.b.id } })).toBe(0)
  })

  test('duas marcações no mesmo horário: uma passa, a outra devolve o conflito com os horários livres mais próximos', async () => {
    const [x, y] = await Promise.all([
      marcarHorario(ini, marcacao({ customerId: m.cliente.id })),
      marcarHorario(ini, marcacao({ customerId: m.outro.id })),
    ])
    const perdeu = [x, y].filter((r) => !r.ok)
    expect([x, y].filter((r) => r.ok)).toHaveLength(1)
    expect(perdeu).toHaveLength(1)
    const conflito = perdeu[0]?.conflict
    expect(conflito?.nearest.length).toBeGreaterThan(0)
    expect(conflito?.nearest[0]).toMatchObject({ label: expect.stringMatching(/^\d\d:\d\d$/), iso: expect.any(String) })
    expect(await prisma.appointment.count({ where: { businessId: m.b.id } })).toBe(1)
  })

  test('profissional não marca na agenda do colega', async () => {
    guards.requireTenant.mockResolvedValue(await comoProfissional('ana'))
    const r = await marcarHorario(ini, marcacao({ professionalId: m.caio.id }))
    expect(r.ok).toBe(false)
    expect(await prisma.appointment.count({ where: { businessId: m.b.id } })).toBe(0)
  })
})

describe('situação do atendimento', () => {
  test('confirma, e cancela com motivo', async () => {
    const a = await makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 14), status: 'PENDING' })
    expect((await mudarSituacao(ini, form({ id: a.id, to: 'confirm' }))).ok).toBe(true)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CONFIRMED')
    expect((await mudarSituacao(ini, form({ id: a.id, to: 'cancel', reason: 'Cliente pediu' }))).ok).toBe(true)
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: 'CANCELED', cancelReason: 'Cliente pediu' })
  })

  test('concluir antes do início devolve a mensagem do domínio e nada muda', async () => {
    const a = await makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 14) })
    const r = await mudarSituacao(ini, form({ id: a.id, to: 'complete' }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/depois do horário de início/)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CONFIRMED')
  })

  test('conclui e marca falta depois do início; desfaz o engano', async () => {
    const depois = await ctxWithRole(m.b, 'OWNER', { now: mn(17, 16) })
    guards.requireTenant.mockResolvedValue(depois)
    const a = await makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 14) })
    const b = await makeAppointment(m.b.id, { customerId: m.outro.id, professionalId: m.caio.id, serviceId: m.banho.id, startsAt: mn(17, 14) })
    expect((await mudarSituacao(ini, form({ id: a.id, to: 'complete' }))).ok).toBe(true)
    expect((await mudarSituacao(ini, form({ id: b.id, to: 'noshow' }))).ok).toBe(true)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('COMPLETED')
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('NO_SHOW')
    expect((await mudarSituacao(ini, form({ id: a.id, to: 'undo' }))).ok).toBe(true)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CONFIRMED')
  })

  test('situação desconhecida é recusada sem tocar no agendamento', async () => {
    const a = await makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 14) })
    const r = await mudarSituacao(ini, form({ id: a.id, to: 'apagar' }))
    expect(r.ok).toBe(false)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CONFIRMED')
  })

  test('profissional não mexe no atendimento do colega', async () => {
    const a = await makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: m.caio.id, serviceId: m.banho.id, startsAt: mn(17, 14) })
    guards.requireTenant.mockResolvedValue(await comoProfissional('ana'))
    const r = await mudarSituacao(ini, form({ id: a.id, to: 'cancel' }))
    expect(r.ok).toBe(false)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CONFIRMED')
  })
})

describe('já estou livre e ajustes', () => {
  test('avisar duas vezes gera um aviso só', async () => {
    const a = await makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 14) })
    expect((await avisarLivre(ini, form({ id: a.id }))).ok).toBe(true)
    const depoisDe1 = await prisma.notification.count({ where: { appointmentId: a.id, kind: 'PROFESSIONAL_FREE_EARLY' } })
    expect((await avisarLivre(ini, form({ id: a.id }))).ok).toBe(true)
    const depoisDe2 = await prisma.notification.count({ where: { appointmentId: a.id, kind: 'PROFESSIONAL_FREE_EARLY' } })
    expect(depoisDe1).toBeGreaterThan(0)
    expect(depoisDe2).toBe(depoisDe1)
  })

  test('ajusta valor e observação sem mexer nos serviços; trocar serviço recalcula', async () => {
    const tosa = await makeService(m.b.id, { name: 'Tosa', durationMin: 30, priceCents: 5000 })
    await prisma.professionalService.create({ data: { businessId: m.b.id, professionalId: m.ana.id, serviceId: tosa.id } })
    const a = await makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 14) })
    const r1 = await ajustarAtendimento(ini, form({ id: a.id, serviceIds: [m.banho.id], price: '70,00', notes: 'Pelo longo' }))
    expect(r1.ok).toBe(true)
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ totalCents: 7000, notes: 'Pelo longo' })
    const r2 = await ajustarAtendimento(ini, form({ id: a.id, serviceIds: [m.banho.id, tosa.id], price: '70,00', notes: 'Pelo longo' }))
    expect(r2.ok).toBe(true)
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ totalCents: 13000, totalDurationMin: 90 })
  })
})
