import 'server-only'
import type { Actor } from '@/server/auth/actor'
import { assertPlatformAdmin, requireActiveAdmin } from '@/server/auth/platform-actor'
import { prisma } from '@/server/db/client'
import { Prisma } from '@/server/db/generated/client'
import { auditPlatform } from '@/server/domain/audit'
import { DomainError, orNotFound, parse, z } from '@/server/domain/errors'
import { emailChannelKind, getEmailChannel, type EmailChannelKind } from '@/server/notifications/channels'
import { ChannelError, isSafeRecipient, type ChannelErrorCode } from '@/server/notifications/channels/types'
import { renderTestEmail } from '@/server/notifications/render-account'
import { PLATFORM_MAIL_BRAND } from '@/server/notifications/render-invite'
import { SCHEDULER_KINDS } from '@/server/notifications/scheduler-runs'
import { addMinutes, toIsoInstant } from '@/server/time'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

export type SystemStatus = {
  database: { sizeBytes: number; largestTables: { name: string; bytes: number }[] }
  queue: { pending: number; oldestPendingAt: Date | null; failed24h: number; skipped24h: number }
  scheduler: { lastRuns: { kind: string; startedAt: Date; finishedAt: Date | null; ok: boolean; summary: string }[] }
  /** `notificationId` só nas falhas de aviso (para "tentar de novo"); nas do agendador é `null`. */
  recentFailures: { at: Date; kind: string; code: string; businessName: string | null; notificationId: string | null }[]
}

const TABLES_SHOWN = 8
const RUNS_PER_KIND = 5
const FAILURES_SHOWN = 20
const DAY_MIN = 24 * 60

/** Inteiro do banco (`bigint`) para número, recusando o que não cabe com segurança. */
function num(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'bigint' ? Number(v) : v
  if (!Number.isSafeInteger(n)) throw new RangeError('Valor grande demais para mostrar com segurança.')
  return n
}

function only<T>(rows: T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error('A consulta de estado do sistema não devolveu linha.')
  return row
}

/**
 * Estado do sistema para o painel dev: tamanho do banco e maiores tabelas, fila de avisos, últimas execuções do agendador e
 * falhas recentes. Falhas trazem só o código curto e o nome da conta: nunca destinatário, conteúdo ou mensagem de erro.
 */
export async function getSystemStatus(actor: PlatformAdminActor, now: Date): Promise<SystemStatus> {
  assertPlatformAdmin(actor)
  const since = addMinutes(now, -DAY_MIN)
  const [size, tables, queue, runs, failedNotifications, failedRuns] = await Promise.all([
    prisma.$queryRaw<{ size: bigint }[]>(Prisma.sql`SELECT pg_database_size(current_database()) AS size`),
    prisma.$queryRaw<{ name: string; bytes: bigint }[]>(Prisma.sql`
      SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
      ORDER BY bytes DESC, name ASC
      LIMIT ${TABLES_SHOWN}::int`),
    prisma.$queryRaw<{ pending: bigint; oldest: Date | null; failed: bigint; skipped: bigint }[]>(Prisma.sql`
      SELECT count(*) FILTER (WHERE status = 'PENDING') AS pending,
             min(scheduled_for) FILTER (WHERE status = 'PENDING') AS oldest,
             count(*) FILTER (WHERE status = 'FAILED' AND updated_at >= ${since}) AS failed,
             count(*) FILTER (WHERE status = 'SKIPPED' AND updated_at >= ${since}) AS skipped
      FROM notifications`),
    Promise.all(
      SCHEDULER_KINDS.map((kind) =>
        prisma.schedulerRun.findMany({
          where: { kind },
          orderBy: { startedAt: 'desc' },
          take: RUNS_PER_KIND,
          select: { kind: true, startedAt: true, finishedAt: true, ok: true, summary: true },
        }),
      ),
    ),
    prisma.notification.findMany({
      where: { status: 'FAILED', updatedAt: { gte: since } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: FAILURES_SHOWN,
      // Só o que a tela mostra: nada de `payload`, destinatário ou cliente.
      select: { id: true, updatedAt: true, kind: true, lastError: true, business: { select: { name: true } } },
    }),
    prisma.schedulerRun.findMany({
      where: { ok: false, startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
      take: FAILURES_SHOWN,
      select: { kind: true, startedAt: true, finishedAt: true, summary: true },
    }),
  ])

  const q = only(queue)
  const failures: SystemStatus['recentFailures'] = [
    ...failedNotifications.map((n) => ({
      at: n.updatedAt,
      kind: `notification:${n.kind}`,
      code: n.lastError ?? 'unknown',
      businessName: n.business.name,
      notificationId: n.id,
    })),
    ...failedRuns.map((r) => ({
      at: r.finishedAt ?? r.startedAt,
      kind: r.kind,
      code: r.summary.replace(/^erro: /, '') || 'unknown',
      businessName: null,
      notificationId: null,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, FAILURES_SHOWN)

  return {
    database: {
      sizeBytes: num(only(size).size),
      largestTables: tables.map((t) => ({ name: t.name, bytes: num(t.bytes) })),
    },
    queue: { pending: num(q.pending), oldestPendingAt: q.oldest, failed24h: num(q.failed), skipped24h: num(q.skipped) },
    scheduler: { lastRuns: runs.flat().sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()) },
    recentFailures: failures,
  }
}

/**
 * Devolve um aviso `FAILED` para a fila: tentativas zeradas, sem espera nem reserva. O horário previsto (`scheduled_for`)
 * não muda: as regras de atraso e de passado decidem, na próxima rodada, se ainda vale enviar. A mudança é um UPDATE
 * condicional em `status = 'FAILED'` (de duas chamadas ao mesmo tempo, só uma passa). Grava auditoria na mesma transação.
 */
export async function retryFailedNotification(actor: PlatformAdminActor, notificationId: string, now: Date): Promise<void> {
  assertPlatformAdmin(actor)
  const id = parse(z.uuid(), notificationId)
  await prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    const aviso = orNotFound(
      await tx.notification.findUnique({ where: { id }, select: { businessId: true, kind: true, channel: true, lastError: true, attempts: true } }),
      'Aviso',
    )
    const r = await tx.notification.updateMany({
      where: { id, businessId: aviso.businessId, status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: null, lockedBy: null, lockedUntil: null, lastError: null, updatedAt: now },
    })
    if (r.count !== 1) {
      throw new DomainError('conflict', 'Este aviso não está com falha, então não há o que reenviar. Atualize a página para ver a situação atual.', {
        reason: 'not_failed',
      })
    }
    await auditPlatform(tx, actor, {
      businessId: aviso.businessId,
      action: 'notification.retried',
      targetType: 'notification',
      targetId: id,
      metadata: { kind: aviso.kind, channel: aviso.channel, previousError: aviso.lastError, previousAttempts: aviso.attempts },
    })
  })
}

export type TestEmailResult = { ok: boolean; channel: EmailChannelKind; error: ChannelErrorCode | null; to: string }

/**
 * Manda um e-mail de teste ao e-mail do próprio admin, para conferir o canal de envio. Devolve o resultado (nunca lança por
 * falha de envio) e audita `system.test_email` só com `ok`, canal e código do erro: sem destinatário, corpo nem mensagem do provedor.
 */
export async function sendTestEmail(actor: PlatformAdminActor, now: Date): Promise<TestEmailResult> {
  assertPlatformAdmin(actor)
  const admin = await prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    return tx.platformAdmin.findUniqueOrThrow({ where: { id: actor.adminId }, select: { name: true, email: true } })
  })
  const channelKind = emailChannelKind()
  const channel = getEmailChannel()
  let error: ChannelErrorCode | null = null
  if (!channel) error = 'not_configured'
  else if (!isSafeRecipient(admin.email)) error = 'invalid_recipient'
  else {
    try {
      await channel.send({ to: admin.email, fromName: PLATFORM_MAIL_BRAND.name, ...renderTestEmail(PLATFORM_MAIL_BRAND, { adminName: admin.name }) })
    } catch (err) {
      // Só o código curto: a mensagem do provedor pode trazer o endereço.
      error = err instanceof ChannelError ? err.code : 'channel_error'
    }
  }
  const result: TestEmailResult = { ok: error === null, channel: channel ? channelKind : 'none', error, to: admin.email }
  await prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    await auditPlatform(tx, actor, {
      businessId: null,
      action: 'system.test_email',
      targetType: 'system',
      targetId: actor.adminId,
      metadata: { ok: result.ok, channel: result.channel, error: result.error, at: toIsoInstant(now) },
    })
  })
  return result
}
