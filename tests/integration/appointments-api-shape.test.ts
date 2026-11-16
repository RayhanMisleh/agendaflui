import { prisma } from '@/server/db/client'
import { anonymizeCustomer, archiveCustomer } from '@/server/domain/customers/customers'
import { listCustomerAppointments } from '@/server/domain/scheduling/agenda'
import {
  bookAppointment,
  cancelAppointment,
  getAppointment,
  undoOutcome,
} from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeAppointment,
  makeBusiness,
  makeCtx,
  makeCustomer,
  makeProfessional,
  makeService,
  makeWorkingHours,
  memberOf,
} from '../setup/factories'

beforeEach(resetDb)

const MANHA = { startMin: 540, endMin: 720 }
/** Segunda-feira, 08:00 em São Paulo. */
const SEGUNDA_08H = new Date('2026-11-16T11:00:00Z')
/** Segunda-feira, 10:00 em São Paulo. */
const DEZ = new Date('2026-11-16T13:00:00Z')

async function montar(o: { timezone?: string } = {}) {
  const b = await makeBusiness(o.timezone ? { timezone: o.timezone } : {})
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30 } })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60 })
  const ana = await makeProfessional(b.id, { name: 'Ana', serviceIds: [banho.id] })
  await makeWorkingHours(b.id, ana.id, 'MONDAY', [MANHA])
  const customer = await makeCustomer(b.id)
  const gerente = await makeCtx(b, { now: SEGUNDA_08H })
  const cliente = await customerAt(b, customer, SEGUNDA_08H)
  return { b, banho, ana, customer, gerente, cliente }
}

const customerAt = (b: { id: string }, c: { id: string; name: string }, now: Date) =>
  makeCtx(b, { actor: { kind: 'customer', customerId: c.id, name: c.name }, now })

describe('canal da ação', () => {
  test('a equipe marca pelo painel (PANEL) por padrão e pelo app (APP) quando o canal é app', async () => {
    const s = await montar()
    const base = { customerId: s.customer.id, professionalId: s.ana.id, serviceIds: [s.banho.id] }
    const painel = await bookAppointment(s.gerente, { ...base, startsAt: DEZ })
    expect(painel.source).toBe('PANEL')
    const viaApp = await makeCtx(s.b, { now: SEGUNDA_08H, channel: 'app' })
    expect(viaApp.channel).toBe('app')
    const app = await bookAppointment(viaApp, { ...base, startsAt: new Date('2026-11-16T14:00:00Z') })
    expect(app.source).toBe('APP')
    expect(s.gerente.channel).toBe('panel')
  })

  test('o cliente do app chega pelo canal app e grava APP', async () => {
    const s = await montar()
    expect(s.cliente.channel).toBe('app')
    const v = await bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    expect(v.source).toBe('APP')
  })

  test('o canal de sistema não vira APP', async () => {
    const s = await montar()
    const sistema = await makeCtx(s.b, { now: SEGUNDA_08H, channel: 'system' })
    const v = await bookAppointment(sistema, {
      customerId: s.customer.id,
      professionalId: s.ana.id,
      serviceIds: [s.banho.id],
      startsAt: DEZ,
    })
    expect(v.source).toBe('PANEL')
  })
})

describe('nota do cliente', () => {
  test('o cliente marca com customerNote; ele e a equipe leem o texto, e as notas internas seguem separadas', async () => {
    const s = await montar()
    const v = await bookAppointment(s.cliente, {
      professionalId: s.ana.id,
      serviceIds: [s.banho.id],
      startsAt: DEZ,
      customerNote: '  Tem medo de secador  ',
    })
    expect(v.customerNote).toBe('Tem medo de secador')
    expect(v).not.toHaveProperty('notes')
    expect((await getAppointment(s.cliente, v.id)).customerNote).toBe('Tem medo de secador')
    const staff = await getAppointment(s.gerente, v.id)
    expect(staff.customerNote).toBe('Tem medo de secador')
    expect(staff.notes).toBeNull()
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: v.id } })).customerNote).toBe('Tem medo de secador')
  })

  test('sem nota, ou com texto vazio, é null; mais de 500 caracteres é validação', async () => {
    const s = await montar()
    const base = { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ }
    expect((await bookAppointment(s.cliente, { ...base, customerNote: '   ' })).customerNote).toBeNull()
    const longa = await domainError(bookAppointment(s.cliente, { ...base, customerNote: 'a'.repeat(501) }))
    expect(longa.code).toBe('validation')
    expect(longa.fields?.['customerNote']).toBeDefined()
  })

  test('o cliente que envia notes recebe forbidden; a equipe grava notes internas e também customerNote', async () => {
    const s = await montar()
    const base = { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ }
    const e = await domainError(bookAppointment(s.cliente, { ...base, notes: 'interna' }))
    expect(e.code).toBe('forbidden')
    expect(await prisma.appointment.count({ where: { businessId: s.b.id } })).toBe(0)
    const v = await bookAppointment(s.gerente, { ...base, customerId: s.customer.id, notes: 'interna', customerNote: 'pedido' })
    expect(v.notes).toBe('interna')
    expect(v.customerNote).toBe('pedido')
  })
})

describe('change (prazo de alteração)', () => {
  test('until é o início menos 120 min; allowed vira falso um minuto depois do prazo', async () => {
    const s = await montar()
    const ag = await makeAppointment(s.b.id, {
      customerId: s.customer.id,
      professionalId: s.ana.id,
      serviceId: s.banho.id,
      startsAt: DEZ,
    })
    const noPrazo = await getAppointment(s.cliente, ag.id)
    expect(noPrazo.change.until?.toISOString()).toBe('2026-11-16T11:00:00.000Z')
    expect(noPrazo.change.untilLabel).toBe('16/11/2026 08:00')
    expect(noPrazo.change.allowed).toBe(true)

    const limite = await customerAt(s.b, s.customer, new Date('2026-11-16T11:00:00Z'))
    expect((await getAppointment(limite, ag.id)).change.allowed).toBe(true)
    const depois = await customerAt(s.b, s.customer, new Date('2026-11-16T11:01:00Z'))
    const fora = await getAppointment(depois, ag.id)
    expect(fora.change.allowed).toBe(false)
    expect(fora.change.until?.toISOString()).toBe('2026-11-16T11:00:00.000Z')
  })

  test('usa o prazo configurado na conta', async () => {
    const s = await montar()
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { customerChangeWindowMin: 30 } })
    const ag = await makeAppointment(s.b.id, {
      customerId: s.customer.id,
      professionalId: s.ana.id,
      serviceId: s.banho.id,
      startsAt: DEZ,
    })
    expect((await getAppointment(s.cliente, ag.id)).change.until?.toISOString()).toBe('2026-11-16T12:30:00.000Z')
  })

  test('agendamento cancelado nunca permite alterar, mas o prazo continua calculado', async () => {
    const s = await montar()
    const ag = await makeAppointment(s.b.id, {
      customerId: s.customer.id,
      professionalId: s.ana.id,
      serviceId: s.banho.id,
      startsAt: DEZ,
    })
    const cancelado = await cancelAppointment(s.cliente, ag.id)
    expect(cancelado.status).toBe('CANCELED')
    expect(cancelado.change).toEqual({
      allowed: false,
      until: new Date('2026-11-16T11:00:00Z'),
      untilLabel: '16/11/2026 08:00',
    })
  })

  test('para a equipe, allowed segue a situação e until vem igual', async () => {
    const s = await montar()
    const ag = await makeAppointment(s.b.id, {
      customerId: s.customer.id,
      professionalId: s.ana.id,
      serviceId: s.banho.id,
      startsAt: DEZ,
    })
    const tarde = await makeCtx(s.b, { now: new Date('2026-11-16T12:50:00Z') })
    const v = await getAppointment(tarde, ag.id)
    expect(v.change.allowed).toBe(true)
    expect(v.change.until?.toISOString()).toBe('2026-11-16T11:00:00.000Z')
    const concluido = await makeAppointment(s.b.id, {
      customerId: s.customer.id,
      professionalId: s.ana.id,
      serviceId: s.banho.id,
      startsAt: new Date('2026-11-16T14:00:00Z'),
      status: 'COMPLETED',
    })
    expect((await getAppointment(tarde, concluido.id)).change.allowed).toBe(false)
  })

  test('o rótulo usa o fuso da conta (Manaus)', async () => {
    const s = await montar({ timezone: 'America/Manaus' })
    // 10:00 em Manaus = 14:00Z; prazo 08:00 em Manaus = 12:00Z.
    const ag = await makeAppointment(s.b.id, {
      customerId: s.customer.id,
      professionalId: s.ana.id,
      serviceId: s.banho.id,
      startsAt: new Date('2026-11-16T14:00:00Z'),
    })
    const v = await getAppointment(s.cliente, ag.id)
    expect(v.change.until?.toISOString()).toBe('2026-11-16T12:00:00.000Z')
    expect(v.change.untilLabel).toBe('16/11/2026 08:00')
  })
})

describe('change.allowed diz se o ator pode alterar', () => {
  test('profissional vê o agendamento de um colega pela ficha do cliente com allowed false; o dele, true', async () => {
    const s = await montar()
    const eu = await ctxWithRole(s.b, 'PROFESSIONAL', { now: SEGUNDA_08H })
    const minha = await makeProfessional(s.b.id, {
      name: 'Eu',
      membershipId: memberOf(eu).membershipId,
      serviceIds: [s.banho.id],
    })
    const base = { customerId: s.customer.id, serviceId: s.banho.id }
    const meu = await makeAppointment(s.b.id, { ...base, professionalId: minha.id, startsAt: DEZ })
    const doColega = await makeAppointment(s.b.id, {
      ...base,
      professionalId: s.ana.id,
      startsAt: new Date('2026-11-16T15:00:00Z'),
    })
    const lista = await listCustomerAppointments(eu, { customerId: s.customer.id, scope: 'upcoming' })
    const allowed = Object.fromEntries(lista.items.map((v) => [v.id, v.change.allowed]))
    expect(allowed).toEqual({ [meu.id]: true, [doColega.id]: false })
    const gerente = await listCustomerAppointments(s.gerente, { customerId: s.customer.id, scope: 'upcoming' })
    expect(gerente.items.map((v) => v.change.allowed)).toEqual([true, true])
  })

  test('cliente só altera o próprio agendamento: na view dele é true, e outro cliente nem o lê', async () => {
    const s = await montar()
    const ag = await makeAppointment(s.b.id, {
      customerId: s.customer.id,
      professionalId: s.ana.id,
      serviceId: s.banho.id,
      startsAt: DEZ,
    })
    expect((await getAppointment(s.cliente, ag.id)).change.allowed).toBe(true)
  })
})

describe('anonimização e nota do cliente', () => {
  test('apaga customerNote de todos os agendamentos do cliente, passados e futuros', async () => {
    const s = await montar()
    const base = { customerId: s.customer.id, professionalId: s.ana.id, serviceId: s.banho.id }
    const futuro = await makeAppointment(s.b.id, { ...base, startsAt: DEZ })
    const passado = await makeAppointment(s.b.id, {
      ...base,
      startsAt: new Date('2026-11-09T13:00:00Z'),
      status: 'COMPLETED',
    })
    const outro = await makeCustomer(s.b.id)
    const deOutro = await makeAppointment(s.b.id, {
      customerId: outro.id,
      professionalId: s.ana.id,
      serviceId: s.banho.id,
      startsAt: new Date('2026-11-16T15:00:00Z'),
    })
    await prisma.appointment.updateMany({
      where: { id: { in: [futuro.id, passado.id, deOutro.id] } },
      data: { customerNote: 'Tem medo de secador' },
    })
    await anonymizeCustomer(s.gerente, s.customer.id)
    const meus = await prisma.appointment.findMany({ where: { customerId: s.customer.id } })
    expect(meus).toHaveLength(2)
    expect(meus.map((a) => a.customerNote)).toEqual([null, null])
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: deOutro.id } })).customerNote).toBe(
      'Tem medo de secador',
    )
    expect((await getAppointment(s.gerente, passado.id)).customerNote).toBeNull()
  })
})

describe('desfazer o resultado com o cliente fora', () => {
  async function concluido() {
    const s = await montar()
    const ag = await makeAppointment(s.b.id, {
      customerId: s.customer.id,
      professionalId: s.ana.id,
      serviceId: s.banho.id,
      startsAt: DEZ,
      status: 'COMPLETED',
    })
    return { s, ag }
  }

  test('cliente anonimizado: conflict customer_gone e o agendamento continua concluído', async () => {
    const { s, ag } = await concluido()
    await anonymizeCustomer(s.gerente, s.customer.id)
    const e = await domainError(undoOutcome(s.gerente, ag.id))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('customer_gone')
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: ag.id } })).status).toBe('COMPLETED')
  })

  test('cliente arquivado: conflict customer_gone', async () => {
    const { s, ag } = await concluido()
    await archiveCustomer(s.gerente, s.customer.id)
    const e = await domainError(undoOutcome(s.gerente, ag.id))
    expect(e.reason).toBe('customer_gone')
  })

  test('cliente ativo: desfaz normalmente', async () => {
    const { s, ag } = await concluido()
    expect((await undoOutcome(s.gerente, ag.id)).status).toBe('CONFIRMED')
  })
})

describe('arquivar e anonimizar ao mesmo tempo', () => {
  test('duas anonimizações simultâneas gravam uma só auditoria', async () => {
    const s = await montar()
    const dono = await ctxWithRole(s.b, 'OWNER', { now: SEGUNDA_08H })
    await Promise.all([anonymizeCustomer(s.gerente, s.customer.id), anonymizeCustomer(dono, s.customer.id)])
    const logs = await prisma.auditLog.findMany({ where: { businessId: s.b.id, action: 'customer.anonymized' } })
    expect(logs).toHaveLength(1)
  })

  test('dois arquivamentos simultâneos gravam uma só auditoria', async () => {
    const s = await montar()
    const dono = await ctxWithRole(s.b, 'OWNER', { now: SEGUNDA_08H })
    await Promise.all([archiveCustomer(s.gerente, s.customer.id), archiveCustomer(dono, s.customer.id)])
    const logs = await prisma.auditLog.findMany({ where: { businessId: s.b.id, action: 'customer.archived' } })
    expect(logs).toHaveLength(1)
  })
})
