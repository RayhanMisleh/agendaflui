import { prisma } from '@/server/db/client'
import { getReportByProfessional, getReportByService } from '@/server/domain/reports/breakdowns'
import { reportCsv } from '@/server/domain/reports/csv'
import { listReportRows } from '@/server/domain/reports/detail'
import { getReportSummary } from '@/server/domain/reports/summary'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeAppointment,
  makeBusiness,
  makeCustomer,
  makeProfessional,
  makeService,
  memberOf,
} from '../setup/factories'

beforeEach(resetDb)

const AGORA = new Date('2026-11-20T15:00:00Z')
const MANAUS = 'America/Manaus'
/** Instante de uma hora local de Manaus (UTC-4) em 2026-11-<dia>. */
const mn = (dia: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, dia, h + 4, m))

type Status = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'NO_SHOW'

async function montar(timezone = MANAUS) {
  const b = await makeBusiness({ timezone })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 30, priceCents: 8000 })
  const tosa = await makeService(b.id, { name: 'Tosa', durationMin: 30, priceCents: 5000 })
  const ana = await makeProfessional(b.id, { name: 'Ana', serviceIds: [banho.id, tosa.id] })
  const caio = await makeProfessional(b.id, { name: 'Caio', serviceIds: [banho.id, tosa.id] })
  const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
  const cliente = await makeCustomer(b.id, { name: 'Bia' })
  return { b, banho, tosa, ana, caio, dono, cliente }
}
type Cena = Awaited<ReturnType<typeof montar>>

/** Atendimento que termina em `endsAt` (30 minutos de duração) e já na situação pedida. */
async function atender(
  s: Cena,
  o: { endsAt: Date; status?: Status; professionalId?: string; serviceId?: string; commissionCents?: number | null },
) {
  const a = await makeAppointment(s.b.id, {
    customerId: s.cliente.id,
    professionalId: o.professionalId ?? s.ana.id,
    serviceId: o.serviceId ?? s.banho.id,
    startsAt: addMinutes(o.endsAt, -30),
    status: o.status ?? 'COMPLETED',
  })
  if (o.commissionCents !== undefined) {
    await prisma.appointment.update({ where: { id: a.id }, data: { commissionCents: o.commissionCents } })
  }
  return a
}

const DIA10 = { from: '2026-11-10', to: '2026-11-10' }

describe('período local da conta', () => {
  test('término às 23:30 locais entra no dia; às 00:30 do dia seguinte fica fora', async () => {
    const s = await montar()
    await atender(s, { endsAt: mn(10, 23, 30) })
    await atender(s, { endsAt: mn(11, 0, 30), professionalId: s.caio.id })
    await atender(s, { endsAt: mn(9, 23, 59), professionalId: s.caio.id })
    const r = await getReportSummary(s.dono, DIA10)
    expect(r.completed).toBe(1)
    expect(r.revenueCents).toBe(8000)
    expect(r.byDay).toEqual([{ date: '2026-11-10', revenueCents: 8000, completed: 1 }])
    const dia11 = await getReportSummary(s.dono, { from: '2026-11-11', to: '2026-11-11' })
    expect(dia11.completed).toBe(1)
  })

  test('byDay traz todos os dias do período, inclusive os sem movimento', async () => {
    const s = await montar()
    await atender(s, { endsAt: mn(11, 10) })
    const r = await getReportSummary(s.dono, { from: '2026-11-10', to: '2026-11-12' })
    expect(r.byDay).toEqual([
      { date: '2026-11-10', revenueCents: 0, completed: 0 },
      { date: '2026-11-11', revenueCents: 8000, completed: 1 },
      { date: '2026-11-12', revenueCents: 0, completed: 0 },
    ])
  })

  test('o período máximo é de 366 dias; 367 dão validação', async () => {
    const s = await montar()
    await expect(getReportSummary(s.dono, { from: '2026-01-01', to: '2027-01-01' })).resolves.toBeDefined()
    const erro = await domainError(getReportSummary(s.dono, { from: '2026-01-01', to: '2027-01-02' }))
    expect(erro.code).toBe('validation')
    expect(erro.fields).toHaveProperty('to')
  })

  test('dia de 25 horas (fim do horário de verão): byDay usa o dia local de verdade', async () => {
    const s = await montar('America/New_York')
    const dono = s.dono
    // 2026-11-01: o relógio recua às 02:00 (EDT, UTC-4) para 01:00 (EST, UTC-5).
    await atender(s, { endsAt: new Date('2026-11-01T04:30:00Z') }) // 00:30 EDT, dia 1
    await atender(s, { endsAt: new Date('2026-11-02T04:30:00Z') }) // 23:30 EST, ainda dia 1 (24 h depois de 04:30Z seria dia 2)
    await atender(s, { endsAt: new Date('2026-11-02T05:30:00Z') }) // 00:30 EST do dia 2
    const r = await getReportSummary(dono, { from: '2026-11-01', to: '2026-11-02' })
    expect(r.byDay).toEqual([
      { date: '2026-11-01', revenueCents: 16000, completed: 2 },
      { date: '2026-11-02', revenueCents: 8000, completed: 1 },
    ])
    expect(r.completed).toBe(3)
  })

  test('data final antes da inicial dá validação', async () => {
    const s = await montar()
    const erro = await domainError(getReportSummary(s.dono, { from: '2026-11-12', to: '2026-11-10' }))
    expect(erro.code).toBe('validation')
  })
})

describe('números do resumo', () => {
  test('receita e comissão são só dos concluídos; cancelados e faltas só entram na contagem', async () => {
    const s = await montar()
    await atender(s, { endsAt: mn(10, 9), commissionCents: 2000 })
    await atender(s, { endsAt: mn(10, 11), serviceId: s.tosa.id, commissionCents: 1250 })
    await atender(s, { endsAt: mn(10, 13), status: 'CANCELED', commissionCents: 999 })
    await atender(s, { endsAt: mn(10, 14), status: 'NO_SHOW' })
    await atender(s, { endsAt: mn(10, 15), status: 'CONFIRMED' })
    const r = await getReportSummary(s.dono, DIA10)
    expect(r).toMatchObject({
      revenueCents: 13000,
      completed: 2,
      canceled: 1,
      noShow: 1,
      averageTicketCents: 6500,
      commissionCents: 3250,
    })
  })

  test('sem concluídos, o ticket médio é 0 e a receita também', async () => {
    const s = await montar()
    await atender(s, { endsAt: mn(10, 9), status: 'CANCELED' })
    const r = await getReportSummary(s.dono, DIA10)
    expect(r.averageTicketCents).toBe(0)
    expect(r.revenueCents).toBe(0)
    expect(r.commissionCents).toBe(0)
  })

  test('filtra por profissional e por serviço', async () => {
    const s = await montar()
    await atender(s, { endsAt: mn(10, 9) })
    await atender(s, { endsAt: mn(10, 10), professionalId: s.caio.id, serviceId: s.tosa.id })
    await atender(s, { endsAt: mn(10, 11), professionalId: s.caio.id })
    expect((await getReportSummary(s.dono, { ...DIA10, professionalId: s.caio.id })).revenueCents).toBe(13000)
    expect((await getReportSummary(s.dono, { ...DIA10, serviceId: s.tosa.id })).revenueCents).toBe(5000)
    const os2 = await getReportSummary(s.dono, { ...DIA10, professionalId: s.caio.id, serviceId: s.banho.id })
    expect(os2).toMatchObject({ completed: 1, revenueCents: 8000 })
  })

  test('a conta B não entra nos números da conta A', async () => {
    const a = await montar()
    const b = await montar()
    await atender(a, { endsAt: mn(10, 9) })
    await atender(b, { endsAt: mn(10, 9) })
    await atender(b, { endsAt: mn(10, 10) })
    expect((await getReportSummary(a.dono, DIA10)).completed).toBe(1)
    expect((await getReportByProfessional(a.dono, DIA10)).map((p) => p.professionalId)).toEqual([a.ana.id])
    expect((await listReportRows(a.dono, DIA10)).items).toHaveLength(1)
  })
})

describe('por profissional e por serviço', () => {
  test('agrupa e ordena pela receita', async () => {
    const s = await montar()
    await atender(s, { endsAt: mn(10, 9), commissionCents: 1000 })
    await atender(s, { endsAt: mn(10, 10), professionalId: s.caio.id, commissionCents: 500 })
    await atender(s, { endsAt: mn(10, 11), professionalId: s.caio.id, serviceId: s.tosa.id, commissionCents: 400 })
    await atender(s, { endsAt: mn(10, 12), professionalId: s.caio.id, status: 'CANCELED' })
    expect(await getReportByProfessional(s.dono, DIA10)).toEqual([
      { professionalId: s.caio.id, name: 'Caio', completed: 2, revenueCents: 13000, commissionCents: 900 },
      { professionalId: s.ana.id, name: 'Ana', completed: 1, revenueCents: 8000, commissionCents: 1000 },
    ])
    expect(await getReportByService(s.dono, DIA10)).toEqual([
      { serviceId: s.banho.id, name: 'Banho', count: 2, revenueCents: 16000 },
      { serviceId: s.tosa.id, name: 'Tosa', count: 1, revenueCents: 5000 },
    ])
  })

  test('por serviço respeita o filtro de profissional e o de serviço', async () => {
    const s = await montar()
    await atender(s, { endsAt: mn(10, 9) })
    await atender(s, { endsAt: mn(10, 10), professionalId: s.caio.id, serviceId: s.tosa.id })
    expect(await getReportByService(s.dono, { ...DIA10, professionalId: s.caio.id })).toEqual([
      { serviceId: s.tosa.id, name: 'Tosa', count: 1, revenueCents: 5000 },
    ])
    expect(await getReportByService(s.dono, { ...DIA10, serviceId: s.banho.id })).toEqual([
      { serviceId: s.banho.id, name: 'Banho', count: 1, revenueCents: 8000 },
    ])
  })
})

describe('filtro de serviço em atendimento com dois serviços', () => {
  async function doisServicos() {
    const s = await montar()
    const a = await makeService(s.b.id, { name: 'Serviço A', priceCents: 6000 })
    const b = await makeService(s.b.id, { name: 'Serviço B', priceCents: 4000 })
    const ag = await prisma.appointment.create({
      data: {
        businessId: s.b.id,
        customerId: s.cliente.id,
        professionalId: s.ana.id,
        startsAt: mn(10, 9),
        endsAt: mn(10, 10),
        status: 'COMPLETED',
        source: 'PANEL',
        totalCents: 10000,
        totalDurationMin: 60,
        commissionCents: 2000,
        createdByType: 'SYSTEM',
        items: {
          create: [a, b].map((sv, i) => ({
            businessId: s.b.id,
            serviceId: sv.id,
            name: sv.name,
            priceCents: sv.priceCents,
            durationMin: 30,
            rewardPoints: 0,
            position: i + 1,
          })),
        },
      },
    })
    return { s, a, b, ag }
  }

  test('com filtro por A, tudo soma só os itens de A e a comissão é null', async () => {
    const { s, a } = await doisServicos()
    const f = { ...DIA10, serviceId: a.id }
    const r = await getReportSummary(s.dono, f)
    expect(r).toMatchObject({ revenueCents: 6000, completed: 1, averageTicketCents: 6000, commissionCents: null })
    expect(r.byDay).toEqual([{ date: '2026-11-10', revenueCents: 6000, completed: 1 }])
    expect(await getReportByProfessional(s.dono, f)).toEqual([
      { professionalId: s.ana.id, name: 'Ana', completed: 1, revenueCents: 6000, commissionCents: null },
    ])
    expect(await getReportByService(s.dono, f)).toEqual([
      { serviceId: a.id, name: 'Serviço A', count: 1, revenueCents: 6000 },
    ])
    // A lista continua com o atendimento inteiro.
    const linhas = await listReportRows(s.dono, f)
    expect(linhas.items.map((i) => i.totalCents)).toEqual([10000])
  })

  test('o mesmo serviço duas vezes no atendimento: count conta itens e o resumo conta um atendimento', async () => {
    const s = await montar()
    const ag = await prisma.appointment.create({
      data: {
        businessId: s.b.id,
        customerId: s.cliente.id,
        professionalId: s.ana.id,
        startsAt: mn(10, 9),
        endsAt: mn(10, 10),
        status: 'COMPLETED',
        source: 'PANEL',
        totalCents: 16000,
        totalDurationMin: 60,
        createdByType: 'SYSTEM',
        items: {
          create: [1, 2].map((posicao) => ({
            businessId: s.b.id,
            serviceId: s.banho.id,
            name: s.banho.name,
            priceCents: s.banho.priceCents,
            durationMin: 30,
            rewardPoints: 0,
            position: posicao,
          })),
        },
      },
    })
    expect(ag.id).toBeDefined()
    expect(await getReportByService(s.dono, DIA10)).toEqual([
      { serviceId: s.banho.id, name: 'Banho', count: 2, revenueCents: 16000 },
    ])
    expect(await getReportSummary(s.dono, DIA10)).toMatchObject({ completed: 1, revenueCents: 16000 })
  })

  test('sem filtro, a receita é a do atendimento inteiro e a comissão é numérica', async () => {
    const { s } = await doisServicos()
    const r = await getReportSummary(s.dono, DIA10)
    expect(r).toMatchObject({ revenueCents: 10000, averageTicketCents: 10000, commissionCents: 2000 })
    expect(r.byDay[0]?.revenueCents).toBe(10000)
    expect((await getReportByProfessional(s.dono, DIA10))[0]).toMatchObject({ revenueCents: 10000, commissionCents: 2000 })
  })
})

describe('permissões', () => {
  async function comProfissional(s: Cena) {
    const ctx = await ctxWithRole(s.b, 'PROFESSIONAL', { now: AGORA })
    const propria = await makeProfessional(s.b.id, {
      name: 'Dani',
      membershipId: memberOf(ctx).membershipId,
      serviceIds: [s.banho.id],
    })
    return { ctx, propria }
  }

  test('o profissional vê só os próprios números, com a própria comissão', async () => {
    const s = await montar()
    const { ctx, propria } = await comProfissional(s)
    await atender(s, { endsAt: mn(10, 9), commissionCents: 1000 })
    await atender(s, { endsAt: mn(10, 11), professionalId: propria.id, commissionCents: 2400 })
    const r = await getReportSummary(ctx, DIA10)
    expect(r).toMatchObject({ completed: 1, revenueCents: 8000, commissionCents: 2400 })
    expect((await getReportByProfessional(ctx, DIA10)).map((p) => p.professionalId)).toEqual([propria.id])
    expect((await getReportByService(ctx, DIA10)).map((x) => x.count)).toEqual([1])
    const linhas = await listReportRows(ctx, DIA10)
    expect(linhas.items.map((i) => i.professionalId)).toEqual([propria.id])
    expect(linhas.items[0]?.commissionCents).toBe(2400)
    // Pedir a própria ficha de forma explícita também passa.
    expect((await getReportSummary(ctx, { ...DIA10, professionalId: propria.id })).completed).toBe(1)
  })

  test('o profissional pedindo o relatório de um colega recebe forbidden em tudo', async () => {
    const s = await montar()
    const { ctx } = await comProfissional(s)
    const pedido = { ...DIA10, professionalId: s.ana.id }
    for (const chamada of [
      () => getReportSummary(ctx, pedido),
      () => getReportByProfessional(ctx, pedido),
      () => getReportByService(ctx, pedido),
      () => listReportRows(ctx, pedido),
    ]) {
      expect((await domainError(chamada())).code).toBe('forbidden')
    }
    const csv = reportCsv(ctx, pedido)
    expect((await domainError(csv.next())).code).toBe('forbidden')
  })

  test('profissional sem ficha ligada ao acesso recebe forbidden', async () => {
    const s = await montar()
    const ctx = await ctxWithRole(s.b, 'PROFESSIONAL', { now: AGORA })
    expect((await domainError(getReportSummary(ctx, DIA10))).code).toBe('forbidden')
  })

  test('gerente vê tudo, com comissão; cliente do app não vê nada', async () => {
    const s = await montar()
    await atender(s, { endsAt: mn(10, 9), commissionCents: 1000 })
    const gerente = await ctxWithRole(s.b, 'MANAGER', { now: AGORA })
    expect(await getReportSummary(gerente, DIA10)).toMatchObject({ completed: 1, commissionCents: 1000 })
    const clienteCtx = {
      ...s.dono,
      actor: { kind: 'customer' as const, customerId: s.cliente.id, name: 'Bia' },
    }
    expect((await domainError(getReportSummary(clienteCtx, DIA10))).code).toBe('forbidden')
  })
})

describe('listReportRows', () => {
  test('pagina sem repetir nem pular, inclusive com o mesmo horário de término', async () => {
    const s = await montar()
    const ids: string[] = []
    for (let i = 0; i < 7; i += 1) {
      // Pares com o mesmo término, em profissionais diferentes.
      const a = await atender(s, {
        endsAt: mn(10, 9 + Math.floor(i / 2)),
        professionalId: i % 2 === 0 ? s.ana.id : s.caio.id,
      })
      ids.push(a.id)
    }
    const vistos: string[] = []
    let cursor: string | undefined
    let paginas = 0
    do {
      const pagina = await listReportRows(s.dono, { ...DIA10, limit: 3, ...(cursor ? { cursor } : {}) })
      expect(pagina.items.length).toBeLessThanOrEqual(3)
      vistos.push(...pagina.items.map((i) => i.id))
      cursor = pagina.nextCursor ?? undefined
      paginas += 1
    } while (cursor)
    expect(paginas).toBe(3)
    expect(vistos).toHaveLength(7)
    expect(new Set(vistos)).toEqual(new Set(ids))
  })

  test('a linha traz rótulos locais, serviços e só os atendimentos encerrados', async () => {
    const s = await montar()
    await atender(s, { endsAt: mn(10, 9, 30), commissionCents: 700 })
    await atender(s, { endsAt: mn(10, 10), status: 'CANCELED' })
    await atender(s, { endsAt: mn(10, 11), status: 'PENDING' })
    const { items } = await listReportRows(s.dono, DIA10)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      startLabel: '10/11/2026 09:00',
      endLabel: '10/11/2026 09:30',
      customerName: 'Bia',
      professionalName: 'Ana',
      services: ['Banho'],
      status: 'COMPLETED',
      totalCents: 8000,
      commissionCents: 700,
    })
    expect(items[1]?.status).toBe('CANCELED')
    expect(items[1]?.commissionCents).toBeNull()
  })

  test('cursor forjado de outro filtro só restringe: não abre linhas de colega nem de outra conta', async () => {
    const s = await montar()
    const outra = await montar()
    const ctx = await ctxWithRole(s.b, 'PROFESSIONAL', { now: AGORA })
    const dani = await makeProfessional(s.b.id, {
      name: 'Dani',
      membershipId: memberOf(ctx).membershipId,
      serviceIds: [s.banho.id],
    })
    await atender(s, { endsAt: mn(10, 9), professionalId: s.ana.id })
    await atender(s, { endsAt: mn(10, 10), professionalId: dani.id })
    await atender(s, { endsAt: mn(10, 11), professionalId: s.ana.id })
    await atender(s, { endsAt: mn(10, 12), professionalId: dani.id })
    await atender(outra, { endsAt: mn(10, 13) })
    // O dono pagina todo o movimento; o cursor da primeira página vira "chave" na mão da Dani.
    const paginaDono = await listReportRows(s.dono, { ...DIA10, limit: 1 })
    const cursor = paginaDono.nextCursor
    expect(cursor).not.toBeNull()
    const depois = await listReportRows(ctx, { ...DIA10, cursor: cursor ?? '' })
    expect(depois.items.every((i) => i.professionalId === dani.id)).toBe(true)
    expect(depois.items.map((i) => i.endLabel)).toEqual(['10/11/2026 10:00', '10/11/2026 12:00'])
    // Cursor de outra conta: ainda só as linhas desta conta.
    const deOutra = await listReportRows(outra.dono, { ...DIA10, limit: 1 })
    const noDono = await listReportRows(s.dono, { ...DIA10, cursor: deOutra.nextCursor ?? paginaDono.nextCursor ?? '' })
    expect(noDono.items.length).toBeLessThanOrEqual(4)
    expect(noDono.items.every((i) => i.customerName === 'Bia')).toBe(true)
    const ids = new Set((await listReportRows(s.dono, DIA10)).items.map((i) => i.id))
    expect(noDono.items.every((i) => ids.has(i.id))).toBe(true)
  })

  test('limite acima de 100 e cursor inválido dão validação', async () => {
    const s = await montar()
    expect((await domainError(listReportRows(s.dono, { ...DIA10, limit: 101 }))).code).toBe('validation')
    expect((await domainError(listReportRows(s.dono, { ...DIA10, cursor: 'lixo' }))).code).toBe('validation')
  })
})

describe('reportCsv', () => {
  test('1.200 linhas saem em mais de um pedaço, com BOM, cabeçalho e 1.201 linhas', async () => {
    const s = await montar()
    const inicio = mn(10, 0)
    await prisma.appointment.createMany({
      data: Array.from({ length: 1200 }, (_, i) => ({
        businessId: s.b.id,
        customerId: s.cliente.id,
        professionalId: s.ana.id,
        startsAt: addMinutes(inicio, i),
        endsAt: addMinutes(inicio, i + 1),
        status: 'COMPLETED' as const,
        source: 'PANEL' as const,
        totalCents: 8050,
        totalDurationMin: 1,
        createdByType: 'SYSTEM' as const,
      })),
    })
    const pedacos: string[] = []
    for await (const p of reportCsv(s.dono, DIA10)) pedacos.push(p)
    expect(pedacos.length).toBeGreaterThan(1)
    expect(pedacos[0]?.startsWith('﻿')).toBe(true)
    expect(pedacos.slice(1).some((p) => p.includes('﻿'))).toBe(false)
    const texto = pedacos.join('')
    expect(texto.endsWith('\r\n')).toBe(true)
    const linhas = texto.slice(1, -2).split('\r\n')
    expect(linhas).toHaveLength(1201)
    expect(linhas[0]).toBe('Início;Término;Cliente;Profissional;Serviços;Situação;Valor;Comissão')
    expect(linhas[1]).toBe('10/11/2026 00:00;10/11/2026 00:01;Bia;Ana;;Concluído;80,50;0,00')
  })

  test('nome de cliente com fórmula sai com apóstrofo, e vírgula decimal no dinheiro', async () => {
    const s = await montar()
    const perigoso = await makeCustomer(s.b.id, { name: '=HYPERLINK("x")' })
    await makeAppointment(s.b.id, {
      customerId: perigoso.id,
      professionalId: s.ana.id,
      serviceId: s.banho.id,
      startsAt: mn(10, 9),
      status: 'COMPLETED',
    })
    let texto = ''
    for await (const p of reportCsv(s.dono, DIA10)) texto += p
    expect(texto).toContain(`;"'=HYPERLINK(""x"")";`)
    expect(texto).toContain(';80,00;')
  })

  test('o CSV do profissional traz só as linhas dele e a própria comissão', async () => {
    const s = await montar()
    const ctx = await ctxWithRole(s.b, 'PROFESSIONAL', { now: AGORA })
    const dani = await makeProfessional(s.b.id, {
      name: 'Dani',
      membershipId: memberOf(ctx).membershipId,
      serviceIds: [s.banho.id],
    })
    await atender(s, { endsAt: mn(10, 9), professionalId: s.ana.id, commissionCents: 1111 })
    await atender(s, { endsAt: mn(10, 10), professionalId: dani.id, commissionCents: 2400 })
    await atender(s, { endsAt: mn(10, 11), professionalId: s.caio.id, commissionCents: 3333 })
    let texto = ''
    for await (const p of reportCsv(ctx, DIA10)) texto += p
    const linhas = texto.slice(1).split('\r\n').filter(Boolean)
    expect(linhas).toHaveLength(2)
    expect(linhas[1]).toBe('10/11/2026 09:30;10/11/2026 10:00;Bia;Dani;Banho;Concluído;80,00;24,00')
    expect(texto).not.toContain('Ana')
    expect(texto).not.toContain('Caio')
    expect(texto).not.toContain('11,11')
    expect(texto).not.toContain('33,33')
  })

  test('valor só dos concluídos e comissão vazia nos cancelados', async () => {
    const s = await montar()
    await atender(s, { endsAt: mn(10, 9), commissionCents: 1500 })
    await atender(s, { endsAt: mn(10, 10), status: 'CANCELED', commissionCents: 999 })
    await atender(s, { endsAt: mn(10, 11), status: 'NO_SHOW', commissionCents: 888 })
    let texto = ''
    for await (const p of reportCsv(s.dono, DIA10)) texto += p
    const linhas = texto.slice(1).split('\r\n').filter(Boolean)
    expect(linhas[1]).toBe('10/11/2026 08:30;10/11/2026 09:00;Bia;Ana;Banho;Concluído;80,00;15,00')
    expect(linhas[2]).toBe('10/11/2026 09:30;10/11/2026 10:00;Bia;Ana;Banho;Cancelado;;')
    expect(linhas[3]).toBe('10/11/2026 10:30;10/11/2026 11:00;Bia;Ana;Banho;Não compareceu;;')
  })

  test('sem movimento, sai só o cabeçalho', async () => {
    const s = await montar()
    const pedacos: string[] = []
    for await (const p of reportCsv(s.dono, DIA10)) pedacos.push(p)
    expect(pedacos.join('').split('\r\n').filter(Boolean)).toHaveLength(1)
  })
})
