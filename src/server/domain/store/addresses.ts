import type { TenantContext } from '@/server/auth/actor'
import type { Address } from '@/server/db/generated/client'
import { DomainError, parse, z } from '@/server/domain/errors'
import { definedOnly } from '@/server/domain/input'
import { requireModule } from '@/server/domain/modules'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { cleanPostalCode } from '@/server/domain/store/settings'
import { STATES } from '@/shared/states'
import { integrations, IntegrationError } from '@/server/integrations'

export type AddressInput = {
  label: string | null
  recipientName: string
  postalCode: string
  street: string
  number: string
  complement: string | null
  district: string
  city: string
  state: string
  isDefault: boolean
}

export type AddressView = AddressInput & { id: string }

export const MAX_ADDRESSES = 10

export { STATES }

const idSchema = z.uuid()

const text = (nome: string, max: number) =>
  z.string(`Informe ${nome}.`).trim().min(1, `Informe ${nome}.`).max(max, `Use até ${max} caracteres em ${nome}.`)

const optionalText = (max: number, nome: string) =>
  z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres em ${nome}.`)
    .transform((t) => (t === '' ? null : t))
    .nullable()

/** CEP com 8 dígitos (aceita `01310-100`); o resultado só traz os dígitos. */
export const postalCodeSchema = z
  .string('Informe o CEP com 8 números.')
  .transform(cleanPostalCode)
  .refine((v) => /^\d{8}$/.test(v), 'Informe o CEP com 8 números, por exemplo 01310-100.')

const fields = {
  label: optionalText(30, 'o apelido'),
  recipientName: z.string('Informe o nome de quem recebe.').trim().min(2, 'Informe o nome de quem recebe, com pelo menos 2 letras.').max(80, 'Use até 80 caracteres no nome.'),
  postalCode: postalCodeSchema,
  street: text('a rua', 120),
  number: text('o número', 10),
  complement: optionalText(80, 'o complemento'),
  district: text('o bairro', 80),
  city: text('a cidade', 80),
  state: z
    .string('Escolha o estado.')
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => (STATES as readonly string[]).includes(s), 'Escolha um estado da lista, com a sigla de 2 letras.'),
  isDefault: z.boolean('Informe se este é o endereço padrão.'),
}

const createSchema = z.object(fields)
const updateSchema = z.object(fields).partial()

const notFound = (): DomainError => new DomainError('not_found', 'Endereço não encontrado.')

export function toAddressView(row: Address): AddressView {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    postalCode: row.postalCode,
    street: row.street,
    number: row.number,
    complement: row.complement,
    district: row.district,
    city: row.city,
    state: row.state,
    isDefault: row.isDefault,
  }
}

/**
 * A loja é do cliente do app: módulo ligado e ator `customer`, senão recusa. Endereços, cotação e pedidos usam o id devolvido,
 * nunca um id vindo do pedido (a equipe e o visitante não têm acesso).
 */
export async function ownCustomerId(ctx: TenantContext): Promise<string> {
  await requireModule(ctx, 'store')
  if (ctx.actor.kind !== 'customer') throw new DomainError('forbidden', 'Entre na sua conta para cuidar dos seus endereços.')
  return ctx.actor.customerId
}

async function loadOwn(ctx: TenantContext, customerId: string, id: string): Promise<Address> {
  if (!idSchema.safeParse(id).success) throw notFound()
  const row = await ctx.db.address.findFirst({ where: { id, customerId } })
  if (row === null) throw notFound()
  return row
}

/** Os endereços do cliente: o padrão primeiro, depois os mais novos. */
export async function listAddresses(ctx: TenantContext): Promise<AddressView[]> {
  const customerId = await ownCustomerId(ctx)
  const rows = await ctx.db.address.findMany({ where: { customerId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }] })
  return rows.map(toAddressView)
}

export async function createAddress(ctx: TenantContext, i: AddressInput): Promise<AddressView> {
  const customerId = await ownCustomerId(ctx)
  const input = parse(createSchema, i)
  const row = await ctx.db.$transaction(async (tx) => {
    // Um cliente por vez: a contagem e o "padrão único" dependem do que o próprio cliente está fazendo.
    await tx.$lockKey('customer', customerId)
    const mine = await tx.address.count({ where: { customerId } })
    if (mine >= MAX_ADDRESSES) throw new DomainError('conflict', 'Você já tem 10 endereços. Apague um para cadastrar outro.')
    // O primeiro endereço já nasce como padrão.
    const makeDefault = input.isDefault || mine === 0
    if (makeDefault) await tx.address.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } })
    return tx.address.create({ data: { businessId: ctx.businessId, customerId, ...input, isDefault: makeDefault } })
  }, TX_OPTIONS)
  return toAddressView(row)
}

export async function updateAddress(ctx: TenantContext, id: string, i: Partial<AddressInput>): Promise<AddressView> {
  const customerId = await ownCustomerId(ctx)
  const changes = definedOnly(parse(updateSchema, i))
  await loadOwn(ctx, customerId, id)
  const row = await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('customer', customerId)
    const atual = await tx.address.findFirst({ where: { id, customerId }, select: { id: true } })
    if (atual === null) throw notFound()
    if (changes.isDefault === true) await tx.address.updateMany({ where: { customerId, isDefault: true, id: { not: id } }, data: { isDefault: false } })
    await tx.address.updateMany({ where: { id, customerId }, data: changes })
    return tx.address.findUniqueOrThrow({ where: { id } })
  }, TX_OPTIONS)
  return toAddressView(row)
}

export async function deleteAddress(ctx: TenantContext, id: string): Promise<void> {
  const customerId = await ownCustomerId(ctx)
  await loadOwn(ctx, customerId, id)
  await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('customer', customerId)
    const gone = await tx.address.findFirst({ where: { id, customerId }, select: { isDefault: true } })
    if (gone === null) return
    await tx.address.deleteMany({ where: { id, customerId } })
    // Apagou o padrão: o endereço mais recente que sobrou passa a ser o padrão.
    if (gone.isDefault) {
      const next = await tx.address.findFirst({ where: { customerId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: { id: true } })
      if (next !== null) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } })
    }
  }, TX_OPTIONS)
}

/**
 * Endereço de um CEP (ViaCEP). Nunca falha por causa do serviço: fora do ar, devolve `unavailable: true` e a tela deixa a
 * pessoa digitar o endereço. CEP que não existe devolve `address: null`.
 */
export async function lookupPostalCode(
  ctx: TenantContext,
  cep: string,
): Promise<{ address: { postalCode: string; street: string; district: string; city: string; state: string } | null; unavailable: boolean }> {
  await ownCustomerId(ctx)
  const postalCode = parse(z.object({ postalCode: postalCodeSchema }), { postalCode: cep }).postalCode
  try {
    const found = await integrations().postalCodes.lookup(postalCode)
    return { address: found === null ? null : { postalCode, ...found }, unavailable: false }
  } catch (err) {
    if (err instanceof IntegrationError) return { address: null, unavailable: true }
    throw err
  }
}
