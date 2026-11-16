import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { addMinutes } from '@/server/time'
import { claimDue, CLAIM_MINUTES, type Claimed } from './claim'
import { getChannels, type Channels } from './channels'
import { ChannelError, isSafeRecipient, type ChannelErrorCode } from './channels/types'
import { loadNotification, type LoadedNotification } from './load'
import { renderNotification } from './render'
import { decide } from './rules'

/*
 * Garantia de entrega: no máximo uma vez por rodada e pelo menos uma vez no total. Se o processo morrer entre o envio e a
 * marcação, a linha volta à fila quando a reserva vence e pode sair de novo; duas rodadas simultâneas nunca enviam a mesma linha.
 */

export type RoundResult = { sent: number; skipped: number; failed: number; retried: number }
type Options = { now?: Date; limit?: number; channels?: Channels }

const DEFAULT_LIMIT = 50
const MAX_ATTEMPTS = 5
/** Espera até a nova tentativa depois da 1ª, 2ª, 3ª e 4ª falha, em minutos. */
const RETRY_MINUTES = [1, 5, 15, 60]
/** Teto de um envio (o Expo tem o seu de 10 s por lote); bem abaixo da reserva de 2 minutos. */
const SEND_TIMEOUT_MS = 30_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_ok, fail) => {
    timer = setTimeout(() => fail(new ChannelError('timeout')), ms)
  })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}

/** Só o código curto entra no banco: a mensagem do provedor pode ter e-mail ou token. */
function codeOf(err: unknown): ChannelErrorCode {
  return err instanceof ChannelError ? err.code : 'channel_error'
}

type Outcome =
  | { kind: 'sent' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; code: ChannelErrorCode; retry: boolean }

/** Atualiza a linha só se ainda for desta rodada. `false` = outro processo assumiu: descarta o resultado sem erro. */
async function finish(row: Claimed, data: Prisma.NotificationUncheckedUpdateManyInput): Promise<boolean> {
  const r = await prisma.notification.updateMany({
    where: { id: row.id, businessId: row.businessId, status: 'PENDING', lockedBy: row.lockedBy },
    data: { lockedUntil: null, lockedBy: null, ...data },
  })
  return r.count === 1
}

/** Renova a reserva antes de enviar: só envia quem ainda é dono da linha por mais um período inteiro. */
async function renew(row: Claimed, now: Date): Promise<boolean> {
  const r = await prisma.notification.updateMany({
    where: { id: row.id, businessId: row.businessId, status: 'PENDING', lockedBy: row.lockedBy, lockedUntil: { gt: now } },
    data: { lockedUntil: addMinutes(now, CLAIM_MINUTES) },
  })
  return r.count === 1
}

async function deliver(n: LoadedNotification, channels: Channels): Promise<Outcome> {
  const recipient = n.recipient
  if (!recipient) return { kind: 'skipped', reason: 'recipient_gone' }
  const rendered = renderNotification(n)
  if (n.channel === 'EMAIL') {
    if (!channels.email) return { kind: 'failed', code: 'not_configured', retry: false }
    if (!recipient.email || !isSafeRecipient(recipient.email)) return { kind: 'failed', code: 'invalid_recipient', retry: false }
    try {
      await withTimeout(channels.email.send({ ...rendered.email, to: recipient.email, fromName: n.business.name }), SEND_TIMEOUT_MS)
      return { kind: 'sent' }
    } catch (err) {
      return { kind: 'failed', code: codeOf(err), retry: true }
    }
  }
  if (!channels.push) return { kind: 'failed', code: 'not_configured', retry: false }
  let invalidTokens: string[]
  try {
    invalidTokens = (await withTimeout(channels.push.send({ ...rendered.push, tokens: recipient.pushTokens }), SEND_TIMEOUT_MS)).invalidTokens
  } catch (err) {
    return { kind: 'failed', code: codeOf(err), retry: true }
  }
  // Fora do `try` do envio: o push já saiu, e falha na limpeza não pode reagendá-lo.
  if (invalidTokens.length > 0) {
    try {
      await prisma.device.deleteMany({ where: { businessId: n.businessId, pushToken: { in: invalidTokens } } })
    } catch (err) {
      console.error(`[avisos] erro ao apagar tokens inválidos: ${err instanceof Error ? err.name : 'desconhecido'}`)
    }
  }
  // Todos os tokens eram mortos: nada chegou a ninguém.
  if (recipient.pushTokens.every((t) => invalidTokens.includes(t))) return { kind: 'skipped', reason: 'no_device' }
  return { kind: 'sent' }
}

async function handle(row: Claimed, now: () => Date, channels: Channels, total: RoundResult): Promise<void> {
  const n = await loadNotification(row.id, row.businessId)
  if (!n) {
    if (await finish(row, { status: 'SKIPPED', skipReason: 'gone' })) total.skipped += 1
    return
  }
  const decision = decide(n, now())
  if (decision.action === 'skip') {
    if (await finish(row, { status: 'SKIPPED', skipReason: decision.reason })) total.skipped += 1
    return
  }
  if (!(await renew(row, now()))) return
  const outcome = await deliver(n, channels)
  const attempts = n.attempts + 1
  if (outcome.kind === 'sent') {
    if (await finish(row, { status: 'SENT', sentAt: now(), lastError: null })) total.sent += 1
  } else if (outcome.kind === 'skipped') {
    if (await finish(row, { status: 'SKIPPED', skipReason: outcome.reason })) total.skipped += 1
  } else if (!outcome.retry || attempts >= MAX_ATTEMPTS) {
    if (await finish(row, { status: 'FAILED', attempts, lastError: outcome.code })) total.failed += 1
  } else {
    const wait = RETRY_MINUTES[attempts - 1] ?? 60
    if (await finish(row, { attempts, lastError: outcome.code, nextAttemptAt: addMinutes(now(), wait) })) total.retried += 1
  }
}

/** Uma rodada: reserva os avisos vencidos, decide e envia cada um e marca o resultado. Nunca lança por causa de uma linha. */
export async function processDueNotifications(o: Options = {}): Promise<RoundResult> {
  const now = () => o.now ?? new Date()
  const channels = o.channels ?? getChannels()
  const total: RoundResult = { sent: 0, skipped: 0, failed: 0, retried: 0 }
  const claimed = await claimDue(now(), o.limit ?? DEFAULT_LIMIT)
  for (const row of claimed) {
    try {
      await handle(row, now, channels, total)
    } catch {
      // Falha inesperada (banco, texto): conta como tentativa para uma linha defeituosa não voltar para sempre.
      try {
        const n = await prisma.notification.findFirst({ where: { id: row.id, businessId: row.businessId }, select: { attempts: true } })
        const attempts = (n?.attempts ?? 0) + 1
        const done = attempts >= MAX_ATTEMPTS
        const ok = await finish(
          row,
          done
            ? { status: 'FAILED', attempts, lastError: 'internal_error' }
            : { attempts, lastError: 'internal_error', nextAttemptAt: addMinutes(now(), RETRY_MINUTES[attempts - 1] ?? 60) },
        )
        if (ok) total[done ? 'failed' : 'retried'] += 1
      } catch {
        // Sem como registrar: a reserva vence sozinha e a linha volta à fila.
      }
    }
  }
  return total
}
