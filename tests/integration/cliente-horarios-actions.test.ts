import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { bookAppointment } from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCtx, makeCustomer, makePet } from '../setup/factories'
import { AGORA, as14h, cenaPet, type CenaPet } from '../setup/cliente-agenda'

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
  headers: async () => new Headers(),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { to })
  },
  notFound: (): never => {
    throw new Error('NEXT_NOT_FOUND')
  },
  unstable_rethrow: (e: unknown): void => {
    if (e instanceof Error && e.message.startsWith('NEXT_')) throw e
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

import { cancelarHorario } from '@/app/app/[slug]/horarios/actions'
import { listarHorarios } from '@/app/app/[slug]/horarios/_lib/listar'
import { ESTADO_VAZIO } from '@/app/app/[slug]/_lib/estado'
import { requireCustomer } from '@/server/auth/guards'

let c: CenaPet
beforeEach(async () => {
  jar.clear()
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'], now: AGORA })
  c = await cenaPet(jar)
})
afterEach(() => vi.useRealTimers())

const cancelar = (slug: string, id: string) => {
  const fd = new FormData()
  fd.set('appointmentId', id)
  return cancelarHorario(slug, ESTADO_VAZIO, fd)
}
const dono = () => makeCtx(c.b, { now: AGORA })
const marcar = async (cliente = c.cliente, pet = c.thor, quando = as14h) =>
  bookAppointment(await dono(), { customerId: cliente.id, petId: pet.id, professionalId: c.ana.id, serviceIds: [c.banho.id], startsAt: quando })

async function redirecionou(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof Error && 'to' in e && typeof e.to === 'string') return e.to
    throw e
  }
  throw new Error('esperava redirect')
}

describe('cancelarHorario', () => {
  test('cancela o próprio horário dentro do prazo', async () => {
    const a = await marcar()
    expect(await redirecionou(cancelar(c.slug, a.id))).toBe(`/${c.slug}/horarios?cancelado=1`)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CANCELED')
  })

  test('depois do prazo: recusa com o prazo e o telefone da loja, nada muda', async () => {
    await prisma.business.update({ where: { id: c.b.id }, data: { phone: '5511987654321' } })
    const a = await marcar()
    vi.setSystemTime(new Date('2026-11-23T16:30:00Z'))
    const r = await cancelar(c.slug, a.id)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('O prazo para cancelar pelo link da loja é de 2 h antes do horário.')
    expect(r.message).toContain('Fale com a loja: (11) 98765-4321.')
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CONFIRMED')
  })

  test('depois do prazo sem telefone: só a mensagem do domínio', async () => {
    const a = await marcar()
    vi.setSystemTime(new Date('2026-11-23T16:30:00Z'))
    const r = await cancelar(c.slug, a.id)
    expect(r.message).not.toContain('Fale com a loja:')
    expect(r.message).toContain('Fale com o estabelecimento.')
  })

  test('horário de outro cliente → não encontrado e nada muda', async () => {
    const outro = await makeCustomer(c.b.id)
    const dele = await makePet(c.b.id, outro.id, { name: 'Zeca' })
    const alheio = await marcar(outro, dele)
    const r = await cancelar(c.slug, alheio.id)
    expect(r).toMatchObject({ ok: false })
    expect(r.message).toMatch(/não encontrad/i)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: alheio.id } })).status).toBe('CONFIRMED')
  })

  test('id de agendamento da loja A enviado pelo slug de B → não encontrado', async () => {
    const a = await marcar()
    // a mesma pessoa é cliente da loja B também
    const lojaB = await makeBusiness({ niche: 'PET' })
    const clienteB = await makeCustomer(lojaB.id, { userId: c.pessoa.id })
    void clienteB
    const r = await cancelar(lojaB.slug, a.id)
    expect(r).toMatchObject({ ok: false })
    expect(r.message).toMatch(/não encontrad/i)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CONFIRMED')
  })

  test('cliente arquivado entre abrir e cancelar → redirect para a loja com a volta, sem mexer', async () => {
    const a = await marcar()
    await prisma.customer.update({ where: { id: c.cliente.id }, data: { archivedAt: new Date() } })
    await expect(cancelar(c.slug, a.id)).rejects.toMatchObject({ to: `/${c.slug}?volta=%2F${c.slug}` })
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CONFIRMED')
  })
})

describe('listarHorarios', () => {
  test('anteriores paginam pelo cursor sem repetir; próximos e anteriores não se misturam', async () => {
    // 12 atendimentos já passados (um por semana para trás) e 1 futuro
    for (let i = 0; i < 12; i++) {
      await prisma.appointment.create({
        data: {
          businessId: c.b.id,
          customerId: c.cliente.id,
          petId: c.thor.id,
          professionalId: c.ana.id,
          startsAt: new Date(Date.UTC(2026, 9, 1 + i, 15, 0)),
          endsAt: new Date(Date.UTC(2026, 9, 1 + i, 16, 0)),
          status: 'COMPLETED',
          source: 'PANEL',
          totalCents: 6500,
          totalDurationMin: 60,
          createdByType: 'SYSTEM',
          items: { create: [{ businessId: c.b.id, serviceId: c.banho.id, name: 'Banho', priceCents: 6500, durationMin: 60, rewardPoints: 0, position: 1 }] },
        },
      })
    }
    await marcar()
    const visit = await requireCustomer(c.slug, `/${c.slug}/horarios`)
    const proximos = await listarHorarios(visit, { anteriores: false })
    expect(proximos.items).toHaveLength(1)
    const p1 = await listarHorarios(visit, { anteriores: true })
    expect(p1.items).toHaveLength(10)
    expect(p1.nextCursor).not.toBeNull()
    const p2 = await listarHorarios(visit, { anteriores: true, depois: p1.nextCursor ?? '' })
    expect(p2.items).toHaveLength(2)
    expect(p2.nextCursor).toBeNull()
    const ids = [...p1.items, ...p2.items].map((x) => x.id)
    expect(new Set(ids).size).toBe(12)
    // do mais recente ao mais antigo
    expect((p1.items[0]?.local.date ?? '') > (p2.items[1]?.local.date ?? '')).toBe(true)
  })

  test('cursor adulterado volta à primeira página', async () => {
    await marcar()
    const visit = await requireCustomer(c.slug, `/${c.slug}/horarios`)
    const r = await listarHorarios(visit, { anteriores: false, depois: 'lixo' })
    expect(r.items).toHaveLength(1)
  })

  test('só vem o horário do próprio cliente', async () => {
    const outro = await makeCustomer(c.b.id)
    const dele = await makePet(c.b.id, outro.id, { name: 'Zeca' })
    await marcar(outro, dele)
    await marcar(c.cliente, c.thor, new Date('2026-11-23T18:00:00Z'))
    const visit = await requireCustomer(c.slug, `/${c.slug}/horarios`)
    const r = await listarHorarios(visit, { anteriores: false })
    expect(r.items.map((x) => x.customer.id)).toEqual([c.cliente.id])
  })
})
