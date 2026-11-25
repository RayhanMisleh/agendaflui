import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeCustomer, makePet } from '../setup/factories'
import { AGORA, SEGUNDA, cenaPet, type CenaPet } from '../setup/cliente-agenda'

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
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

import { diasLivres, horariosLivres, profissionaisPara, servicosDoPet } from '@/app/app/[slug]/(area)/agendar/consultas'

let c: CenaPet
beforeEach(async () => {
  jar.clear()
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'], now: AGORA })
  c = await cenaPet(jar)
})
afterEach(() => vi.useRealTimers())

const escopo = () => ({ serviceIds: [c.banho.id], petId: c.thor.id, professionalId: null, rescheduling: null })

describe('consultas do Agendar', () => {
  test('servicosDoPet traz o preço e o tempo do porte do pet', async () => {
    const r = await servicosDoPet(c.slug, c.thor.id)
    expect(r).toMatchObject({ ok: true, servicos: [{ id: c.banho.id, name: 'Banho', priceCents: 6500, durationMin: 60, durationLabel: '1 h', clubOnly: false, locked: false }] })
  })

  test('servicosDoPet de pet de outro cliente → ok false "Pet não encontrado."', async () => {
    const outro = await makeCustomer(c.b.id)
    const alheio = await makePet(c.b.id, outro.id, { name: 'Alheio' })
    expect(await servicosDoPet(c.slug, alheio.id)).toMatchObject({ ok: false, message: 'Pet não encontrado.' })
  })

  test('gato com gatos desligados: nenhum serviço é oferecido', async () => {
    expect(await servicosDoPet(c.slug, c.mel.id)).toMatchObject({ ok: true, servicos: [] })
  })

  test('serviço do Clube aparece trancado para quem não é do Clube', async () => {
    await prisma.service.update({ where: { id: c.banho.id }, data: { clubOnly: true } })
    expect(await servicosDoPet(c.slug, c.thor.id)).toMatchObject({ ok: true, servicos: [{ clubOnly: true, locked: true }] })
    await prisma.customer.update({ where: { id: c.cliente.id }, data: { isClubMember: true } })
    expect(await servicosDoPet(c.slug, c.thor.id)).toMatchObject({ ok: true, servicos: [{ clubOnly: true, locked: false }] })
  })

  test('profissionaisPara lista só quem faz os serviços, sem dado interno', async () => {
    const r = await profissionaisPara(c.slug, [c.banho.id])
    expect(r).toEqual({ ok: true, profissionais: [{ id: c.ana.id, name: 'Ana', avatarUrl: null }] })
  })

  test('horariosLivres do dia de expediente e vazio no dia sem expediente', async () => {
    const r = await horariosLivres(c.slug, { date: SEGUNDA, ...escopo() })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.horarios[0]).toEqual({ iso: '2026-11-23T12:00:00.000Z', label: '09:00' })
    expect(r.horarios.length).toBeGreaterThan(10)
    expect(await horariosLivres(c.slug, { date: '2026-11-24', ...escopo() })).toEqual({ ok: true, horarios: [] })
  })

  test('diasLivres marca só as segundas como livres, dá 14 dias e diz hasMore', async () => {
    const r = await diasLivres(c.slug, { from: '2026-11-16', ...escopo() })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dias).toHaveLength(14)
    expect(r.dias[0]).toMatchObject({ date: '2026-11-16', weekdayShort: 'Hoje' })
    expect(r.dias[1]).toMatchObject({ date: '2026-11-17', weekdayShort: 'Amanhã', label: '17' })
    expect(r.dias.filter((d) => d.available).map((d) => d.date)).toEqual(['2026-11-16', '2026-11-23'])
    expect(r.hasMore).toBe(true)
  })

  test('diasLivres corta em maxAdvanceDays e diz hasMore falso', async () => {
    await prisma.businessSettings.update({ where: { businessId: c.b.id }, data: { maxAdvanceDays: 10 } })
    const r = await diasLivres(c.slug, { from: '2026-11-16', ...escopo() })
    expect(r).toMatchObject({ ok: true, hasMore: false })
    if (r.ok) expect(r.dias.map((d) => d.date).at(-1)).toBe('2026-11-26')
    expect(await diasLivres(c.slug, { from: '2026-11-27', ...escopo() })).toEqual({ ok: true, dias: [], hasMore: false, proximo: '2026-11-27' })
  })

  test('horariosLivres com rescheduling de outro cliente → ok false', async () => {
    const outro = await makeCustomer(c.b.id)
    const alheiaPet = await makePet(c.b.id, outro.id, { name: 'Zeca' })
    const { makeAppointment } = await import('../setup/factories')
    const a = await makeAppointment(c.b.id, { customerId: outro.id, professionalId: c.ana.id, serviceId: c.banho.id, petId: alheiaPet.id, startsAt: new Date('2026-11-23T14:00:00Z') })
    const r = await horariosLivres(c.slug, { date: SEGUNDA, serviceIds: [], petId: '', professionalId: null, rescheduling: a.id })
    expect(r.ok).toBe(false)
  })

  test('visitante sem sessão → ok false com o caminho para entrar de novo', async () => {
    jar.clear()
    expect(await servicosDoPet(c.slug, c.thor.id)).toEqual({ ok: false, message: 'Entre de novo para continuar.', reentrar: `/${c.slug}/entrar` })
  })

  test('61ª consulta de horários em 60 s → mensagem de muitas tentativas', async () => {
    for (let i = 0; i < 60; i++) expect((await horariosLivres(c.slug, { date: SEGUNDA, ...escopo() })).ok).toBe(true)
    const r = await horariosLivres(c.slug, { date: SEGUNDA, ...escopo() })
    expect(r).toMatchObject({ ok: false, message: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.' })
  })
})
