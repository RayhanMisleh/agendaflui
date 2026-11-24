'use server'
import { assertCustomerRate, type CustomerVisit } from '@/server/auth/customer-access'
import { listServicesForPet } from '@/server/domain/catalog/pet-services'
import { listServices } from '@/server/domain/catalog/services'
import { getAvailability, listAvailableDays } from '@/server/domain/scheduling/availability'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import { listProfessionals } from '@/server/domain/team/professionals'
import { addDays, compareLocalDates, todayIn, toIsoInstant, weekdayOf } from '@/server/time'
import { formatDuration } from '@/shared/duration'
import { SERVICE_ICON_NAMES, type ServiceIconName } from '@/shared/service-icons'
import { consultar, type Pedido } from '../_lib/consulta'

/*
 * Consultas do Agendar (horários, serviços, profissionais): server actions que o cliente chama conforme escolhe. Cada uma
 * relê a visita (`consultar`): sem vínculo ativo com ESTA loja nada roda. Quem decide é o domínio, que só entrega o pet e o
 * agendamento do próprio cliente. As de horário contam no limite `availability` (por cliente).
 */

export type ServicoDoPet = {
  id: string
  name: string
  description: string | null
  icon: ServiceIconName
  priceCents: number
  durationMin: number
  durationLabel: string
  clubOnly: boolean
  /** Serviço do Clube e o cliente ainda não é do Clube: aparece, mas não se escolhe. */
  locked: boolean
}

export type ProfissionalDaLista = { id: string; name: string; avatarUrl: string | null }
export type DiaLivre = { date: string; label: string; weekdayShort: string; available: boolean }
export type HorarioLivre = { iso: string; label: string }

const DIAS_POR_VEZ = 14
const SEMANA = { SUNDAY: 'Dom', MONDAY: 'Seg', TUESDAY: 'Ter', WEDNESDAY: 'Qua', THURSDAY: 'Qui', FRIDAY: 'Sex', SATURDAY: 'Sáb' } as const

const icone = (nome: string): ServiceIconName => (SERVICE_ICON_NAMES as readonly string[]).includes(nome) ? (nome as ServiceIconName) : SERVICE_ICON_NAMES[0]

function ids(valor: unknown, max = 20): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string').slice(0, max) : []
}

async function doClube(v: CustomerVisit): Promise<boolean> {
  const c = await v.ctx.db.customer.findUnique({ where: { id: v.customerId }, select: { isClubMember: true } })
  return c?.isClubMember === true
}

/** Os serviços feitos para o pet, com o preço e o tempo do porte dele. Sem nicho (loja sem pets), `petId` vazio lista a loja. */
export async function servicosDoPet(slug: string, petId: string): Promise<Pedido<{ servicos: ServicoDoPet[] }>> {
  return consultar(slug, async (v) => {
    const clube = await doClube(v)
    const monta = (s: { id: string; name: string; description: string | null; icon: string; clubOnly: boolean }, priceCents: number, durationMin: number): ServicoDoPet => ({
      id: s.id,
      name: s.name,
      description: s.description,
      icon: icone(s.icon),
      priceCents,
      durationMin,
      durationLabel: formatDuration(durationMin),
      clubOnly: s.clubOnly,
      locked: s.clubOnly && !clube,
    })
    if ((await getNicheSettings(v.ctx)).niche === null) {
      return { servicos: (await listServices(v.ctx)).map((s) => monta(s, s.priceCents, s.durationMin)) }
    }
    const opcoes = await listServicesForPet(v.ctx, petId)
    return {
      servicos: opcoes.flatMap((o) => (o.offered && o.priceCents !== null && o.durationMin !== null ? [monta(o.service, o.priceCents, o.durationMin)] : [])),
    }
  })
}

/** Os profissionais que fazem todos os serviços escolhidos. */
export async function profissionaisPara(slug: string, serviceIds: string[]): Promise<Pedido<{ profissionais: ProfissionalDaLista[] }>> {
  return consultar(slug, async (v) => {
    const lista = await listProfessionals(v.ctx, { serviceIds: ids(serviceIds) })
    return { profissionais: lista.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl })) }
  })
}

type ConsultaDeHorario = { serviceIds: string[]; petId: string; professionalId: string | null; rescheduling: string | null }

function escopo(q: ConsultaDeHorario) {
  const serviceIds = ids(q.serviceIds)
  return {
    ...(serviceIds.length > 0 || !q.rescheduling ? { serviceIds } : {}),
    petId: q.petId === '' ? null : q.petId,
    professionalId: q.professionalId === '' ? null : q.professionalId,
    rescheduling: q.rescheduling === '' ? null : q.rescheduling,
  }
}

/** 14 dias a partir de `from`, só até o alcance máximo da loja; `hasMore` diz se há mais dias depois. */
export async function diasLivres(slug: string, q: ConsultaDeHorario & { from: string }): Promise<Pedido<{ dias: DiaLivre[]; hasMore: boolean; proximo: string }>> {
  return consultar(slug, async (v) => {
    await assertCustomerRate(v, 'availability', v.ctx.clock())
    const hoje = todayIn(v.ctx.timeZone, v.ctx.clock())
    const limite = addDays(hoje, (await getSchedulingRules(v.ctx)).maxAdvanceDays)
    const from = compareLocalDates(q.from, hoje) < 0 ? hoje : q.from
    const to = [addDays(from, DIAS_POR_VEZ - 1), limite].sort(compareLocalDates)[0] ?? limite
    if (compareLocalDates(from, to) > 0) return { dias: [], hasMore: false, proximo: from }
    const dias = await listAvailableDays(v.ctx, { from, to, ...escopo(q) })
    return {
      dias: dias.map((d) => ({
        date: d.date,
        label: d.date.slice(8, 10).replace(/^0/, ''),
        weekdayShort: d.date === hoje ? 'Hoje' : d.date === addDays(hoje, 1) ? 'Amanhã' : SEMANA[weekdayOf(d.date)],
        available: d.available,
      })),
      hasMore: compareLocalDates(addDays(to, 1), limite) <= 0,
      proximo: addDays(to, 1),
    }
  })
}

/** Os horários livres do dia (instante exato e rótulo local). */
export async function horariosLivres(slug: string, q: ConsultaDeHorario & { date: string }): Promise<Pedido<{ horarios: HorarioLivre[] }>> {
  return consultar(slug, async (v) => {
    await assertCustomerRate(v, 'availability', v.ctx.clock())
    const dia = await getAvailability(v.ctx, { date: q.date, ...escopo(q) })
    return { horarios: dia.slots.map((s) => ({ iso: toIsoInstant(s.startsAt), label: s.label })) }
  })
}
