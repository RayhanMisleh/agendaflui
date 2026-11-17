import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { getSystemStatus, retryFailedNotification } from '@/server/domain/platform/system'
import { cleanupRound, startScheduler } from '@/server/notifications/scheduler'
import { recordSchedulerRun } from '@/server/notifications/scheduler-runs'
import { hashToken } from '@/server/auth/tokens'
import { addMinutes, fromIsoInstant } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeCustomer, makePlatformAdmin, makeUser } from '../setup/factories'

// Com a máquina ocupada, a primeira consulta e o reinício do banco passam de 5 s.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 })

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

const NOW = fromIsoInstant('2026-11-16T15:00:00.000Z')
const at = (s: string) => fromIsoInstant(s)
const dias = (d: Date, n: number) => addMinutes(d, n * 24 * 60)

let actor: PlatformAdminActor
let adminId: string
beforeEach(async () => {
  await resetDb()
  const admin = await makePlatformAdmin()
  adminId = admin.id
  actor = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function aviso(
  businessId: string,
  customerId: string,
  o: { status?: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'CANCELED'; scheduledFor?: Date; lastError?: string; attempts?: number; updatedAt?: Date; key?: string } = {},
) {
  const n = await prisma.notification.create({
    data: {
      businessId,
      kind: 'APPOINTMENT_CONFIRMED',
      channel: 'EMAIL',
      customerId,
      scheduledFor: o.scheduledFor ?? dias(NOW, -1),
      status: o.status ?? 'PENDING',
      attempts: o.attempts ?? 0,
      ...(o.lastError ? { lastError: o.lastError } : {}),
      payload: { email: 'maria.segredo@exemplo.test', corpo: 'texto do aviso' },
      dedupeKey: o.key ?? randomUUID(),
    },
  })
  if (o.updatedAt) await prisma.$executeRaw`UPDATE notifications SET updated_at = ${o.updatedAt}::timestamptz WHERE id = ${n.id}::uuid`
  return n
}

describe('getSystemStatus', () => {
  test('tamanho do banco, as maiores tabelas (no máximo 8, da maior para a menor) e ator que não é admin', async () => {
    const s = await getSystemStatus(actor, NOW)
    expect(s.database.sizeBytes).toBeGreaterThan(0)
    expect(Number.isSafeInteger(s.database.sizeBytes)).toBe(true)
    expect(s.database.largestTables.length).toBeGreaterThan(0)
    expect(s.database.largestTables.length).toBeLessThanOrEqual(8)
    const bytes = s.database.largestTables.map((t) => t.bytes)
    expect(bytes).toEqual([...bytes].sort((a, b) => b - a))
    expect(s.database.largestTables.every((t) => /^[a-z_]+$/.test(t.name) && t.bytes > 0)).toBe(true)
    expect(s.database.largestTables.map((t) => t.name)).not.toContain('_prisma_migrations')

    const intruso = { kind: 'system' } as unknown as PlatformAdminActor
    expect((await domainError(getSystemStatus(intruso, NOW))).code).toBe('forbidden')
    expect((await domainError(retryFailedNotification(intruso, randomUUID(), NOW))).code).toBe('forbidden')
  })

  test('fila: pendentes, o mais antigo, falhas e ignorados das últimas 24 horas', async () => {
    const b = await makeBusiness()
    const c = await makeCustomer(b.id)
    await aviso(b.id, c.id, { scheduledFor: at('2026-11-15T10:00:00.000Z') })
    await aviso(b.id, c.id, { scheduledFor: at('2026-11-14T08:00:00.000Z') })
    await aviso(b.id, c.id, { scheduledFor: at('2026-11-16T09:00:00.000Z') })
    await aviso(b.id, c.id, { status: 'SENT' })
    await aviso(b.id, c.id, { status: 'FAILED', lastError: 'timeout', updatedAt: at('2026-11-16T10:00:00.000Z') })
    await aviso(b.id, c.id, { status: 'FAILED', lastError: 'timeout', updatedAt: at('2026-11-10T10:00:00.000Z') })
    await aviso(b.id, c.id, { status: 'SKIPPED', updatedAt: at('2026-11-16T11:00:00.000Z') })
    await aviso(b.id, c.id, { status: 'SKIPPED', updatedAt: at('2026-11-01T11:00:00.000Z') })

    const { queue } = (await getSystemStatus(actor, NOW))
    expect(queue.pending).toBe(3)
    expect(queue.oldestPendingAt?.getTime()).toBe(at('2026-11-14T08:00:00.000Z').getTime())
    expect(queue.failed24h).toBe(1)
    expect(queue.skipped24h).toBe(1)
  })

  test('fila vazia: zeros e sem pendente mais antigo', async () => {
    const { queue, scheduler, recentFailures } = await getSystemStatus(actor, NOW)
    expect(queue).toEqual({ pending: 0, oldestPendingAt: null, failed24h: 0, skipped24h: 0 })
    expect(scheduler.lastRuns).toEqual([])
    expect(recentFailures).toEqual([])
  })

  test('últimas execuções do agendador: até 5 de cada tipo, da mais recente para a mais antiga', async () => {
    for (let i = 0; i < 7; i++) {
      await recordSchedulerRun({ kind: 'notifications', startedAt: addMinutes(NOW, -i), finishedAt: addMinutes(NOW, -i + 0.01), ok: true, summary: `enviados ${i}` })
    }
    await recordSchedulerRun({ kind: 'cleanup', startedAt: addMinutes(NOW, -90), finishedAt: addMinutes(NOW, -89), ok: true, summary: 'apagados 4' })
    await recordSchedulerRun({ kind: 'usage_flush', startedAt: addMinutes(NOW, -20), finishedAt: addMinutes(NOW, -20), ok: true, summary: 'linhas 3' })

    const { scheduler } = await getSystemStatus(actor, NOW)
    expect(scheduler.lastRuns).toHaveLength(7)
    expect(scheduler.lastRuns.filter((r) => r.kind === 'notifications')).toHaveLength(5)
    const inicios = scheduler.lastRuns.map((r) => r.startedAt.getTime())
    expect(inicios).toEqual([...inicios].sort((a, b) => b - a))
    expect(scheduler.lastRuns[0]).toMatchObject({ kind: 'notifications', ok: true, summary: 'enviados 0' })
    expect(scheduler.lastRuns.at(-1)).toMatchObject({ kind: 'cleanup', summary: 'apagados 4' })
    expect(scheduler.lastRuns[0]?.finishedAt).toBeInstanceOf(Date)
  })

  test('falhas recentes: código do aviso e erro do agendador, nunca destinatário nem conteúdo', async () => {
    const b = await makeBusiness({ name: 'Pet Feliz' })
    const c = await makeCustomer(b.id, { name: 'Maria Segredo', email: 'maria.segredo@exemplo.test' })
    await aviso(b.id, c.id, { status: 'FAILED', lastError: 'timeout', updatedAt: at('2026-11-16T10:00:00.000Z') })
    await aviso(b.id, c.id, { status: 'FAILED', lastError: 'invalid_recipient', updatedAt: at('2026-11-16T12:00:00.000Z') })
    await aviso(b.id, c.id, { status: 'FAILED', lastError: 'timeout', updatedAt: at('2026-11-10T12:00:00.000Z') }) // antiga
    await aviso(b.id, c.id, { status: 'SENT', updatedAt: at('2026-11-16T12:00:00.000Z') })
    await recordSchedulerRun({ kind: 'cleanup', startedAt: at('2026-11-16T13:00:00.000Z'), finishedAt: at('2026-11-16T13:00:01.000Z'), ok: false, summary: 'erro: TypeError' })
    await recordSchedulerRun({ kind: 'notifications', startedAt: at('2026-11-16T13:30:00.000Z'), finishedAt: at('2026-11-16T13:30:01.000Z'), ok: true, summary: 'enviados 1' })
    await recordSchedulerRun({ kind: 'cleanup', startedAt: at('2026-11-10T13:00:00.000Z'), finishedAt: at('2026-11-10T13:00:01.000Z'), ok: false, summary: 'erro: RangeError' })

    const { recentFailures } = await getSystemStatus(actor, NOW)
    expect(recentFailures.map((f) => [f.kind, f.code, f.businessName])).toEqual([
      ['cleanup', 'TypeError', null],
      ['notification:APPOINTMENT_CONFIRMED', 'invalid_recipient', 'Pet Feliz'],
      ['notification:APPOINTMENT_CONFIRMED', 'timeout', 'Pet Feliz'],
    ])
    expect(recentFailures.map((f) => f.notificationId !== null)).toEqual([false, true, true])
    const at2 = recentFailures.map((f) => f.at.getTime())
    expect(at2).toEqual([...at2].sort((a, b) => b - a))
    const texto = JSON.stringify(await getSystemStatus(actor, NOW))
    expect(texto).not.toMatch(/segredo|maria|texto do aviso|@exemplo/i)
  }, 20_000) // várias consultas e inserções: estoura os 5 s quando a máquina está carregada
})

describe('retryFailedNotification', () => {
  test('volta o aviso para a fila com tentativas zeradas, mantém o horário previsto e grava auditoria', async () => {
    const b = await makeBusiness()
    const c = await makeCustomer(b.id)
    const previsto = at('2026-11-15T10:00:00.000Z')
    const n = await aviso(b.id, c.id, { status: 'FAILED', lastError: 'timeout', attempts: 5, scheduledFor: previsto })
    await prisma.notification.update({ where: { id: n.id }, data: { nextAttemptAt: at('2026-11-16T14:00:00.000Z'), lockedBy: 'rodada-antiga', lockedUntil: at('2026-11-16T14:01:00.000Z') } })

    await retryFailedNotification(actor, n.id, NOW)

    const depois = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })
    expect(depois).toMatchObject({ status: 'PENDING', attempts: 0, nextAttemptAt: null, lockedBy: null, lockedUntil: null, lastError: null })
    expect(depois.scheduledFor.getTime()).toBe(previsto.getTime())
    expect(depois.updatedAt.getTime()).toBe(NOW.getTime())

    const logs = await prisma.auditLog.findMany({ where: { action: 'notification.retried' } })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ businessId: b.id, actorType: 'PLATFORM_ADMIN', actorId: adminId, targetType: 'notification', targetId: n.id })
    const meta = JSON.stringify(logs[0]?.metadata)
    expect(meta).toContain('timeout')
    expect(meta).not.toMatch(/maria|@exemplo|texto do aviso/)
  })

  test('aviso que não está FAILED: conflict, sem mudar nada nem auditar; inexistente: not_found', async () => {
    const b = await makeBusiness()
    const c = await makeCustomer(b.id)
    for (const status of ['PENDING', 'SENT', 'SKIPPED', 'CANCELED'] as const) {
      const n = await aviso(b.id, c.id, { status, attempts: 2 })
      const e = await domainError(retryFailedNotification(actor, n.id, NOW))
      expect(e.code).toBe('conflict')
      expect(e.reason).toBe('not_failed')
      const igual = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })
      expect(igual).toMatchObject({ status, attempts: 2 })
    }
    expect(await prisma.auditLog.count({ where: { action: 'notification.retried' } })).toBe(0)
    expect((await domainError(retryFailedNotification(actor, randomUUID(), NOW))).code).toBe('not_found')
    expect((await domainError(retryFailedNotification(actor, 'xyz', NOW))).code).toBe('validation')
  })

  test('duas tentativas ao mesmo tempo: uma volta para a fila, a outra recebe conflict', async () => {
    const b = await makeBusiness()
    const c = await makeCustomer(b.id)
    const n = await aviso(b.id, c.id, { status: 'FAILED', lastError: 'timeout', attempts: 5 })
    const r = await Promise.allSettled([retryFailedNotification(actor, n.id, NOW), retryFailedNotification(actor, n.id, NOW)])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.auditLog.count({ where: { action: 'notification.retried' } })).toBe(1)
    const perdeu = r.find((x) => x.status === 'rejected')
    expect(perdeu?.status === 'rejected' && perdeu.reason).toMatchObject({ code: 'conflict', reason: 'not_failed' })
  })

  test('admin desativado não reenvia', async () => {
    const b = await makeBusiness()
    const c = await makeCustomer(b.id)
    const n = await aviso(b.id, c.id, { status: 'FAILED' })
    await prisma.platformAdmin.update({ where: { id: adminId }, data: { active: false } })
    expect((await domainError(retryFailedNotification(actor, n.id, NOW))).code).toBe('forbidden')
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('FAILED')
  })
})

describe('agendador grava scheduler_runs', () => {
  test('rodada que lança vira ok: false com só o nome do erro; a seguinte, ok: true com contagens', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = vi.fn()
    run.mockRejectedValueOnce(new TypeError('maria@exemplo.test e ExponentPushToken[abc]'))
    run.mockResolvedValue({ sent: 3, skipped: 1, failed: 0, retried: 2 })
    vi.useFakeTimers()
    const s = startScheduler({ run, cleanup: async () => undefined, flush: async () => 0 })
    const gravadas = () => prisma.schedulerRun.count({ where: { kind: 'notifications' } })
    await vi.advanceTimersByTimeAsync(2_500)
    await vi.waitFor(async () => expect(await gravadas()).toBe(1))
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(async () => expect(await gravadas()).toBe(2))
    s.stop()

    const runs = await prisma.schedulerRun.findMany({ where: { kind: 'notifications' }, orderBy: { startedAt: 'asc' } })
    expect(runs[0]).toMatchObject({ ok: false, summary: 'erro: TypeError' })
    expect(runs[0]?.finishedAt).toBeInstanceOf(Date)
    expect(runs[1]).toMatchObject({ ok: true, summary: 'enviados 3, ignorados 1, falhas 0, novas tentativas 2' })
    expect(JSON.stringify(runs)).not.toMatch(/maria|ExponentPushToken|@/)
  })

  test('falha ao gravar a execução nunca derruba a rodada: a seguinte roda', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.useFakeTimers()
    const run = vi.fn(async () => ({ sent: 1 }))
    const record = vi.fn(async () => {
      throw new Error('banco caiu')
    })
    const s = startScheduler({ run, cleanup: async () => undefined, flush: async () => 0, record })
    await vi.advanceTimersByTimeAsync(130_000)
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(record).toHaveBeenCalled()
    s.stop()
  })

  test('a limpeza apaga execuções com mais de 14 dias e passagens de suporte vencidas há mais de 1 dia', async () => {
    const b = await makeBusiness()
    const mk = (startedAt: Date) => recordSchedulerRun({ kind: 'notifications', startedAt, finishedAt: startedAt, ok: true, summary: 'x' })
    const agora = new Date()
    await mk(dias(agora, -15))
    await mk(dias(agora, -13))
    const passagem = (expiresAt: Date) =>
      prisma.supportHandoff.create({ data: { adminId, businessId: b.id, tokenHash: hashToken(randomUUID()), expiresAt } })
    const vencidaHaDois = await passagem(dias(agora, -2))
    const vencidaHaPouco = await passagem(addMinutes(agora, -60))
    const valida = await passagem(addMinutes(agora, 5))

    await cleanupRound(agora)

    expect(await prisma.schedulerRun.count({ where: { kind: 'notifications', summary: 'x' } })).toBe(1)
    const ids = (await prisma.supportHandoff.findMany()).map((h) => h.id).sort()
    expect(ids).toEqual([vencidaHaPouco.id, valida.id].sort())
    expect(ids).not.toContain(vencidaHaDois.id)
    // A limpeza também grava a própria execução? Não: quem grava é o agendador.
    expect(await prisma.schedulerRun.count({ where: { kind: 'cleanup' } })).toBe(0)
  })

  test('a limpeza apaga sessões e sessões do painel dev vencidas há mais de 1 dia e audita o suporte que venceu sem encerrar', async () => {
    const b = await makeBusiness()
    const usuario = await makeUser()
    const agora = new Date()
    const sessao = (expiresAt: Date, extra: { userId?: string | null; impersonatorAdminId?: string; revokedAt?: Date } = {}) =>
      prisma.session.create({
        data: { userId: extra.userId ?? null, impersonatorAdminId: extra.impersonatorAdminId ?? null, activeBusinessId: b.id, tokenHash: hashToken(randomUUID()), expiresAt, revokedAt: extra.revokedAt ?? null },
      })
    await sessao(dias(agora, -2), { userId: usuario.id })
    const recenteMembro = await sessao(addMinutes(agora, -60), { userId: usuario.id })
    const validaMembro = await sessao(addMinutes(agora, 60), { userId: usuario.id })
    await sessao(dias(agora, -3), { impersonatorAdminId: adminId })
    await sessao(dias(agora, -3), { impersonatorAdminId: adminId, revokedAt: dias(agora, -4) })
    const recenteSuporte = await sessao(addMinutes(agora, -30), { impersonatorAdminId: adminId })
    const painel = (expiresAt: Date) => prisma.platformSession.create({ data: { adminId, tokenHash: hashToken(randomUUID()), expiresAt } })
    await painel(dias(agora, -2))
    const painelRecente = await painel(addMinutes(agora, -60))
    const painelValida = await painel(addMinutes(agora, 60))

    await cleanupRound(agora)

    expect((await prisma.session.findMany()).map((x) => x.id).sort()).toEqual([recenteMembro.id, validaMembro.id, recenteSuporte.id].sort())
    expect((await prisma.platformSession.findMany()).map((x) => x.id).sort()).toEqual([painelRecente.id, painelValida.id].sort())
    // Só o suporte que venceu sem ter sido encerrado nem revogado vira `support.expired`, uma vez, na conta, com o nome do admin.
    const expiradas = await prisma.auditLog.findMany({ where: { action: 'support.expired' } })
    expect(expiradas).toHaveLength(1)
    expect(expiradas[0]).toMatchObject({ businessId: b.id, actorType: 'PLATFORM_ADMIN', actorId: adminId })
    // Rodar de novo não grava de novo.
    await cleanupRound(agora)
    expect(await prisma.auditLog.count({ where: { action: 'support.expired' } })).toBe(1)
  })

  test('duas limpezas ao mesmo tempo gravam um único support.expired por sessão, com o instante do vencimento', async () => {
    const b = await makeBusiness()
    const agora = new Date()
    const vencimento = dias(agora, -3)
    for (let i = 0; i < 3; i++) {
      await prisma.session.create({ data: { userId: null, impersonatorAdminId: adminId, activeBusinessId: b.id, tokenHash: hashToken(randomUUID()), expiresAt: vencimento } })
    }
    await Promise.all([cleanupRound(agora), cleanupRound(agora)])
    const linhas = await prisma.auditLog.findMany({ where: { action: 'support.expired' } })
    expect(linhas).toHaveLength(3)
    expect(linhas[0]?.metadata).toMatchObject({ expiresAt: vencimento.toISOString() })
    expect(await prisma.session.count()).toBe(0)
  })
})
