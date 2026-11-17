import type { TenantContext } from '@/server/auth/actor'
import type { BusinessSettings } from '@/server/db/generated/client'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { auditIn } from '@/server/domain/audit'
import { definedOnly } from '@/server/domain/input'
import { authorize, orNotFound, parse, z } from '@/server/domain/errors'
import { writeSettings, type SettingsTx } from '@/server/domain/settings/versioned'

export type SchedulingRules = {
  slotStepMin: number
  minLeadMin: number
  maxAdvanceDays: number
  customerChangeWindowMin: number
  bufferMin: number
  autoConfirm: boolean
}

/** Grades de horário aceitas, em minutos. */
export const SLOT_STEPS: readonly number[] = [5, 10, 15, 20, 30, 60]

/** Limites de cada regra numérica (os mesmos do esquema abaixo); as telas leem daqui em vez de repetir os números. */
export const RULE_LIMITS = {
  minLeadMin: { min: 0, max: 10080 },
  maxAdvanceDays: { min: 1, max: 365 },
  customerChangeWindowMin: { min: 0, max: 10080 },
  bufferMin: { min: 0, max: 120, step: 5 },
} as const

const rulesSchema = z
  .object({
    slotStepMin: z
      .number()
      .refine((v) => SLOT_STEPS.includes(v), 'Escolha uma grade de 5, 10, 15, 20, 30 ou 60 minutos.'),
    minLeadMin: z
      .number()
      .int('Informe minutos inteiros.')
      .min(RULE_LIMITS.minLeadMin.min, 'A antecedência não pode ser negativa.')
      .max(RULE_LIMITS.minLeadMin.max, 'A antecedência máxima é de 7 dias (10080 minutos).'),
    maxAdvanceDays: z
      .number()
      .int('Informe dias inteiros.')
      .min(RULE_LIMITS.maxAdvanceDays.min, 'Permita marcar com pelo menos 1 dia de alcance.')
      .max(RULE_LIMITS.maxAdvanceDays.max, 'O alcance máximo é de 365 dias.'),
    customerChangeWindowMin: z
      .number()
      .int('Informe minutos inteiros.')
      .min(RULE_LIMITS.customerChangeWindowMin.min, 'O prazo não pode ser negativo.')
      .max(RULE_LIMITS.customerChangeWindowMin.max, 'O prazo máximo é de 7 dias (10080 minutos).'),
    bufferMin: z
      .number()
      .int('Informe minutos inteiros.')
      .min(RULE_LIMITS.bufferMin.min, 'O intervalo não pode ser negativo.')
      .max(RULE_LIMITS.bufferMin.max, 'O intervalo máximo é de 120 minutos.')
      .multipleOf(RULE_LIMITS.bufferMin.step, 'O intervalo deve ser múltiplo de 5 minutos.'),
    autoConfirm: z.boolean(),
  })
  .partial()

/** Valida e limpa um pedido de mudança das regras (mesmo esquema do dono); `validation` com os campos se não passar. */
export function parseSchedulingRules(input: Partial<SchedulingRules>): Partial<SchedulingRules> {
  return definedOnly(parse(rulesSchema, input))
}

/** As regras com a versão das configurações (a mesma dos termos e avisos), que a gravação com controle de edição exige. */
export type SchedulingRulesView = SchedulingRules & { version: number }

function toRules(settings: BusinessSettings): SchedulingRulesView {
  return {
    slotStepMin: settings.slotStepMin,
    minLeadMin: settings.minLeadMin,
    maxAdvanceDays: settings.maxAdvanceDays,
    customerChangeWindowMin: settings.customerChangeWindowMin,
    bufferMin: settings.bufferMin,
    autoConfirm: settings.autoConfirm,
    version: settings.version,
  }
}

async function loadSettings(ctx: TenantContext, db: TenantClient | TenantTx): Promise<BusinessSettings> {
  return orNotFound(
    await db.businessSettings.findUnique({ where: { businessId: ctx.businessId } }),
    'Configurações da conta',
  )
}

export async function getSchedulingRules(
  ctx: TenantContext,
  db: TenantClient | TenantTx = ctx.db,
): Promise<SchedulingRulesView> {
  return toRules(await loadSettings(ctx, db))
}

/**
 * Grava as regras dentro da transação `tx` (a do cliente da conta, ou a do `prisma` cru quando o painel dev grava junto o
 * fuso). É o único caminho de escrita das regras: o dono e o admin passam por aqui. Com `version`, é um UPDATE condicional
 * (`conflict` `stale_version` se a linha já mudou); sem ela, grava e sobe a versão. Sem mudança não grava, não sobe e não audita.
 * A auditoria guarda os campos e o antes e o depois de cada um.
 */
export async function applySchedulingRules(
  ctx: TenantContext,
  tx: SettingsTx,
  input: Partial<SchedulingRules>,
  version?: number,
): Promise<SchedulingRulesView> {
  authorize(ctx, 'manage_settings')
  const data = definedOnly(parse(rulesSchema, input))
  let changes: Record<string, { from: number | boolean; to: number | boolean }> = {}
  const { row } = await writeSettings(tx, ctx, version, (atual) => {
    const antes = toRules(atual)
    const mudados = (Object.keys(data) as (keyof SchedulingRules)[]).filter((k) => data[k] !== antes[k])
    if (mudados.length === 0) return null
    changes = Object.fromEntries(mudados.map((k) => [k, { from: antes[k], to: data[k] as number | boolean }]))
    return { data: Object.fromEntries(mudados.map((k) => [k, data[k]])) }
  })
  const fields = Object.keys(changes)
  if (fields.length > 0) {
    await auditIn(tx, ctx, {
      action: 'scheduling_rules.updated',
      targetType: 'BusinessSettings',
      targetId: ctx.businessId,
      metadata: { fields, changes },
    })
  }
  return toRules(row)
}

export async function updateSchedulingRules(
  ctx: TenantContext,
  input: Partial<SchedulingRules>,
  version?: number,
): Promise<SchedulingRulesView> {
  authorize(ctx, 'manage_settings')
  return ctx.db.$transaction((tx) => applySchedulingRules(ctx, tx, input, version))
}
