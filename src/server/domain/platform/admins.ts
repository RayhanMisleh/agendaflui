import 'server-only'
import { AuthError } from '@/server/auth/actor'
import { hashPassword, passwordSchema, verifyPassword } from '@/server/auth/password'
import { assertPlatformAdmin, requireActiveAdmin, type PlatformAdminActor } from '@/server/auth/platform-actor'
import { clearRateLimit, hitRateLimit, limitKey } from '@/server/auth/rate-limit-db'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { auditPlatform } from '@/server/domain/audit'
import { DomainError, isUniqueViolation, parse, z } from '@/server/domain/errors'
import { emailSchema, personNameSchema } from './schemas'

export type AdminRow = { id: string; name: string; email: string; active: boolean; lastLoginAt: Date | null; createdAt: Date }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Troca de senha: 5 tentativas por admin a cada 15 minutos (acertar zera o contador). */
const SENHA_LIMITE = { limit: 5, windowSec: 900 } as const

const SELECAO = { id: true, name: true, email: true, active: true, lastLoginAt: true, createdAt: true } satisfies Prisma.PlatformAdminSelect

const criarSchema = z.object({ name: personNameSchema, email: emailSchema, password: passwordSchema })
const perfilSchema = z.object({ name: personNameSchema })
const senhaSchema = z.object({ current: z.string().min(1, 'Informe a senha atual.').max(400), next: passwordSchema })

function adminInexistente(): DomainError {
  return new DomainError('not_found', 'Admin não encontrado.')
}

/** Uma trava só para tudo que muda o conjunto de admins ativos: serializa "último admin ativo" entre transações. */
async function travarAdmins(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended('platform_admins', 0))`
}

export async function listAdmins(actor: PlatformAdminActor): Promise<AdminRow[]> {
  assertPlatformAdmin(actor)
  await requireActiveAdmin(prisma, actor)
  return prisma.platformAdmin.findMany({ select: SELECAO, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
}

/** Cria o admin com a senha escolhida (argon2). E-mail repetido é erro do campo. A senha nunca vai para a auditoria. */
export async function createAdmin(actor: PlatformAdminActor, input: { name: string; email: string; password: string }): Promise<AdminRow> {
  assertPlatformAdmin(actor)
  const i = parse(criarSchema, input)
  const passwordHash = await hashPassword(i.password)
  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    let criado: AdminRow
    try {
      criado = await tx.platformAdmin.create({ data: { name: i.name, email: i.email, passwordHash }, select: SELECAO })
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      const msg = 'Já existe um admin com este e-mail. Use outro e-mail.'
      throw new DomainError('validation', msg, { fields: { email: msg } })
    }
    await auditPlatform(tx, actor, { businessId: null, action: 'admin.created', targetType: 'platform_admin', targetId: criado.id })
    return criado
  })
}

/**
 * Ativa ou desativa um admin. Desativar não vale para si mesmo nem para o último admin ativo, e é conferido sob uma trava
 * única de transação (duas desativações simultâneas dos dois últimos admins: só uma passa). Desativar revoga as sessões
 * do painel dev do admin e as de suporte que ele abriu; reativar não devolve nenhuma.
 */
export async function setAdminActive(
  actor: PlatformAdminActor,
  adminId: string,
  active: boolean,
  now: Date = new Date(),
): Promise<AdminRow> {
  assertPlatformAdmin(actor)
  if (!UUID.test(adminId)) throw adminInexistente()
  return prisma.$transaction(async (tx) => {
    await travarAdmins(tx)
    await requireActiveAdmin(tx, actor)
    const alvo = await tx.platformAdmin.findUnique({ where: { id: adminId }, select: SELECAO })
    if (!alvo) throw adminInexistente()
    if (alvo.active === active) return alvo
    if (!active) {
      if (adminId === actor.adminId) {
        throw new DomainError('conflict', 'Você não pode desativar o seu próprio acesso. Peça a outro admin para fazer isso.')
      }
      const outros = await tx.platformAdmin.count({ where: { active: true, id: { not: adminId } } })
      if (outros === 0) {
        throw new DomainError('conflict', 'Este é o último admin ativo da plataforma. Crie ou reative outro admin antes de desativar este.')
      }
    }
    const atualizado = await tx.platformAdmin.update({ where: { id: adminId }, data: { active }, select: SELECAO })
    if (!active) {
      await tx.platformSession.updateMany({ where: { adminId, revokedAt: null }, data: { revokedAt: now } })
      await tx.session.updateMany({ where: { impersonatorAdminId: adminId, revokedAt: null }, data: { revokedAt: now } })
    }
    await auditPlatform(tx, actor, {
      businessId: null,
      action: active ? 'admin.activated' : 'admin.deactivated',
      targetType: 'platform_admin',
      targetId: adminId,
    })
    return atualizado
  })
}

export async function updateOwnProfile(actor: PlatformAdminActor, input: { name: string }): Promise<AdminRow> {
  assertPlatformAdmin(actor)
  const i = parse(perfilSchema, input)
  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    const atualizado = await tx.platformAdmin.update({ where: { id: actor.adminId }, data: { name: i.name }, select: SELECAO })
    await auditPlatform(tx, actor, { businessId: null, action: 'admin.profile_updated', targetType: 'platform_admin', targetId: actor.adminId })
    return atualizado
  })
}

/**
 * Troca a própria senha. Confere a atual (5 tentativas por admin a cada 15 min; `AuthError('rate_limited')` depois), grava
 * a nova (argon2) e revoga todas as outras sessões do admin (painel dev e suporte), mantendo a do token passado.
 */
export async function changeOwnPassword(
  actor: PlatformAdminActor,
  input: { current: string; next: string },
  keepSessionToken: string,
  now: Date = new Date(),
): Promise<void> {
  assertPlatformAdmin(actor)
  if (!UUID.test(actor.adminId)) throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
  const i = parse(senhaSchema, input)
  await requireActiveAdmin(prisma, actor)
  const chave = limitKey('admin:senha', actor.adminId)
  const limite = await hitRateLimit(chave, SENHA_LIMITE, now)
  if (!limite.allowed) throw new AuthError('rate_limited', limite.retryAfterSec)
  const admin = await prisma.platformAdmin.findUnique({ where: { id: actor.adminId }, select: { passwordHash: true } })
  if (!admin || !(await verifyPassword(admin.passwordHash, i.current))) {
    const msg = 'A senha atual não confere. Digite de novo.'
    throw new DomainError('validation', msg, { reason: 'wrong_password', fields: { current: msg } })
  }
  if (i.next === i.current) {
    const msg = 'Escolha uma senha diferente da atual.'
    throw new DomainError('validation', msg, { fields: { next: msg } })
  }
  const passwordHash = await hashPassword(i.next)
  await prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    // A troca só vale se a senha ainda é a que foi conferida (duas trocas simultâneas: só uma passa).
    const trocada = await tx.platformAdmin.updateMany({ where: { id: actor.adminId, passwordHash: admin.passwordHash }, data: { passwordHash } })
    if (trocada.count !== 1) {
      throw new DomainError('conflict', 'A senha foi alterada em outra janela. Recarregue a página e tente de novo.')
    }
    await tx.platformSession.updateMany({
      where: { adminId: actor.adminId, revokedAt: null, tokenHash: { not: hashToken(keepSessionToken) } },
      data: { revokedAt: now },
    })
    await tx.session.updateMany({ where: { impersonatorAdminId: actor.adminId, revokedAt: null }, data: { revokedAt: now } })
    await auditPlatform(tx, actor, { businessId: null, action: 'admin.password_changed', targetType: 'platform_admin', targetId: actor.adminId })
  })
  await clearRateLimit(chave)
}
