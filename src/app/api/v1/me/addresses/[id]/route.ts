import { defineRoute, preflight } from '@/server/api/define-route'
import { addressSchema } from '@/server/api/schemas/store'
import { idParams } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { definedOnly } from '@/server/domain/input'
import { deleteAddress, updateAddress } from '@/server/domain/store/addresses'

export const PATCH = defineRoute({
  method: 'PATCH',
  path: '/v1/me/addresses/{id}',
  auth: 'customer',
  module: 'store',
  summary: 'Altera só os campos enviados do endereço do cliente. Endereço de outra pessoa: 404',
  tag: 'Loja',
  params: idParams('o endereço'),
  body: z
    .object({
      label: z.string().max(100).nullable().optional(),
      recipientName: z.string().max(200).optional(),
      postalCode: z.string().max(20).optional(),
      street: z.string().max(300).optional(),
      number: z.string().max(50).optional(),
      complement: z.string().max(200).nullable().optional(),
      district: z.string().max(200).optional(),
      city: z.string().max(200).optional(),
      state: z.string().max(10).optional(),
      isDefault: z.boolean().optional(),
    })
    .refine((b) => Object.values(b).some((v) => v !== undefined), 'Envie ao menos um campo para alterar.'),
  response: addressSchema,
  handler: async ({ ctx, params, body }) => updateAddress(ctx, params.id, definedOnly(body)),
})

export const DELETE = defineRoute({
  method: 'DELETE',
  path: '/v1/me/addresses/{id}',
  auth: 'customer',
  module: 'store',
  status: 204,
  summary: 'Apaga o endereço do cliente. Endereço de outra pessoa: 404',
  tag: 'Loja',
  params: idParams('o endereço'),
  response: z.undefined(),
  handler: async ({ ctx, params }) => deleteAddress(ctx, params.id),
})

export const OPTIONS = preflight
