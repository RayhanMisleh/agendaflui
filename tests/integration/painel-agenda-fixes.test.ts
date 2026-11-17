import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { getAgendaPage } from '@/server/domain/scheduling/agenda-page'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeAppointment, makeBusiness, makeCustomer, makeProfessional, makeService, makeWorkingHours } from '../setup/factories'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { ajustarAtendimento, marcarHorario, mudarSituacao, remarcarAtendimento } from '@/app/painel/(app)/agenda/actions'
import { bloquearHorario } from '@/app/painel/(app)/equipe/actions'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const MANAUS = 'America/Manaus'
const AGORA = new Date('2026-11-17T12:00:00Z')
const mn = (dia: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, dia, h + 4, m))
const EXPEDIENTE = [{ startMin: 540, endMin: 1080 }]

function form(campos: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item)
  return fd
}

async function montar() {
  const b = await makeBusiness({ timezone: MANAUS })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60, priceCents: 8000 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [banho.id] })
  const caio = await makeProfessional(b.id, { name: 'Caio', displayOrder: 2, serviceIds: [banho.id] })
  for (const p of [ana, caio]) await makeWorkingHours(b.id, p.id, 'TUESDAY', EXPEDIENTE)
  const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
  const cliente = await makeCustomer(b.id, { name: 'Marina Souza' })
  return { b, banho, ana, caio, dono, cliente }
}
type M = Awaited<ReturnType<typeof montar>>

let m: M
beforeEach(async () => {
  await resetDb()
  m = await montar()
  guards.requireTenant.mockResolvedValue(m.dono)
})
afterEach(() => guards.requireTenant.mockReset())

const marcado = (h: number, quem: 'ana' | 'caio' = 'ana', dia = 17) =>
  makeAppointment(m.b.id, { customerId: m.cliente.id, professionalId: (quem === 'ana' ? m.ana : m.caio).id, serviceId: m.banho.id, startsAt: mn(dia, h) })

describe('startsAt velho não vence o dia escolhido', () => {
  test('marcar: instante do dia 17 com date=24 é recusado e nada é marcado', async () => {
    const r = await marcarHorario(
      ini,
      form({ customerId: m.cliente.id, serviceIds: [m.banho.id], professionalId: m.ana.id, date: '2026-11-24', time: '10:00', startsAt: mn(17, 10).toISOString() }),
    )
    expect(r.ok).toBe(false)
    expect(r.fields.date).toBeTruthy()
    expect(await prisma.appointment.count({ where: { businessId: m.b.id } })).toBe(0)
  })

  test('marcar: instante do mesmo dia local de date vale (23:30 em Manaus é dia 17 mesmo sendo dia 18 em UTC)', async () => {
    const r = await marcarHorario(
      ini,
      form({ customerId: m.cliente.id, serviceIds: [m.banho.id], professionalId: m.ana.id, date: '2026-11-17', time: '', startsAt: mn(17, 17, 0).toISOString() }),
    )
    expect(r.ok).toBe(true)
  })

  test('remarcar: instante de outro dia que o date enviado é recusado e a ficha fica onde estava', async () => {
    const a = await marcado(10)
    const r = await remarcarAtendimento(ini, form({ id: a.id, professionalId: '', date: '2026-11-24', time: '', startsAt: mn(17, 15).toISOString() }))
    expect(r.ok).toBe(false)
    expect(r.fields.date).toBeTruthy()
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).startsAt).toEqual(mn(17, 10))
  })
})

describe('horário sugerido de outro dia', () => {
  test('o conflito traz o dia local de cada horário sugerido', async () => {
    await marcado(10)
    const r = await marcarHorario(ini, form({ customerId: m.cliente.id, serviceIds: [m.banho.id], professionalId: m.ana.id, date: '2026-11-17', time: '10:00', startsAt: '' }))
    expect(r.ok).toBe(false)
    expect(r.conflict?.nearest.length).toBeGreaterThan(0)
    for (const n of r.conflict?.nearest ?? []) expect(n.date).toBe('2026-11-17')
  })

  test('com o dia do horário sugerido a ação marca; com o dia antigo recusa e nada é marcado', async () => {
    // Um horário sugerido que cai no dia 18 (terça é 17; o expediente de quarta não existe, mas o horário avulso vale).
    const sugerido = { iso: mn(18, 10).toISOString(), label: '10:00', date: '2026-11-18' }
    const velho = await marcarHorario(
      ini,
      form({ customerId: m.cliente.id, serviceIds: [m.banho.id], professionalId: m.ana.id, date: '2026-11-17', time: sugerido.label, startsAt: sugerido.iso }),
    )
    expect(velho.ok).toBe(false)
    expect(velho.fields.date).toBeTruthy()
    expect(await prisma.appointment.count({ where: { businessId: m.b.id } })).toBe(0)
    const novo = await marcarHorario(
      ini,
      form({ customerId: m.cliente.id, serviceIds: [m.banho.id], professionalId: m.ana.id, date: sugerido.date, time: sugerido.label, startsAt: sugerido.iso }),
    )
    expect(novo.ok).toBe(true)
    expect((await prisma.appointment.findFirstOrThrow({ where: { businessId: m.b.id } })).startsAt).toEqual(mn(18, 10))
  })
})

describe('remarcar confere a origem que a tela mostrava', () => {
  const origem = (a: { startsAt: Date; professionalId: string }) => ({ fromStartsAt: a.startsAt.toISOString(), fromProfessionalId: a.professionalId })

  test('duas remarcações seguidas sobre a mesma origem: a segunda recebe conflito e não grava', async () => {
    const a = await marcado(10)
    const de = origem(a)
    const primeira = await remarcarAtendimento(ini, form({ id: a.id, professionalId: '', date: '2026-11-17', time: '14:00', ...de }))
    expect(primeira.ok).toBe(true)
    const segunda = await remarcarAtendimento(ini, form({ id: a.id, professionalId: '', date: '2026-11-17', time: '11:00', ...de }))
    expect(segunda.ok).toBe(false)
    expect(segunda.message).toBe('Este atendimento mudou agora. Recarregue para ver.')
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).startsAt).toEqual(mn(17, 14))
  })

  test('mudou só o profissional: também é conflito', async () => {
    const a = await marcado(10)
    const de = origem(a)
    await remarcarAtendimento(ini, form({ id: a.id, professionalId: m.caio.id, date: '2026-11-17', time: '10:00', ...de }))
    const r = await remarcarAtendimento(ini, form({ id: a.id, professionalId: '', date: '2026-11-17', time: '16:00', ...de }))
    expect(r.message).toBe('Este atendimento mudou agora. Recarregue para ver.')
  })

  test('origem que ainda bate remarca normalmente', async () => {
    const a = await marcado(10)
    const r = await remarcarAtendimento(ini, form({ id: a.id, professionalId: '', date: '2026-11-17', time: '15:00', ...origem(a) }))
    expect(r.ok).toBe(true)
  })
})

describe('?data= fora de uma janela razoável', () => {
  test.each(['9999-12-31', '0000-01-01', '1999-12-31', '2040-01-01'])('%s cai em hoje, sem erro, e os links andam para datas válidas', async (data) => {
    const page = await getAgendaPage(m.dono, { data })
    expect(page.date).toBe('2026-11-17')
    expect(page.prevDate).toBe('2026-11-16')
    expect(page.nextDate).toBe('2026-11-18')
  })

  test('as pontas da janela valem: 2000-01-01 e dois anos à frente', async () => {
    expect((await getAgendaPage(m.dono, { data: '2000-01-01' })).date).toBe('2000-01-01')
    expect((await getAgendaPage(m.dono, { data: '2028-11-16' })).date).toBe('2028-11-16')
  })
})

describe('ações com ids de outra conta', () => {
  async function alheia() {
    const b = await makeBusiness({ timezone: MANAUS })
    const servico = await makeService(b.id, { name: 'Tosa', durationMin: 60 })
    const prof = await makeProfessional(b.id, { name: 'Zeca', serviceIds: [servico.id] })
    await makeWorkingHours(b.id, prof.id, 'TUESDAY', EXPEDIENTE)
    const cliente = await makeCustomer(b.id, { name: 'Alheio' })
    const atendimento = await makeAppointment(b.id, { customerId: cliente.id, professionalId: prof.id, serviceId: servico.id, startsAt: mn(17, 10), status: 'PENDING' })
    return { servico, prof, cliente, atendimento }
  }

  test('marcar com cliente, serviço ou profissional de outra conta é recusado', async () => {
    const x = await alheia()
    const base = { customerId: m.cliente.id, serviceIds: [m.banho.id], professionalId: m.ana.id, date: '2026-11-17', time: '10:00' }
    for (const troca of [{ customerId: x.cliente.id }, { serviceIds: [x.servico.id] }, { professionalId: x.prof.id }]) {
      const r = await marcarHorario(ini, form({ ...base, ...troca }))
      expect(r.ok).toBe(false)
    }
    expect(await prisma.appointment.count({ where: { businessId: m.b.id } })).toBe(0)
  })

  test('remarcar atendimento de outra conta, ou para profissional de outra conta, não muda nada', async () => {
    const x = await alheia()
    const meu = await marcado(10)
    expect((await remarcarAtendimento(ini, form({ id: x.atendimento.id, professionalId: '', date: '2026-11-17', time: '15:00' }))).ok).toBe(false)
    expect((await remarcarAtendimento(ini, form({ id: meu.id, professionalId: x.prof.id, date: '2026-11-17', time: '15:00' }))).ok).toBe(false)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: x.atendimento.id } })).startsAt).toEqual(mn(17, 10))
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: meu.id } })).startsAt).toEqual(mn(17, 10))
  })

  test.each(['cancel', 'noshow', 'complete', 'confirm'])('situação %s em atendimento de outra conta não muda nada', async (to) => {
    const x = await alheia()
    const r = await mudarSituacao(ini, form({ id: x.atendimento.id, to, reason: '' }))
    expect(r.ok).toBe(false)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: x.atendimento.id } })).status).toBe('PENDING')
  })

  test('ajustar atendimento de outra conta não muda nada', async () => {
    const x = await alheia()
    const r = await ajustarAtendimento(ini, form({ id: x.atendimento.id, price: '1,00', notes: 'invasão' }))
    expect(r.ok).toBe(false)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: x.atendimento.id } })).notes).not.toBe('invasão')
  })

  test('bloquear horário de profissional de outra conta é recusado', async () => {
    const x = await alheia()
    const r = await bloquearHorario(ini, form({ id: x.prof.id, startDate: '2026-11-18', startTime: '09:00', endDate: '2026-11-18', endTime: '12:00', reason: 'x' }))
    expect(r.ok).toBe(false)
    expect(await prisma.timeBlock.count({ where: { professionalId: x.prof.id } })).toBe(0)
  })
})
