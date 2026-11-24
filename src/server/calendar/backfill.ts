import type { Prisma } from '@/server/db/generated/client'
import { toIsoInstant } from '@/server/time'

/**
 * Enfileira, com o cliente cru (o domínio de plataforma não tem `tenantDb`), os agendamentos futuros dos profissionais dados:
 * cria a linha de `calendar_syncs` ou sobe a geração e zera tentativas, espera e falha. Cada subida é um UPDATE sobre a
 * linha travada, então uma remarcação em paralelo e esta subida somam as duas (nunca uma apaga a outra). Devolve quantas
 * linhas tocou. Roda dentro da transação de quem muda o acesso ou liga a agenda.
 */
export async function enqueueCalendarForProfessionalsRaw(
  tx: Prisma.TransactionClient,
  i: { businessId: string; professionalIds: string[]; now: Date },
): Promise<number> {
  if (i.professionalIds.length === 0) return 0
  const agora = toIsoInstant(i.now)
  return tx.$executeRaw`
    INSERT INTO calendar_syncs (id, business_id, appointment_id, generation, synced_generation, updated_at)
    SELECT gen_random_uuid(), a.business_id, a.id, 1, 0, ${agora}::timestamptz
    FROM appointments a
    WHERE a.business_id = ${i.businessId}::uuid
      AND a.professional_id = ANY(${i.professionalIds}::uuid[])
      AND a.ends_at >= ${agora}::timestamptz
    ORDER BY a.id
    ON CONFLICT (business_id, appointment_id) DO UPDATE SET
      generation = calendar_syncs.generation + 1, attempts = 0, next_attempt_at = NULL, failed_at = NULL, last_error = NULL,
      updated_at = EXCLUDED.updated_at`
}
