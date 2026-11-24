import type { TenantContext } from '@/server/auth/actor'
import type { BusinessSettings, Prisma } from '@/server/db/generated/client'
import { DomainError, orNotFound } from '@/server/domain/errors'

/**
 * O que a gravação de configurações usa de uma transação. O cliente por conta (`ctx.db.$transaction`) e o `prisma` cru
 * (o painel dev grava fuso e regras juntos) cabem aqui; por isso toda leitura e escrita leva o `businessId` explícito.
 */
export interface SettingsTx {
  businessSettings: {
    findUnique(args: { where: { businessId: string } }): PromiseLike<BusinessSettings | null>
    updateMany(args: {
      where: { businessId: string; version: number }
      data: Prisma.BusinessSettingsUncheckedUpdateManyInput
    }): PromiseLike<{ count: number }>
  }
  auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown> }
}

const MAX_ATTEMPTS = 5

export function staleSettings(): DomainError {
  return new DomainError(
    'conflict',
    'Outra pessoa alterou estas configurações enquanto você editava. Recarregue a página e refaça a alteração.',
    { reason: 'stale_version' },
  )
}

/** O que uma gravação muda: valores simples (não operações do Prisma), para a linha gravada poder ser devolvida sem reler. */
export type SettingsWrite = {
  data: Partial<
    Pick<
      BusinessSettings,
      | 'slotStepMin'
      | 'minLeadMin'
      | 'maxAdvanceDays'
      | 'customerChangeWindowMin'
      | 'bufferMin'
      | 'autoConfirm'
      | 'loyaltyRankingEnabled'
    >
  > & { notifications?: Prisma.InputJsonObject; nicheOptions?: Prisma.InputJsonObject }
}

/**
 * Grava em `business_settings` com controle de versão. `plan` olha a linha lida e devolve o que mudar (ou `null` se não há
 * mudança: nada é gravado, a versão não sobe e `changed` volta `false`).
 * Devolve a linha como ficou gravada (a lida com a mudança e a versão nova), sem reler o banco.
 * - Com `version`: UPDATE condicional de uma instrução (`WHERE version = ...`); linha que já mudou → `conflict` `stale_version`.
 * - Sem `version` (seed, API, chamadores antigos): grava sobre a linha lida; se ela mudou no meio, relê e tenta de novo.
 * A versão sobe em 1 a cada gravação.
 */
export async function writeSettings(
  tx: SettingsTx,
  ctx: TenantContext,
  version: number | undefined,
  plan: (row: BusinessSettings) => SettingsWrite | null,
): Promise<{ row: BusinessSettings; changed: boolean }> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = orNotFound(await tx.businessSettings.findUnique({ where: { businessId: ctx.businessId } }), 'Configurações da conta')
    const write = plan(row)
    if (write === null) return { row, changed: false }
    const { count } = await tx.businessSettings.updateMany({
      where: { businessId: ctx.businessId, version: version ?? row.version },
      data: { ...write.data, version: { increment: 1 } },
    })
    if (count === 1) {
      const { notifications, nicheOptions, ...simples } = write.data
      const gravada: BusinessSettings = {
        ...row,
        ...simples,
        ...(notifications !== undefined ? { notifications: notifications as BusinessSettings['notifications'] } : {}),
        ...(nicheOptions !== undefined ? { nicheOptions: nicheOptions as BusinessSettings['nicheOptions'] } : {}),
        version: (version ?? row.version) + 1,
      }
      return { row: gravada, changed: true }
    }
    if (version !== undefined) throw staleSettings()
  }
  throw new DomainError('conflict', 'As configurações mudaram enquanto você salvava. Tente de novo.', { reason: 'changed' })
}
