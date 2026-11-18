import type { TenantContext } from '@/server/auth/actor'
import type { StoreSettings as StoreSettingsRow } from '@/server/db/generated/client'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, isUniqueViolation, parse, z } from '@/server/domain/errors'
import { requireModule } from '@/server/domain/modules'
import { integrationStatus } from '@/server/domain/platform/integration-secrets'
import { staleSettings } from '@/server/domain/settings/versioned'

/** Prazo mínimo para pagar: o Pix do Mercado Pago só aceita expiração de pelo menos 30 minutos. */
export const MIN_PAYMENT_WINDOW_MIN = 30

export type StoreSettings = {
  pickupEnabled: boolean
  pickupInstructions: string | null
  shippingEnabled: boolean
  originPostalCode: string | null
  defaultPackage: { weightGrams: number; lengthCm: number; heightCm: number; widthCm: number }
  paymentWindowMin: number
  version: number
}

export type StoreOptions = {
  pickup: { enabled: boolean; instructions: string | null }
  shipping: { enabled: boolean }
  payment: { available: boolean }
}

type Db = TenantClient | TenantTx

/** Sem linha gravada valem estes padrões (a primeira gravação cria a linha). */
export const DEFAULT_SETTINGS: StoreSettings = {
  pickupEnabled: true,
  pickupInstructions: null,
  shippingEnabled: false,
  originPostalCode: null,
  defaultPackage: { weightGrams: 1000, lengthCm: 20, heightCm: 10, widthCm: 30 },
  paymentWindowMin: 60,
  version: 0,
}

/** CEP só com dígitos (tira `-`, espaços e pontos), sem conferir o tamanho. */
export function cleanPostalCode(text: string): string {
  return text.replace(/[\s.-]/g, '')
}

const side = (nome: string) =>
  z
    .number(`Informe ${nome} em centímetros.`)
    .int(`Informe ${nome} em centímetros inteiros.`)
    .min(1, `${nome[0]?.toUpperCase() ?? ''}${nome.slice(1)} precisa ser de pelo menos 1 cm.`)
    .max(200, `${nome[0]?.toUpperCase() ?? ''}${nome.slice(1)} pode ter no máximo 200 cm.`)

export const packageSchema = z.strictObject({
  weightGrams: z
    .number('Informe o peso em gramas.')
    .int('Informe o peso em gramas inteiras.')
    .min(1, 'O peso precisa ser de pelo menos 1 g.')
    .max(30_000, 'O peso pode ser de no máximo 30.000 g (30 kg).'),
  lengthCm: side('o comprimento'),
  heightCm: side('a altura'),
  widthCm: side('a largura'),
})

const postalCodeField = z
  .string('Informe o CEP com 8 números.')
  .transform(cleanPostalCode)
  .nullable()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v === null || /^\d{8}$/.test(v), 'Informe o CEP com 8 números, por exemplo 01310-100.')

const schema = z.strictObject({
  pickupEnabled: z.boolean('Informe se a retirada no local está ligada.'),
  pickupInstructions: z
    .string()
    .trim()
    .max(300, 'Use até 300 caracteres nas instruções.')
    .transform((t) => (t === '' ? null : t))
    .nullable(),
  shippingEnabled: z.boolean('Informe se a entrega está ligada.'),
  originPostalCode: postalCodeField,
  defaultPackage: packageSchema,
  paymentWindowMin: z
    .number('Informe o prazo para pagar em minutos.')
    .int('Informe o prazo em minutos inteiros.')
    .min(MIN_PAYMENT_WINDOW_MIN, 'O prazo mínimo é de 30 minutos (o Pix exige pelo menos isso).')
    .max(1440, 'O prazo máximo é de 1.440 minutos (24 horas).'),
})

function toSettings(row: StoreSettingsRow | null): StoreSettings {
  if (row === null) return { ...DEFAULT_SETTINGS, defaultPackage: { ...DEFAULT_SETTINGS.defaultPackage } }
  return {
    pickupEnabled: row.pickupEnabled,
    pickupInstructions: row.pickupInstructions,
    shippingEnabled: row.shippingEnabled,
    originPostalCode: row.originPostalCode,
    defaultPackage: { weightGrams: row.defaultWeightGrams, lengthCm: row.defaultLengthCm, heightCm: row.defaultHeightCm, widthCm: row.defaultWidthCm },
    paymentWindowMin: row.paymentWindowMin,
    version: row.version,
  }
}

/** Leitura sem conferir quem pede: só o próprio domínio da loja a usa (cotação, pedido, vitrine), depois de conferir o que cabe a cada um. */
export async function loadStoreSettings(ctx: TenantContext, db: Db = ctx.db): Promise<StoreSettings> {
  return toSettings(await db.storeSettings.findUnique({ where: { businessId: ctx.businessId } }))
}

/** As configurações da loja para a equipe com `manage_store`. */
export async function getStoreSettings(ctx: TenantContext, db: Db = ctx.db): Promise<StoreSettings> {
  await requireModule(ctx, 'store', db)
  authorize(ctx, 'manage_store')
  return loadStoreSettings(ctx, db)
}

/**
 * Grava as configurações sobre a versão lida (0 = ainda sem linha). Retirada e entrega não podem estar as duas desligadas e
 * a entrega exige o CEP de origem. Versão que já mudou: `conflict` `stale_version`.
 */
export async function updateStoreSettings(ctx: TenantContext, version: number, i: Omit<StoreSettings, 'version'>): Promise<StoreSettings> {
  await requireModule(ctx, 'store')
  authorize(ctx, 'manage_store')
  if (!Number.isInteger(version) || version < 0) throw staleSettings()
  const input = parse(schema, i)
  if (!input.pickupEnabled && !input.shippingEnabled) {
    const message = 'Deixe a retirada no local ou a entrega ligada. Os dois desligados não deixam o cliente comprar.'
    throw new DomainError('validation', message, { fields: { pickupEnabled: message } })
  }
  if (input.shippingEnabled && input.originPostalCode === null) {
    const message = 'Informe o CEP de origem para ligar a entrega.'
    throw new DomainError('validation', message, { fields: { originPostalCode: message } })
  }
  const data = {
    pickupEnabled: input.pickupEnabled,
    pickupInstructions: input.pickupInstructions,
    shippingEnabled: input.shippingEnabled,
    originPostalCode: input.originPostalCode,
    defaultWeightGrams: input.defaultPackage.weightGrams,
    defaultLengthCm: input.defaultPackage.lengthCm,
    defaultHeightCm: input.defaultPackage.heightCm,
    defaultWidthCm: input.defaultPackage.widthCm,
    paymentWindowMin: input.paymentWindowMin,
  }
  try {
    return await ctx.db.$transaction(async (tx) => {
      let row: StoreSettingsRow
      if (version === 0) {
        row = await tx.storeSettings.create({ data: { businessId: ctx.businessId, ...data } })
      } else {
        const { count } = await tx.storeSettings.updateMany({ where: { businessId: ctx.businessId, version }, data: { ...data, version: { increment: 1 } } })
        if (count !== 1) throw staleSettings()
        row = await tx.storeSettings.findUniqueOrThrow({ where: { businessId: ctx.businessId } })
      }
      await audit(
        ctx,
        {
          action: 'store.settings_updated',
          targetType: 'business',
          targetId: ctx.businessId,
          metadata: { pickupEnabled: input.pickupEnabled, shippingEnabled: input.shippingEnabled, paymentWindowMin: input.paymentWindowMin },
        },
        tx,
      )
      return toSettings(row)
    })
  } catch (err) {
    // Duas primeiras gravações juntas: a segunda esbarra na chave da conta.
    if (isUniqueViolation(err)) throw staleSettings()
    throw err
  }
}

/**
 * O que o app precisa saber para montar o carrinho. A entrega só aparece como ligada se dá para cotar: CEP de origem
 * gravado e token da Frenet configurado. O pagamento só está disponível com o Mercado Pago configurado.
 */
export async function getStoreOptions(ctx: TenantContext): Promise<StoreOptions> {
  await requireModule(ctx, 'store')
  const s = await loadStoreSettings(ctx)
  const status = await integrationStatus(ctx.businessId)
  return {
    pickup: { enabled: s.pickupEnabled, instructions: s.pickupEnabled ? s.pickupInstructions : null },
    shipping: { enabled: s.shippingEnabled && s.originPostalCode !== null && status.frenet },
    payment: { available: status.mercadoPago },
  }
}

/** Situação das integrações da conta para a tela de configurações da loja: só se estão configuradas, nunca o segredo. */
export async function getStoreIntegrations(ctx: TenantContext): Promise<{ mercadoPago: boolean; frenet: boolean }> {
  await requireModule(ctx, 'store')
  authorize(ctx, 'manage_store')
  return integrationStatus(ctx.businessId)
}
