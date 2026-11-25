import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

import { GET } from '@/app/app/[slug]/(area)/horarios/[id]/agenda.ics/route'

let c: CenaPet
beforeEach(async () => {
  jar.clear()
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'], now: AGORA })
  c = await cenaPet(jar)
})
afterEach(() => vi.useRealTimers())

const pedir = (slug: string, id: string) => GET(new Request(`http://app.localhost:3000/${slug}/horarios/${id}/agenda.ics`), { params: Promise.resolve({ slug, id }) })

async function marcar(cliente: { id: string }, pet: { id: string }) {
  return bookAppointment(await makeCtx(c.b, { now: AGORA }), { customerId: cliente.id, petId: pet.id, professionalId: c.ana.id, serviceIds: [c.banho.id], startsAt: as14h })
}

describe('.ics do cliente', () => {
  test('cliente baixa o .ics do próprio horário com DTSTART em UTC e o pet no título', async () => {
    const a = await marcar(c.cliente, c.thor)
    const r = await pedir(c.slug, a.id)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="horario-2026-11-23.ics"')
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    const corpo = await r.text()
    expect(corpo).toContain('DTSTART:20261123T170000Z')
    expect(corpo).toContain('SUMMARY:Banho para Thor em')
  })

  test('id de outro cliente → 404', async () => {
    const outro = await makeCustomer(c.b.id)
    const dele = await makePet(c.b.id, outro.id, { name: 'Zeca' })
    const alheio = await marcar(outro, dele)
    expect((await pedir(c.slug, alheio.id)).status).toBe(404)
  })

  test('id de agendamento de outra loja pelo slug desta → 404', async () => {
    const lojaB = await makeBusiness({ niche: 'PET' })
    const clienteB = await makeCustomer(lojaB.id)
    const petB = await makePet(lojaB.id, clienteB.id, { name: 'B' })
    const { makeService, makeServicePrice, makeProfessional, makeWorkingHours } = await import('../setup/factories')
    const servico = await makeService(lojaB.id, { name: 'Banho', priceCents: 5000 })
    await makeServicePrice(lojaB.id, servico.id, 'DOG_MEDIUM', {})
    const prof = await makeProfessional(lojaB.id, { name: 'Bia', serviceIds: [servico.id] })
    await makeWorkingHours(lojaB.id, prof.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
    const b = await bookAppointment(await makeCtx(lojaB, { now: AGORA }), { customerId: clienteB.id, petId: petB.id, professionalId: prof.id, serviceIds: [servico.id], startsAt: as14h })
    expect((await pedir(c.slug, b.id)).status).toBe(404)
  })

  test('sem sessão → 404; id que não é UUID → 404', async () => {
    const a = await marcar(c.cliente, c.thor)
    expect((await pedir(c.slug, 'nao-e-id')).status).toBe(404)
    jar.clear()
    expect((await pedir(c.slug, a.id)).status).toBe(404)
  })
})
