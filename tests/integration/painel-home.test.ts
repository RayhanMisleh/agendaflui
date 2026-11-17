import { prisma } from '@/server/db/client'
import { getHomeOverview } from '@/server/domain/scheduling/home'
import { getPainelContext } from '@/server/domain/settings/painel-context'
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

const MANAUS = 'America/Manaus'
/** Terça-feira 17/11/2026, 08:00 em Manaus (UTC-4). */
const AGORA = new Date('2026-11-17T12:00:00Z')
/** Instante de uma hora local de Manaus em 2026-11-<dia>. */
const mn = (dia: number, h: number, m = 0, mes = 10): Date => new Date(Date.UTC(2026, mes, dia, h + 4, m))
const EXPEDIENTE = [
  { startMin: 540, endMin: 720 },
  { startMin: 780, endMin: 1080 },
]

async function montar() {
  const b = await makeBusiness({ timezone: MANAUS })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60, priceCents: 8000 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [banho.id] })
  const caio = await makeProfessional(b.id, { name: 'Caio', displayOrder: 2, serviceIds: [banho.id] })
  for (const p of [ana, caio]) await makeWorkingHours(b.id, p.id, 'TUESDAY', EXPEDIENTE)
  const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
  const clienteA = await makeCustomer(b.id, { name: 'Marina Souza' })
  const clienteB = await makeCustomer(b.id, { name: 'Paulo Lima' })
  return { b, banho, ana, caio, dono, clienteA, clienteB }
}
type M = Awaited<ReturnType<typeof montar>>

function marcar(
  m: M,
  o: { startsAt: Date; quem?: 'ana' | 'caio'; cliente?: 'A' | 'B'; status?: 'PENDING' | 'CONFIRMED' | 'CANCELED' | 'COMPLETED' | 'NO_SHOW'; durationMin?: number },
) {
  return makeAppointment(m.b.id, {
    customerId: (o.cliente === 'B' ? m.clienteB : m.clienteA).id,
    professionalId: (o.quem === 'caio' ? m.caio : m.ana).id,
    serviceId: m.banho.id,
    startsAt: o.startsAt,
    ...(o.status ? { status: o.status } : {}),
    ...(o.durationMin ? { durationMin: o.durationMin } : {}),
  })
}

async function comoProfissional(m: M, quem: 'ana' | 'caio') {
  const ctx = await ctxWithRole(m.b, 'PROFESSIONAL', { now: AGORA })
  await prisma.professional.update({ where: { id: (quem === 'ana' ? m.ana : m.caio).id }, data: { membershipId: memberOf(ctx).membershipId } })
  return ctx
}

describe('getHomeOverview: quem vê o quê', () => {
  test('o dono vê os atendimentos de todos os profissionais; o profissional só os dele', async () => {
    const m = await montar()
    await marcar(m, { startsAt: mn(17, 9), quem: 'ana', cliente: 'A' })
    await marcar(m, { startsAt: mn(17, 10), quem: 'caio', cliente: 'B' })
    await marcar(m, { startsAt: mn(17, 14), quem: 'ana', cliente: 'B' })

    const dono = await getHomeOverview(m.dono)
    expect(dono.scope).toBe('all')
    expect([dono.next, ...dono.later].map((a) => a?.customer.name)).toEqual(['Marina Souza', 'Paulo Lima', 'Paulo Lima'])
    expect(dono.summary.total).toBe(3)

    const ana = await getHomeOverview(await comoProfissional(m, 'ana'))
    expect(ana.scope).toBe('own')
    expect([ana.next, ...ana.later].map((a) => [a?.professional.name, a?.local.start])).toEqual([
      ['Ana', '09:00'],
      ['Ana', '14:00'],
    ])
    expect(ana.summary.total).toBe(2)
    expect(ana.counts).toEqual({ today: 2, month: 2 })
  })

  test('profissional sem ficha ligada ao acesso não vê atendimento de ninguém', async () => {
    const m = await montar()
    await marcar(m, { startsAt: mn(17, 9) })
    const sem = await ctxWithRole(m.b, 'PROFESSIONAL', { now: AGORA })
    const home = await getHomeOverview(sem)
    expect(home.next).toBeNull()
    expect(home.later).toEqual([])
    expect(home.counts).toEqual({ today: 0, month: 0 })
    expect(home.summary.total).toBe(0)
    expect(home.unlinked).toBe(true)
  })

  test('profissional com ficha ligada e dono não ficam "sem ficha"', async () => {
    const m = await montar()
    expect((await getHomeOverview(await comoProfissional(m, 'ana'))).unlinked).toBe(false)
    expect((await getHomeOverview(m.dono)).unlinked).toBe(false)
  })

  test('cliente do app e visitante não têm Início', async () => {
    const m = await montar()
    const comoCliente = await makeCtx(m.b, { actor: { kind: 'customer', customerId: m.clienteA.id, name: 'Marina' }, now: AGORA })
    expect((await domainError(getHomeOverview(comoCliente))).code).toBe('forbidden')
    const visitante = await makeCtx(m.b, { actor: { kind: 'guest' }, now: AGORA })
    expect((await domainError(getHomeOverview(visitante))).code).toBe('forbidden')
  })

  test('o suporte vê todos', async () => {
    const m = await montar()
    await marcar(m, { startsAt: mn(17, 9), quem: 'caio' })
    const suporte = await makeCtx(m.b, { actor: { kind: 'impersonator', adminId: 'a', name: 'Suporte' }, now: AGORA })
    expect((await getHomeOverview(suporte)).next?.professional.name).toBe('Caio')
  })
})

describe('getHomeOverview: o dia local da conta', () => {
  test('o dia é o de Manaus: 23:30 local entra, 00:00 do dia seguinte e 23:59 da véspera ficam de fora', async () => {
    const m = await montar()
    await marcar(m, { startsAt: new Date('2026-11-18T03:30:00Z'), quem: 'ana', durationMin: 15 }) // 17/11 23:30 em Manaus
    await marcar(m, { startsAt: new Date('2026-11-18T04:00:00Z'), quem: 'caio', durationMin: 15 }) // 18/11 00:00
    await marcar(m, { startsAt: new Date('2026-11-17T03:45:00Z'), quem: 'caio', durationMin: 15, status: 'COMPLETED' }) // 16/11 23:45
    const home = await getHomeOverview(m.dono)
    expect(home.date).toBe('2026-11-17')
    expect(home.next?.local).toMatchObject({ date: '2026-11-17', start: '23:30' })
    expect(home.later).toEqual([])
    expect(home.summary.total).toBe(1)
    expect(home.counts.today).toBe(1)
  })

  test('perto da meia-noite UTC o "hoje" continua sendo o de Manaus', async () => {
    const m = await montar()
    const tarde = await ctxWithRole(m.b, 'OWNER', { now: new Date('2026-11-18T02:00:00Z') }) // 17/11 22:00 em Manaus
    expect((await getHomeOverview(tarde)).date).toBe('2026-11-17')
    const cedo = await ctxWithRole(m.b, 'OWNER', { now: new Date('2026-11-17T03:00:00Z') }) // 16/11 23:00 em Manaus
    expect((await getHomeOverview(cedo)).date).toBe('2026-11-16')
  })

  test('traz o dia da semana e o rótulo da data local', async () => {
    const m = await montar()
    const home = await getHomeOverview(m.dono)
    expect(home.weekday).toBe('TUESDAY')
    expect(home.dateLabel).toBe('17/11/2026')
  })
})

describe('getHomeOverview: próximos atendimentos', () => {
  test('só entram os abertos que ainda não terminaram, em ordem de horário', async () => {
    const m = await montar()
    await marcar(m, { startsAt: mn(17, 7), quem: 'ana' }) // 07:00–08:00, já terminou às 08:00 (agora)
    await marcar(m, { startsAt: mn(17, 15), quem: 'ana' })
    await marcar(m, { startsAt: mn(17, 9), quem: 'ana', status: 'PENDING' })
    await marcar(m, { startsAt: mn(17, 10), quem: 'caio', status: 'CANCELED' })
    await marcar(m, { startsAt: mn(17, 11), quem: 'caio', status: 'NO_SHOW' })
    await marcar(m, { startsAt: mn(17, 13), quem: 'caio', status: 'COMPLETED' })
    const home = await getHomeOverview(m.dono)
    expect([home.next, ...home.later].map((a) => a?.local.start)).toEqual(['09:00', '15:00'])
    expect(home.next?.status).toBe('PENDING')
  })

  test('o próximo do profissional é o dele: um colega e um cancelado dele, mais cedo, não valem', async () => {
    const m = await montar()
    await marcar(m, { startsAt: mn(17, 9), quem: 'caio', cliente: 'B' })
    await marcar(m, { startsAt: mn(17, 9, 30), quem: 'ana', status: 'CANCELED' })
    await marcar(m, { startsAt: mn(17, 11), quem: 'ana', cliente: 'A' })
    const ana = await getHomeOverview(await comoProfissional(m, 'ana'))
    expect([ana.next?.professional.name, ana.next?.local.start]).toEqual(['Ana', '11:00'])
    expect(ana.later).toEqual([])
    const dono = await getHomeOverview(m.dono)
    expect([dono.next?.professional.name, dono.next?.local.start]).toEqual(['Caio', '09:00'])
    expect(dono.later.map((a) => a.local.start)).toEqual(['11:00'])
  })

  test('um atendimento em andamento ainda é o próximo', async () => {
    const m = await montar()
    const meio = await ctxWithRole(m.b, 'OWNER', { now: mn(17, 9, 30) })
    await marcar(m, { startsAt: mn(17, 9) })
    await marcar(m, { startsAt: mn(17, 11), quem: 'caio' })
    const home = await getHomeOverview(meio)
    expect(home.next?.local.start).toBe('09:00')
    expect(home.later.map((a) => a.local.start)).toEqual(['11:00'])
  })

  test('sem nada mais hoje, o próximo é o primeiro dos dias seguintes e a lista de hoje fica vazia', async () => {
    const m = await montar()
    await marcar(m, { startsAt: mn(19, 10), quem: 'ana' })
    await marcar(m, { startsAt: mn(18, 16), quem: 'caio' })
    const home = await getHomeOverview(m.dono)
    expect(home.next?.local).toMatchObject({ date: '2026-11-18', start: '16:00' })
    expect(home.later).toEqual([])
    expect(home.summary.total).toBe(0)
  })

  test('conta sem atendimento nenhum: tudo vazio, sem erro', async () => {
    const m = await montar()
    const home = await getHomeOverview(m.dono)
    expect(home.next).toBeNull()
    expect(home.later).toEqual([])
    expect(home.counts).toEqual({ today: 0, month: 0 })
    expect(home.summary.total).toBe(0)
  })

  test('a lista de hoje tem teto e não traz o próximo duas vezes', async () => {
    const m = await montar()
    for (let i = 0; i < 12; i++) await marcar(m, { startsAt: mn(17, 9, i * 15), quem: i % 2 ? 'ana' : 'caio', durationMin: 15 })
    const home = await getHomeOverview(m.dono)
    expect(home.next?.local.start).toBe('09:00')
    expect(home.later.length).toBe(7)
    expect(new Set([home.next?.id, ...home.later.map((a) => a.id)]).size).toBe(8)
  })

  test('o nome do cliente e do profissional e os serviços vêm prontos para a tela', async () => {
    const m = await montar()
    await marcar(m, { startsAt: mn(17, 9) })
    const a = (await getHomeOverview(m.dono)).next
    expect(a?.customer.name).toBe('Marina Souza')
    expect(a?.professional.name).toBe('Ana')
    expect(a?.items.map((i) => i.name)).toEqual(['Banho'])
  })
})

describe('getHomeOverview: contadores e ocupação', () => {
  test('hoje e mês contam o que não foi cancelado, no mês local da conta', async () => {
    const m = await montar()
    await marcar(m, { startsAt: mn(17, 9) })
    await marcar(m, { startsAt: mn(17, 10), quem: 'caio', status: 'CANCELED' })
    await marcar(m, { startsAt: mn(3, 9), status: 'COMPLETED' })
    await marcar(m, { startsAt: mn(30, 15), quem: 'caio' })
    await marcar(m, { startsAt: new Date('2026-12-01T03:30:00Z'), quem: 'caio', durationMin: 15 }) // 30/11 23:30 em Manaus: ainda é novembro
    await marcar(m, { startsAt: new Date('2026-12-01T04:00:00Z'), quem: 'ana', durationMin: 15 }) // 01/12 00:00: dezembro
    await marcar(m, { startsAt: mn(31, 9, 0, 9), quem: 'ana' }) // 31/10: outubro
    const home = await getHomeOverview(m.dono)
    expect(home.counts).toEqual({ today: 1, month: 4 })
  })

  test('a ocupação do dia vem do resumo do dia, sobre o expediente dos dois profissionais', async () => {
    const m = await montar()
    // Expediente de cada um: 3 h + 5 h = 8 h; dois profissionais = 960 min. Ocupados: 60 + 60 = 120 min.
    await marcar(m, { startsAt: mn(17, 9), quem: 'ana' })
    await marcar(m, { startsAt: mn(17, 9), quem: 'caio' })
    const home = await getHomeOverview(m.dono)
    expect(home.summary.workingMinutes).toBe(960)
    expect(home.summary.bookedMinutes).toBe(120)
    expect(home.summary.occupancy).toBe(0.125)
  })
})

describe('getPainelContext: papel, termos e módulos num lugar só', () => {
  test('devolve os termos da conta, o papel em português e os módulos', async () => {
    const b = await makeBusiness({ timezone: MANAUS })
    await prisma.businessSettings.update({
      where: { businessId: b.id },
      data: { termProfessionalSingular: 'Tosador', termProfessionalPlural: 'Tosadores', termCustomerPlural: 'Tutores' },
    })
    const dono = await ctxWithRole(b, 'OWNER')
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    const gerente = await ctxWithRole(b, 'MANAGER')
    const a = await getPainelContext(dono)
    expect(a.terms.customerPlural).toBe('Tutores')
    expect(a.roleLabel).toBe('Dono')
    expect((await getPainelContext(prof)).roleLabel).toBe('Tosador')
    expect((await getPainelContext(gerente)).roleLabel).toBe('Gerente')
    expect(a.modules).toEqual({ loyalty: false, banners: false, store: false, vouchers: false })
  })

  test('o suporte aparece como Suporte e usa o nome do admin', async () => {
    const b = await makeBusiness({ timezone: MANAUS })
    const suporte = await makeCtx(b, { actor: { kind: 'impersonator', adminId: 'a', name: 'Rafa' } })
    const ctx = await getPainelContext(suporte)
    expect(ctx.roleLabel).toBe('Suporte')
    expect(ctx.userName).toBe('Rafa')
  })

  test('módulo ligado na conta aparece ligado', async () => {
    const b = await makeBusiness({ timezone: MANAUS })
    await prisma.businessModules.update({ where: { businessId: b.id }, data: { loyalty: true } })
    expect((await getPainelContext(await ctxWithRole(b, 'OWNER'))).modules.loyalty).toBe(true)
  })

  test('cliente do app não recebe o contexto do painel', async () => {
    const b = await makeBusiness({ timezone: MANAUS })
    const c = await makeCustomer(b.id)
    const ctx = await makeCtx(b, { actor: { kind: 'customer', customerId: c.id, name: 'x' } })
    expect((await domainError(getPainelContext(ctx))).code).toBe('forbidden')
  })
})
