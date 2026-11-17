import { AuthError, type TenantContext } from '@/server/auth/actor'
import { readOwnUser, writeOwnName, writeOwnPassword } from '@/server/auth/own-account'
import { hashPassword, passwordSchema, verifyPassword, fakePasswordHash } from '@/server/auth/password'
import { clearRateLimit, hitRateLimit, LIMITS, limitKey } from '@/server/auth/rate-limit-db'
import type { MembershipRole } from '@/server/db/generated/client'
import { auditIn } from '@/server/domain/audit'
import { searchKey } from '@/server/domain/customers/contact'
import { DomainError, parse, z } from '@/server/domain/errors'
import { personNameSchema } from '@/server/domain/platform/schemas'

/*
 * Meu perfil e minha senha no painel. Só para quem entrou com o próprio usuário (membro da equipe): o suporte ("entrar
 * como") e os demais atores não têm "eu" e recebem `forbidden`, em todas as funções.
 */

export type OwnAccountProfile = {
  name: string
  email: string
  avatarUrl: string | null
  role: MembershipRole
  professionalId: string | null
}

type Eu = { userId: string; membershipId: string; role: MembershipRole }

function eu(ctx: TenantContext): Eu {
  if (ctx.actor.kind !== 'member') throw new DomainError('forbidden', 'Só a própria pessoa da equipe pode ver e alterar o seu perfil e a sua senha.')
  return { userId: ctx.actor.userId, membershipId: ctx.actor.membershipId, role: ctx.actor.role }
}

const nomeSchema = z.object({ name: personNameSchema })
const senhaSchema = z.object({
  current: z.string().min(1, 'Informe a senha atual.').max(200, 'A senha pode ter no máximo 200 caracteres.'),
  next: passwordSchema,
})

const senhaErrada = (): DomainError =>
  new DomainError('forbidden', 'A senha atual não confere. Confira a senha e tente de novo.', {
    reason: 'wrong_password',
    fields: { current: 'Senha incorreta.' },
  })

export async function getOwnAccountProfile(ctx: TenantContext): Promise<OwnAccountProfile> {
  const { userId, membershipId, role } = eu(ctx)
  const usuario = await readOwnUser(userId)
  if (!usuario) throw new DomainError('not_found', 'Usuário não encontrado.')
  const ficha = await ctx.db.professional.findFirst({ where: { membershipId, archivedAt: null }, select: { id: true } })
  return { name: usuario.name, email: usuario.email, avatarUrl: usuario.avatarUrl, role, professionalId: ficha?.id ?? null }
}

/** Troca o nome (regrava a busca sem acento) e audita na conta ativa. */
export async function updateOwnAccountProfile(ctx: TenantContext, input: { name: string }): Promise<void> {
  const { userId } = eu(ctx)
  const { name } = parse(nomeSchema, input)
  await writeOwnName(userId, name, searchKey(name), (tx) =>
    auditIn(tx, ctx, { action: 'account.profile_updated', targetType: 'user', targetId: userId }),
  )
}

/**
 * Troca a própria senha. Confere a senha atual (5 tentativas a cada 15 minutos por usuário; acertar zera o contador), exige
 * uma nova diferente e válida, mantém a sessão do token passado e derruba as outras sessões do painel e os tokens do app de
 * todos os vínculos da pessoa, na mesma transação da troca.
 */
export async function changeOwnAccountPassword(
  ctx: TenantContext,
  input: { current: string; next: string },
  keepSessionToken: string,
): Promise<void> {
  const { userId } = eu(ctx)
  const i = parse(senhaSchema, input)
  if (i.current === i.next) {
    throw new DomainError('validation', 'Confira os campos informados e tente de novo.', {
      fields: { next: 'A senha nova precisa ser diferente da atual.' },
    })
  }
  const now = ctx.clock()
  const chave = limitKey('senha-painel', userId)
  const tentativa = await hitRateLimit(chave, LIMITS.loginEmail, now)
  if (!tentativa.allowed) throw new AuthError('rate_limited', tentativa.retryAfterSec)
  const usuario = await readOwnUser(userId)
  const ok = await verifyPassword(usuario?.passwordHash ?? (await fakePasswordHash), i.current)
  if (!usuario || usuario.passwordHash === null || !ok) throw senhaErrada()
  const passwordHash = await hashPassword(i.next)
  const gravada = await writeOwnPassword({
    userId,
    passwordHash,
    expectedHash: usuario.passwordHash,
    keepSessionToken,
    now,
    registrar: (tx) => auditIn(tx, ctx, { action: 'account.password_changed', targetType: 'user', targetId: userId }),
  })
  // A senha mudou entre a conferência e a gravação (outra troca ou redefinição): conta como senha atual que não confere.
  if (!gravada) throw senhaErrada()
  await clearRateLimit(chave)
}
