import { defineRoute, preflight } from '@/server/api/define-route'
import { uuid } from '@/server/api/wire'
import { CAPABILITIES } from '@/server/auth/capabilities'
import { getStaffProfile } from '@/server/auth/staff-app-auth'
import { z } from '@/server/domain/errors'
import { setNotifyAllAppointments } from '@/server/domain/team/staff-preferences'

const profileSchema = z.object({
  userId: uuid,
  membershipId: uuid,
  name: z.string(),
  email: z.string(),
  role: z.enum(['OWNER', 'MANAGER', 'PROFESSIONAL']),
  roleLabel: z.string(),
  professionalId: uuid.nullable(),
  capabilities: z.array(z.enum(CAPABILITIES)),
  notifyAllAppointments: z.boolean(),
})

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/me',
  auth: 'staff',
  summary: 'Quem está logado na equipe: papel, rótulo do papel, capacidades e a preferência de avisos de toda a loja',
  tag: 'Conta da equipe',
  response: profileSchema,
  handler: async ({ ctx }) => getStaffProfile(ctx),
})

export const PATCH = defineRoute({
  method: 'PATCH',
  path: '/v1/staff/me',
  auth: 'staff',
  summary: 'Liga ou desliga os avisos (por push) de todos os agendamentos da loja; só dono e gerente (403 para o profissional)',
  tag: 'Conta da equipe',
  body: z.object({ notifyAllAppointments: z.boolean() }),
  response: profileSchema,
  handler: async ({ ctx, body }) => {
    await setNotifyAllAppointments(ctx, body.notifyAllAppointments)
    return getStaffProfile(ctx)
  },
})

export const OPTIONS = preflight
