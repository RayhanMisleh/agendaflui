import { defineRoute, preflight } from '@/server/api/define-route'
import { addressSchema } from '@/server/api/schemas/store'
import { z } from '@/server/domain/errors'
import { createAddress, listAddresses } from '@/server/domain/store/addresses'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/me/addresses',
  auth: 'customer',
  module: 'store',
  summary: 'Endereços de entrega do cliente (até 10): o padrão primeiro',
  tag: 'Loja',
  response: z.object({ items: z.array(addressSchema) }),
  handler: async ({ ctx }) => ({ items: await listAddresses(ctx) }),
})

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/me/addresses',
  auth: 'customer',
  module: 'store',
  status: 201,
  summary: 'Cadastra um endereço de entrega. O primeiro já fica como padrão; marcar outro como padrão desmarca o anterior',
  tag: 'Loja',
  body: z.object({
    label: z.string().max(100).nullable().optional().describe('Apelido, como "Casa" ou "Trabalho".'),
    recipientName: z.string().max(200),
    postalCode: z.string().max(20).describe('CEP com 8 números, com ou sem traço.'),
    street: z.string().max(300),
    number: z.string().max(50),
    complement: z.string().max(200).nullable().optional(),
    district: z.string().max(200),
    city: z.string().max(200),
    state: z.string().max(10).describe('Sigla do estado (UF).'),
    isDefault: z.boolean().optional(),
  }),
  response: addressSchema,
  handler: async ({ ctx, body }) => createAddress(ctx, { ...body, label: body.label ?? null, complement: body.complement ?? null, isDefault: body.isDefault ?? false }),
})

export const OPTIONS = preflight
