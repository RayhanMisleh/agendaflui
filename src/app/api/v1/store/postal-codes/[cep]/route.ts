import { defineRoute, preflight } from '@/server/api/define-route'
import { postalCodeResultSchema } from '@/server/api/schemas/store'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { z } from '@/server/domain/errors'
import { lookupPostalCode } from '@/server/domain/store/addresses'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/store/postal-codes/{cep}',
  auth: 'customer',
  module: 'store',
  summary: 'Endereço de um CEP (8 números, com ou sem traço). Com a consulta fora do ar a resposta é 200 com `unavailable` verdadeiro: a pessoa digita o endereço',
  tag: 'Loja',
  params: z.object({ cep: z.string().max(20).describe('CEP com 8 números, com ou sem traço.') }),
  response: postalCodeResultSchema,
  limit: LIMITS.postalCode,
  limitBy: 'subject',
  handler: async ({ ctx, params }) => lookupPostalCode(ctx, params.cep),
})

export const OPTIONS = preflight
