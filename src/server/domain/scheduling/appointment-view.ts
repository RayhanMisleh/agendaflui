import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import type {
  Appointment,
  AppointmentItem,
  AppointmentStatus,
  Customer,
  PartyType,
  Professional,
} from '@/server/db/generated/client'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { formatPhone } from '@/server/domain/customers/contact'
import { isCustomer } from '@/server/domain/input'
import { DomainError, z } from '@/server/domain/errors'
import { enqueueAppointmentEvent } from '@/server/domain/notifications/outbox'
import { ownProfessionalId } from '@/server/domain/team/professionals'
import { customerChangeDeadline, withinCustomerWindow } from '@/server/domain/scheduling/change-window'
import { OPEN_STATUSES } from '@/server/domain/scheduling/status'
import { formatDateTime, formatTime, fromEpochMs, localParts } from '@/server/time'

export type AppointmentView = {
  id: string
  status: AppointmentStatus
  source: 'APP' | 'PANEL'
  startsAt: Date
  endsAt: Date
  /** Rótulos no fuso da conta. */
  local: { date: string; start: string; end: string }
  customer: { id: string; name: string; phoneLabel: string | null }
  professional: { id: string; name: string }
  items: { serviceId: string; name: string; priceCents: number; durationMin: number }[]
  totalCents: number
  totalDurationMin: number
  /** Só na visão da equipe: o cliente do app e o visitante nunca recebem estes dois campos (a chave nem existe). */
  commissionCents?: number | null
  /** Anotação interna da equipe (mesma regra de `commissionCents`). */
  notes?: string | null
  /** Observação escrita pelo cliente ao marcar; visível ao cliente e à equipe. */
  customerNote: string | null
  /** Prazo do cliente para cancelar ou remarcar; para a equipe, `allowed` só segue a situação. */
  change: { allowed: boolean; until: Date | null; untilLabel: string | null }
  createdAt: Date
  /** Rótulo de `createdAt` no fuso da conta. */
  createdLabel: string
  canceledAt: Date | null
  /** Rótulo de `canceledAt` no fuso da conta; nulo quando o instante é nulo. */
  canceledLabel: string | null
  cancelReason: string | null
  completedAt: Date | null
  /** Rótulo de `completedAt` no fuso da conta; nulo quando o instante é nulo. */
  completedLabel: string | null
}

export type Db = TenantClient | TenantTx

export type Who = 'customer' | 'staff'

export type Scope = { all: boolean; ownId: string | null }

export type Row = Appointment & { items: AppointmentItem[]; customer: Customer; professional: Professional }

const idSchema = z.uuid()

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres.`)
    .transform((texto) => (texto === '' ? null : texto))

export type ChangeEvent =
  | 'booked'
  | 'rescheduled'
  | 'canceled'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'outcome_undone'
  | 'adjusted'

/** Dados a mais de um evento, usados só para montar os avisos (ver `afterChange`). */
export type ChangeExtra = {
  from?: string
  fields?: string
  /** Avisa também o membro ligado ao profissional, qualquer que seja quem age. */
  notifyProfessional?: boolean
  previousStartsAt?: number
  previousProfessionalId?: string
}

/**
 * Ponto único dos avisos de cada operação. Roda dentro da transação, depois da gravação, para o aviso
 * nascer junto com a mudança ou não nascer.
 */
export async function afterChange(
  tx: TenantTx,
  ctx: TenantContext,
  event: ChangeEvent,
  appointment: Row,
  extra: ChangeExtra = {},
): Promise<void> {
  if (event === 'adjusted') return
  const previous = typeof extra.previousStartsAt === 'number' ? fromEpochMs(extra.previousStartsAt) : undefined
  const professional = typeof extra.previousProfessionalId === 'string' ? extra.previousProfessionalId : undefined
  await enqueueAppointmentEvent(tx, ctx, event, appointment, {
    ...(extra.notifyProfessional ? { notifyProfessional: true } : {}),
    ...(previous ? { previousStartsAt: previous } : {}),
    ...(professional ? { previousProfessionalId: professional } : {}),
  })
}

export function notFound(): DomainError {
  return new DomainError('not_found', 'Agendamento não encontrado.')
}

export function forbidden(message = 'Você não tem permissão para fazer isso.'): DomainError {
  return new DomainError('forbidden', message)
}

export function invalidTransition(message: string): DomainError {
  return new DomainError('conflict', message, { reason: 'invalid_transition' })
}

export function actorKind(ctx: TenantContext): Who {
  if (ctx.actor.kind === 'customer') return 'customer'
  if (can(ctx.actor, 'view_own_agenda')) return 'staff'
  throw forbidden()
}

export function party(ctx: TenantContext): { type: PartyType; id: string | null } {
  const actor = ctx.actor
  switch (actor.kind) {
    case 'member':
      return { type: 'MEMBER', id: actor.userId }
    case 'impersonator':
    case 'platform_admin':
      return { type: 'PLATFORM_ADMIN', id: actor.adminId }
    case 'customer':
      return { type: 'CUSTOMER', id: actor.customerId }
    case 'system':
      return { type: 'SYSTEM', id: null }
    case 'guest':
      throw forbidden('Entre na sua conta para fazer isso.')
  }
}

/** A equipe com `view_all_agendas` age em qualquer agenda; sem ela, só na do profissional ligado ao acesso. */
export async function staffScope(ctx: TenantContext, who: Who): Promise<Scope> {
  if (who === 'customer') return { all: false, ownId: null }
  if (can(ctx.actor, 'view_all_agendas')) return { all: true, ownId: null }
  return { all: false, ownId: await ownProfessionalId(ctx) }
}

export function assertProfessionalAllowed(who: Who, scope: Scope, professionalId: string): void {
  if (who === 'staff' && !scope.all && scope.ownId !== professionalId) {
    throw forbidden('Você só pode agir na sua própria agenda.')
  }
}

/** Escopo de quem só vê o próprio: o cliente do app, que nunca tem agenda de equipe. */
const NO_AGENDA: Scope = { all: false, ownId: null }

/** Escopo de leitura de quem pede, para `toView`: o da equipe, ou nenhum para o cliente do app. */
export async function viewScope(ctx: TenantContext): Promise<Scope> {
  return ctx.actor.kind === 'customer' ? NO_AGENDA : staffScope(ctx, actorKind(ctx))
}

/**
 * Única regra de "este ator vê os campos internos (comissão e observações) deste agendamento?":
 * quem tem `view_all_agendas` (inclui o suporte) ou o profissional dono do agendamento. Cliente nunca.
 */
export function canSeeInternals(ctx: TenantContext, scope: Scope, professionalId: string): boolean {
  if (ctx.actor.kind === 'customer') return false
  return scope.all || (scope.ownId !== null && scope.ownId === professionalId)
}

/**
 * Prazo de alteração: `customerChangeWindowMin` (das regras da conta, lidas uma vez por operação) antes do
 * início. `allowed` diz se ESTE ator pode alterar: situação aberta, mais o prazo (cliente dono) ou a regra de
 * escopo da equipe (`canSeeInternals`: todas as agendas, suporte ou o profissional do próprio agendamento).
 */
function changeOf(ctx: TenantContext, row: Row, scope: Scope, changeWindowMin: number): AppointmentView['change'] {
  const until = customerChangeDeadline(row.startsAt, changeWindowMin)
  const actor = ctx.actor
  const mayChange =
    actor.kind === 'customer'
      ? row.customerId === actor.customerId && withinCustomerWindow(ctx.clock(), row.startsAt, changeWindowMin)
      : canSeeInternals(ctx, scope, row.professionalId)
  return {
    allowed: OPEN_STATUSES.includes(row.status) && mayChange,
    until,
    untilLabel: formatDateTime(until, ctx.timeZone),
  }
}

/** `changeWindowMin` vem das regras de agenda da conta; quem monta a lista as lê uma vez só. */
export function toView(ctx: TenantContext, row: Row, scope: Scope, changeWindowMin: number): AppointmentView {
  const internals = canSeeInternals(ctx, scope, row.professionalId)
  const view: AppointmentView = {
    id: row.id,
    status: row.status,
    source: row.source,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    local: {
      date: localParts(row.startsAt, ctx.timeZone).date,
      start: formatTime(row.startsAt, ctx.timeZone),
      end: formatTime(row.endsAt, ctx.timeZone),
    },
    customer: {
      id: row.customer.id,
      name: row.customer.name,
      phoneLabel: row.customer.phone ? formatPhone(row.customer.phone) : null,
    },
    professional: { id: row.professional.id, name: row.professional.name },
    items: [...row.items]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((item) => ({
        serviceId: item.serviceId,
        name: item.name,
        priceCents: item.priceCents,
        durationMin: item.durationMin,
      })),
    totalCents: row.totalCents,
    totalDurationMin: row.totalDurationMin,
    customerNote: row.customerNote,
    change: changeOf(ctx, row, scope, changeWindowMin),
    createdAt: row.createdAt,
    createdLabel: formatDateTime(row.createdAt, ctx.timeZone),
    canceledAt: row.canceledAt,
    canceledLabel: row.canceledAt === null ? null : formatDateTime(row.canceledAt, ctx.timeZone),
    cancelReason: row.cancelReason,
    completedAt: row.completedAt,
    completedLabel: row.completedAt === null ? null : formatDateTime(row.completedAt, ctx.timeZone),
  }
  // A visão do cliente é outra: sem as chaves internas, em vez de chaves nulas.
  if (isCustomer(ctx)) return view
  return { ...view, commissionCents: internals ? row.commissionCents : null, notes: internals ? row.notes : null }
}

/**
 * Agendamento com itens, cliente e profissional. As consultas vão em sequência: dentro de uma transação o
 * cliente do banco atende uma por vez, e o `include` do Prisma as dispararia em paralelo.
 */
async function loadRow(db: Db, id: string): Promise<Row | null> {
  if (!idSchema.safeParse(id).success) return null
  const appointment = await db.appointment.findUnique({ where: { id } })
  if (!appointment) return null
  const items = await db.appointmentItem.findMany({
    where: { appointmentId: id },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })
  const customer = await db.customer.findUnique({ where: { id: appointment.customerId } })
  const professional = await db.professional.findUnique({ where: { id: appointment.professionalId } })
  if (!customer || !professional) return null
  return { ...appointment, items, customer, professional }
}

/** Lê o agendamento e confere o acesso do ator: cliente só o próprio (`not_found`), equipe conforme a agenda. */
export async function loadForActor(ctx: TenantContext, db: Db, id: string, who: Who, scope: Scope): Promise<Row> {
  const row = await loadRow(db, id)
  if (!row) throw notFound()
  if (ctx.actor.kind === 'customer' && row.customerId !== ctx.actor.customerId) throw notFound()
  assertProfessionalAllowed(who, scope, row.professionalId)
  return row
}

export async function reload(db: Db, id: string): Promise<Row> {
  const row = await loadRow(db, id)
  if (!row) throw notFound()
  return row
}
