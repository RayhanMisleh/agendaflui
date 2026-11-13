import { randomUUID } from 'node:crypto'
import type { Business, Membership, MembershipRole, Prisma, User } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'

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

export async function makeUser(overrides: Partial<Prisma.UserUncheckedCreateInput> = {}): Promise<User> {
  const id = sufixo()
  return prisma.user.create({
    data: { name: `Usuário ${id}`, email: `usuario-${id}@exemplo.test`, passwordHash: null, ...overrides },
  })
}

export async function makeMembership(
  businessId: string,
  userId: string,
  role: MembershipRole,
): Promise<Membership> {
  return prisma.membership.create({ data: { businessId, userId, role } })
}
