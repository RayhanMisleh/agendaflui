import { defineRoute, preflight } from '@/server/api/define-route'
import { idParams } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { deleteTimeBlock } from '@/server/domain/team/time-blocks'

export const DELETE = defineRoute({
  method: 'DELETE',
  path: '/v1/staff/time-blocks/{id}',
  auth: 'staff',
  status: 204,
  summary: 'Remove um bloqueio de agenda',
  tag: 'Equipe',
  params: idParams('o bloqueio'),
  response: z.undefined(),
  handler: async ({ ctx, params }) => deleteTimeBlock(ctx, params.id),
})

export const OPTIONS = preflight
