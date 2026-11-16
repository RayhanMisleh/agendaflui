import { randomUUID } from 'node:crypto'
import type { AuditLog, Business, Membership, MembershipRole, Prisma, Upload, User } from '@/server/db/generated/client'
import { hashPassword } from '@/server/auth/password'
import type { PlatformAdmin } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import type { Actor, TenantContext } from '@/server/auth/actor'
import { createTenantContext } from '@/server/auth/context'

let contador = 0

function sufixo(): string {
  contador += 1
  return `${contador.toString(36)}${randomUUID().slice(0, 8)}`
}

/** Cria a conta com marca, módulos e configurações. */
export async function makeBusiness(overrides: Partial<Prisma.BusinessUncheckedCreateInput> = {}): Promise<Business> {
  const slug = `conta-${sufixo()}`
  return prisma.business.create({
    data: {
      slug,
      name: `Conta ${slug}`,
      branding: { create: { displayName: `Conta ${slug}` } },
      modules: { create: {} },
      settings: { create: {} },
      ...overrides,
    },
  })
}

type MakeUserInput = Omit<Prisma.UserUncheckedCreateInput, 'passwordHash' | 'name' | 'email'> & {
  name?: string
  email?: string
  /** Texto puro (vira hash). `null` = convite pendente, sem senha. */
  password?: string | null
}

export async function makeUser(overrides: MakeUserInput = {}): Promise<User> {
  const id = sufixo()
  const { password = 'senha-bem-longa', ...rest } = overrides
  return prisma.user.create({
    data: {
      name: `Usuário ${id}`,
      email: `usuario-${id}@exemplo.test`,
      passwordHash: password === null ? null : await hashPassword(password),
      ...rest,
    },
  })
}

export async function makePlatformAdmin(
  o: { email?: string; password?: string; name?: string; active?: boolean } = {},
): Promise<PlatformAdmin> {
  const id = sufixo()
  return prisma.platformAdmin.create({
    data: {
      name: o.name ?? `Admin ${id}`,
      email: o.email ?? `admin-${id}@exemplo.test`,
      passwordHash: await hashPassword(o.password ?? 'senha-bem-longa'),
      active: o.active ?? true,
    },
  })
}

export async function makeMembership(
  businessId: string,
  userId: string,
  role: MembershipRole,
): Promise<Membership> {
  return prisma.membership.create({ data: { businessId, userId, role } })
}

export async function makeUpload(businessId: string | null): Promise<Upload> {
  return prisma.upload.create({
    data: {
      businessId,
      path: `uploads/${sufixo()}.png`,
      mimeType: 'image/png',
      sizeBytes: 1,
      width: 1,
      height: 1,
      createdByType: 'SYSTEM',
    },
  })
}

export async function makeAuditLog(businessId: string | null): Promise<AuditLog> {
  return prisma.auditLog.create({
    data: { businessId, actorType: 'SYSTEM', actorName: 'sistema', action: `teste-${sufixo()}` },
  })
}

/** Contexto de conta para testes de domínio. Sem `actor`, cria um usuário e um vínculo OWNER. */
export async function makeCtx(
  business: { id: string },
  opts: { actor?: Actor; now?: Date } = {},
): Promise<TenantContext> {
  let actor = opts.actor
  if (!actor) {
    const user = await makeUser()
    const membership = await makeMembership(business.id, user.id, 'OWNER')
    actor = { kind: 'member', userId: user.id, membershipId: membership.id, name: user.name, role: 'OWNER' }
  }
  const now = opts.now
  return createTenantContext({ businessId: business.id, actor, ...(now ? { clock: () => now } : {}) })
}
