import { defineRoute, preflight } from '@/server/api/define-route'
import { uuid } from '@/server/api/wire'
import { CAPABILITIES } from '@/server/auth/capabilities'
import { getStaffProfile } from '@/server/auth/staff-app-auth'
import { z } from '@/server/domain/errors'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/me',
  auth: 'staff',
  summary: 'Quem está logado na equipe: papel, rótulo do papel e capacidades',
  tag: 'Conta da equipe',
  response: z.object({
    userId: uuid,
    membershipId: uuid,
    name: z.string(),
    email: z.string(),
    role: z.enum(['OWNER', 'MANAGER', 'PROFESSIONAL']),
    roleLabel: z.string(),
    professionalId: uuid.nullable(),
    capabilities: z.array(z.enum(CAPABILITIES)),
  }),
  handler: async ({ ctx }) => getStaffProfile(ctx),
})

export const OPTIONS = preflight
