import { beforeEach, describe, expect, test } from 'vitest'
import { getAgendaPage } from '@/server/domain/scheduling/agenda-page'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeAppointment, makeBusiness, makeCustomer, makeProfessional, makeService, makeWorkingHours } from '../setup/factories'

beforeEach(resetDb)

const MANAUS = 'America/Manaus'
/** 2026-11-17 é terça. Instante de uma hora local de Manaus (UTC-4). */
const mn = (dia: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, dia, h + 4, m))
const EXPEDIENTE = [{ startMin: 540, endMin: 1080 }]

async function montar(now: Date, timezone = MANAUS) {
  const b = await makeBusiness({ timezone })
  const servico = await makeService(b.id, { name: 'Banho', durationMin: 60, priceCents: 8000 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [servico.id] })
  for (const dia of ['MONDAY', 'TUESDAY', 'WEDNESDAY'] as const) await makeWorkingHours(b.id, ana.id, dia, EXPEDIENTE)
  const dono = await ctxWithRole(b, 'OWNER', { now })
  const cliente = await makeCustomer(b.id, { name: 'Marina' })
  const marcar = (startsAt: Date, status?: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'NO_SHOW') =>
    makeAppointment(b.id, { customerId: cliente.id, professionalId: ana.id, serviceId: servico.id, startsAt, ...(status ? { status } : {}) })
  return { b, ana, dono, marcar }
}

describe('minuto de agora e vagas passadas', () => {
  test('nowMin só existe quando a data é hoje', async () => {
    const s = await montar(mn(17, 11, 30))
    expect((await getAgendaPage(s.dono, { data: '2026-11-17' })).day?.nowMin).toBe(690)
    expect((await getAgendaPage(s.dono, { data: '2026-11-18' })).day?.nowMin).toBeNull()
    expect((await getAgendaPage(s.dono, { data: '2026-11-16' })).day?.nowMin).toBeNull()
  })

  test('hoje, nenhuma vaga livre começa antes de agora; amanhã a vaga começa na abertura do expediente', async () => {
    const s = await montar(mn(17, 12))
    const hoje = (await getAgendaPage(s.dono, { data: '2026-11-17' })).day?.columns[0]?.gaps ?? []
    expect(hoje.length).toBeGreaterThan(0)
    expect(hoje.every((g) => g.startMin >= 720)).toBe(true)
    const amanha = (await getAgendaPage(s.dono, { data: '2026-11-18' })).day?.columns[0]?.gaps ?? []
    expect(amanha[0]?.startMin).toBe(540)
    const ontem = (await getAgendaPage(s.dono, { data: '2026-11-16' })).day?.columns[0]?.gaps ?? []
    expect(ontem).toEqual([])
  })
})

describe('draggable por situação', () => {
  test('só atendimento aberto pode ser arrastado; concluído, falta e cancelado não', async () => {
    const s = await montar(mn(17, 8))
    const ids = {
      PENDING: (await s.marcar(mn(17, 9), 'PENDING')).id,
      CONFIRMED: (await s.marcar(mn(17, 10), 'CONFIRMED')).id,
      COMPLETED: (await s.marcar(mn(17, 11), 'COMPLETED')).id,
      NO_SHOW: (await s.marcar(mn(17, 12), 'NO_SHOW')).id,
      CANCELED: (await s.marcar(mn(17, 13), 'CANCELED')).id,
    }
    const slips = (await getAgendaPage(s.dono, { data: '2026-11-17' })).day?.columns.flatMap((c) => c.slips) ?? []
    const por = new Map(slips.map((x) => [x.id, x.draggable]))
    expect(por.get(ids.PENDING)).toBe(true)
    expect(por.get(ids.CONFIRMED)).toBe(true)
    expect(por.get(ids.COMPLETED)).toBe(false)
    expect(por.get(ids.NO_SHOW)).toBe(false)
    // O cancelado pode nem aparecer na agenda; se aparecer, não arrasta.
    if (por.has(ids.CANCELED)) expect(por.get(ids.CANCELED)).toBe(false)
  })
})

describe('semana que atravessa a troca do horário de verão', () => {
  test('em Nova York a semana de 26/10 a 01/11 tem 7 dias, e o dia de 25 horas conta cada atendimento no dia local', async () => {
    const s = await montar(new Date('2026-10-28T16:00:00Z'), 'America/New_York')
    await s.marcar(new Date('2026-11-01T03:30:00Z')) // 23:30 EDT de 31/10
    await s.marcar(new Date('2026-11-01T04:30:00Z')) // 00:30 EDT de 01/11
    await s.marcar(new Date('2026-11-02T04:30:00Z')) // 23:30 EST de 01/11 (24 h depois ainda é dia 1)
    await s.marcar(new Date('2026-11-02T05:30:00Z')) // 00:30 EST de 02/11: fora da semana
    const page = await getAgendaPage(s.dono, { visao: 'semana', data: '2026-10-28' })
    expect(page.week?.map((d) => d.date)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ])
    const contagem = Object.fromEntries((page.week ?? []).map((d) => [d.date, d.count]))
    expect(contagem['2026-10-31']).toBe(1)
    expect(contagem['2026-11-01']).toBe(2)
    expect(page.week?.reduce((soma, d) => soma + d.count, 0)).toBe(3)
  })
})
