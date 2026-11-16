import { defineRoute, preflight } from '@/server/api/define-route'
import { professionalSchema } from '@/server/api/booking-schemas'
import { queryFlag, uuid } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { listProfessionals } from '@/server/domain/team/professionals'

const staffProfessionalSchema = professionalSchema.extend({
  commissionBps: z.number(),
  active: z.boolean(),
  displayOrder: z.number(),
  archived: z.boolean(),
  membershipId: uuid.nullable(),
})

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/professionals',
  auth: 'staff',
  summary: 'Profissionais da conta; a comissão real só aparece para quem gere a equipe e na própria ficha (nas outras vem 0)',
  tag: 'Equipe',
  query: z.object({
    includeInactive: queryFlag.optional().describe('`true` inclui os profissionais desativados.'),
    includeArchived: queryFlag.optional().describe('`true` inclui os profissionais arquivados.'),
  }),
  response: z.object({ items: z.array(staffProfessionalSchema) }),
  handler: async ({ ctx, query }) => ({ items: await listProfessionals(ctx, query) }),
})

export const OPTIONS = preflight
