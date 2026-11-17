import { defineRoute, preflight } from '@/server/api/define-route'
import { bannerSchema } from '@/server/api/schemas/banners'
import { listLiveBanners } from '@/server/domain/banners/banners'
import { z } from '@/server/domain/errors'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/banners',
  auth: 'key_or_customer',
  module: 'banners',
  summary: 'Banners no ar hoje (ativos, com imagem e dentro do período na data local da conta), na ordem da conta, até 20',
  tag: 'Banners',
  response: z.object({ items: z.array(bannerSchema) }),
  handler: async ({ ctx }) => ({ items: await listLiveBanners(ctx) }),
})

export const OPTIONS = preflight
