import type { TenantContext } from '@/server/auth/actor'
import type { BusinessSettings } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { authorize, orNotFound, parse, z } from '@/server/domain/errors'

export type SchedulingRules = {
  slotStepMin: number
  minLeadMin: number
  maxAdvanceDays: number
  customerChangeWindowMin: number
  bufferMin: number
  autoConfirm: boolean
}

const SLOT_STEPS: readonly number[] = [5, 10, 15, 20, 30, 60]

const rulesSchema = z
  .object({
    slotStepMin: z
      .number()
      .refine((v) => SLOT_STEPS.includes(v), 'Escolha uma grade de 5, 10, 15, 20, 30 ou 60 minutos.'),
    minLeadMin: z
      .number()
      .int('Informe minutos inteiros.')
      .min(0, 'A antecedência não pode ser negativa.')
      .max(10080, 'A antecedência máxima é de 7 dias (10080 minutos).'),
    maxAdvanceDays: z
      .number()
      .int('Informe dias inteiros.')
      .min(1, 'Permita marcar com pelo menos 1 dia de alcance.')
      .max(365, 'O alcance máximo é de 365 dias.'),
    customerChangeWindowMin: z
      .number()
      .int('Informe minutos inteiros.')
      .min(0, 'O prazo não pode ser negativo.')
      .max(10080, 'O prazo máximo é de 7 dias (10080 minutos).'),
    bufferMin: z
      .number()
      .int('Informe minutos inteiros.')
      .min(0, 'O intervalo não pode ser negativo.')
      .max(120, 'O intervalo máximo é de 120 minutos.')
      .multipleOf(5, 'O intervalo deve ser múltiplo de 5 minutos.'),
    autoConfirm: z.boolean(),
  })
  .partial()

function toRules(settings: BusinessSettings): SchedulingRules {
  return {
    slotStepMin: settings.slotStepMin,
    minLeadMin: settings.minLeadMin,
    maxAdvanceDays: settings.maxAdvanceDays,
    customerChangeWindowMin: settings.customerChangeWindowMin,
    bufferMin: settings.bufferMin,
    autoConfirm: settings.autoConfirm,
  }
}

async function loadSettings(ctx: TenantContext): Promise<BusinessSettings> {
  return orNotFound(
    await ctx.db.businessSettings.findUnique({ where: { businessId: ctx.businessId } }),
    'Configurações da conta',
  )
}

export async function getSchedulingRules(ctx: TenantContext): Promise<SchedulingRules> {
  return toRules(await loadSettings(ctx))
}

export async function updateSchedulingRules(
  ctx: TenantContext,
  input: Partial<SchedulingRules>,
): Promise<SchedulingRules> {
  authorize(ctx, 'manage_settings')
  const parsed = parse(rulesSchema, input)
  const data = Object.fromEntries(Object.entries(parsed).filter(([, valor]) => valor !== undefined))
  const fields = Object.keys(data)
  if (fields.length === 0) return getSchedulingRules(ctx)
  const updated = await ctx.db.$transaction(async (tx) => {
    const settings = await tx.businessSettings.update({ where: { businessId: ctx.businessId }, data })
    await audit(
      ctx,
      { action: 'scheduling_rules.updated', targetType: 'BusinessSettings', targetId: ctx.businessId, metadata: { fields } },
      tx,
    )
    return settings
  })
  return toRules(updated)
}
