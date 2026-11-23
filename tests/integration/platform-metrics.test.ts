import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import type { AppointmentStatus, Business } from '@/server/db/generated/client'
import { getAccountMetrics, getOverview } from '@/server/domain/platform/metrics'
import { addMinutes, fromIsoInstant } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeCustomer, makeMembership, makePlatformAdmin, makeProfessional, makeService, makeUser } from '../setup/factories'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

// Segunda-feira, 16/11/2026, 12:00 em São Paulo (15:00 UTC), 11:00 em Manaus.
const NOW = fromIsoInstant('2026-11-16T15:00:00.000Z')
const at = (s: string) => fromIsoInstant(s)
const dias = (d: Date, n: number) => addMinutes(d, n * 24 * 60)

let actor: PlatformAdminActor
beforeEach(async () => {
  await resetDb()
  const admin = await makePlatformAdmin()
  actor = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
})
afterEach(() => vi.restoreAllMocks())

type Conta = { business: Business; customerId: string; professionalId: string; serviceId: string }

async function conta(o: { timezone?: string; status?: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'; createdAt?: Date } = {}): Promise<Conta> {
  // Datas fixas e antigas: as contas e clientes do cenário não caem em nenhuma janela por acidente.
  const criada = o.createdAt ?? at('2026-01-01T12:00:00.000Z')
  const business = await makeBusiness({
    ...(o.timezone ? { timezone: o.timezone } : {}),
    ...(o.status ? { status: o.status } : {}),
    createdAt: criada,
  })
  const customer = await makeCustomer(business.id, { createdAt: criada })
  const professional = await makeProfessional(business.id)
  const service = await makeService(business.id)
  return { business, customerId: customer.id, professionalId: professional.id, serviceId: service.id }
}

async function agendamento(
  c: Conta,
  o: { startsAt: Date; durationMin?: number; status?: AppointmentStatus; totalCents?: number; createdAt?: Date; customerId?: string },
): Promise<string> {
  const durationMin = o.durationMin ?? 30
  const a = await prisma.appointment.create({
    data: {
      businessId: c.business.id,
      customerId: o.customerId ?? c.customerId,
      professionalId: c.professionalId,
      startsAt: o.startsAt,
      endsAt: addMinutes(o.startsAt, durationMin),
      status: o.status ?? 'CONFIRMED',
      source: 'PANEL',
      totalCents: o.totalCents ?? 5000,
      totalDurationMin: durationMin,
      createdByType: 'SYSTEM',
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    },
  })
  return a.id
}

describe('getOverview: dia e mês no fuso de cada conta', () => {
  test('23:30 de Manaus conta no hoje de Manaus; 00:30 do dia seguinte não; e o mesmo instante não conta em São Paulo', async () => {
    const sp = await conta()
    const mn = await conta({ timezone: 'America/Manaus' })
    // Manaus: 23:30 do dia 16 (= 17/11 03:30 UTC) é hoje; 00:30 do dia 17 (= 04:30 UTC) é amanhã.
    await agendamento(mn, { startsAt: at('2026-11-17T03:30:00.000Z') })
    await agendamento(mn, { startsAt: at('2026-11-17T04:30:00.000Z') })
    // São Paulo: 10:00 do dia 16 e 23:30 do dia 16 (= 02:30 UTC) são hoje; 00:30 do dia 17 (= 03:30 UTC) não é.
    await agendamento(sp, { startsAt: at('2026-11-16T13:00:00.000Z') })
    await agendamento(sp, { startsAt: at('2026-11-17T02:30:00.000Z') })
    await agendamento(sp, { startsAt: at('2026-11-17T03:30:00.000Z') })
    // Cancelado não conta.
    await agendamento(sp, { startsAt: at('2026-11-16T14:00:00.000Z'), status: 'CANCELED' })

    const o = await getOverview(actor, NOW)
    expect(o.appointments.today).toBe(3)
  })

  test('mês parcial até o fim de hoje, mês anterior inteiro e o mesmo trecho do mês anterior, cada conta no seu fuso', async () => {
    const sp = await conta()
    const mn = await conta({ timezone: 'America/Manaus' })
    // Mês atual (novembro, até o fim de hoje).
    await agendamento(sp, { startsAt: at('2026-11-05T13:00:00.000Z') })
    await agendamento(sp, { startsAt: at('2026-11-16T13:00:00.000Z') })
    await agendamento(sp, { startsAt: at('2026-11-17T02:30:00.000Z') })
    await agendamento(sp, { startsAt: at('2026-11-17T03:30:00.000Z') }) // amanhã: fora do parcial
    await agendamento(mn, { startsAt: at('2026-11-02T13:00:00.000Z') })
    await agendamento(mn, { startsAt: at('2026-11-17T03:30:00.000Z') })
    await agendamento(mn, { startsAt: at('2026-11-17T04:30:00.000Z') }) // amanhã em Manaus
    // Mês anterior (outubro).
    await agendamento(sp, { startsAt: at('2026-10-10T13:00:00.000Z') }) // dentro do mesmo trecho (até 16/10)
    await agendamento(sp, { startsAt: at('2026-10-30T13:00:00.000Z') }) // outubro, fora do mesmo trecho
    // 31/10 23:00 em Manaus = 01/11 03:00 UTC: é outubro em Manaus (e seria novembro em São Paulo).
    await agendamento(mn, { startsAt: at('2026-11-01T03:00:00.000Z') })
    // Cancelado não conta em nenhum período.
    await agendamento(sp, { startsAt: at('2026-10-11T13:00:00.000Z'), status: 'CANCELED' })

    const { month } = (await getOverview(actor, NOW)).appointments
    expect(month).toEqual({ current: 5, previous: 3, previousSamePeriod: 1 })
  })

  test('receita soma só os COMPLETED cujo término cai no período, em centavos', async () => {
    const sp = await conta()
    const mn = await conta({ timezone: 'America/Manaus' })
    await agendamento(sp, { startsAt: at('2026-11-05T13:00:00.000Z'), status: 'COMPLETED', totalCents: 10_000 })
    await agendamento(sp, { startsAt: at('2026-11-06T13:00:00.000Z'), status: 'COMPLETED', totalCents: 2_550 })
    await agendamento(sp, { startsAt: at('2026-11-07T13:00:00.000Z'), status: 'CONFIRMED', totalCents: 99_000 })
    await agendamento(sp, { startsAt: at('2026-11-08T13:00:00.000Z'), status: 'CANCELED', totalCents: 88_000 })
    await agendamento(sp, { startsAt: at('2026-11-09T13:00:00.000Z'), status: 'NO_SHOW', totalCents: 77_000 })
    // Começou em outubro (31/10 23:50 em São Paulo) e terminou em novembro: conta em novembro.
    await agendamento(sp, { startsAt: at('2026-11-01T02:50:00.000Z'), durationMin: 30, status: 'COMPLETED', totalCents: 1_000 })
    await agendamento(mn, { startsAt: at('2026-11-03T13:00:00.000Z'), status: 'COMPLETED', totalCents: 4_000 })
    // Outubro.
    await agendamento(sp, { startsAt: at('2026-10-10T13:00:00.000Z'), status: 'COMPLETED', totalCents: 7_000 })
    await agendamento(sp, { startsAt: at('2026-10-30T13:00:00.000Z'), status: 'COMPLETED', totalCents: 300 })
    // Termina depois do fim de hoje: ainda não é receita do mês parcial.
    await agendamento(sp, { startsAt: at('2026-11-17T03:10:00.000Z'), status: 'COMPLETED', totalCents: 5_555 })

    const { revenueCents } = await getOverview(actor, NOW)
    expect(revenueCents.month).toEqual({ current: 17_550, previous: 7_300, previousSamePeriod: 7_000 })
  })

  test('clientes: total sem arquivados nem conta arquivada; novos do mês com tendência', async () => {
    const sp = await conta({ createdAt: at('2026-06-01T12:00:00.000Z') })
    const mn = await conta({ timezone: 'America/Manaus', createdAt: at('2026-06-01T12:00:00.000Z') })
    const arquivada = await conta({ status: 'ARCHIVED', createdAt: at('2026-06-01T12:00:00.000Z') })
    // Já existem 3 (um por conta, criados em junho). Novos de novembro:
    await makeCustomer(sp.business.id, { createdAt: at('2026-11-05T12:00:00.000Z') })
    await makeCustomer(mn.business.id, { createdAt: at('2026-11-17T03:30:00.000Z') }) // 23:30 de 16/11 em Manaus
    await makeCustomer(mn.business.id, { createdAt: at('2026-11-17T04:30:00.000Z') }) // já é dia 17 em Manaus: fora do parcial
    // Outubro: um no mesmo trecho (até 16/10), um depois.
    await makeCustomer(sp.business.id, { createdAt: at('2026-10-10T12:00:00.000Z') })
    await makeCustomer(sp.business.id, { createdAt: at('2026-10-30T12:00:00.000Z') })
    // Arquivado e de conta arquivada não contam.
    await makeCustomer(sp.business.id, { createdAt: at('2026-11-06T12:00:00.000Z'), archivedAt: at('2026-11-07T12:00:00.000Z') })
    await makeCustomer(arquivada.business.id, { createdAt: at('2026-11-06T12:00:00.000Z') })

    const { customers } = await getOverview(actor, NOW)
    // 2 contas com 1 inicial + (sp: 1 nov + 2 out) + (mn: 2 nov)
    expect(customers.total).toBe(2 + 3 + 2)
    expect(customers.newMonth).toEqual({ current: 2, previous: 2, previousSamePeriod: 1 })
  })

  test('contas por situação e novas nos últimos 30 dias', async () => {
    await conta({ createdAt: at('2026-11-10T12:00:00.000Z') })
    await conta({ createdAt: at('2026-10-01T12:00:00.000Z') })
    await conta({ status: 'SUSPENDED', createdAt: at('2026-10-20T12:00:00.000Z') })
    await conta({ status: 'ARCHIVED', createdAt: at('2026-08-01T12:00:00.000Z') })

    const { accounts } = await getOverview(actor, NOW)
    expect(accounts).toEqual({ active: 2, suspended: 1, archived: 1, newLast30d: 2 })
  })

  test('avisos pendentes e com falha', async () => {
    const sp = await conta()
    const notificacao = (status: 'PENDING' | 'FAILED' | 'SENT', n: number) =>
      prisma.notification.create({
        data: {
          businessId: sp.business.id,
          kind: 'APPOINTMENT_CONFIRMED',
          channel: 'EMAIL',
          customerId: sp.customerId,
          scheduledFor: dias(NOW, -1),
          status,
          dedupeKey: `k-${status}-${n}`,
        },
      })
    await notificacao('PENDING', 1)
    await notificacao('PENDING', 2)
    await notificacao('SENT', 1)
    const falha = await notificacao('FAILED', 1)
    const antiga = await notificacao('FAILED', 2)
    await prisma.$executeRaw`UPDATE notifications SET updated_at = ${at('2026-11-16T10:00:00.000Z')}::timestamptz WHERE id = ${falha.id}::uuid`
    await prisma.$executeRaw`UPDATE notifications SET updated_at = ${at('2026-11-10T10:00:00.000Z')}::timestamptz WHERE id = ${antiga.id}::uuid`

    const o = await getOverview(actor, NOW)
    expect(o.notifications).toEqual({ pending: 2, failed24h: 1 })
  })

  test('conta sem agendamento criado há 15 dias aparece como quieta; arquivada, suspensa e ativa recente não', async () => {
    const parada = await conta({ createdAt: at('2026-09-01T12:00:00.000Z') })
    await agendamento(parada, { startsAt: at('2026-12-01T13:00:00.000Z'), createdAt: dias(NOW, -15) })
    const nunca = await conta({ createdAt: at('2026-09-01T12:00:00.000Z') })
    const nova = await conta({ createdAt: dias(NOW, -1) }) // criada ontem, sem agendamento: ainda não é "quieta"
    const recente = await conta()
    await agendamento(recente, { startsAt: at('2026-11-20T13:00:00.000Z'), createdAt: dias(NOW, -3) })
    const arquivada = await conta({ status: 'ARCHIVED' })
    const suspensa = await conta({ status: 'SUSPENDED' })
    void arquivada
    void suspensa
    void nova

    const { quietAccounts } = await getOverview(actor, NOW)
    // Quem parou vem primeiro; a conta antiga que nunca teve agendamento vem por último.
    expect(quietAccounts.map((q) => q.id)).toEqual([parada.business.id, nunca.business.id])
    expect(quietAccounts[1]?.lastActivityAt).toBeNull()
    expect(quietAccounts[0]?.lastActivityAt?.getTime()).toBe(dias(NOW, -15).getTime())
    expect(quietAccounts[0]?.name).toBe(parada.business.name)
  })

  test('contas quietas: no máximo 10, e as que pararam não perdem a vaga para as que nunca tiveram agendamento', async () => {
    for (let i = 0; i < 12; i++) await conta()
    const parada = await conta()
    await agendamento(parada, { startsAt: at('2026-12-01T13:00:00.000Z'), createdAt: dias(NOW, -40) })
    const { quietAccounts } = await getOverview(actor, NOW)
    expect(quietAccounts).toHaveLength(10)
    expect(quietAccounts[0]?.id).toBe(parada.business.id)
  })

  test('conta com fuso inválido fica fora dos números e é contada em skippedAccounts, com aviso sem dado pessoal', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ruim = await conta()
    await prisma.business.update({ where: { id: ruim.business.id }, data: { timezone: 'Marte/Olimpo' } })
    await agendamento(ruim, { startsAt: at('2026-11-16T13:00:00.000Z') })
    const boa = await conta()
    await agendamento(boa, { startsAt: at('2026-11-16T13:00:00.000Z') })
    const o = await getOverview(actor, NOW)
    expect(o.skippedAccounts).toBe(1)
    expect(o.appointments.today).toBe(1)
    const log = JSON.stringify(aviso.mock.calls)
    expect(log).toContain('1')
    expect(log).not.toContain(ruim.business.name)
    expect(log).not.toContain(ruim.business.id)
    vi.restoreAllMocks()
    expect((await getOverview(actor, NOW)).skippedAccounts).toBe(1)
  })

  test('sem dados: tudo zero e listas vazias', async () => {
    expect(await getOverview(actor, NOW)).toEqual({
      accounts: { active: 0, suspended: 0, archived: 0, newLast30d: 0 },
      skippedAccounts: 0,
      appointments: { today: 0, month: { current: 0, previous: 0, previousSamePeriod: 0 } },
      customers: { total: 0, newMonth: { current: 0, previous: 0, previousSamePeriod: 0 } },
      revenueCents: { month: { current: 0, previous: 0, previousSamePeriod: 0 } },
      store: { accounts: 0, paidOrders: { current: 0, previous: 0, previousSamePeriod: 0 }, revenueCents: { current: 0, previous: 0, previousSamePeriod: 0 } },
      notifications: { pending: 0, failed24h: 0 },
      quietAccounts: [],
    })
  })

  test('ator que não é admin da plataforma: forbidden', async () => {
    const intruso = { kind: 'system' } as unknown as PlatformAdminActor
    expect((await domainError(getOverview(intruso, NOW))).code).toBe('forbidden')
    expect((await domainError(getAccountMetrics(intruso, randomUUID(), NOW))).code).toBe('forbidden')
  })
})

describe('getOverview: número de consultas', () => {
  /** Conta as instruções que chegam ao banco (inclui BEGIN e COMMIT). */
  function contarConsultas(): { total: () => number } {
    const original = pg.Client.prototype.query as unknown as (...a: unknown[]) => unknown
    let n = 0
    vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (this: unknown, ...args: unknown[]) {
      n += 1
      return original.apply(this, args)
    } as never)
    return { total: () => n }
  }

  test('com 20 fusos distintos usa no máximo 15 consultas e o mesmo número de consultas que com 1 fuso', async () => {
    const fusos = [
      'America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco', 'America/Noronha', 'America/New_York', 'America/Chicago',
      'America/Denver', 'America/Los_Angeles', 'America/Santiago', 'America/Bogota', 'America/Lima', 'Europe/Lisbon',
      'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Auckland', 'Africa/Cairo',
      'America/Argentina/Buenos_Aires',
    ]
    const um = await conta()
    await agendamento(um, { startsAt: at('2026-11-16T13:00:00.000Z') })
    const c1 = contarConsultas()
    await getOverview(actor, NOW)
    const comUm = c1.total()
    expect(comUm).toBeGreaterThan(0)
    vi.restoreAllMocks()

    for (const timezone of fusos) {
      const c = await conta({ timezone })
      await agendamento(c, { startsAt: at('2026-11-16T13:00:00.000Z') })
    }
    const c2 = contarConsultas()
    const o = await getOverview(actor, NOW)
    const comVinte = c2.total()
    expect(comVinte).toBeLessThanOrEqual(15)
    expect(comVinte).toBe(comUm)
    expect(o.appointments.month.current).toBe(21)
  })
})

describe('índices das métricas', () => {
  const ESPERADOS = [
    ['appointments', 'appointments_starts_at_idx'],
    ['appointments', 'appointments_ends_at_completed_idx'],
    ['appointments', 'appointments_business_id_created_at_idx'],
    ['audit_logs', 'audit_logs_created_at_id_idx'],
    ['notifications', 'notifications_status_updated_at_idx'],
  ] as const

  test('existem no catálogo, e o parcial de término só vale para COMPLETED', async () => {
    const linhas = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`
    const porNome = new Map(linhas.map((l) => [l.indexname, l.indexdef]))
    for (const [, nome] of ESPERADOS) expect(porNome.has(nome), nome).toBe(true)
    expect(porNome.get('appointments_ends_at_completed_idx')).toMatch(/WHERE \(?\(?status = 'COMPLETED'/)
    expect(porNome.get('audit_logs_created_at_id_idx')).toMatch(/created_at DESC, id DESC/)
  })
})

describe('getAccountMetrics', () => {
  test('conta só os dados da própria conta, no fuso dela', async () => {
    const mn = await conta({ timezone: 'America/Manaus' })
    const outra = await conta()
    // Manaus: 23:30 de hoje e 00:30 de amanhã; próximos 7 dias.
    await agendamento(mn, { startsAt: at('2026-11-17T03:30:00.000Z') })
    await agendamento(mn, { startsAt: at('2026-11-17T04:30:00.000Z') })
    await agendamento(mn, { startsAt: at('2026-11-22T13:00:00.000Z') }) // dentro de 7 dias
    await agendamento(mn, { startsAt: at('2026-11-30T13:00:00.000Z') }) // fora
    await agendamento(mn, { startsAt: at('2026-11-03T13:00:00.000Z'), status: 'COMPLETED', totalCents: 6_000 })
    await agendamento(mn, { startsAt: at('2026-11-04T13:00:00.000Z'), status: 'NO_SHOW' })
    await agendamento(mn, { startsAt: at('2026-11-05T13:00:00.000Z'), status: 'CANCELED' })
    await agendamento(mn, { startsAt: at('2026-10-10T13:00:00.000Z'), status: 'COMPLETED', totalCents: 2_000 })
    // Dados de outra conta: nada disso pode somar.
    await agendamento(outra, { startsAt: at('2026-11-16T13:00:00.000Z'), status: 'COMPLETED', totalCents: 90_000 })
    await agendamento(outra, { startsAt: at('2026-11-18T13:00:00.000Z') })
    await makeCustomer(outra.business.id)

    const novo = await makeCustomer(mn.business.id, { createdAt: at('2026-11-08T12:00:00.000Z') })
    await makeCustomer(mn.business.id, { createdAt: at('2026-10-08T12:00:00.000Z') })
    await makeCustomer(mn.business.id, { createdAt: at('2026-11-09T12:00:00.000Z'), archivedAt: at('2026-11-10T12:00:00.000Z') })
    void novo
    // Equipe: 1 vínculo ativo, 1 inativo; profissionais: já existe 1 (da conta), +1 ativo, +1 arquivado.
    const u1 = await makeUser()
    const u2 = await makeUser()
    await makeMembership(mn.business.id, u1.id, 'OWNER')
    const inativo = await makeMembership(mn.business.id, u2.id, 'MANAGER')
    await prisma.membership.update({ where: { id: inativo.id }, data: { active: false } })
    await makeProfessional(mn.business.id)
    await makeProfessional(mn.business.id, { archivedAt: NOW })

    const m = await getAccountMetrics(actor, mn.business.id, NOW)
    expect(m.appointments.today).toBe(1)
    expect(m.appointments.next7d).toBe(3) // 23:30 de hoje, 00:30 de amanhã e 22/11; o de 30/11 fica fora
    expect(m.appointments.month).toEqual({ current: 3, previous: 1, previousSamePeriod: 1 })
    expect(m.appointments.byStatusMonth).toEqual({ PENDING: 0, CONFIRMED: 1, COMPLETED: 1, CANCELED: 1, NO_SHOW: 1 })
    expect(m.customers).toEqual({ total: 1 + 2, newMonth: 1 })
    expect(m.revenueCents.month).toEqual({ current: 6_000, previous: 2_000, previousSamePeriod: 2_000 })
    expect(m.team).toEqual({ active: 1, professionals: 2 })
    expect(m.lastActivityAt).not.toBeNull()
  })

  test('conta sem nada: zeros e lastActivityAt nulo; conta inexistente: not_found', async () => {
    const vazia = await makeBusiness()
    const m = await getAccountMetrics(actor, vazia.id, NOW)
    expect(m).toEqual({
      appointments: { today: 0, next7d: 0, month: { current: 0, previous: 0, previousSamePeriod: 0 }, byStatusMonth: { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELED: 0, NO_SHOW: 0 } },
      customers: { total: 0, newMonth: 0 },
      revenueCents: { month: { current: 0, previous: 0, previousSamePeriod: 0 } },
      store: null,
      team: { active: 0, professionals: 0 },
      lastActivityAt: null,
    })
    expect((await domainError(getAccountMetrics(actor, randomUUID(), NOW))).code).toBe('not_found')
    expect((await domainError(getAccountMetrics(actor, 'não-é-uuid', NOW))).code).toBe('validation')
  })

  test('lastActivityAt é a criação do agendamento mais recente', async () => {
    const c = await conta()
    await agendamento(c, { startsAt: at('2026-11-20T13:00:00.000Z'), createdAt: at('2026-11-01T10:00:00.000Z') })
    await agendamento(c, { startsAt: at('2026-11-21T13:00:00.000Z'), createdAt: at('2026-11-09T10:00:00.000Z') })
    const m = await getAccountMetrics(actor, c.business.id, NOW)
    expect(m.lastActivityAt?.getTime()).toBe(at('2026-11-09T10:00:00.000Z').getTime())
  })
})
