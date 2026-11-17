import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import type { Prisma } from '@/server/db/generated/client'
import { DomainError, parse, z } from '@/server/domain/errors'
import { ownProfessionalId } from '@/server/domain/team/professionals'
import { compareLocalDates, daysBetween, isLocalDate, localDayRange } from '@/server/time'

/** Datas locais da conta (`AAAA-MM-DD`), inclusive nas duas pontas; no máximo 366 dias. */
export type ReportRange = { from: string; to: string }
export type ReportFilter = ReportRange & { professionalId?: string; serviceId?: string }

export const MAX_REPORT_DAYS = 366

const localDate = z.string().refine(isLocalDate, 'Use uma data válida no formato AAAA-MM-DD.')

const filterSchema = z.object({
  from: localDate,
  to: localDate,
  professionalId: z.uuid('Profissional inválido.').optional(),
  serviceId: z.uuid('Serviço inválido.').optional(),
})

/** Situações que fecham um atendimento e entram nos relatórios (as demais ainda podem mudar). */
export const REPORT_STATUSES = ['COMPLETED', 'CANCELED', 'NO_SHOW'] as const

export type ReportScope = {
  from: string
  to: string
  start: Date
  end: Date
  professionalId: string | undefined
  serviceId: string | undefined
  /** Vê a comissão de todos (dono, gerente, suporte); senão só a da própria ficha. */
  seesAllCommission: boolean
  ownId: string | null
}

function forbidden(message: string): DomainError {
  return new DomainError('forbidden', message)
}

/** Valida o período e resolve o que o ator pode ver. O profissional só enxerga a própria ficha. */
export async function resolveScope(ctx: TenantContext, input: ReportFilter): Promise<ReportScope> {
  const f = parse(filterSchema, input)
  const all = can(ctx.actor, 'view_all_reports')
  if (!all && !can(ctx.actor, 'view_own_reports')) throw forbidden('Você não tem permissão para ver os relatórios.')
  if (compareLocalDates(f.from, f.to) > 0) {
    throw new DomainError('validation', 'A data final deve ser igual ou depois da inicial.', {
      fields: { to: 'Use uma data igual ou depois da inicial.' },
    })
  }
  if (daysBetween(f.from, f.to) + 1 > MAX_REPORT_DAYS) {
    throw new DomainError('validation', `Escolha um período de no máximo ${MAX_REPORT_DAYS} dias.`, {
      fields: { to: `O período pode ter até ${MAX_REPORT_DAYS} dias.` },
    })
  }
  let professionalId = f.professionalId
  let ownId: string | null = null
  if (!all) {
    ownId = await ownProfessionalId(ctx)
    if (ownId === null) throw forbidden('Seu acesso não está ligado a uma ficha de profissional.')
    if (professionalId !== undefined && professionalId !== ownId) {
      throw forbidden('Você só pode ver os seus próprios relatórios.')
    }
    professionalId = ownId
  }
  return {
    from: f.from,
    to: f.to,
    start: localDayRange(f.from, ctx.timeZone).start,
    end: localDayRange(f.to, ctx.timeZone).end,
    professionalId,
    serviceId: f.serviceId,
    seesAllCommission: all,
    ownId,
  }
}

export function seesCommissionOf(scope: ReportScope, professionalId: string): boolean {
  return scope.seesAllCommission || scope.ownId === professionalId
}

/** Filtro de atendimentos do relatório: término dentro do período, profissional e serviço. */
export function appointmentWhere(
  scope: ReportScope,
  statuses: readonly (typeof REPORT_STATUSES)[number][],
  range: { start: Date; end: Date } = scope,
): Prisma.AppointmentWhereInput {
  return {
    status: { in: [...statuses] },
    endsAt: { gte: range.start, lt: range.end },
    ...(scope.professionalId ? { professionalId: scope.professionalId } : {}),
    ...(scope.serviceId ? { items: { some: { serviceId: scope.serviceId } } } : {}),
  }
}
