import type { TenantContext } from '@/server/auth/actor'
import { DomainError, orNotFound, parse, z } from '@/server/domain/errors'

/** Id do cliente que age; qualquer outro ator (equipe, visitante) recebe `forbidden`. */
function ownCustomerId(ctx: TenantContext): string {
  if (ctx.actor.kind !== 'customer') throw new DomainError('forbidden', 'Só o próprio cliente pode fazer isso.')
  return ctx.actor.customerId
}

export type NotificationPreferences = {
  emailAppointments: boolean
  emailMarketing: boolean
}

export const preferencesSchema = z.object({
  emailAppointments: z.boolean('Informe sim ou não para os avisos de agendamento por e-mail.'),
  emailMarketing: z.boolean('Informe sim ou não para as novidades por e-mail.'),
})

const SELECT = { notifyEmailAppointments: true, notifyEmailMarketing: true } as const

function toView(row: { notifyEmailAppointments: boolean; notifyEmailMarketing: boolean }): NotificationPreferences {
  return { emailAppointments: row.notifyEmailAppointments, emailMarketing: row.notifyEmailMarketing }
}

/** Preferências de aviso do próprio cliente (os padrões do cadastro enquanto ele não mexe). */
export async function getNotificationPreferences(ctx: TenantContext): Promise<NotificationPreferences> {
  const id = ownCustomerId(ctx)
  const row = orNotFound(
    await ctx.db.customer.findFirst({ where: { id, archivedAt: null, anonymizedAt: null }, select: SELECT }),
    'Cliente',
  )
  return toView(row)
}

/** Grava as duas preferências de uma vez (substitui). */
export async function updateNotificationPreferences(
  ctx: TenantContext,
  input: NotificationPreferences,
): Promise<NotificationPreferences> {
  const id = ownCustomerId(ctx)
  const i = parse(preferencesSchema, input)
  const { count } = await ctx.db.customer.updateMany({
    where: { id, archivedAt: null, anonymizedAt: null },
    data: {
      notifyEmailAppointments: i.emailAppointments,
      notifyEmailMarketing: i.emailMarketing,
    },
  })
  if (count === 0) throw new DomainError('not_found', 'Cliente não encontrado.')
  return i
}
