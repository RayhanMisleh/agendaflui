import { defineRoute, preflight } from '@/server/api/define-route'
import { voucherSchema } from '@/server/api/schemas/vouchers'
import { idParams } from '@/server/api/wire'
import { getPublicVoucher } from '@/server/domain/vouchers/vouchers'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/vouchers/{id}',
  auth: 'key',
  module: 'vouchers',
  summary: 'Um voucher à venda. Inativo, arquivado, de parceiro parado ou de outra conta: 404',
  tag: 'Vouchers',
  params: idParams('o voucher'),
  response: voucherSchema,
  handler: async ({ ctx, params }) => getPublicVoucher(ctx, params.id),
})

export const OPTIONS = preflight
