import { defineRoute, preflight } from '@/server/api/define-route'
import { getNotificationPreferences, preferencesSchema, updateNotificationPreferences } from '@/server/domain/customers/preferences'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/me/notifications',
  auth: 'customer',
  summary: 'Preferências de aviso do cliente',
  tag: 'Conta do cliente',
  response: preferencesSchema,
  handler: async ({ ctx }) => getNotificationPreferences(ctx),
})

export const PUT = defineRoute({
  method: 'PUT',
  path: '/v1/me/notifications',
  auth: 'customer',
  summary: 'Grava as quatro preferências de aviso do cliente',
  tag: 'Conta do cliente',
  body: preferencesSchema,
  response: preferencesSchema,
  handler: async ({ ctx, body }) => updateNotificationPreferences(ctx, body),
})

export const OPTIONS = preflight
