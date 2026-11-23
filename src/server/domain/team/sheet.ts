import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import { DomainError, authorize } from '@/server/domain/errors'
import { listAccess } from '@/server/domain/team/access'
import type { TeamMember } from '@/server/domain/team/access'
import { accessStatus } from '@/server/domain/team/access-status'
import type { AccessStatus } from '@/server/domain/team/access-status'
import { getProfessional, listProfessionals, ownProfessionalId } from '@/server/domain/team/professionals'
import type { ProfessionalView } from '@/server/domain/team/professionals'
import { listTimeBlocks } from '@/server/domain/team/time-blocks'
import type { TimeBlockView } from '@/server/domain/team/time-blocks'
import { getWeekSchedule } from '@/server/domain/team/working-hours'
import type { WeekSchedule } from '@/server/domain/team/working-hours'
import { listServices } from '@/server/domain/catalog/services'
import { addDays, todayIn } from '@/server/time'

/** Quantos dias à frente a ficha mostra os bloqueios. */
const DIAS_DE_BLOQUEIO = 90

export type TeamSheet = {
  professional: ProfessionalView
  /** A ficha é da própria pessoa. */
  own: boolean
  /** Quem gerencia a equipe vê e altera tudo; o profissional só o expediente, os bloqueios e a foto da própria ficha. */
  fullAccess: boolean
  /** Os serviços da conta e se a pessoa faz cada um. Vazio para quem não gerencia a equipe. */
  services: { id: string; name: string; does: boolean }[]
  week: WeekSchedule
  blocks: TimeBlockView[]
  /** O acesso (login) ligado à ficha. Só para quem gerencia a equipe. */
  access: TeamMember | null
  /** Hoje na conta, `AAAA-MM-DD`. */
  today: string
  timeZone: string
}

/**
 * Tudo que a ficha de um profissional mostra. Quem gerencia a equipe (dono, gerente, suporte) abre qualquer ficha; o
 * profissional abre só a própria, e nela não vê serviços nem acesso. Ficha de colega é `forbidden`; de outra conta ou
 * inexistente, `not_found`.
 */
export async function getTeamSheet(ctx: TenantContext, id: string): Promise<TeamSheet> {
  const professional = await getProfessional(ctx, id)
  const fullAccess = can(ctx.actor, 'manage_team')
  const own = (await ownProfessionalId(ctx)) === id
  if (!fullAccess && !(own && can(ctx.actor, 'manage_own_availability'))) {
    throw new DomainError('forbidden', 'Você não tem permissão para ver a ficha de outro profissional.')
  }
  const today = todayIn(ctx.timeZone, ctx.clock())
  const [week, blocks, services, access] = await Promise.all([
    getWeekSchedule(ctx, id),
    listTimeBlocks(ctx, { professionalId: id, from: today, to: addDays(today, DIAS_DE_BLOQUEIO) }),
    fullAccess ? listServices(ctx, { includeInactive: true }) : Promise.resolve([]),
    fullAccess ? listAccess(ctx) : Promise.resolve([]),
  ])
  const faz = new Set(professional.serviceIds)
  return {
    professional,
    own,
    fullAccess,
    services: services.map((s) => ({ id: s.id, name: s.name, does: faz.has(s.id) })),
    week,
    blocks,
    access: access.find((m) => m.professionalId === id) ?? null,
    today,
    timeZone: ctx.timeZone,
  }
}

export type TeamRow = {
  professional: ProfessionalView
  serviceNames: string[]
  access: { role: TeamMember['role']; status: AccessStatus } | null
}

/** A lista da equipe: cada profissional com os serviços que faz e o papel do acesso ligado. Só para quem gerencia a equipe. */
export async function listTeamOverview(ctx: TenantContext): Promise<TeamRow[]> {
  authorize(ctx, 'manage_team')
  const [profissionais, servicos, acessos] = await Promise.all([
    listProfessionals(ctx, { includeInactive: true }),
    listServices(ctx, { includeInactive: true }),
    listAccess(ctx),
  ])
  const nomes = new Map(servicos.map((s) => [s.id, s.name]))
  return profissionais.map((professional) => {
    const acesso = acessos.find((m) => m.professionalId === professional.id)
    return {
      professional,
      serviceNames: professional.serviceIds.flatMap((id) => nomes.get(id) ?? []),
      access: acesso ? { role: acesso.role, status: accessStatus(acesso) } : null,
    }
  })
}
