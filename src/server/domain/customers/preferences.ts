import type { TenantContext } from '@/server/auth/actor'
import { ownCustomerId } from '@/server/domain/customers/account'
import { DomainError, orNotFound, parse, z } from '@/server/domain/errors'

export type NotificationPreferences = {
  pushAppointments: boolean
  emailAppointments: boolean
  pushMarketing: boolean
  emailMarketing: boolean
}

export const preferencesSchema = z.object({
  pushAppointments: z.boolean('Informe sim ou não para os avisos de agendamento no aparelho.'),
  emailAppointments: z.boolean('Informe sim ou não para os avisos de agendamento por e-mail.'),
  pushMarketing: z.boolean('Informe sim ou não para as novidades no aparelho.'),
  emailMarketing: z.boolean('Informe sim ou não para as novidades por e-mail.'),
})

const SELECT = { notifyPushAppointments: true, notifyEmailAppointments: true, notifyPushMarketing: true, notifyEmailMarketing: true } as const

function toView(row: {
  notifyPushAppointments: boolean
  notifyEmailAppointments: boolean
  notifyPushMarketing: boolean
  notifyEmailMarketing: boolean
}): NotificationPreferences {
  return {
    pushAppointments: row.notifyPushAppointments,
    emailAppointments: row.notifyEmailAppointments,
    pushMarketing: row.notifyPushMarketing,
    emailMarketing: row.notifyEmailMarketing,
  }
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

/** Grava as quatro preferências de uma vez (substitui). */
export async function updateNotificationPreferences(
  ctx: TenantContext,
  input: NotificationPreferences,
): Promise<NotificationPreferences> {
  const id = ownCustomerId(ctx)
  const i = parse(preferencesSchema, input)
  const { count } = await ctx.db.customer.updateMany({
    where: { id, archivedAt: null, anonymizedAt: null },
    data: {
      notifyPushAppointments: i.pushAppointments,
      notifyEmailAppointments: i.emailAppointments,
      notifyPushMarketing: i.pushMarketing,
      notifyEmailMarketing: i.emailMarketing,
    },
  })
  if (count === 0) throw new DomainError('not_found', 'Cliente não encontrado.')
  return i
}
