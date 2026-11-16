import type { TenantContext } from '@/server/auth/actor'
import { DomainError, isUniqueViolation, parse, z } from '@/server/domain/errors'

/** Plataformas do app, como o app as informa (minúsculas). */
export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const

const PLATFORM = { ios: 'IOS', android: 'ANDROID', web: 'WEB' } as const

/** Token de notificação do aparelho. */
export const pushTokenSchema = z
  .string('Informe o token de notificação do aparelho.')
  .min(16, 'O token de notificação é curto demais. Confira o token enviado pelo sistema do aparelho.')
  .max(4096, 'O token de notificação é longo demais. Confira o token enviado pelo sistema do aparelho.')
  .describe('Token de notificação do aparelho, como o sistema do aparelho o entrega.')

export const registerDeviceSchema = z.object({
  platform: z.enum(DEVICE_PLATFORMS, 'Use ios, android ou web.'),
  pushToken: pushTokenSchema,
})

const MAX_ATTEMPTS = 3

/** Dono do aparelho: o cliente (app do cliente) ou o vínculo do membro da equipe (app da equipe). Outro ator não tem aparelho. */
type Owner = { customerId: string; membershipId: null } | { customerId: null; membershipId: string }

function ownerOf(ctx: TenantContext): Owner {
  const actor = ctx.actor
  if (actor.kind === 'customer') return { customerId: actor.customerId, membershipId: null }
  if (actor.kind === 'member') return { customerId: null, membershipId: actor.membershipId }
  throw new DomainError('forbidden', 'Só o cliente ou a equipe, pelo app, podem registrar um aparelho.')
}

/**
 * Registra o aparelho de quem usa o app (cliente ou membro da equipe) para receber notificações. O mesmo token na conta
 * passa a pertencer ao último que o registrou, seja cliente ou equipe (o aparelho trocou de dono). Duas chamadas
 * simultâneas com o mesmo token deixam um registro só: quem perde a corrida pela inserção refaz como atualização.
 */
export async function registerDevice(ctx: TenantContext, input: { platform: string; pushToken: string }): Promise<void> {
  const owner = ownerOf(ctx)
  const i = parse(registerDeviceSchema, input)
  const now = ctx.clock()
  const platform = PLATFORM[i.platform]
  for (let attempt = 1; ; attempt++) {
    try {
      await ctx.db.device.upsert({
        where: { businessId_pushToken: { businessId: ctx.businessId, pushToken: i.pushToken } },
        create: { businessId: ctx.businessId, ...owner, platform, pushToken: i.pushToken, lastSeenAt: now },
        update: { ...owner, platform, lastSeenAt: now },
      })
      return
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= MAX_ATTEMPTS) throw err
    }
  }
}

/** Remove o aparelho de quem pede. Token que não é dele (ou não existe) não muda nada e não dá erro: não revela quem o tem. */
export async function removeDevice(ctx: TenantContext, pushTokenValue: string): Promise<void> {
  const owner = ownerOf(ctx)
  const { pushToken: token } = parse(z.object({ pushToken: pushTokenSchema }), { pushToken: pushTokenValue })
  await ctx.db.device.deleteMany({ where: { ...owner, pushToken: token } })
}
