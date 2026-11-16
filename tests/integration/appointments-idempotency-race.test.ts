import { vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { bookAppointmentWithOutcome, idempotencyRequestHash } from '@/server/domain/scheduling/appointments'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeAppointment, makeBusiness, makeCtx, makeCustomer, makeProfessional, makeService, makeWorkingHours } from '../setup/factories'

// Ponto de injeção: roda depois da leitura sob a trava e antes da gravação do agendamento.
const gancho = vi.hoisted(() => ({ antesDeGravar: null as null | (() => Promise<void>) }))

vi.mock('@/server/domain/scheduling/placement', async (original) => {
  const real = await original<typeof import('@/server/domain/scheduling/placement')>()
  return {
    ...real,
    placeAppointment: async (...args: Parameters<typeof real.placeAppointment>) => {
      const escolhido = await real.placeAppointment(...args)
      await gancho.antesDeGravar?.()
      return escolhido
    },
  }
})

beforeEach(async () => {
  await resetDb()
  gancho.antesDeGravar = null
})

const AGORA = new Date('2026-11-16T11:00:00Z')
const DEZ = new Date('2026-11-23T13:00:00Z')

async function montar() {
  const b = await makeBusiness()
  const banho = await makeService(b.id, { durationMin: 60 })
  const ana = await makeProfessional(b.id, { name: 'Ana', serviceIds: [banho.id] })
  await makeWorkingHours(b.id, ana.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
  const cli = await makeCustomer(b.id)
  const ctx = await makeCtx(b, { actor: { kind: 'customer', customerId: cli.id, name: cli.name }, now: AGORA })
  const pedido = { professionalId: ana.id, serviceIds: [banho.id], startsAt: DEZ, idempotencyKey: 'corrida-1' }
  /** Linha que "outra requisição" grava por fora, com a mesma chave. */
  const porFora = async (hash: string) =>
    makeAppointment(b.id, { customerId: cli.id, professionalId: ana.id, serviceId: banho.id, startsAt: addMinutes(DEZ, 24 * 60) }).then((a) =>
      prisma.appointment.update({ where: { id: a.id }, data: { idempotencyKey: 'corrida-1', idempotencyKeyAt: AGORA, idempotencyRequestHash: hash } }),
    )
  return { b, ctx, pedido, porFora, cli }
}

describe('violação do índice único da chave de idempotência', () => {
  test('perdeu a corrida com um pedido igual: relê e devolve a repetição, sem agendamento a mais', async () => {
    const s = await montar()
    let inserida = ''
    gancho.antesDeGravar = async () => {
      inserida = (await s.porFora(idempotencyRequestHash({ ...s.pedido, customerNote: null }))).id
      gancho.antesDeGravar = null
    }
    const r = await bookAppointmentWithOutcome(s.ctx, s.pedido)
    expect(r.replayed).toBe(true)
    expect(r.appointment.id).toBe(inserida)
    expect(await prisma.appointment.count({ where: { businessId: s.b.id } })).toBe(1)
  })

  test('perdeu a corrida com um pedido diferente: idempotency_key_reused', async () => {
    const s = await montar()
    gancho.antesDeGravar = async () => {
      await s.porFora('hash-de-outro-pedido')
      gancho.antesDeGravar = null
    }
    const erro = await domainError(bookAppointmentWithOutcome(s.ctx, s.pedido))
    expect(erro).toMatchObject({ code: 'conflict', reason: 'idempotency_key_reused' })
    expect(await prisma.appointment.count({ where: { businessId: s.b.id } })).toBe(1)
  })

  test('outro índice único violado não é tratado como repetição (o erro sobe)', async () => {
    const s = await montar()
    gancho.antesDeGravar = async () => {
      throw Object.assign(new Error('outro'), { code: 'P2002', meta: { modelName: 'Appointment', target: ['customers_business_id_email_key'] } })
    }
    await expect(bookAppointmentWithOutcome(s.ctx, s.pedido)).rejects.toMatchObject({ code: 'P2002' })
  })
})
