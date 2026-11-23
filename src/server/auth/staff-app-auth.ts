import 'server-only'
import { AuthError, type TenantContext } from '@/server/auth/actor'
import { ApiAuthError } from '@/server/auth/api-auth-error'
import { issueTokens, type RequestMeta, type TokenPair } from '@/server/auth/api-tokens'
import { can, CAPABILITIES, type Capability } from '@/server/auth/capabilities'
import { checkLoginLimit, clearLoginLimit } from '@/server/auth/login-limit'
import { fakePasswordHash, verifyPassword } from '@/server/auth/password'
import { roleLabel } from '@/server/auth/role-labels'
import { prisma } from '@/server/db/client'
import type { MembershipRole } from '@/server/db/generated/client'
import { tenantDb, type TenantClient, type TenantTx } from '@/server/db/tenant'
import { DomainError } from '@/server/domain/errors'

export type StaffMember = {
  userId: string
  membershipId: string
  name: string
  role: MembershipRole
  professionalId: string | null
}

export type StaffProfile = StaffMember & {
  email: string
  roleLabel: string
  capabilities: Capability[]
  /** Dono ou gerente que recebe por push os avisos de toda a loja (sempre `false` para o profissional). */
  notifyAllAppointments: boolean
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000'


/** Profissional (não arquivado) ligado ao vínculo, ou `null`. */
async function professionalIdOf(db: TenantClient | TenantTx, membershipId: string): Promise<string | null> {
  const professional = await db.professional.findFirst({ where: { membershipId, archivedAt: null }, select: { id: true } })
  return professional?.id ?? null
}

/**
 * Entrada da equipe pelo app, sem escolher a loja: a loja é a do vínculo ATIVO do usuário (há no máximo um por login).
 * Mesmo erro (`invalid_credentials`) para e-mail inexistente, senha errada, usuário sem senha e usuário sem vínculo ativo,
 * sempre com uma verificação de senha e as duas consultas para igualar o tempo. Só com a senha certa a loja suspensa ou
 * arquivada aparece (`business_unavailable`). O limite de tentativas é por e-mail e IP, sem depender de loja.
 */
export async function loginStaff(
  input: { email: string; password: string },
  meta: RequestMeta,
  now: Date,
): Promise<{ pair: TokenPair; member: StaffMember; business: { id: string; slug: string; name: string } }> {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const area = 'app-equipe' as const
  await checkLoginLimit(area, email, meta.ip ?? undefined, now)

  const user = email.length > 0 && email.length <= 254 ? await prisma.user.findUnique({ where: { email } }) : null
  const ok = await verifyPassword(user?.passwordHash ?? (await fakePasswordHash), typeof input.password === 'string' ? input.password : '')
  // Sempre as duas consultas, exista o usuário ou não (o tempo não revela se o e-mail é de alguém).
  const membership = await prisma.membership.findFirst({
    where: { userId: user?.id ?? NIL_UUID, active: true },
    include: { business: { select: { id: true, slug: true, name: true, status: true } } },
  })
  if (!user || !user.passwordHash || !ok || !membership) throw new AuthError('invalid_credentials')
  const loja = membership.business
  if (loja.status !== 'ACTIVE') {
    throw new ApiAuthError('business_unavailable', 'business_unavailable', 'Esta conta não está disponível agora. Fale com o suporte.')
  }
  const businessId = loja.id

  const db = tenantDb(businessId)
  const result = await db.$transaction(async (tx) => {
    await tx.$lockKey('membership', membership.id)
    // Quem troca ou redefine a senha trava este mesmo vínculo (`lockUserAccess`) antes de gravar o hash e revogar os tokens:
    // sob a trava, o hash lido aqui é o definitivo. Se mudou desde a conferência, a senha usada é a antiga e nada é emitido.
    const hashAtual = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } })
    if (hashAtual?.passwordHash !== user.passwordHash) return null
    // Relê sob a trava, por garantia de que o vínculo ainda está ativo. Desativar o vínculo não revoga tokens: o contexto
    // (a cada requisição) e a renovação releem o vínculo e recusam.
    const atual = await tx.membership.findFirst({ where: { id: membership.id, active: true }, select: { role: true } })
    if (!atual) return null
    const pair = await issueTokens(tx, { kind: 'staff', businessId, membershipId: membership.id, userId: user.id }, meta, now)
    return { pair, role: atual.role, professionalId: await professionalIdOf(tx, membership.id) }
  })
  if (!result) throw new AuthError('invalid_credentials')
  await prisma.user.updateMany({ where: { id: user.id }, data: { lastLoginAt: now } })
  await clearLoginLimit(area, email, meta.ip ?? undefined)
  return {
    pair: result.pair,
    member: { userId: user.id, membershipId: membership.id, name: user.name, role: result.role, professionalId: result.professionalId },
    business: { id: loja.id, slug: loja.slug, name: loja.name },
  }
}

/**
 * Quem está logado no app da equipe, a partir do contexto (relido do banco a cada requisição): papel, rótulo com o termo
 * da conta, profissional ligado e as capacidades do papel.
 */
export async function getStaffProfile(ctx: TenantContext): Promise<StaffProfile> {
  const actor = ctx.actor
  if (actor.kind !== 'member') throw new DomainError('forbidden', 'Este endereço é só para a equipe da conta.')
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { email: true } })
  const settings = await ctx.db.businessSettings.findFirst({ select: { termProfessionalSingular: true } })
  const vinculo = await ctx.db.membership.findFirst({ where: { id: actor.membershipId }, select: { notifyAllAppointments: true } })
  return {
    userId: actor.userId,
    membershipId: actor.membershipId,
    name: actor.name,
    email: user?.email ?? '',
    role: actor.role,
    roleLabel: roleLabel(actor.role, settings?.termProfessionalSingular ?? 'Profissional'),
    professionalId: await professionalIdOf(ctx.db, actor.membershipId),
    capabilities: CAPABILITIES.filter((c) => can(actor, c)),
    notifyAllAppointments: can(actor, 'view_all_agendas') && (vinculo?.notifyAllAppointments ?? false),
  }
}
