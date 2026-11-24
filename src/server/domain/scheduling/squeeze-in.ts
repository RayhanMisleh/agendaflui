import type { TenantTx } from '@/server/db/tenant'
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
