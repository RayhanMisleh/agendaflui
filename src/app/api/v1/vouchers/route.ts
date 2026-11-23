import { defineRoute, preflight } from '@/server/api/define-route'
import { voucherSchema } from '@/server/api/schemas/vouchers'
import { z } from '@/server/domain/errors'
import { listPublicVouchers } from '@/server/domain/vouchers/vouchers'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/vouchers',
  auth: 'guest',
  module: 'vouchers',
  summary: 'Vouchers à venda (ativos, de parceiro ativo), na ordem da loja. O estoque não é exposto. A compra é um pedido da Loja com linhas `voucherId` e entrega `NONE`',
  tag: 'Vouchers',
  response: z.object({ items: z.array(voucherSchema) }),
  handler: async ({ ctx }) => ({ items: await listPublicVouchers(ctx) }),
})

export const OPTIONS = preflight
