import type { TenantContext } from '@/server/auth/actor'
import type { TenantTx } from '@/server/db/tenant'

/*
 * Fila do Google Agenda, do lado do domínio: cada mudança de agendamento sobe a `generation` da linha dele em
 * `calendar_syncs`, na mesma transação da mudança. Nada aqui chama o Google nem lê ligação: o agendador (em
 * `src/server/calendar/worker.ts`) é quem lê o estado atual e deixa a agenda igual a ele. Nenhuma trava nova: o
 * enfileiramento roda sob as travas da operação que o chama.
 */

/** Marca o agendamento como "mudou": cria a linha ou sobe a geração e zera tentativas, espera e falha. */
export async function enqueueCalendarSync(tx: TenantTx, ctx: TenantContext, appointmentId: string): Promise<void> {
  await tx.calendarSync.upsert({
    where: { appointmentId },
    create: { businessId: ctx.businessId, appointmentId },
    update: { generation: { increment: 1 }, attempts: 0, nextAttemptAt: null, failedAt: null, lastError: null },
  })
}

/** A fase 2 (pet) acrescenta `{ petId }` aqui quando o agendamento ganhar pet. */
export type CalendarScope = { professionalId: string } | { customerId: string }

/**
 * Enfileira os agendamentos de um profissional ou de um cliente, em ordem de id (a ordem fixa evita espera em
 * círculo entre duas operações). `futureOnly`: só os que ainda não terminaram. `onlyPlaced`: só os que já estão numa agenda.
 * Devolve quantos enfileirou.
 */
export async function enqueueCalendarFor(
  tx: TenantTx,
  ctx: TenantContext,
  scope: CalendarScope,
  o: { futureOnly: boolean; onlyPlaced?: boolean },
): Promise<number> {
  const where = 'professionalId' in scope ? { professionalId: scope.professionalId } : { customerId: scope.customerId }
  const rows = await tx.appointment.findMany({
    where: { ...where, ...(o.futureOnly ? { endsAt: { gte: ctx.clock() } } : {}) },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  let ids = rows.map((r) => r.id)
  if (o.onlyPlaced === true && ids.length > 0) {
    const colocados = await tx.calendarSync.findMany({
      where: { appointmentId: { in: ids }, placedUserId: { not: null } },
      select: { appointmentId: true },
    })
    const set = new Set(colocados.map((c) => c.appointmentId))
    ids = ids.filter((id) => set.has(id))
  }
  for (const id of ids) await enqueueCalendarSync(tx, ctx, id)
  return ids.length
}
