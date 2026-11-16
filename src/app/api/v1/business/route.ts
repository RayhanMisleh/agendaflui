import { defineRoute, preflight } from '@/server/api/define-route'
import { businessSchema } from '@/server/api/booking-schemas'
import { getPublicBusiness } from '@/server/domain/platform/public-business'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/business',
  auth: 'key',
  summary: 'Dados públicos da conta: nome, marca, termos, módulos e regras de agenda',
  tag: 'Conta',
  response: businessSchema,
  handler: async ({ key }) => getPublicBusiness(key.businessId),
})

export const OPTIONS = preflight
