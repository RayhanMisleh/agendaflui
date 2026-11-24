import type { TenantContext } from '@/server/auth/actor'
import type { TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { ACTIVE_STATUSES } from '@/server/domain/scheduling/status'

/**
 * Existe agendamento normal (não encaixe) e ativo do profissional que se sobrepõe ao intervalo `[início, fim)`?
 * É a pergunta que decide se a marcação da equipe vira encaixe. Roda sob a trava do profissional.
 */
export async function overlapsNormal(
  db: TenantTx,
  i: { professionalId: string; startsAt: Date; endsAt: Date; ignoreAppointmentId?: string },
): Promise<boolean> {
  const found = await db.appointment.findFirst({
    where: {
      professionalId: i.professionalId,
      status: { in: [...ACTIVE_STATUSES] },
      isSqueezeIn: false,
      startsAt: { lt: i.endsAt },
      endsAt: { gt: i.startsAt },
      ...(i.ignoreAppointmentId ? { id: { not: i.ignoreAppointmentId } } : {}),
    },
    select: { id: true },
  })
  return found !== null
}

/**
 * Um normal saiu de `[início, fim)` (cancelado, faltou, remarcado, encurtado, ou virou encaixe): os encaixes do profissional que
 * se sobrepõem a esse intervalo são reavaliados em ordem de início (e id). Cada um que já não sobrepõe nenhum normal vira
 * normal, e o seguinte já conta os promovidos (relê a cada passo). Devolve os ids promovidos. Roda na transação do
 * pedido, sob a trava do profissional.
 */
export async function promoteSqueezeIns(
  tx: TenantTx,
  ctx: TenantContext,
  i: { professionalId: string; startsAt: Date; endsAt: Date },
): Promise<string[]> {
  const candidates = await tx.appointment.findMany({
    where: {
      professionalId: i.professionalId,
      status: { in: [...ACTIVE_STATUSES] },
      isSqueezeIn: true,
      startsAt: { lt: i.endsAt },
      endsAt: { gt: i.startsAt },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: { id: true, startsAt: true, endsAt: true },
  })
  const promoted: string[] = []
  for (const c of candidates) {
    const blocked = await overlapsNormal(tx, {
      professionalId: i.professionalId,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      ignoreAppointmentId: c.id,
    })
    if (blocked) continue
    await tx.appointment.update({ where: { id: c.id }, data: { isSqueezeIn: false } })
    await audit(ctx, { action: 'appointment.squeeze_in_promoted', targetType: 'Appointment', targetId: c.id }, tx)
    promoted.push(c.id)
  }
  return promoted
}
