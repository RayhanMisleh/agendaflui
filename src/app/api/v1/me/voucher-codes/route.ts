import { defineRoute, preflight } from '@/server/api/define-route'
import { toWireVoucherCode, voucherCodeSchema } from '@/server/api/schemas/vouchers'
import { pageCursor, pageLimit } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { listMyVoucherCodes } from '@/server/domain/vouchers/codes'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/me/voucher-codes',
  auth: 'customer',
  module: 'vouchers',
  summary: 'Os códigos de voucher do cliente (só os dele), do mais novo ao mais antigo, com situação, validade e parceiro, paginados por cursor. O código é gerado quando o pagamento do pedido é aprovado',
  tag: 'Vouchers',
  query: z.object({ cursor: pageCursor.optional(), limit: pageLimit(100, 30) }),
  response: z.object({ items: z.array(voucherCodeSchema), nextCursor: z.string().nullable() }),
  handler: async ({ ctx, query }) => {
    const page = await listMyVoucherCodes(ctx, { limit: query.limit, ...(query.cursor === undefined ? {} : { cursor: query.cursor }) })
    return { items: page.items.map(toWireVoucherCode), nextCursor: page.nextCursor }
  },
})

export const OPTIONS = preflight
