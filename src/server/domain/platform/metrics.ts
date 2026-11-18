import 'server-only'
import type { Actor } from '@/server/auth/actor'
import { assertPlatformAdmin } from '@/server/auth/platform-actor'
import { prisma } from '@/server/db/client'
import { Prisma } from '@/server/db/generated/client'
import { DomainError, orNotFound, parse, z } from '@/server/domain/errors'
import { addMinutes, fromEpochMs, isValidTimeZone, localPeriods, startOfUtcHour, type LocalPeriods } from '@/server/time'
import { usageSummary } from './api-usage'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

/*
 * Métricas da plataforma. Regras que valem para todos os números:
 * - "hoje" e "mês" são do fuso de CADA conta (o agendamento das 23:30 de Manaus é do dia local de Manaus). Os limites
 *   `[início, fim)` de cada fuso vêm do módulo de tempo e entram na consulta como uma tabela derivada (`VALUES`)
 *   parametrizada; o banco junta cada linha com a janela do fuso da sua conta. Assim o número de consultas não depende
 *   do número de fusos, e nada é somado em memória.
 * - "mês" é o mês até o fim de hoje (parcial). `previous` é o mês anterior inteiro; `previousSamePeriod` é o mesmo número
 *   de dias do mês anterior, para comparar parcial com parcial.
 * - Avisos e uso da API contam todas as contas, inclusive arquivadas (são números do sistema).
 * - Agendamento cancelado não conta como agendamento. Conta arquivada fica fora dos números da plataforma.
 * - Cliente arquivado ou anonimizado não conta como cliente.
 * - Loja: pedido pago é o de status `PAID`, contado pelo instante do pagamento (`paid_at`) e só em contas com o módulo Loja ligado;
 *   a receita soma `total_cents` (itens mais frete).
 * - Receita é a soma de `total_cents` (o valor cobrado) dos agendamentos COMPLETED cujo término cai no período.
 */

export type Trend = {
  /** O mês até o fim de hoje (no fuso da conta). */
  current: number
  /** O mês anterior inteiro. */
  previous: number
  /** O mesmo número de dias do mês anterior (compara mês parcial com mês parcial). */
  previousSamePeriod: number
}

export type Overview = {
  accounts: { active: number; suspended: number; archived: number; newLast30d: number }
  /** Contas não arquivadas ignoradas nos números por terem fuso horário inválido. */
  skippedAccounts: number
  appointments: { today: number; month: Trend }
  customers: { total: number; newMonth: Trend }
  revenueCents: { month: Trend }
  /** Volume da loja no mês, só das contas com o módulo Loja ligado (`accounts` é quantas são). */
  store: { accounts: number; paidOrders: Trend; revenueCents: Trend }
  appUsers: { activeToday: number; activeMonth: number }
  api: { requests24h: number; errors24h: number }
  notifications: { pending: number; failed24h: number }
  quietAccounts: { id: string; name: string; lastActivityAt: Date | null }[]
}

export type AccountMetrics = {
  appointments: { today: number; next7d: number; month: Trend; byStatusMonth: Record<string, number> }
  customers: { total: number; newMonth: number }
  revenueCents: { month: Trend }
  /** Pedidos pagos e receita da loja no mês; `null` quando a conta não tem o módulo Loja ligado. */
  store: { paidOrders: Trend; revenueCents: Trend } | null
  team: { active: number; professionals: number }
  appUsers: { activeMonth: number }
  lastActivityAt: Date | null
}

const STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW'] as const
const QUIET_DAYS = 14
const QUIET_LIMIT = 10
const DAY_MIN = 24 * 60

type Row = Record<string, bigint | number | null>

/** Inteiro do banco (`bigint`) para número, recusando o que não cabe com segurança. */
function num(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'bigint' ? Number(v) : v
  if (!Number.isSafeInteger(n)) throw new RangeError('Valor grande demais para somar com segurança.')
  return n
}

function only<T>(rows: T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error('A consulta de métricas não devolveu linha.')
  return row
}

function trend(r: Row, prefix: string): Trend {
  return { current: num(r[`${prefix}_cur`]), previous: num(r[`${prefix}_prev`]), previousSamePeriod: num(r[`${prefix}_same`]) }
}

type Windows = { tz: string; p: LocalPeriods }[]

/** Tabela derivada com uma linha por fuso: `tz, t0..t1 (hoje), m0..m1 (mês), p0..p1 (mês anterior), s0..s1 (mesmo trecho)`. */
function windowsTable(windows: Windows): Prisma.Sql {
  const linhas = windows.map(
    ({ tz, p }) =>
      Prisma.sql`(${tz}::text, ${p.today.start}::timestamptz, ${p.today.end}::timestamptz, ${p.month.start}::timestamptz, ${p.month.end}::timestamptz, ${p.previousMonth.start}::timestamptz, ${p.previousMonth.end}::timestamptz, ${p.previousSamePeriod.start}::timestamptz, ${p.previousSamePeriod.end}::timestamptz)`,
  )
  return Prisma.sql`(VALUES ${Prisma.join(linhas)}) AS w(tz, t0, t1, m0, m1, p0, p1, s0, s1)`
}

/** Menor início e maior fim entre todas as janelas, para o banco poder usar os índices de data. */
function bounds(windows: Windows, from: 'previous' | 'month'): { lo: Date; hi: Date } {
  const inicios = windows.map(({ p }) => (from === 'previous' ? p.previousMonth.start : p.month.start).getTime())
  const fins = windows.map(({ p }) => p.month.end.getTime())
  return { lo: fromEpochMs(Math.min(...inicios)), hi: fromEpochMs(Math.max(...fins)) }
}

// Fragmentos estáticos (sem entrada de ninguém): os valores variáveis entram sempre como parâmetros.
const inWin = (col: string, a: string, b: string) => `${col} >= w.${a} AND ${col} < w.${b}`
const NOT_CANCELED = `a.status <> 'CANCELED'`
const countCols = (prefix: string, cond: string, col: string) =>
  `count(*) FILTER (WHERE ${cond} AND ${inWin(col, 'm0', 'm1')}) AS ${prefix}_cur,
   count(*) FILTER (WHERE ${cond} AND ${inWin(col, 'p0', 'p1')}) AS ${prefix}_prev,
   count(*) FILTER (WHERE ${cond} AND ${inWin(col, 's0', 's1')}) AS ${prefix}_same`
const revenueCols = `coalesce(sum(a.total_cents) FILTER (WHERE a.status = 'COMPLETED' AND ${inWin('a.ends_at', 'm0', 'm1')}), 0)::bigint AS rev_cur,
   coalesce(sum(a.total_cents) FILTER (WHERE a.status = 'COMPLETED' AND ${inWin('a.ends_at', 'p0', 'p1')}), 0)::bigint AS rev_prev,
   coalesce(sum(a.total_cents) FILTER (WHERE a.status = 'COMPLETED' AND ${inWin('a.ends_at', 's0', 's1')}), 0)::bigint AS rev_same`
const APPT_COLS = `count(*) FILTER (WHERE ${NOT_CANCELED} AND ${inWin('a.starts_at', 't0', 't1')}) AS today,
   ${countCols('appt', NOT_CANCELED, 'a.starts_at')},
   ${revenueCols}`

type ApptResult = { today: number; month: Trend; revenue: Trend }
function apptResult(r: Row): ApptResult {
  return { today: num(r['today']), month: trend(r, 'appt'), revenue: trend(r, 'rev') }
}

type CustomerResult = { total: number; newMonth: Trend }
async function customerAggregate(windows: Windows, scope: Prisma.Sql): Promise<CustomerResult> {
  const live = `c.archived_at IS NULL AND c.anonymized_at IS NULL`
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT count(*) FILTER (WHERE ${Prisma.raw(live)}) AS total,
      ${Prisma.raw(countCols('cust', live, 'c.created_at'))}
    FROM customers c
    JOIN businesses b ON b.id = c.business_id
    JOIN ${windowsTable(windows)} ON w.tz = b.timezone
    WHERE ${scope}`)
  const r = only(rows)
  return { total: num(r['total']), newMonth: trend(r, 'cust') }
}

type StoreResult = { accounts: number; paidOrders: Trend; revenueCents: Trend }

/** Pedidos pagos e receita da loja por janela, só das contas (do escopo) com o módulo Loja ligado. Tudo agregado no banco. */
async function storeAggregate(windows: Windows, scope: Prisma.Sql): Promise<StoreResult> {
  const { lo, hi } = bounds(windows, 'previous')
  const paid = `o.status = 'PAID'`
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT ${Prisma.raw(countCols('ord', paid, 'o.paid_at'))},
      coalesce(sum(o.total_cents) FILTER (WHERE ${Prisma.raw(`${paid} AND ${inWin('o.paid_at', 'm0', 'm1')}`)}), 0)::bigint AS rev_cur,
      coalesce(sum(o.total_cents) FILTER (WHERE ${Prisma.raw(`${paid} AND ${inWin('o.paid_at', 'p0', 'p1')}`)}), 0)::bigint AS rev_prev,
      coalesce(sum(o.total_cents) FILTER (WHERE ${Prisma.raw(`${paid} AND ${inWin('o.paid_at', 's0', 's1')}`)}), 0)::bigint AS rev_same
    FROM orders o
    JOIN businesses b ON b.id = o.business_id
    JOIN business_modules m ON m.business_id = b.id AND m.store
    JOIN ${windowsTable(windows)} ON w.tz = b.timezone
    WHERE ${scope} AND o.paid_at >= ${lo} AND o.paid_at < ${hi}`)
  const accounts = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT count(*) AS n FROM businesses b JOIN business_modules m ON m.business_id = b.id AND m.store
    WHERE ${scope} AND b.timezone IN (${Prisma.join(windows.map((w) => w.tz))})`)
  const r = only(rows)
  return { accounts: num(only(accounts)['n']), paidOrders: trend(r, 'ord'), revenueCents: trend(r, 'rev') }
}

async function appUsersAggregate(windows: Windows, scope: Prisma.Sql): Promise<{ today: number; month: number }> {
  const { lo, hi } = bounds(windows, 'month')
  const active = (a: string, b: string) => `((t.created_at >= w.${a} AND t.created_at < w.${b}) OR (t.used_at >= w.${a} AND t.used_at < w.${b}))`
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT count(DISTINCT t.customer_id) FILTER (WHERE ${Prisma.raw(active('t0', 't1'))}) AS today,
           count(DISTINCT t.customer_id) FILTER (WHERE ${Prisma.raw(active('m0', 'm1'))}) AS month
    FROM refresh_tokens t
    JOIN businesses b ON b.id = t.business_id
    JOIN ${windowsTable(windows)} ON w.tz = b.timezone
    WHERE t.subject = 'CUSTOMER' AND t.customer_id IS NOT NULL AND ${scope}
      AND ((t.created_at >= ${lo} AND t.created_at < ${hi}) OR (t.used_at >= ${lo} AND t.used_at < ${hi}))`)
  const r = only(rows)
  return { today: num(r['today']), month: num(r['month']) }
}

const ZERO: Trend = { current: 0, previous: 0, previousSamePeriod: 0 }
const NO_STORE: StoreResult = { accounts: 0, paidOrders: ZERO, revenueCents: ZERO }

export async function getOverview(actor: PlatformAdminActor, now: Date): Promise<Overview> {
  assertPlatformAdmin(actor)
  const live = Prisma.sql`b.status <> 'ARCHIVED'`
  const zonas = await prisma.business.groupBy({ by: ['timezone'], where: { status: { not: 'ARCHIVED' } }, _count: { _all: true } })
  const windows: Windows = zonas.filter((z) => isValidTimeZone(z.timezone)).map((z) => ({ tz: z.timezone, p: localPeriods(now, z.timezone) }))
  const skippedAccounts = zonas.filter((z) => !isValidTimeZone(z.timezone)).reduce((soma, z) => soma + z._count._all, 0)
  if (skippedAccounts > 0) console.warn(JSON.stringify({ level: 'warn', event: 'overview_invalid_timezone', accounts: skippedAccounts }))
  const since24h = addMinutes(now, -DAY_MIN)
  const quietCutoff = addMinutes(now, -QUIET_DAYS * DAY_MIN)

  const apptWindowed = async (): Promise<ApptResult> => {
    if (windows.length === 0) return { today: 0, month: ZERO, revenue: ZERO }
    const { lo, hi } = bounds(windows, 'previous')
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT ${Prisma.raw(APPT_COLS)}
      FROM appointments a
      JOIN businesses b ON b.id = a.business_id
      JOIN ${windowsTable(windows)} ON w.tz = b.timezone
      WHERE ${live}
        AND ((a.starts_at >= ${lo} AND a.starts_at < ${hi}) OR (a.status = 'COMPLETED' AND a.ends_at >= ${lo} AND a.ends_at < ${hi}))`)
    return apptResult(only(rows))
  }

  const [accountRows, appt, cust, users, store, usage, notif, quiet] = await Promise.all([
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT count(*) FILTER (WHERE status = 'ACTIVE') AS active,
             count(*) FILTER (WHERE status = 'SUSPENDED') AS suspended,
             count(*) FILTER (WHERE status = 'ARCHIVED') AS archived,
             count(*) FILTER (WHERE created_at >= ${addMinutes(now, -30 * DAY_MIN)}) AS new30
      FROM businesses`),
    apptWindowed(),
    windows.length === 0 ? Promise.resolve<CustomerResult>({ total: 0, newMonth: ZERO }) : customerAggregate(windows, live),
    windows.length === 0 ? Promise.resolve({ today: 0, month: 0 }) : appUsersAggregate(windows, live),
    windows.length === 0 ? Promise.resolve(NO_STORE) : storeAggregate(windows, live),
    // As 24 horas cheias que terminam na hora atual.
    usageSummary(actor, { from: addMinutes(startOfUtcHour(now), -23 * 60), to: addMinutes(now, 1) }),
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT count(*) FILTER (WHERE status = 'PENDING') AS pending,
             count(*) FILTER (WHERE status = 'FAILED' AND updated_at >= ${since24h}) AS failed
      FROM notifications WHERE status IN ('PENDING', 'FAILED')`),
    prisma.$queryRaw<{ id: string; name: string; last: Date | null }[]>(Prisma.sql`
      SELECT q.id, q.name, q.last FROM (
        SELECT b.id, b.name, (SELECT max(a.created_at) FROM appointments a WHERE a.business_id = b.id) AS last
        FROM businesses b
        WHERE b.status = 'ACTIVE' AND b.created_at < ${quietCutoff}
          AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.business_id = b.id AND a.created_at >= ${quietCutoff})
      ) q
      ORDER BY (q.last IS NULL) ASC, q.last ASC, q.id ASC
      LIMIT ${QUIET_LIMIT}::int`),
  ])

  const a = only(accountRows)
  const n = only(notif)
  return {
    accounts: { active: num(a['active']), suspended: num(a['suspended']), archived: num(a['archived']), newLast30d: num(a['new30']) },
    skippedAccounts,
    appointments: { today: appt.today, month: appt.month },
    customers: { total: cust.total, newMonth: cust.newMonth },
    revenueCents: { month: appt.revenue },
    store,
    appUsers: { activeToday: users.today, activeMonth: users.month },
    api: {
      requests24h: usage.reduce((soma, r) => soma + r.count, 0),
      errors24h: usage.reduce((soma, r) => soma + r.errorCount, 0),
    },
    notifications: { pending: num(n['pending']), failed24h: num(n['failed']) },
    quietAccounts: quiet.map((q) => ({ id: q.id, name: q.name, lastActivityAt: q.last })),
  }
}

export async function getAccountMetrics(actor: PlatformAdminActor, businessId: string, now: Date): Promise<AccountMetrics> {
  assertPlatformAdmin(actor)
  const id = parse(z.uuid(), businessId)
  const conta = orNotFound(await prisma.business.findUnique({ where: { id }, select: { timezone: true } }), 'Conta')
  if (!isValidTimeZone(conta.timezone)) throw new DomainError('validation', 'O fuso horário desta conta é inválido. Corrija-o nos dados da conta.')
  const windows: Windows = [{ tz: conta.timezone, p: localPeriods(now, conta.timezone) }]
  const scope = Prisma.sql`b.id = ${id}::uuid`
  const { lo, hi } = bounds(windows, 'previous')
  const next7dEnd = addMinutes(now, 7 * DAY_MIN)
  const statusCols = STATUSES.map((s) => `count(*) FILTER (WHERE a.status = '${s}' AND ${inWin('a.starts_at', 'm0', 'm1')}) AS st_${s.toLowerCase()}`).join(',\n   ')

  const [apptRows, cust, users, store, team, professionals, last] = await Promise.all([
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT ${Prisma.raw(APPT_COLS)},
        count(*) FILTER (WHERE a.status IN ('PENDING', 'CONFIRMED') AND a.starts_at >= ${now} AND a.starts_at < ${next7dEnd}) AS next7d,
        ${Prisma.raw(statusCols)}
      FROM appointments a
      JOIN businesses b ON b.id = a.business_id
      JOIN ${windowsTable(windows)} ON w.tz = b.timezone
      WHERE ${scope}
        AND ((a.starts_at >= ${lo} AND a.starts_at < ${hi}) OR (a.status = 'COMPLETED' AND a.ends_at >= ${lo} AND a.ends_at < ${hi})
             OR (a.starts_at >= ${now} AND a.starts_at < ${next7dEnd}))`),
    customerAggregate(windows, scope),
    appUsersAggregate(windows, scope),
    storeAggregate(windows, scope),
    prisma.membership.count({ where: { businessId: id, active: true } }),
    prisma.professional.count({ where: { businessId: id, active: true, archivedAt: null } }),
    prisma.appointment.aggregate({ where: { businessId: id }, _max: { createdAt: true } }),
  ])

  const r = only(apptRows)
  const appt = apptResult(r)
  return {
    appointments: {
      today: appt.today,
      next7d: num(r['next7d']),
      month: appt.month,
      byStatusMonth: Object.fromEntries(STATUSES.map((s) => [s, num(r[`st_${s.toLowerCase()}`])])),
    },
    customers: { total: cust.total, newMonth: cust.newMonth.current },
    revenueCents: { month: appt.revenue },
    store: store.accounts > 0 ? { paidOrders: store.paidOrders, revenueCents: store.revenueCents } : null,
    team: { active: team, professionals },
    appUsers: { activeMonth: users.month },
    lastActivityAt: last._max.createdAt,
  }
}
