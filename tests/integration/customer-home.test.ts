import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { getCustomerHome, getRebookSuggestion } from '@/server/domain/scheduling/customer-home'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeAppointment, makeBusiness, makeCtx, makeCustomer, makePet, makeProfessional, makeService, makeServicePrice } from '../setup/factories'
import { lancar } from '../setup/loyalty'

const AGORA = new Date('2026-11-17T15:00:00Z')

beforeEach(resetDb)

async function cena() {
  const b = await makeBusiness({ timezone: 'America/Manaus' })
  const banho = await makeService(b.id, { name: 'Banho' })
  const tosa = await makeService(b.id, { name: 'Tosa' })
  const ana = await makeProfessional(b.id, { name: 'Ana', serviceIds: [banho.id, tosa.id] })
  const cliente = await makeCustomer(b.id, { name: 'Marina Souza' })
  const outro = await makeCustomer(b.id, { name: 'João Souza' })
  const ctx = await makeCtx(b, { actor: { kind: 'customer', customerId: cliente.id, name: cliente.name }, now: AGORA })
  return { b, banho, tosa, ana, cliente, outro, ctx }
}

const dias = (n: number) => addMinutes(AGORA, n * 1440)

describe('getCustomerHome', () => {
  test('próximo horário é o do próprio cliente, nunca o de outro cliente da loja', async () => {
    const s = await cena()
    await makeAppointment(s.b.id, { customerId: s.outro.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: dias(1) })
    expect((await getCustomerHome(s.ctx)).next).toBeNull()
    const meu = await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: dias(3) })
    const home = await getCustomerHome(s.ctx)
    expect(home.next?.id).toBe(meu.id)
    expect(home.firstName).toBe('Marina')
  })

  test('módulos desligados: banners vazios e points null; ligados, o saldo', async () => {
    const s = await cena()
    expect(await getCustomerHome(s.ctx)).toMatchObject({ banners: [], points: null })
    await prisma.businessModules.update({ where: { businessId: s.b.id }, data: { loyalty: true, banners: true } })
    await lancar(s.b.id, s.cliente.id, 120)
    expect(await getCustomerHome(s.ctx)).toMatchObject({ banners: [], points: 120 })
  })

  test('ator guest → forbidden', async () => {
    const s = await cena()
    const guest = await makeCtx(s.b, { actor: { kind: 'guest' } })
    expect((await domainError(getCustomerHome(guest))).code).toBe('forbidden')
  })
})

describe('getRebookSuggestion', () => {
  test('usa o último concluído e o profissional que ainda faz tudo', async () => {
    const s = await cena()
    await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.tosa.id, startsAt: dias(-30), status: 'COMPLETED' })
    await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: dias(-7), status: 'COMPLETED' })
    const r = await getRebookSuggestion(s.ctx)
    expect(r).toMatchObject({ serviceNames: ['Banho'], professionalId: s.ana.id, professionalName: 'Ana', petId: null, query: `?servicos=${s.banho.id}&profissional=${s.ana.id}` })
  })

  test('sem concluído, usa o último confirmado que já passou; futuro e cancelado não contam', async () => {
    const s = await cena()
    expect(await getRebookSuggestion(s.ctx)).toBeNull()
    await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.tosa.id, startsAt: dias(2) })
    await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.tosa.id, startsAt: dias(-2), status: 'CANCELED' })
    expect(await getRebookSuggestion(s.ctx)).toBeNull()
    await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: dias(-5) })
    expect((await getRebookSuggestion(s.ctx))?.serviceNames).toEqual(['Banho'])
  })

  test('tira serviço arquivado e do clube (para quem não é do clube); sem nada sobrando, nulo', async () => {
    const s = await cena()
    const vip = await makeService(s.b.id, { name: 'Spa', clubOnly: true })
    await prisma.professionalService.create({ data: { businessId: s.b.id, professionalId: s.ana.id, serviceId: vip.id } })
    await prisma.appointmentItem.create({
      data: { businessId: s.b.id, appointmentId: (await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: dias(-3), status: 'COMPLETED' })).id, serviceId: vip.id, name: 'Spa', priceCents: 1000, durationMin: 30, rewardPoints: 0, position: 2 },
    })
    expect((await getRebookSuggestion(s.ctx))?.serviceNames).toEqual(['Banho'])
    await prisma.customer.update({ where: { id: s.cliente.id }, data: { isClubMember: true } })
    expect((await getRebookSuggestion(s.ctx))?.serviceNames).toEqual(['Banho', 'Spa'])
    await prisma.service.updateMany({ where: { id: { in: [s.banho.id, vip.id] } }, data: { archivedAt: new Date() } })
    expect(await getRebookSuggestion(s.ctx)).toBeNull()
  })

  test('profissional que saiu ou não faz mais tudo fica de fora da sugestão', async () => {
    const s = await cena()
    await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: dias(-3), status: 'COMPLETED' })
    await prisma.professional.update({ where: { id: s.ana.id }, data: { active: false } })
    expect(await getRebookSuggestion(s.ctx)).toMatchObject({ professionalId: null, professionalName: null, query: `?servicos=${s.banho.id}` })
  })

  test('agendamento de outro cliente nunca vira sugestão', async () => {
    const s = await cena()
    await makeAppointment(s.b.id, { customerId: s.outro.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: dias(-3), status: 'COMPLETED' })
    expect(await getRebookSuggestion(s.ctx)).toBeNull()
  })
})

describe('loja de pet shop', () => {
  async function pet() {
    const s = await cena()
    await prisma.business.update({ where: { id: s.b.id }, data: { niche: 'PET' } })
    const thor = await makePet(s.b.id, s.cliente.id, { name: 'Thor', species: 'DOG', size: 'SMALL' })
    return { ...s, thor }
  }

  test('Início traz os pets ativos do cliente; loja sem nicho, lista vazia', async () => {
    const s = await pet()
    const arquivado = await makePet(s.b.id, s.cliente.id, { name: 'Velho', archivedAt: new Date() })
    await makePet(s.b.id, s.outro.id, { name: 'Alheio' })
    const home = await getCustomerHome(s.ctx)
    expect(home.pets.map((p) => p.name)).toEqual(['Thor'])
    expect(home.pets.some((p) => p.id === arquivado.id)).toBe(false)
    const comum = await cena()
    expect((await getCustomerHome(comum.ctx)).pets).toEqual([])
  })

  test('rebook leva o pet e tira serviço que não atende o porte atual do pet', async () => {
    const s = await pet()
    await makeServicePrice(s.b.id, s.tosa.id, 'DOG_SMALL')
    const a = await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: dias(-3), status: 'COMPLETED', petId: s.thor.id })
    await prisma.appointmentItem.create({
      data: { businessId: s.b.id, appointmentId: a.id, serviceId: s.tosa.id, name: 'Tosa', priceCents: 1000, durationMin: 30, rewardPoints: 0, position: 2 },
    })
    expect(await getRebookSuggestion(s.ctx)).toMatchObject({
      petId: s.thor.id,
      petName: 'Thor',
      serviceNames: ['Banho', 'Tosa'],
      query: `?pet=${s.thor.id}&servicos=${s.banho.id},${s.tosa.id}&profissional=${s.ana.id}`,
    })
    await prisma.pet.update({ where: { id: s.thor.id }, data: { size: 'LARGE' } })
    expect((await getRebookSuggestion(s.ctx))?.serviceNames).toEqual(['Banho'])
  })

  test('rebook nulo quando o pet foi arquivado ou é gato com gatos desligados', async () => {
    const s = await pet()
    const mia = await makePet(s.b.id, s.cliente.id, { name: 'Mia', species: 'CAT', size: null })
    await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: dias(-3), status: 'COMPLETED', petId: mia.id })
    expect(await getRebookSuggestion(s.ctx)).toBeNull()
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { nicheOptions: { servesCats: true } } })
    expect((await getRebookSuggestion(s.ctx))?.petName).toBe('Mia')
    await prisma.pet.update({ where: { id: mia.id }, data: { archivedAt: new Date() } })
    expect(await getRebookSuggestion(s.ctx)).toBeNull()
  })
})
