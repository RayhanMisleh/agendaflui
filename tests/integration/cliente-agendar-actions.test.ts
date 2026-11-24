import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { bookAppointment } from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { makeCtx, makeCustomer, makePet } from '../setup/factories'
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

import { OCUPADO, marcarHorario, remarcarHorario } from '@/app/app/[slug]/agendar/actions'
import { tituloDoSucesso } from '@/app/app/[slug]/agendar/feito/[id]/Sucesso'
import { ESTADO_VAZIO } from '@/app/app/[slug]/_lib/estado'

let c: CenaPet
beforeEach(async () => {
  jar.clear()
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'], now: AGORA })
  c = await cenaPet(jar)
})
afterEach(() => vi.useRealTimers())

function pedido(o: { petId?: string; serviceIds?: string[]; professionalId?: string; startsAt?: Date; note?: string; key?: string }): FormData {
  const fd = new FormData()
  fd.set('petId', o.petId ?? c.thor.id)
  for (const id of o.serviceIds ?? [c.banho.id]) fd.append('serviceIds', id)
  fd.set('professionalId', o.professionalId ?? '')
  fd.set('startsAt', (o.startsAt ?? as14h).toISOString())
  fd.set('customerNote', o.note ?? '')
  fd.set('key', o.key ?? 'chave-1')
  return fd
}

async function redirecionou(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof Error && 'to' in e && typeof e.to === 'string') return e.to
    throw e
  }
  throw new Error('esperava redirect')
}

describe('marcarHorario', () => {
  test('marca para o próprio pet com o preço do porte e redireciona para feito', async () => {
    const para = await redirecionou(marcarHorario(c.slug, ESTADO_VAZIO, pedido({ note: 'Cuidado com o secador' })))
    const a = await prisma.appointment.findFirstOrThrow({ where: { businessId: c.b.id }, include: { items: true } })
    expect(para).toBe(`/${c.slug}/agendar/feito/${a.id}`)
    expect(a).toMatchObject({ customerId: c.cliente.id, petId: c.thor.id, professionalId: c.ana.id, startsAt: as14h, totalCents: 6500, status: 'CONFIRMED', customerNote: 'Cuidado com o secador' })
    expect(a.items).toMatchObject([{ name: 'Banho', priceCents: 6500, durationMin: 60 }])
  })

  test('pet de outro cliente → mensagem de pet e nada gravado', async () => {
    const outro = await makeCustomer(c.b.id)
    const alheio = await makePet(c.b.id, outro.id, { name: 'Alheio' })
    const r = await marcarHorario(c.slug, ESTADO_VAZIO, pedido({ petId: alheio.id }))
    expect(r).toMatchObject({ ok: false, message: 'Escolha um pet deste cliente.', fields: { petId: 'Escolha um pet deste cliente.' } })
    expect(await prisma.appointment.count()).toBe(0)
  })

  test('mesma key duas vezes: um agendamento só e o mesmo redirect', async () => {
    const um = await redirecionou(marcarHorario(c.slug, ESTADO_VAZIO, pedido({})))
    const dois = await redirecionou(marcarHorario(c.slug, ESTADO_VAZIO, pedido({})))
    expect(dois).toBe(um)
    expect(await prisma.appointment.count()).toBe(1)
  })

  test('horário tomado por outro cliente entre escolher e confirmar: mensagem e conflict.nearest', async () => {
    const outro = await makeCustomer(c.b.id, { name: 'Paulo' })
    const dele = await makePet(c.b.id, outro.id, { name: 'Zeca' })
    const dono = await makeCtx(c.b, { now: AGORA })
    await bookAppointment(dono, { customerId: outro.id, petId: dele.id, professionalId: c.ana.id, serviceIds: [c.banho.id], startsAt: as14h })
    for (const pro of ['', c.ana.id]) {
      const r = await marcarHorario(c.slug, ESTADO_VAZIO, pedido({ professionalId: pro, key: `k-${pro || 'qq'}` }))
      expect(r.ok).toBe(false)
      expect(r.message).toBe(OCUPADO)
      expect(r.conflict).toBeDefined()
    }
    expect(await prisma.appointment.count({ where: { customerId: c.cliente.id } })).toBe(0)
  })

  test('o conflito traz os próximos horários livres quando o domínio os calcula', async () => {
    const outro = await makeCustomer(c.b.id, { name: 'Paulo' })
    const dele = await makePet(c.b.id, outro.id, { name: 'Zeca' })
    const dono = await makeCtx(c.b, { now: AGORA })
    await bookAppointment(dono, { customerId: outro.id, petId: dele.id, professionalId: c.ana.id, serviceIds: [c.banho.id], startsAt: as14h })
    const r = await marcarHorario(c.slug, ESTADO_VAZIO, pedido({ professionalId: c.ana.id }))
    for (const n of r.conflict?.nearest ?? []) expect(n).toMatchObject({ iso: expect.stringMatching(/Z$/), label: expect.stringMatching(/^\d\d:\d\d/), date: expect.stringMatching(/^\d{4}-\d\d-\d\d$/) })
  })

  test('gato com gatos desligados → "A loja não atende gatos no momento."', async () => {
    const r = await marcarHorario(c.slug, ESTADO_VAZIO, pedido({ petId: c.mel.id }))
    expect(r).toMatchObject({ ok: false, message: 'A loja não atende gatos no momento.' })
    expect(await prisma.appointment.count()).toBe(0)
  })

  test('horário inválido pede para escolher um horário', async () => {
    const fd = pedido({})
    fd.set('startsAt', 'amanhã')
    expect(await marcarHorario(c.slug, ESTADO_VAZIO, fd)).toMatchObject({ ok: false, fields: { startsAt: 'Escolha um horário.' } })
  })

  test('conta sem autoConfirm: o agendamento fica pendente e o título diz "Pedido de horário enviado"', async () => {
    await prisma.businessSettings.update({ where: { businessId: c.b.id }, data: { autoConfirm: false } })
    await redirecionou(marcarHorario(c.slug, ESTADO_VAZIO, pedido({})))
    const a = await prisma.appointment.findFirstOrThrow()
    expect(a.status).toBe('PENDING')
    expect(tituloDoSucesso({ status: a.status, remarcado: false })).toBe('Pedido de horário enviado')
    expect(tituloDoSucesso({ status: 'CONFIRMED', remarcado: false })).toBe('Horário marcado')
    expect(tituloDoSucesso({ status: 'CONFIRMED', remarcado: true })).toBe('Horário remarcado')
  })

  test('21ª marcação em 60 s → muitas tentativas', async () => {
    const fd = () => {
      const f = pedido({})
      f.set('startsAt', 'x')
      return f
    }
    for (let i = 0; i < 20; i++) await marcarHorario(c.slug, ESTADO_VAZIO, fd())
    expect(await marcarHorario(c.slug, ESTADO_VAZIO, fd())).toMatchObject({ ok: false, message: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.' })
  })
})

describe('remarcarHorario', () => {
  const marcada = async () => {
    const dono = await makeCtx(c.b, { now: AGORA })
    return bookAppointment(dono, { customerId: c.cliente.id, petId: c.thor.id, professionalId: c.ana.id, serviceIds: [c.banho.id], startsAt: as14h })
  }

  test('remarcar para horário livre grava e leva a feito?remarcado=1', async () => {
    const a = await marcada()
    const novo = new Date('2026-11-23T18:00:00Z')
    const fd = new FormData()
    fd.set('appointmentId', a.id)
    fd.set('startsAt', novo.toISOString())
    fd.set('professionalId', c.ana.id)
    expect(await redirecionou(remarcarHorario(c.slug, ESTADO_VAZIO, fd))).toBe(`/${c.slug}/agendar/feito/${a.id}?remarcado=1`)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).startsAt).toEqual(novo)
  })

  test('remarcar para perto do próprio horário (14:30) grava', async () => {
    const a = await marcada()
    const fd = new FormData()
    fd.set('appointmentId', a.id)
    fd.set('startsAt', new Date('2026-11-23T17:30:00Z').toISOString())
    fd.set('professionalId', '')
    await redirecionou(remarcarHorario(c.slug, ESTADO_VAZIO, fd))
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).startsAt).toEqual(new Date('2026-11-23T17:30:00Z'))
  })

  test('agendamento de outro cliente → não encontrado e nada muda', async () => {
    const outro = await makeCustomer(c.b.id)
    const dele = await makePet(c.b.id, outro.id, { name: 'Zeca' })
    const dono = await makeCtx(c.b, { now: AGORA })
    const alheio = await bookAppointment(dono, { customerId: outro.id, petId: dele.id, professionalId: c.ana.id, serviceIds: [c.banho.id], startsAt: as14h })
    const fd = new FormData()
    fd.set('appointmentId', alheio.id)
    fd.set('startsAt', new Date('2026-11-23T18:00:00Z').toISOString())
    const r = await remarcarHorario(c.slug, ESTADO_VAZIO, fd)
    expect(r.ok).toBe(false)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: alheio.id } })).startsAt).toEqual(as14h)
  })
})
