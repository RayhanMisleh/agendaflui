import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeAppointment, makeBusiness, makeCustomer, makePet, makeProfessional, makeService, makeServicePrice, makeWorkingHours } from '../setup/factories'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { ajustarAtendimento, marcarHorario, mudarSituacao, remarcarAtendimento } from '@/app/app/painel/agenda/actions'
import { buscarClientes, cadastrarClienteRapido, servicosDoPet } from '@/app/app/painel/agenda/consultas'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const AGORA = new Date('2026-11-17T12:00:00Z')
const mn = (dia: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, dia, h + 4, m))

function form(campos: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item)
  return fd
}

async function montar() {
  const b = await makeBusiness({ timezone: 'America/Manaus', niche: 'PET' })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60, priceCents: 8000 })
  const tosa = await makeService(b.id, { name: 'Tosa', durationMin: 30, priceCents: 4000 })
  await makeServicePrice(b.id, tosa.id, 'DOG_SMALL', { priceCents: 3000, durationMin: 30 })
  await makeServicePrice(b.id, tosa.id, 'DOG_MEDIUM', { priceCents: 4000, durationMin: 45 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [banho.id, tosa.id] })
  await makeWorkingHours(b.id, ana.id, 'TUESDAY', [{ startMin: 540, endMin: 1080 }])
  const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
  const marina = await makeCustomer(b.id, { name: 'Marina' })
  const thor = await makePet(b.id, marina.id, { name: 'Thor', species: 'DOG', size: 'MEDIUM' })
  const mel = await makePet(b.id, marina.id, { name: 'Mel', species: 'DOG', size: 'SMALL' })
  return { b, banho, tosa, ana, dono, marina, thor, mel }
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
  form({ customerId: m.marina.id, petId: m.thor.id, serviceIds: [m.banho.id], professionalId: m.ana.id, date: '2026-11-17', time: '10:00', ...extra })

describe('marcar com pet', () => {
  test('marcarHorario com petId e durationMin 47 grava 47 min e responde "Horário marcado: Thor (Marina), 10:00."', async () => {
    const r = await marcarHorario(ini, marcacao({ durationMin: '47' }))
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Horário marcado: Thor (Marina), 10:00.')
    const a = await prisma.appointment.findFirstOrThrow({ where: { businessId: m.b.id } })
    expect(a.totalDurationMin).toBe(47)
    expect(a.petId).toBe(m.thor.id)
  })

  test('duração que não é número vira erro do campo', async () => {
    const r = await marcarHorario(ini, marcacao({ durationMin: 'abc' }))
    expect(r.ok).toBe(false)
    expect(r.fields.durationMin).toBe('Use de 5 a 720 minutos.')
  })

  test('marcarHorario sobre outro atendimento devolve confirmation com "10:00–11:00 já tem Rex (Banho)"; reenviar com ack grava como encaixe', async () => {
    const rex = await makePet(m.b.id, m.marina.id, { name: 'Rex' })
    await makeAppointment(m.b.id, { customerId: m.marina.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 10), petId: rex.id })
    const r = await marcarHorario(ini, marcacao())
    expect(r.ok).toBe(false)
    expect(r.confirmation?.issues.map((i) => i.text)).toContain('10:00–11:00 já tem Rex (Banho)')
    expect(await prisma.appointment.count({ where: { businessId: m.b.id } })).toBe(1)
    const ok = await marcarHorario(ini, marcacao({ ack: r.confirmation?.ack ?? '' }))
    expect(ok.ok).toBe(true)
    expect(await prisma.appointment.findFirstOrThrow({ where: { petId: m.thor.id } })).toMatchObject({ isSqueezeIn: true })
  })

  test('marcarHorario em conta pet sem petId devolve fields.petId "Escolha o pet."', async () => {
    const r = await marcarHorario(ini, marcacao({ petId: '' }))
    expect(r.ok).toBe(false)
    expect(r.fields.petId).toBe('Escolha o pet.')
  })

  test('ajustarAtendimento trocando o pet refaz o total pelo porte novo', async () => {
    await marcarHorario(ini, marcacao({ serviceIds: [m.tosa.id] }))
    const a = await prisma.appointment.findFirstOrThrow({ where: { businessId: m.b.id } })
    expect(a.totalCents).toBe(4000)
    const r = await ajustarAtendimento(ini, form({ id: a.id, petId: m.mel.id, price: '40,00' }))
    expect(r.ok).toBe(true)
    const depois = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })
    expect(depois.petId).toBe(m.mel.id)
    expect(depois.totalCents).toBe(3000)
  })

  test('mudarSituacao undo de falta sobre normal devolve confirmation; com ack, reabre como encaixe', async () => {
    const falta = await makeAppointment(m.b.id, { customerId: m.marina.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 10), petId: m.thor.id, status: 'NO_SHOW' })
    await makeAppointment(m.b.id, { customerId: m.marina.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 10), petId: m.mel.id })
    const r = await mudarSituacao(ini, form({ id: falta.id, to: 'undo' }))
    expect(r.ok).toBe(false)
    expect(r.confirmation).toBeDefined()
    const ok = await mudarSituacao(ini, form({ id: falta.id, to: 'undo', ack: r.confirmation?.ack ?? '' }))
    expect(ok.ok).toBe(true)
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: falta.id } })).toMatchObject({ status: 'CONFIRMED', isSqueezeIn: true })
  })
})

describe('remarcar', () => {
  test('remarcarAtendimento para horário ocupado devolve confirmation; com ack grava; ack de outro horário pede de novo', async () => {
    const a = await makeAppointment(m.b.id, { customerId: m.marina.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 9), petId: m.thor.id })
    await makeAppointment(m.b.id, { customerId: m.marina.id, professionalId: m.ana.id, serviceId: m.banho.id, startsAt: mn(17, 14), petId: m.mel.id })
    const campos = { id: a.id, professionalId: m.ana.id, date: '2026-11-17', time: '14:00' }
    const r = await remarcarAtendimento(ini, form(campos))
    expect(r.ok).toBe(false)
    const ack = r.confirmation?.ack ?? ''
    expect(ack).not.toBe('')
    const outro = await remarcarAtendimento(ini, form({ ...campos, time: '14:30', ack }))
    expect(outro.ok).toBe(false)
    expect(outro.confirmation?.ack).not.toBe(ack)
    const ok = await remarcarAtendimento(ini, form({ ...campos, ack }))
    expect(ok.ok).toBe(true)
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ isSqueezeIn: true })
  })
})

describe('consultas da folha de marcar', () => {
  test('servicosDoPet marca não oferecido com reason "Não atende Cão gigante"', async () => {
    const gigante = await makePet(m.b.id, m.marina.id, { name: 'Zeus', species: 'DOG', size: 'GIANT' })
    const r = await servicosDoPet(gigante.id)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const tosa = r.servicos.find((s) => s.id === m.tosa.id)
    expect(tosa).toMatchObject({ offered: false, reason: 'Não atende Cão gigante', priceCents: null })
    expect(r.servicos.find((s) => s.id === m.banho.id)?.offered).toBe(true)
  })

  test('cadastrarClienteRapido com pet cria cliente e pet; pet inválido não deixa cliente', async () => {
    const ok = await cadastrarClienteRapido({ nome: 'Paulo Lima', telefone: '(11) 91234-5678', pet: { name: 'Bidu', species: 'DOG', size: 'SMALL' } })
    expect(ok.ok).toBe(true)
    expect(await prisma.pet.count({ where: { businessId: m.b.id, name: 'Bidu' } })).toBe(1)
    const ruim = await cadastrarClienteRapido({ nome: 'Carla Dias', telefone: '(11) 91234-0000', pet: { name: '', species: 'DOG', size: 'SMALL' } })
    expect(ruim.ok).toBe(false)
    expect(await prisma.customer.count({ where: { businessId: m.b.id, name: 'Carla Dias' } })).toBe(0)
  })

  test('buscarClientes traz os pets de cada cliente e acha pelo nome do pet', async () => {
    const r = await buscarClientes('Thor')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.clientes.map((c) => c.name)).toEqual(['Marina'])
    expect(r.clientes[0]?.pets.map((p) => p.name)).toEqual(['Mel', 'Thor'])
  })
})
