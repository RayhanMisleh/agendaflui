import { defineRoute, preflight } from '@/server/api/define-route'
import { staffCustomer, staffCustomerSchema } from '@/server/api/schemas/staff'
import { getCustomer } from '@/server/domain/customers/customers'
import { z } from '@/server/domain/errors'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/customers/{id}',
  auth: 'staff',
  summary: 'Um cliente, com a anotação interna da equipe',
  tag: 'Clientes da equipe',
  params: z.object({ id: z.uuid() }),
  response: staffCustomerSchema,
  handler: async ({ ctx, params }) => staffCustomer(await getCustomer(ctx, params.id)),
})

export const OPTIONS = preflight
