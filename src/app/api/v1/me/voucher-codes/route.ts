import { defineRoute, preflight } from '@/server/api/define-route'
import { toWireVoucherCode, voucherCodeSchema } from '@/server/api/schemas/vouchers'
import { z } from '@/server/domain/errors'
import { listMyVoucherCodes } from '@/server/domain/vouchers/codes'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/me/voucher-codes',
  auth: 'customer',
  module: 'vouchers',
  summary: 'Os códigos de voucher do cliente (só os dele), do mais novo ao mais antigo, com situação, validade e parceiro. O código é gerado quando o pagamento do pedido é aprovado',
  tag: 'Vouchers',
  response: z.object({ items: z.array(voucherCodeSchema) }),
  handler: async ({ ctx }) => ({ items: (await listMyVoucherCodes(ctx)).map(toWireVoucherCode) }),
})

export const OPTIONS = preflight
