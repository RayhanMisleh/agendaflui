import { areaLink } from '@/server/area-links'
import { googleClient } from '@/server/auth/google/config'
import { prisma } from '@/server/db/client'
import { integrations, IntegrationError } from '@/server/integrations'
import { addMinutes, localParts } from '@/server/time'
import { claimCalendarSyncs, type ClaimedSync } from './claim'
import { buildCalendarEvent, calendarEventId, isCalendarVisible, petEventLabel } from './event'
import { openCalendarToken } from './token'

/*
 * O envio ao Google Agenda é uma RECONCILIAÇÃO: para cada linha atrasada de `calendar_syncs` o agendador lê o estado atual do
 * agendamento e deixa o Google igual a ele (grava o evento ou apaga). Repetir é inofensivo (id determinístico + PUT). A rodada
 * termina gravando `synced_generation` com a geração que reservou: mudança no meio do envio só sobe a geração e a linha volta
 * na rodada seguinte. O Google nunca é chamado dentro de transação nem pela gravação do agendamento.
 */

export const CALENDAR_RETRY_MINUTES = [1, 5, 15, 60, 240] as const
export const CALENDAR_MAX_ATTEMPTS = 6
const DEFAULT_LIMIT = 50
const LIMITED_WAIT_MIN = 1
const UNCONFIGURED_WAIT_MIN = 15

export type CalendarRoundResult = { upserted: number; deleted: number; revoked: number; retried: number; failed: number; skipped: number }

/** O que se sabe do acesso de uma pessoa nesta rodada (nunca gravado: o token de acesso vive só aqui). */
type Access =
  | { kind: 'ok'; accessToken: string; sealed: string }
  | { kind: 'revoked' }
  | { kind: 'none' }
  | { kind: 'wait'; minutes: number }
  | { kind: 'error'; code: string }

type Round = {
  now: Date
  result: CalendarRoundResult
  access: Map<string, Access>
  touched: Set<string>
  client: Awaited<ReturnType<typeof googleClient>> | undefined
}

type Step = { kind: 'done' } | { kind: 'skipped' } | { kind: 'wait'; minutes: number } | { kind: 'error'; code: string } | { kind: 'fatal'; code: string }

/**
 * Desliga a ligação (`REVOKED`) só se o token usado ainda é o guardado: uma religação feita no meio do caminho troca o selo e
 * não é desfeita. Devolve se desligou.
 */
export async function markCalendarRevoked(userId: string, usedSealed: string, now: Date): Promise<boolean> {
  const r = await prisma.calendarConnection.updateMany({
    where: { userId, status: 'CONNECTED', refreshTokenEnc: usedSealed },
    data: { status: 'REVOKED', revokedAt: now, refreshTokenEnc: null },
  })
  return r.count === 1
}

const nameOf = (err: unknown): string => (err instanceof Error ? err.name : 'desconhecido')

async function accessFor(round: Round, userId: string): Promise<Access> {
  const cached = round.access.get(userId)
  if (cached !== undefined) return cached
  const state = await openAccess(round, userId)
  round.access.set(userId, state)
  return state
}

async function openAccess(round: Round, userId: string): Promise<Access> {
  const token = await openCalendarToken(userId)
  if (token === null) return { kind: 'none' }
  round.client ??= await googleClient()
  if (round.client === null) return { kind: 'wait', minutes: UNCONFIGURED_WAIT_MIN }
  try {
    const { accessToken } = await integrations().google.refreshAccessToken({
      clientId: round.client.clientId,
      clientSecret: round.client.clientSecret,
      refreshToken: token.refreshToken,
    })
    return { kind: 'ok', accessToken, sealed: token.sealed }
  } catch (err) {
    if (err instanceof IntegrationError) {
      if (err.code === 'revoked') {
        if (await markCalendarRevoked(userId, token.sealed, round.now)) round.result.revoked += 1
        return { kind: 'revoked' }
      }
      if (err.code === 'rate_limited') return { kind: 'wait', minutes: LIMITED_WAIT_MIN }
      return { kind: 'error', code: err.code }
    }
    console.error(`[agenda] erro ao renovar o acesso: ${nameOf(err)}`)
    return { kind: 'error', code: 'unexpected' }
  }
}

/** Faz uma chamada ao Google com o acesso da pessoa e traduz o resultado (o que fazer com a linha). */
async function withAccess(round: Round, userId: string, call: (accessToken: string) => Promise<void>): Promise<Step> {
  const access = await accessFor(round, userId)
  switch (access.kind) {
    case 'revoked':
    case 'none':
      return { kind: 'skipped' }
    case 'wait':
      return { kind: 'wait', minutes: access.minutes }
    case 'error':
      return { kind: 'error', code: access.code }
    case 'ok':
      break
  }
  try {
    await call(access.accessToken)
    round.touched.add(userId)
    return { kind: 'done' }
  } catch (err) {
    if (!(err instanceof IntegrationError)) {
      console.error(`[agenda] erro ao falar com o Google: ${nameOf(err)}`)
      return { kind: 'fatal', code: 'unexpected' }
    }
    switch (err.code) {
      case 'revoked':
        if (await markCalendarRevoked(userId, access.sealed, round.now)) round.result.revoked += 1
        round.access.set(userId, { kind: 'revoked' })
        return { kind: 'skipped' }
      case 'rate_limited':
        round.access.set(userId, { kind: 'wait', minutes: LIMITED_WAIT_MIN })
        return { kind: 'wait', minutes: LIMITED_WAIT_MIN }
      case 'rejected':
        return { kind: 'fatal', code: err.code }
      default:
        return { kind: 'error', code: err.code }
    }
  }
}

/** Solta a reserva (e, se pedido, adia) sem contar tentativa. */
async function release(line: ClaimedSync, nextAttemptAt: Date | null): Promise<void> {
  await prisma.calendarSync.updateMany({
    where: { id: line.id, lockedBy: line.lockedBy },
    data: { lockedUntil: null, lockedBy: null, ...(nextAttemptAt !== null ? { nextAttemptAt } : {}) },
  })
}

/** Falha que se repete: espera crescente; na 6ª para. Só vale se a geração ainda é a que se tentou (senão, a mudança já a revive). */
async function penalize(round: Round, line: ClaimedSync, code: string): Promise<void> {
  const attempts = Math.min(line.attempts + 1, CALENDAR_MAX_ATTEMPTS)
  const gaveUp = attempts >= CALENDAR_MAX_ATTEMPTS
  const wait = CALENDAR_RETRY_MINUTES[Math.min(attempts, CALENDAR_RETRY_MINUTES.length) - 1] ?? CALENDAR_RETRY_MINUTES[0]
  const r = await prisma.calendarSync.updateMany({
    where: { id: line.id, lockedBy: line.lockedBy, generation: line.generation },
    data: {
      attempts,
      lastError: code.slice(0, 40),
      lockedUntil: null,
      lockedBy: null,
      ...(gaveUp ? { failedAt: round.now } : { nextAttemptAt: addMinutes(round.now, wait) }),
    },
  })
  if (r.count === 0) await release(line, null)
  if (gaveUp) round.result.failed += 1
  else round.result.retried += 1
}

/** Erro que não adianta repetir: a linha para na hora. */
async function giveUp(round: Round, line: ClaimedSync, code: string): Promise<void> {
  const r = await prisma.calendarSync.updateMany({
    where: { id: line.id, lockedBy: line.lockedBy, generation: line.generation },
    data: { attempts: Math.min(line.attempts + 1, CALENDAR_MAX_ATTEMPTS), lastError: code.slice(0, 40), failedAt: round.now, lockedUntil: null, lockedBy: null },
  })
  if (r.count === 0) await release(line, null)
  round.result.failed += 1
}

/** A linha ficou igual ao Google até a geração que se leu. */
async function finishSynced(line: ClaimedSync, placedUserId: string | null): Promise<void> {
  await prisma.calendarSync.updateMany({
    where: { id: line.id, lockedBy: line.lockedBy },
    data: { syncedGeneration: line.generation, placedUserId, attempts: 0, nextAttemptAt: null, lastError: null, lockedUntil: null, lockedBy: null },
  })
}

/** Resolve o que fazer quando um passo não terminou; `true` = a linha já foi tratada (para de processá-la). */
async function stopped(round: Round, line: ClaimedSync, step: Step): Promise<boolean> {
  switch (step.kind) {
    case 'done':
    case 'skipped':
      return false
    case 'wait':
      await release(line, addMinutes(round.now, step.minutes))
      round.result.skipped += 1
      return true
    case 'error':
      await penalize(round, line, step.code)
      return true
    case 'fatal':
      await giveUp(round, line, step.code)
      return true
  }
}

async function processLine(round: Round, line: ClaimedSync): Promise<void> {
  const a = await prisma.appointment.findFirst({
    where: { id: line.appointmentId, businessId: line.businessId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      customerNote: true,
      customer: { select: { name: true } },
      pet: { select: { name: true, species: true, size: true } },
      items: { select: { name: true }, orderBy: { position: 'asc' } },
      business: { select: { timezone: true } },
      professional: { select: { membership: { select: { active: true, userId: true, user: { select: { calendarConnection: { select: { status: true } } } } } } } },
    },
  })
  if (a === null) {
    await finishSynced(line, null)
    round.result.skipped += 1
    return
  }
  const vinculo = a.professional.membership
  const target = vinculo !== null && vinculo.active && vinculo.user.calendarConnection?.status === 'CONNECTED' ? vinculo.userId : null
  const want = isCalendarVisible(a.status)
  const google = integrations().google
  const eventId = calendarEventId(a.id)
  let placed = line.placedUserId

  // O evento mudou de dono ou não vale mais: sai da agenda de quem tinha (se ela ainda está ligada).
  if (placed !== null && (placed !== target || !want)) {
    const anterior = placed
    const step = await withAccess(round, anterior, (accessToken) => google.deleteEvent({ accessToken, eventId }))
    if (await stopped(round, line, step)) return
    if (step.kind === 'done') round.result.deleted += 1
    placed = null
  }

  if (want && target !== null) {
    const { date } = localParts(a.startsAt, a.business.timezone)
    const event = buildCalendarEvent(
      {
        id: a.id,
        status: a.status,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        customerName: a.customer.name,
        customerNote: a.customerNote,
        petLabel: a.pet === null ? null : petEventLabel(a.pet),
        serviceNames: a.items.map((i) => i.name),
      },
      { timeZone: a.business.timezone, painelUrl: areaLink('app', `/painel/agenda?data=${date}&ag=${a.id}`) },
    )
    const step = await withAccess(round, target, (accessToken) => google.upsertEvent({ accessToken, event }))
    if (await stopped(round, line, step)) return
    // Acesso retirado: nada a fazer agora e o evento (se havia) continua onde está.
    if (step.kind === 'done') {
      round.result.upserted += 1
      placed = target
    } else if (line.placedUserId === target) {
      placed = target
    }
  }
  await finishSynced(line, placed)
}

/**
 * Uma rodada: reserva as linhas atrasadas e as deixa iguais ao Google, uma de cada vez. Nunca lança por causa de uma linha; o
 * que não terminou volta com espera (ver `CALENDAR_RETRY_MINUTES`). Um token de acesso por pessoa por rodada.
 */
export async function processCalendarSyncs(o: { now?: Date; limit?: number } = {}): Promise<CalendarRoundResult> {
  const now = o.now ?? new Date()
  const result: CalendarRoundResult = { upserted: 0, deleted: 0, revoked: 0, retried: 0, failed: 0, skipped: 0 }
  const round: Round = { now, result, access: new Map(), touched: new Set(), client: undefined }
  const lines = await claimCalendarSyncs(now, o.limit ?? DEFAULT_LIMIT)
  for (const line of lines) {
    try {
      await processLine(round, line)
    } catch (err) {
      console.error(`[agenda] erro numa linha: ${nameOf(err)}`)
      try {
        await penalize(round, line, 'unexpected')
      } catch (inner) {
        console.error(`[agenda] erro ao adiar a linha: ${nameOf(inner)}`)
      }
    }
  }
  if (round.touched.size > 0) {
    await prisma.calendarConnection.updateMany({ where: { userId: { in: [...round.touched] }, status: 'CONNECTED' }, data: { lastSyncedAt: now } })
  }
  return result
}
