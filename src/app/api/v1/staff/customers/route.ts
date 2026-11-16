import { defineRoute, preflight } from '@/server/api/define-route'
import { staffCustomer, staffCustomerSchema } from '@/server/api/schemas/staff'
import { queryFlag } from '@/server/api/wire'
import { createCustomer, listCustomers } from '@/server/domain/customers/customers'
import { z } from '@/server/domain/errors'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/customers',
  auth: 'staff',
  summary: 'Clientes em ordem de nome, com busca (nome sem acento, e-mail ou telefone) e paginação por cursor',
  tag: 'Clientes da equipe',
  query: z.object({
    search: z.string().max(80).optional(),
    clubOnly: queryFlag.optional(),
    includeArchived: queryFlag.optional(),
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
  response: z.object({ items: z.array(staffCustomerSchema), nextCursor: z.string().nullable() }),
  handler: async ({ ctx, query }) => {
    const page = await listCustomers(ctx, query)
    return { items: page.items.map(staffCustomer), nextCursor: page.nextCursor }
  },
})

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/customers',
  auth: 'staff',
  status: 201,
  summary: 'Cadastra um cliente pelo balcão (origem PANEL); quem só vê a própria agenda não cadastra',
  tag: 'Clientes da equipe',
  body: z.object({
    name: z.string().max(200),
    email: z.string().max(254).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    birthDate: z.string().max(10).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    isClubMember: z.boolean().optional(),
  }),
  response: staffCustomerSchema,
  handler: async ({ ctx, body }) => staffCustomer(await createCustomer(ctx, body)),
})

export const OPTIONS = preflight
