import 'server-only'
import { runAfterResponse } from '@/server/after'
import { lockUserAccess } from '@/server/auth/password-reset'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { DomainError } from '@/server/domain/errors'
import { integrations } from '@/server/integrations'
import { enqueueCalendarForProfessionalsRaw } from './backfill'
import { openSealedCalendarToken, sealCalendarToken } from './token'

/*
 * Ligar e desligar o Google Agenda de uma pessoa. A ligação guarda o token de renovação selado; ligar enfileira os
 * agendamentos futuros dos profissionais ligados ao vínculo ativo dela; desligar apaga a ligação e esquece onde cada evento
 * estava (os eventos já enviados ficam na agenda dela). Revogar o token no Google é melhor esforço, depois do commit.
 */

export type CalendarStatusView = { state: 'off' | 'on' | 'revoked'; connectedAt: Date | null; lastSyncedAt: Date | null }

/** O estado da agenda da pessoa para a tela. */
export async function getCalendarStatus(userId: string): Promise<CalendarStatusView> {
  const c = await prisma.calendarConnection.findUnique({ where: { userId }, select: { status: true, connectedAt: true, lastSyncedAt: true } })
  if (c === null) return { state: 'off', connectedAt: null, lastSyncedAt: null }
  return { state: c.status === 'CONNECTED' ? 'on' : 'revoked', connectedAt: c.connectedAt, lastSyncedAt: c.lastSyncedAt }
}

/** Revoga no Google, depois da resposta, um token que saiu de uso. Falha é engolida. */
export function revokeSealedLater(userId: string, sealed: string | null): void {
  if (sealed === null) return
  runAfterResponse(async () => {
    const token = openSealedCalendarToken(userId, sealed)
    if (token !== null) await integrations().google.revokeToken(token)
  })
}

/**
 * Liga (ou religa) a agenda. Sob a trava da pessoa, confere de novo que o Google vinculado é o mesmo `sub` e grava a ligação
 * `CONNECTED` com o token selado (religar troca o selo e limpa a revogação). Enfileira os futuros dos profissionais ligados ao
 * vínculo ativo da pessoa. Depois do commit, o selo antigo (se havia e era outro) é revogado no Google.
 */
export async function connectCalendar(i: { userId: string; googleSub: string; refreshToken: string; now: Date }): Promise<{ queued: number }> {
  const selo = sealCalendarToken(i.userId, i.refreshToken)
  let antigo: string | null = null
  const queued = await prisma.$transaction(async (tx) => {
    await lockUserAccess(tx, i.userId)
    const pessoa = await tx.user.findUnique({ where: { id: i.userId }, select: { googleSub: true } })
    if (pessoa === null || pessoa.googleSub === null || pessoa.googleSub !== i.googleSub) {
      throw new DomainError('conflict', 'Use a mesma conta Google vinculada à sua conta.', { reason: 'calendar_wrong_google' })
    }
    const anterior = await tx.calendarConnection.findUnique({ where: { userId: i.userId }, select: { refreshTokenEnc: true } })
    antigo = anterior?.refreshTokenEnc ?? null
    await tx.calendarConnection.upsert({
      where: { userId: i.userId },
      create: { userId: i.userId, googleSub: i.googleSub, status: 'CONNECTED', refreshTokenEnc: selo, connectedAt: i.now },
      update: { googleSub: i.googleSub, status: 'CONNECTED', refreshTokenEnc: selo, connectedAt: i.now, revokedAt: null, lastSyncedAt: null },
    })
    const ligados = await tx.professional.findMany({
      where: { membership: { userId: i.userId, active: true } },
      select: { id: true, businessId: true },
      orderBy: { id: 'asc' },
    })
    let total = 0
    for (const businessId of new Set(ligados.map((p) => p.businessId))) {
      total += await enqueueCalendarForProfessionalsRaw(tx, {
        businessId,
        professionalIds: ligados.filter((p) => p.businessId === businessId).map((p) => p.id),
        now: i.now,
      })
    }
    return total
  })
  if (antigo !== selo) revokeSealedLater(i.userId, antigo)
  return { queued }
}

/**
 * Apaga a ligação dentro da transação de quem a chama (desvincular o Google, trocar o e-mail) e esquece onde os eventos
 * estavam. Devolve o selo para revogar depois do commit, ou `null` se não havia ligação ou ela já estava desligada.
 */
export async function disconnectCalendarIn(tx: Prisma.TransactionClient, userId: string): Promise<string | null> {
  const atual = await tx.calendarConnection.findUnique({ where: { userId }, select: { refreshTokenEnc: true } })
  if (atual === null) return null
  await tx.calendarConnection.delete({ where: { userId } })
  await tx.calendarSync.updateMany({ where: { placedUserId: userId }, data: { placedUserId: null } })
  return atual.refreshTokenEnc
}

/** Desliga a agenda a pedido da pessoa; o token é revogado no Google depois do commit. */
export async function disconnectCalendar(userId: string): Promise<void> {
  const selo = await prisma.$transaction(async (tx) => {
    await lockUserAccess(tx, userId)
    return disconnectCalendarIn(tx, userId)
  })
  revokeSealedLater(userId, selo)
}
