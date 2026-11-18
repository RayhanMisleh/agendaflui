import type { TenantContext } from '@/server/auth/actor'
import type { TenantTx } from '@/server/db/tenant'
import { isModuleOn } from '@/server/domain/modules'
import { party, type ChangeEvent, type ChangeExtra, type Row } from '@/server/domain/scheduling/appointment-view'

/**
 * Pontos de um atendimento, chamada por `afterChange` dentro da transação da mudança de situação (que já trava o
 * profissional; o desfazer trava também o cliente, antes). Cada linha leva uma chave `dedupe_key` única no banco.
 * - `completed`: com a Fidelidade ligada, credita a soma de `reward_points` dos itens (cópia da marcação), se for maior
 *   que zero. A chave leva a conclusão (`n` = estornos já gravados): concluir de novo depois de desfazer vale, e o mesmo evento repetido
 *   bate na chave única e não credita outra vez.
 * - `outcome_undone` vindo de `COMPLETED`: estorna o que o atendimento rendeu (soma líquida dos créditos e estornos), mesmo
 *   com o módulo desligado. O estorno pode deixar o saldo negativo (o atendimento não aconteceu). Falta desfeita não mexe.
 */
export async function applyAppointmentLoyalty(
  tx: TenantTx,
  ctx: TenantContext,
  event: ChangeEvent,
  appointment: Row,
  extra: ChangeExtra,
): Promise<void> {
  if (event === 'completed') {
    if (!(await isModuleOn(tx, ctx.businessId, 'loyalty'))) return
    const points = appointment.items.reduce((sum, item) => sum + item.rewardPoints, 0)
    if (points <= 0) return
    // A chave liga o crédito à conclusão (quantos estornos já houve), não ao crédito: o mesmo evento entregue duas vezes bate na chave.
    const n = await tx.loyaltyTransaction.count({ where: { appointmentId: appointment.id, kind: 'EARN_REVERSAL' } })
    const by = party(ctx)
    await tx.loyaltyTransaction.create({
      data: {
        businessId: ctx.businessId,
        customerId: appointment.customerId,
        kind: 'EARN',
        points,
        appointmentId: appointment.id,
        dedupeKey: `appt:${appointment.id}:earn:${n}`,
        createdByType: by.type,
        createdById: by.id,
      },
    })
    return
  }
  if (event === 'outcome_undone' && extra.from === 'COMPLETED') {
    const earned = await tx.loyaltyTransaction.aggregate({
      where: { appointmentId: appointment.id, kind: { in: ['EARN', 'EARN_REVERSAL'] } },
      _sum: { points: true },
    })
    const net = earned._sum.points ?? 0
    if (net <= 0) return
    const n = await tx.loyaltyTransaction.count({ where: { appointmentId: appointment.id, kind: 'EARN_REVERSAL' } })
    const by = party(ctx)
    await tx.loyaltyTransaction.create({
      data: {
        businessId: ctx.businessId,
        customerId: appointment.customerId,
        kind: 'EARN_REVERSAL',
        points: -net,
        appointmentId: appointment.id,
        dedupeKey: `appt:${appointment.id}:reversal:${n}`,
        createdByType: by.type,
        createdById: by.id,
      },
    })
  }
}
