import { randomUUID } from 'node:crypto'
import type { TenantContext } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import type { Customer, LoyaltyEntryKind } from '@/server/db/generated/client'
import { ctxWithRole, makeAppointment, makeBusiness, makeCtx, makeCustomer, makeProfessional, makeService, memberOf } from './factories'

/** Terça-feira, 17 de novembro de 2026, 11:00 em Manaus (15:00 UTC). */
export const AGORA = new Date('2026-11-17T15:00:00Z')
/** O atendimento já começou: 09:00 em Manaus. */
export const INICIO = new Date('2026-11-17T13:00:00Z')

export type CenaFidelidade = Awaited<ReturnType<typeof cenaFidelidade>>

/** Conta com a Fidelidade ligada, dono, gerente, profissional (membros) e um cliente com contexto de app. */
export async function cenaFidelidade(o: { timezone?: string; modulo?: boolean; now?: Date } = {}) {
  const b = await makeBusiness({ timezone: o.timezone ?? 'America/Manaus' })
  if (o.modulo !== false) await prisma.businessModules.update({ where: { businessId: b.id }, data: { loyalty: true } })
  const now = o.now ?? AGORA
  const dono = await ctxWithRole(b, 'OWNER', { now })
  const gerente = await ctxWithRole(b, 'MANAGER', { now })
  const profissional = await ctxWithRole(b, 'PROFESSIONAL', { now })
  const cliente = await makeCustomer(b.id, { name: 'Maria da Silva' })
  const ctxCliente = await ctxDoCliente(b, cliente, now)
  return { b, now, dono, gerente, profissional, cliente, ctxCliente }
}

export function ctxDoCliente(b: { id: string }, c: Pick<Customer, 'id' | 'name'>, now: Date = AGORA): Promise<TenantContext> {
  return makeCtx(b, { actor: { kind: 'customer', customerId: c.id, name: c.name }, now })
}

/** Linha direta no razão (por padrão um ajuste de saldo); para montar saldo e histórico sem passar pelo domínio. */
export async function lancar(
  businessId: string,
  customerId: string,
  points: number,
  o: { kind?: LoyaltyEntryKind; createdAt?: Date; appointmentId?: string; dedupeKey?: string } = {},
) {
  const kind = o.kind ?? 'ADJUST'
  return prisma.loyaltyTransaction.create({
    data: {
      businessId,
      customerId,
      kind,
      points,
      ...(kind === 'ADJUST' ? { reason: 'Saldo de teste' } : {}),
      ...(o.appointmentId ? { appointmentId: o.appointmentId } : {}),
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      dedupeKey: o.dedupeKey ?? `teste:${randomUUID()}`,
      createdByType: 'SYSTEM',
    },
  })
}

export async function saldoNoBanco(businessId: string, customerId: string): Promise<number> {
  const r = await prisma.loyaltyTransaction.aggregate({ where: { businessId, customerId }, _sum: { points: true } })
  return r._sum.points ?? 0
}

/** Agendamento confirmado, de hoje às 09:00 (Manaus), com um item por valor de pontos informado. */
export async function agendamentoComPontos(
  b: { id: string },
  customerId: string,
  pontos: number[],
  o: { professionalId?: string } = {},
) {
  const servicos = []
  for (const [i, p] of pontos.entries()) servicos.push(await makeService(b.id, { name: `Serviço ${i + 1}`, rewardPoints: p, durationMin: 30 }))
  const [primeiro, ...resto] = servicos
  if (!primeiro) throw new Error('Informe ao menos um serviço.')
  const professionalId = o.professionalId ?? (await makeProfessional(b.id, { serviceIds: servicos.map((s) => s.id) })).id
  const ag = await makeAppointment(b.id, { customerId, professionalId, serviceId: primeiro.id, startsAt: INICIO })
  for (const [i, s] of resto.entries()) {
    await prisma.appointmentItem.create({
      data: { businessId: b.id, appointmentId: ag.id, serviceId: s.id, name: s.name, priceCents: s.priceCents, durationMin: s.durationMin, rewardPoints: s.rewardPoints, position: i + 2 },
    })
  }
  return { ag, servicos, professionalId }
}

export { memberOf }
