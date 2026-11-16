import { randomUUID } from 'node:crypto'
import type { AuditLog, Business, Customer, Membership, MembershipRole, Prisma, Professional, Service, Upload, User, WorkingHours } from '@/server/db/generated/client'
import { hashPassword } from '@/server/auth/password'
import type { PlatformAdmin } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import type { Actor, TenantContext } from '@/server/auth/actor'
import type { Weekday } from '@/server/time'
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

/** Serviço direto no banco (nome único, 30 min, R$ 50,00). */
export async function makeService(
  businessId: string,
  overrides: Partial<Omit<Prisma.ServiceUncheckedCreateInput, 'businessId'>> = {},
): Promise<Service> {
  return prisma.service.create({
    data: { name: `Serviço ${sufixo()}`, priceCents: 5000, durationMin: 30, ...overrides, businessId },
  })
}

/** Profissional direto no banco. Sem `serviceIds`, não liga nenhum serviço. */
export async function makeProfessional(
  businessId: string,
  overrides: Partial<Omit<Prisma.ProfessionalUncheckedCreateInput, 'businessId'>> & { serviceIds?: string[] } = {},
): Promise<Professional> {
  const { serviceIds = [], ...rest } = overrides
  const professional = await prisma.professional.create({
    data: { name: `Profissional ${sufixo()}`, ...rest, businessId },
  })
  if (serviceIds.length > 0) {
    await prisma.professionalService.createMany({
      data: serviceIds.map((serviceId) => ({ businessId, professionalId: professional.id, serviceId })),
    })
  }
  return professional
}

/** Cliente direto no banco (origem balcão, telefone válido único, sem e-mail). */
export async function makeCustomer(
  businessId: string,
  overrides: Partial<Omit<Prisma.CustomerUncheckedCreateInput, 'businessId'>> = {},
): Promise<Customer> {
  contador += 1
  const phone = `5511${(900000000 + contador).toString()}`
  return prisma.customer.create({
    data: { name: `Cliente ${sufixo()}`, phone, origin: 'PANEL', ...overrides, businessId },
  })
}

/** Intervalos de expediente de um dia da semana, direto no banco. */
export async function makeWorkingHours(
  businessId: string,
  professionalId: string,
  weekday: Weekday,
  ranges: { startMin: number; endMin: number }[],
): Promise<WorkingHours[]> {
  await prisma.workingHours.createMany({
    data: ranges.map((r) => ({ businessId, professionalId, weekday, startMin: r.startMin, endMin: r.endMin })),
  })
  return prisma.workingHours.findMany({ where: { businessId, professionalId, weekday } })
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

/** Contexto de um membro com o papel dado: cria o usuário e o vínculo. */
export async function ctxWithRole(
  business: { id: string },
  role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL',
  opts: { now?: Date } = {},
): Promise<TenantContext> {
  const user = await makeUser()
  const membership = await makeMembership(business.id, user.id, role)
  return makeCtx(business, {
    actor: { kind: 'member', userId: user.id, membershipId: membership.id, name: user.name, role },
    ...(opts.now ? { now: opts.now } : {}),
  })
}

/** O ator membro de um contexto criado por `ctxWithRole` (ids do usuário e do vínculo). */
export function memberOf(ctx: TenantContext): Extract<Actor, { kind: 'member' }> {
  if (ctx.actor.kind !== 'member') throw new Error('O ator do contexto não é um membro.')
  return ctx.actor
}
