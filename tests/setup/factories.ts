import { randomUUID } from 'node:crypto'
import type { Appointment, AppointmentStatus, AuditLog, Business, CalendarConnection, CalendarConnectionStatus, Customer, Membership, MembershipRole, OnboardingProgress, OnboardingStep, Pet, Prisma, PriceVariant, Professional, Service, ServicePrice, Upload, User, WorkingHours } from '@/server/db/generated/client'
import { hashPassword } from '@/server/auth/password'
import type { GoogleLink } from '@/server/auth/person'
import type { PlatformAdmin } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import { sealCalendarToken } from '@/server/calendar/token'
import type { Actor, Channel, TenantContext } from '@/server/auth/actor'
import { addMinutes, type Weekday } from '@/server/time'
import { createTenantContext } from '@/server/auth/context'
import { searchKey } from '@/server/domain/customers/contact'

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
      searchName: `conta ${slug}`,
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
  /** Texto puro (vira hash). `null` = sem senha. Sem `password` nem `google`, a pessoa nasce com a senha padrão. */
  password?: string | null
  /** Google vinculado (sem `password`, a pessoa fica só com o Google). */
  google?: GoogleLink
  /** Padrão: verificada se tem senha ou Google. `true` força a verificação (conta pendente já provada). */
  verified?: boolean
}

export async function makeUser(overrides: MakeUserInput = {}): Promise<User> {
  const id = sufixo()
  const { password, google, verified, ...rest } = overrides
  const texto = password === undefined ? (google ? null : 'senha-bem-longa') : password
  const ativa = texto !== null || google !== undefined
  const verificada = verified ?? ativa
  return prisma.user.create({
    data: {
      name: `Usuário ${id}`,
      searchName: `usuario ${id}`,
      email: `usuario-${id}@exemplo.test`,
      passwordHash: texto === null ? null : await hashPassword(texto),
      ...(verificada ? { emailVerifiedAt: new Date() } : {}),
      ...(google ? { googleSub: google.sub, googleEmail: google.email, googleLinkedAt: new Date() } : {}),
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

/** Linha de preço por variante (padrão 5000 / 30) e marca o serviço como `BY_VARIANT`. */
export async function makeServicePrice(
  businessId: string,
  serviceId: string,
  variant: PriceVariant,
  o: { priceCents?: number; durationMin?: number } = {},
): Promise<ServicePrice> {
  await prisma.service.update({ where: { id: serviceId }, data: { pricingMode: 'BY_VARIANT' } })
  return prisma.servicePrice.create({
    data: { businessId, serviceId, variant, priceCents: o.priceCents ?? 5000, durationMin: o.durationMin ?? 30 },
  })
}

/** Pet direto no banco (cão médio, nome único). */
export async function makePet(
  businessId: string,
  customerId: string,
  overrides: Partial<Omit<Prisma.PetUncheckedCreateInput, 'businessId' | 'customerId'>> = {},
): Promise<Pet> {
  const name = overrides.name ?? `Pet ${sufixo()}`
  return prisma.pet.create({
    data: { species: 'DOG', size: 'MEDIUM', searchName: searchKey(name), ...overrides, name, businessId, customerId },
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

/**
 * Cliente direto no banco (origem balcão, telefone válido único, sem e-mail). Com `userId`, liga à pessoa: `linkedAt` agora
 * e o e-mail da pessoa, se não vierem.
 */
export async function makeCustomer(
  businessId: string,
  overrides: Partial<Omit<Prisma.CustomerUncheckedCreateInput, 'businessId'>> = {},
): Promise<Customer> {
  contador += 1
  const phone = `5511${(900000000 + contador).toString()}`
  const name = overrides.name ?? `Cliente ${sufixo()}`
  const pessoa = overrides.userId ? await prisma.user.findUniqueOrThrow({ where: { id: overrides.userId } }) : null
  return prisma.customer.create({
    data: {
      phone,
      origin: pessoa ? 'APP' : 'PANEL',
      searchName: searchKey(name),
      ...(pessoa ? { email: pessoa.email, linkedAt: new Date() } : {}),
      ...overrides,
      name,
      businessId,
    },
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

/** Agendamento direto no banco, com um item do serviço (origem painel, criado pelo sistema). Sem `durationMin`, usa o do serviço. */
export async function makeAppointment(
  businessId: string,
  o: {
    customerId: string
    professionalId: string
    serviceId: string
    startsAt: Date
    durationMin?: number
    status?: AppointmentStatus
    petId?: string | null
    isSqueezeIn?: boolean
  },
): Promise<Appointment> {
  const service = await prisma.service.findFirstOrThrow({ where: { id: o.serviceId, businessId } })
  const durationMin = o.durationMin ?? service.durationMin
  return prisma.appointment.create({
    data: {
      businessId,
      customerId: o.customerId,
      professionalId: o.professionalId,
      startsAt: o.startsAt,
      endsAt: addMinutes(o.startsAt, durationMin),
      status: o.status ?? 'CONFIRMED',
      petId: o.petId ?? null,
      isSqueezeIn: o.isSqueezeIn ?? false,
      source: 'PANEL',
      totalCents: service.priceCents,
      totalDurationMin: durationMin,
      createdByType: 'SYSTEM',
      items: {
        create: [
          {
            businessId,
            serviceId: service.id,
            name: service.name,
            priceCents: service.priceCents,
            durationMin,
            rewardPoints: service.rewardPoints,
            position: 1,
          },
        ],
      },
    },
  })
}

/** Contexto de conta para testes de domínio. Sem `actor`, cria um usuário e um vínculo OWNER. */
export async function makeCtx(
  business: { id: string },
  opts: { actor?: Actor; now?: Date; channel?: Channel } = {},
): Promise<TenantContext> {
  let actor = opts.actor
  if (!actor) {
    const user = await makeUser()
    const membership = await makeMembership(business.id, user.id, 'OWNER')
    actor = { kind: 'member', userId: user.id, membershipId: membership.id, name: user.name, role: 'OWNER' }
  }
  const now = opts.now
  // O ator `customer` só existe pelo app; os demais, por padrão, chegam pelo painel.
  const channel = opts.channel ?? (actor.kind === 'customer' ? 'app' : 'panel')
  return createTenantContext({ businessId: business.id, actor, channel, ...(now ? { clock: () => now } : {}) })
}

/** Contexto de um membro com o papel dado: cria o usuário e o vínculo. */
export async function ctxWithRole(
  business: { id: string },
  role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL',
  opts: { now?: Date; channel?: Channel } = {},
): Promise<TenantContext> {
  const user = await makeUser()
  const membership = await makeMembership(business.id, user.id, role)
  return makeCtx(business, {
    actor: { kind: 'member', userId: user.id, membershipId: membership.id, name: user.name, role },
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.channel ? { channel: opts.channel } : {}),
  })
}

/** O ator membro de um contexto criado por `ctxWithRole` (ids do usuário e do vínculo). */
export function memberOf(ctx: TenantContext): Extract<Actor, { kind: 'member' }> {
  if (ctx.actor.kind !== 'member') throw new Error('O ator do contexto não é um membro.')
  return ctx.actor
}

/**
 * Ligação da pessoa com o Google Agenda, direto no banco. `CONNECTED` (padrão) sela o token (padrão `rt-<sub>-1`); `REVOKED` fica
 * sem token e com `revokedAt` agora.
 */
export async function makeCalendarConnection(
  userId: string,
  o: { status?: CalendarConnectionStatus; googleSub?: string; refreshToken?: string } = {},
): Promise<CalendarConnection> {
  const status = o.status ?? 'CONNECTED'
  const googleSub = o.googleSub ?? `sub-${userId}`
  const agora = new Date()
  return prisma.calendarConnection.create({
    data: {
      userId,
      googleSub,
      status,
      connectedAt: agora,
      ...(status === 'CONNECTED'
        ? { refreshTokenEnc: sealCalendarToken(userId, o.refreshToken ?? `rt-${googleSub}-1`) }
        : { revokedAt: agora }),
    },
  })
}

/** Progresso do começo do dono, direto no banco (vazio por padrão). */
export async function makeOnboarding(
  businessId: string,
  o: Partial<{ doneSteps: OnboardingStep[]; skippedSteps: OnboardingStep[]; wizardFinishedAt: Date; dismissedAt: Date }> = {},
): Promise<OnboardingProgress> {
  return prisma.onboardingProgress.create({ data: { businessId, ...o } })
}
