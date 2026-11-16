import type { Actor } from '@/server/auth/actor'
import { CAPABILITIES, can } from '@/server/auth/capabilities'
import { prisma } from '@/server/db/client'
import { getService, listServices } from '@/server/domain/catalog/services'
import { audit } from '@/server/domain/audit'
import { createCustomer, getCustomer, listCustomers, updateCustomer } from '@/server/domain/customers/customers'
import {
  bookAppointment,
  cancelAppointment,
  completeAppointment,
  getAppointment,
  rescheduleAppointment,
} from '@/server/domain/scheduling/appointments'
import { getNextAppointment, listCustomerAppointments } from '@/server/domain/scheduling/agenda'
import { getAvailability, listAvailableDays } from '@/server/domain/scheduling/availability'
import { createTimeBlock, deleteTimeBlock } from '@/server/domain/team/time-blocks'
import { getProfessional, listProfessionals } from '@/server/domain/team/professionals'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeAppointment, makeBusiness, makeCtx, makeCustomer, makeProfessional, makeService, makeWorkingHours } from '../setup/factories'

beforeEach(resetDb)

const GUEST: Actor = { kind: 'guest' }
/** Segunda-feira, 08:00 em São Paulo. */
const AGORA = new Date('2026-11-16T11:00:00Z')
const SEGUNDA = '2026-11-23'

async function montar() {
  const b = await makeBusiness()
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60, priceCents: 8000 })
  const clube = await makeService(b.id, { name: 'Corte do clube', durationMin: 30, clubOnly: true })
  const parado = await makeService(b.id, { name: 'Parado', active: false })
  const ana = await makeProfessional(b.id, { name: 'Ana', commissionBps: 3000, serviceIds: [banho.id, clube.id] })
  await makeWorkingHours(b.id, ana.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
  const cliente = await makeCustomer(b.id)
  const existente = await makeAppointment(b.id, {
    customerId: cliente.id,
    professionalId: ana.id,
    serviceId: banho.id,
    startsAt: new Date('2026-11-30T13:00:00Z'),
  })
  const guest = await makeCtx(b, { actor: GUEST, channel: 'app', now: AGORA })
  return { b, banho, clube, parado, ana, cliente, existente, guest }
}

describe('ator visitante (guest)', () => {
  test('não tem nenhuma capacidade', () => {
    expect(CAPABILITIES.some((c) => can(GUEST, c))).toBe(false)
  })

  test('lê serviços, profissionais e disponibilidade como cliente comum, sem campos internos', async () => {
    const s = await montar()
    const servicos = await listServices(s.guest)
    expect(servicos.map((x) => x.name).sort()).toEqual(['Banho', 'Corte do clube'])
    expect(servicos.map((x) => x.id)).not.toContain(s.parado.id)
    expect((await domainError(getService(s.guest, s.parado.id))).code).toBe('not_found')
    expect((await getService(s.guest, s.banho.id)).id).toBe(s.banho.id)
    const profissionais = await listProfessionals(s.guest, { includeInactive: true, includeArchived: true })
    expect(profissionais.map((p) => p.id)).toEqual([s.ana.id])
    expect(profissionais[0]).not.toHaveProperty('commissionBps')
    expect(profissionais[0]).not.toHaveProperty('membershipId')
    expect(await getProfessional(s.guest, s.ana.id)).toMatchObject({ id: s.ana.id, name: 'Ana' })
    const dia = await getAvailability(s.guest, { date: SEGUNDA, serviceIds: [s.banho.id] })
    expect(dia.slots.length).toBeGreaterThan(0)
    const dias = await listAvailableDays(s.guest, { from: SEGUNDA, to: SEGUNDA, serviceIds: [s.banho.id] })
    expect(dias).toEqual([{ date: SEGUNDA, weekday: 'MONDAY', available: true }])
  })

  test('serviço do clube: forbidden club_only, como para um cliente sem clube', async () => {
    const s = await montar()
    const erro = await domainError(getAvailability(s.guest, { date: SEGUNDA, serviceIds: [s.clube.id] }))
    expect(erro).toMatchObject({ code: 'forbidden', reason: 'club_only' })
    expect((await domainError(listAvailableDays(s.guest, { from: SEGUNDA, to: SEGUNDA, serviceIds: [s.clube.id] }))).reason).toBe('club_only')
  })

  test('aplica antecedência e alcance do cliente: nada antes de 60 minutos nem depois de 60 dias', async () => {
    const s = await montar()
    // 09:30 em São Paulo: com 60 minutos de antecedência, o primeiro início é 10:30.
    const maisTarde = await makeCtx(s.b, { actor: GUEST, channel: 'app', now: new Date('2026-11-16T12:30:00Z') })
    const hoje = await getAvailability(maisTarde, { date: '2026-11-16', serviceIds: [s.banho.id] })
    expect(hoje.slots[0]?.label).toBe('10:30')
    const longe = await getAvailability(s.guest, { date: '2027-03-01', serviceIds: [s.banho.id] })
    expect(longe.slots).toEqual([])
  })

  test('recebe forbidden em todo o resto e não grava nada, nem auditoria', async () => {
    const s = await montar()
    const antes = {
      agendamentos: await prisma.appointment.count(),
      auditoria: await prisma.auditLog.count(),
      clientes: await prisma.customer.count(),
      bloqueios: await prisma.timeBlock.count(),
    }
    const bloqueio = await prisma.timeBlock.create({
      data: { businessId: s.b.id, professionalId: s.ana.id, startsAt: new Date('2026-11-24T15:00:00Z'), endsAt: new Date('2026-11-24T16:00:00Z'), createdByType: 'SYSTEM' },
    })
    antes.bloqueios += 1
    const startsAt = new Date('2026-11-23T14:00:00Z')
    const tentativas: Record<string, () => Promise<unknown>> = {
      marcar: () => bookAppointment(s.guest, { customerId: s.cliente.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt }),
      marcarSemCliente: () => bookAppointment(s.guest, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt }),
      cancelar: () => cancelAppointment(s.guest, s.existente.id),
      remarcar: () => rescheduleAppointment(s.guest, s.existente.id, { startsAt }),
      concluir: () => completeAppointment(s.guest, s.existente.id),
      lerAgendamento: () => getAppointment(s.guest, s.existente.id),
      listarAgendamentos: () => listCustomerAppointments(s.guest, { customerId: s.cliente.id, scope: 'upcoming' }),
      proximo: () => getNextAppointment(s.guest, s.cliente.id),
      lerCliente: () => getCustomer(s.guest, s.cliente.id),
      listarClientes: () => listCustomers(s.guest),
      criarCliente: () => createCustomer(s.guest, { name: 'Novo' }),
      atualizarCliente: () => updateCustomer(s.guest, s.cliente.id, { name: 'Outro nome' }),
      bloquear: () =>
        createTimeBlock(s.guest, { professionalId: s.ana.id, startsAt: new Date('2026-11-23T15:00:00Z'), endsAt: new Date('2026-11-23T16:00:00Z') }),
      apagarBloqueio: () => deleteTimeBlock(s.guest, bloqueio.id),
    }
    for (const [nome, fn] of Object.entries(tentativas)) {
      expect((await domainError(fn())).code, nome).toBe('forbidden')
    }
    expect(await prisma.appointment.count()).toBe(antes.agendamentos)
    expect(await prisma.auditLog.count()).toBe(antes.auditoria)
    expect(await prisma.customer.count()).toBe(antes.clientes)
    expect(await prisma.timeBlock.count()).toBe(antes.bloqueios)
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: s.cliente.id } })).toMatchObject({ name: s.cliente.name })
  })

  test('a auditoria recusa o ator visitante', async () => {
    const s = await montar()
    expect((await domainError(audit(s.guest, { action: 'teste.visitante' }))).code).toBe('forbidden')
    expect(await prisma.auditLog.count({ where: { action: 'teste.visitante' } })).toBe(0)
  })
})
