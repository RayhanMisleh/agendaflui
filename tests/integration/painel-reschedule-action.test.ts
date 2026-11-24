import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeAppointment, makeBusiness, makeCustomer, makeProfessional, makeService, makeWorkingHours, memberOf } from '../setup/factories'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { remarcarAtendimento } from '@/app/app/painel/agenda/actions'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const MANAUS = 'America/Manaus'
const AGORA = new Date('2026-11-17T12:00:00Z')
const mn = (dia: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, dia, h + 4, m))
const EXPEDIENTE = [
  { startMin: 540, endMin: 720 },
  { startMin: 780, endMin: 1080 },
]

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
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

const marcar = (o: { quem?: 'ana' | 'caio'; h: number; min?: number; status?: 'PENDING' | 'CONFIRMED' | 'COMPLETED'; cliente?: 'A' | 'B' }) =>
  makeAppointment(m.b.id, {
    customerId: (o.cliente === 'B' ? m.outro : m.cliente).id,
    professionalId: (o.quem === 'caio' ? m.caio : m.ana).id,
    serviceId: m.banho.id,
    startsAt: mn(17, o.h, o.min ?? 0),
    ...(o.status ? { status: o.status } : {}),
  })

describe('remarcar', () => {
  test('muda o horário, no relógio da conta, e também de profissional', async () => {
    const a = await marcar({ h: 10 })
    const r = await remarcarAtendimento(ini, form({ id: a.id, date: '2026-11-17', time: '15:30', professionalId: m.caio.id }))
    expect(r.ok).toBe(true)
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ startsAt: mn(17, 15, 30), professionalId: m.caio.id })
  })

  test('muda de dia pelo formulário (dia local mais minutos locais)', async () => {
    const a = await marcar({ h: 10 })
    const r = await remarcarAtendimento(ini, form({ id: a.id, date: '2026-11-24', time: '09:00', professionalId: '' }))
    expect(r.ok).toBe(true)
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ startsAt: mn(24, 9), professionalId: m.ana.id })
  })

  test('aceita o instante exato de um horário oferecido pelo servidor', async () => {
    const a = await marcar({ h: 10 })
    const r = await remarcarAtendimento(ini, form({ id: a.id, startsAt: mn(17, 16).toISOString(), date: '', time: '', professionalId: '' }))
    expect(r.ok).toBe(true)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).startsAt).toEqual(mn(17, 16))
  })

  test('em cima de outro agendamento: conflito com os horários livres mais próximos, e nada muda', async () => {
    const a = await marcar({ h: 10 })
    await marcar({ h: 14, cliente: 'B' })
    const r = await remarcarAtendimento(ini, form({ id: a.id, date: '2026-11-17', time: '14:30', professionalId: m.ana.id }))
    expect(r.ok).toBe(false)
    expect(r.conflict?.nearest.length).toBeGreaterThan(0)
    expect(r.message).toMatch(/Confira o horário/)
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ startsAt: mn(17, 10), professionalId: m.ana.id })
  })

  test('ficha concluída é recusada', async () => {
    const depois = await ctxWithRole(m.b, 'OWNER', { now: mn(17, 16) })
    guards.requireTenant.mockResolvedValue(depois)
    const a = await marcar({ h: 10, status: 'COMPLETED' })
    const r = await remarcarAtendimento(ini, form({ id: a.id, date: '2026-11-18', time: '09:00', professionalId: '' }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/pendentes ou confirmados/)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).startsAt).toEqual(mn(17, 10))
  })

  test('profissional remarcando a ficha de um colega não tem permissão', async () => {
    const a = await marcar({ quem: 'caio', h: 10 })
    const ctx = await ctxWithRole(m.b, 'PROFESSIONAL', { now: AGORA })
    await prisma.professional.update({ where: { id: m.ana.id }, data: { membershipId: memberOf(ctx).membershipId } })
    guards.requireTenant.mockResolvedValue(ctx)
    const r = await remarcarAtendimento(ini, form({ id: a.id, date: '2026-11-17', time: '15:00', professionalId: m.caio.id }))
    expect(r.ok).toBe(false)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).startsAt).toEqual(mn(17, 10))
  })

  test('profissional não leva a própria ficha para a agenda do colega', async () => {
    const a = await marcar({ quem: 'ana', h: 10 })
    const ctx = await ctxWithRole(m.b, 'PROFESSIONAL', { now: AGORA })
    await prisma.professional.update({ where: { id: m.ana.id }, data: { membershipId: memberOf(ctx).membershipId } })
    guards.requireTenant.mockResolvedValue(ctx)
    const r = await remarcarAtendimento(ini, form({ id: a.id, date: '2026-11-17', time: '15:00', professionalId: m.caio.id }))
    expect(r.ok).toBe(false)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).professionalId).toBe(m.ana.id)
  })

  test('duas pessoas soltando duas fichas no mesmo horário: uma passa', async () => {
    const a = await marcar({ h: 9 })
    const b = await marcar({ h: 11, cliente: 'B' })
    const [x, y] = await Promise.all([
      remarcarAtendimento(ini, form({ id: a.id, date: '2026-11-17', time: '15:00', professionalId: m.ana.id })),
      remarcarAtendimento(ini, form({ id: b.id, date: '2026-11-17', time: '15:00', professionalId: m.ana.id })),
    ])
    expect([x, y].filter((r) => r.ok)).toHaveLength(1)
    const perdeu = [x, y].find((r) => !r.ok)
    expect(perdeu?.conflict?.nearest.length).toBeGreaterThan(0)
    expect(await prisma.appointment.count({ where: { businessId: m.b.id, startsAt: mn(17, 15) } })).toBe(1)
  })

  test('data ou hora inválidas voltam no campo', async () => {
    const a = await marcar({ h: 10 })
    const r = await remarcarAtendimento(ini, form({ id: a.id, date: '2026-13-40', time: '15:00', professionalId: '' }))
    expect(r.ok).toBe(false)
    expect(r.fields.date).toBeTruthy()
    const r2 = await remarcarAtendimento(ini, form({ id: a.id, date: '2026-11-17', time: '25:99', professionalId: '' }))
    expect(r2.fields.time).toBeTruthy()
  })
})
