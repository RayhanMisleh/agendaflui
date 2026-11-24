import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { bookAppointment, completeAppointment, getAppointment } from '@/server/domain/scheduling/appointments'
import { getAvailability } from '@/server/domain/scheduling/availability'
import { getReportSummary } from '@/server/domain/reports/summary'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeCtx, makeCustomer, makePet, makeProfessional, makeService, makeServicePrice, makeWorkingHours } from '../setup/factories'

beforeEach(resetDb)

/** Segunda-feira, 08:00 em São Paulo; expediente 09:00–18:00. */
const AGORA = new Date('2026-11-16T11:00:00Z')
const hora = (h: number, m = 0): Date => new Date(Date.UTC(2026, 10, 16, h + 3, m))

async function conta(o: { niche?: 'PET' | null; servesCats?: boolean } = {}) {
  const niche = o.niche === undefined ? 'PET' : o.niche
  const b = await makeBusiness(niche ? { niche } : {})
  await prisma.businessSettings.update({
    where: { businessId: b.id },
    data: { slotStepMin: 30, ...(o.servesCats ? { nicheOptions: { servesCats: true } } : {}) },
  })
  const banho = await makeService(b.id, { name: 'Banho', priceCents: 5000, durationMin: 60 })
  await makeServicePrice(b.id, banho.id, 'DOG_SMALL', { priceCents: 5000, durationMin: 60 })
  await makeServicePrice(b.id, banho.id, 'DOG_LARGE', { priceCents: 8500, durationMin: 90 })
  await makeServicePrice(b.id, banho.id, 'CAT', { priceCents: 6000, durationMin: 60 })
  const unico = await makeService(b.id, { name: 'Hidratação', priceCents: 3000, durationMin: 30 })
  const ana = await makeProfessional(b.id, { name: 'Ana', commissionBps: 5000, serviceIds: [banho.id, unico.id] })
  await makeWorkingHours(b.id, ana.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
  const dono = await makeCtx(b, { now: AGORA })
  const cliente = await makeCustomer(b.id, { name: 'Marina' })
  const doCliente = await makeCtx(b, { actor: { kind: 'customer', customerId: cliente.id, name: cliente.name }, now: AGORA })
  const grande = await makePet(b.id, cliente.id, { name: 'Rex', size: 'LARGE' })
  const pequeno = await makePet(b.id, cliente.id, { name: 'Bob', size: 'SMALL' })
  const gato = await makePet(b.id, cliente.id, { name: 'Mia', species: 'CAT', size: null })
  return { b, banho, unico, ana, dono, cliente, doCliente, grande, pequeno, gato }
}

describe('marcar com pet', () => {
  test('equipe marca para cão grande: total 8500, 90 min, item com variant DOG_LARGE e preço da linha', async () => {
    const s = await conta()
    const v = await bookAppointment(s.dono, { customerId: s.cliente.id, petId: s.grande.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(10) })
    expect(v.totalCents).toBe(8500)
    expect(v.totalDurationMin).toBe(90)
    expect(v.items).toEqual([{ serviceId: s.banho.id, name: 'Banho', priceCents: 8500, durationMin: 90, variant: 'DOG_LARGE' }])
    expect(v.local.end).toBe('11:30')
  })

  test('conta pet sem petId → validation fields.petId; conta sem nicho com petId → validation', async () => {
    const s = await conta()
    const e = await domainError(bookAppointment(s.dono, { customerId: s.cliente.id, professionalId: s.ana.id, serviceIds: [s.unico.id], startsAt: hora(10) }))
    expect(e.code).toBe('validation')
    expect(e.fields?.['petId']).toBe('Escolha o pet.')

    const sem = await conta({ niche: null })
    const e2 = await domainError(bookAppointment(sem.dono, { customerId: sem.cliente.id, petId: sem.grande.id, professionalId: sem.ana.id, serviceIds: [sem.unico.id], startsAt: hora(10) }))
    expect(e2.code).toBe('validation')
    expect(e2.fields?.['petId']).toBe('Esta loja não usa pets.')
    const ok = await bookAppointment(sem.dono, { customerId: sem.cliente.id, professionalId: sem.ana.id, serviceIds: [sem.unico.id], startsAt: hora(10) })
    expect(ok.pet).toBeNull()
  })

  test('pet de outro cliente → validation fields.petId; o banco também recusa (FK composta) num insert direto', async () => {
    const s = await conta()
    const outro = await makeCustomer(s.b.id, { name: 'Paulo' })
    const petDele = await makePet(s.b.id, outro.id, { name: 'Zeca' })
    const e = await domainError(bookAppointment(s.dono, { customerId: s.cliente.id, petId: petDele.id, professionalId: s.ana.id, serviceIds: [s.unico.id], startsAt: hora(10) }))
    expect(e.fields?.['petId']).toBeTruthy()
    await expect(
      prisma.appointment.create({
        data: {
          businessId: s.b.id,
          customerId: s.cliente.id,
          petId: petDele.id,
          professionalId: s.ana.id,
          startsAt: hora(10),
          endsAt: hora(11),
          status: 'CONFIRMED',
          source: 'PANEL',
          totalCents: 0,
          totalDurationMin: 60,
          createdByType: 'SYSTEM',
        },
      }),
    ).rejects.toThrow()
  })

  test('cliente marca para o próprio pet; para pet de outro cliente → validation', async () => {
    const s = await conta()
    const v = await bookAppointment(s.doCliente, { petId: s.pequeno.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(10) })
    expect(v.totalCents).toBe(5000)
    expect(v.pet).toEqual({ id: s.pequeno.id, name: 'Bob', typeLabel: 'Cão pequeno' })
    const outro = await makeCustomer(s.b.id)
    const petDele = await makePet(s.b.id, outro.id)
    const e = await domainError(bookAppointment(s.doCliente, { petId: petDele.id, professionalId: s.ana.id, serviceIds: [s.unico.id], startsAt: hora(12) }))
    expect(e.code).toBe('validation')
  })

  test('cliente com gato e gatos desligados → recusa; equipe com o mesmo gato num SINGLE marca', async () => {
    const s = await conta()
    const e1 = await domainError(bookAppointment(s.doCliente, { petId: s.gato.id, professionalId: s.ana.id, serviceIds: [s.unico.id], startsAt: hora(10) }))
    expect(e1.message).toBe('A loja não atende gatos no momento.')
    const e2 = await domainError(bookAppointment(s.doCliente, { petId: s.gato.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(10) }))
    expect(e2.message).toBe('A loja não atende gatos no momento.')
    const v = await bookAppointment(s.dono, { customerId: s.cliente.id, petId: s.gato.id, professionalId: s.ana.id, serviceIds: [s.unico.id], startsAt: hora(10) })
    expect(v.items[0]?.variant).toBe('CAT')
  })

  test('mudar o preço da linha depois não muda o agendamento já feito (foto do momento)', async () => {
    const s = await conta()
    const v = await bookAppointment(s.dono, { customerId: s.cliente.id, petId: s.grande.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(10) })
    await prisma.servicePrice.updateMany({ where: { serviceId: s.banho.id, variant: 'DOG_LARGE' }, data: { priceCents: 9900, durationMin: 120 } })
    const depois = await getAppointment(s.dono, v.id)
    expect(depois.totalCents).toBe(8500)
    expect(depois.totalDurationMin).toBe(90)
    expect(depois.items[0]?.priceCents).toBe(8500)
  })

  test('mudar o porte do pet depois não muda o item já gravado; a visão mostra o typeLabel novo do pet', async () => {
    const s = await conta()
    const v = await bookAppointment(s.dono, { customerId: s.cliente.id, petId: s.pequeno.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(10) })
    await prisma.pet.update({ where: { id: s.pequeno.id }, data: { size: 'GIANT' } })
    const depois = await getAppointment(s.dono, v.id)
    expect(depois.items[0]?.variant).toBe('DOG_SMALL')
    expect(depois.pet?.typeLabel).toBe('Cão gigante')
  })

  test('visão traz pet { name, typeLabel }; conta sem nicho traz pet null', async () => {
    const s = await conta()
    const v = await bookAppointment(s.dono, { customerId: s.cliente.id, petId: s.grande.id, professionalId: s.ana.id, serviceIds: [s.unico.id], startsAt: hora(10) })
    expect(v.pet).toEqual({ id: s.grande.id, name: 'Rex', typeLabel: 'Cão grande' })
    expect(v.items[0]?.variant).toBe('DOG_LARGE')
    const sem = await conta({ niche: null })
    const w = await bookAppointment(sem.dono, { customerId: sem.cliente.id, professionalId: sem.ana.id, serviceIds: [sem.unico.id], startsAt: hora(10) })
    expect(w.pet).toBeNull()
    expect(w.items[0]?.variant).toBeNull()
  })
})

describe('disponibilidade com pet', () => {
  test('getAvailability com petId usa a duração do porte (grande: 90 min → último início 16:30)', async () => {
    const s = await conta()
    const r = await getAvailability(s.dono, { date: '2026-11-16', serviceIds: [s.banho.id], petId: s.grande.id })
    expect(r.durationMin).toBe(90)
    expect(r.totalCents).toBe(8500)
    expect(r.slots.at(-1)?.label).toBe('16:30')
  })

  test('getAvailability: cliente com durationMin → forbidden; equipe com durationMin usa o pedido', async () => {
    const s = await conta()
    const e = await domainError(getAvailability(s.doCliente, { date: '2026-11-16', serviceIds: [s.unico.id], petId: s.pequeno.id, durationMin: 20 }))
    expect(e.code).toBe('forbidden')
    const r = await getAvailability(s.dono, { date: '2026-11-16', serviceIds: [s.unico.id], petId: s.pequeno.id, durationMin: 120 })
    expect(r.durationMin).toBe(120)
    const ruim = await domainError(getAvailability(s.dono, { date: '2026-11-16', serviceIds: [s.unico.id], petId: s.pequeno.id, durationMin: 721 }))
    expect(ruim.code).toBe('validation')
  })
})

describe('concluir com pet', () => {
  test('comissão sobre o totalCents da foto; relatório soma o mesmo valor', async () => {
    const s = await conta()
    const v = await bookAppointment(s.dono, { customerId: s.cliente.id, petId: s.grande.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(9) })
    const depois = await makeCtx(s.b, { now: hora(11) })
    const feito = await completeAppointment(depois, v.id)
    expect(feito.commissionCents).toBe(4250)
    const r = await getReportSummary(depois, { from: '2026-11-16', to: '2026-11-16' })
    expect(r.revenueCents).toBe(8500)
    expect(r.commissionCents).toBe(4250)
  })
})
