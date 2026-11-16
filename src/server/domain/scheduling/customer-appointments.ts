import type { TenantContext } from '@/server/auth/actor'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { DomainError } from '@/server/domain/errors'
import { cancelWithinTransaction } from '@/server/domain/scheduling/appointment-status-ops'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { OPEN_STATUSES } from '@/server/domain/scheduling/status'

export type OpenAppointment = { id: string; professionalId: string }

/** Agendamentos pendentes, confirmados ou em andamento (ainda não terminaram) do cliente. */
export async function openAppointmentsOfCustomer(
  ctx: TenantContext,
  db: TenantClient | TenantTx,
  customerId: string,
): Promise<OpenAppointment[]> {
  return db.appointment.findMany({
    where: { customerId, status: { in: [...OPEN_STATUSES] }, endsAt: { gt: ctx.clock() } },
    select: { id: true, professionalId: true },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  })
}

const MAX_ATTEMPTS = 5

/** Os profissionais mudaram entre a leitura e a trava (uma remarcação): refaz com o conjunto novo. */
class RelockNeeded extends Error {
  constructor(readonly professionalIds: string[]) {
    super('relock')
  }
}

const sortedIds = (appointments: OpenAppointment[]): string[] =>
  [...new Set(appointments.map((a) => a.professionalId))].sort()

/**
 * Transação que trava o cliente e depois os profissionais dos agendamentos abertos dele (ordem crescente
 * de id), relê esses agendamentos sob as travas e entrega a lista a `fn`. Se uma remarcação concorrente
 * trouxe um profissional que não estava travado, a transação recomeça com o conjunto completo.
 */
export async function withCustomerAppointmentsLocked<T>(
  ctx: TenantContext,
  customerId: string,
  fn: (tx: TenantTx, open: OpenAppointment[]) => Promise<T>,
): Promise<T> {
  let ids = sortedIds(await openAppointmentsOfCustomer(ctx, ctx.db, customerId))
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await ctx.db.$transaction(async (tx) => {
        await tx.$lockKey('customer', customerId)
        for (const id of ids) await tx.$lockKey('professional', id)
        const open = await openAppointmentsOfCustomer(ctx, tx, customerId)
        const union = sortedIds(open)
        if (union.some((id) => !ids.includes(id))) throw new RelockNeeded([...new Set([...ids, ...union])].sort())
        return fn(tx, open)
      }, TX_OPTIONS)
    } catch (err) {
      if (!(err instanceof RelockNeeded)) throw err
      ids = err.professionalIds
    }
  }
  throw new DomainError('conflict', 'Os agendamentos deste cliente estão mudando agora. Tente de novo em instantes.', {
    reason: 'busy',
  })
}

/** Cancela, sob as travas já obtidas, os agendamentos abertos do cliente. Devolve quantos cancelou. */
export async function cancelOpenAppointmentsOfCustomer(
  tx: TenantTx,
  ctx: TenantContext,
  open: OpenAppointment[],
  reason: string,
): Promise<number> {
  for (const appointment of open) await cancelWithinTransaction(tx, ctx, appointment.id, reason)
  return open.length
}
