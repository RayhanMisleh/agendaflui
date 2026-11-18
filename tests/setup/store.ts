import sharp from 'sharp'
import type { Actor, TenantContext } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { createProduct, type ProductInput, type ProductView } from '@/server/domain/store/products'
import { clearFrenet, getIntegrations, setFrenet, setMercadoPago } from '@/server/domain/platform/integrations'
import { ctxDoCliente } from './loyalty'
import { ctxWithRole, makeBusiness, makeCustomer, makePlatformAdmin } from './factories'

/** Terça-feira, 17 de novembro de 2026, 11:00 em Manaus (15:00 UTC). */
export const AGORA = new Date('2026-11-17T15:00:00Z')

export type CenaLoja = Awaited<ReturnType<typeof cenaLoja>>

/** Conta com a Loja ligada, dono, gerente, profissional (membros) e dois clientes com contexto de app. */
export async function cenaLoja(o: { modulo?: boolean; now?: Date } = {}) {
  const b = await makeBusiness({ timezone: 'America/Manaus' })
  if (o.modulo !== false) await prisma.businessModules.update({ where: { businessId: b.id }, data: { store: true } })
  const now = o.now ?? AGORA
  const dono = await ctxWithRole(b, 'OWNER', { now })
  const gerente = await ctxWithRole(b, 'MANAGER', { now })
  const profissional = await ctxWithRole(b, 'PROFESSIONAL', { now })
  const cliente = await makeCustomer(b.id, { name: 'Maria da Silva' })
  const outro = await makeCustomer(b.id, { name: 'João Souza' })
  return { b, now, dono, gerente, profissional, cliente, outro, ctxCliente: await ctxDoCliente(b, cliente, now), ctxOutro: await ctxDoCliente(b, outro, now) }
}

export const dadosDoProduto = (o: Partial<ProductInput> = {}): ProductInput => ({
  categoryId: null,
  name: 'Shampoo',
  description: null,
  priceCents: 2500,
  promoPriceCents: null,
  stock: 10,
  weightGrams: null,
  lengthCm: null,
  heightCm: null,
  widthCm: null,
  active: true,
  ...o,
})

export function produto(ctx: TenantContext, o: Partial<ProductInput> = {}): Promise<ProductView> {
  return createProduct(ctx, dadosDoProduto(o))
}

export const png = async (w = 800, h = 600) => ({
  bytes: new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#0e4f5c' } }).png().toBuffer()),
})

/** O token e o segredo do webhook de cada conta de teste: DIFERENTES entre contas, para um teste falhar se o código usar os de outra. */
export const mpTokenDe = (businessId: string): string => `TEST-${businessId.replaceAll('-', '')}-Qz7K`
export const mpSegredoDe = (businessId: string): string => `whsec${businessId.replaceAll('-', '')}`

/** Configura Mercado Pago e/ou Frenet da conta, como o admin da plataforma (valores inventados, próprios de cada conta). */
export async function configurarIntegracoes(businessId: string, o: { mercadoPago?: boolean; frenet?: boolean | 'remover' } = {}) {
  const a = await makePlatformAdmin()
  const admin: Extract<Actor, { kind: 'platform_admin' }> = { kind: 'platform_admin', adminId: a.id, name: a.name }
  const versao = async () => (await getIntegrations(admin, businessId)).version
  if (o.mercadoPago) await setMercadoPago(admin, businessId, await versao(), { accessToken: mpTokenDe(businessId), webhookSecret: mpSegredoDe(businessId) })
  if (o.frenet === true) await setFrenet(admin, businessId, await versao(), { token: 'FRENET-TOKEN-0123456789-Vb6D' })
  if (o.frenet === 'remover') await clearFrenet(admin, businessId, await versao())
}

/** Liga a entrega da conta (CEP de origem preenchido), por gravação direta. */
export async function ligarEntrega(businessId: string, o: { origem?: string; retirada?: boolean } = {}) {
  await prisma.storeSettings.upsert({
    where: { businessId },
    create: { businessId, shippingEnabled: true, originPostalCode: o.origem ?? '01310100', pickupEnabled: o.retirada ?? true },
    update: { shippingEnabled: true, originPostalCode: o.origem ?? '01310100', pickupEnabled: o.retirada ?? true },
  })
}

export { ctxDoCliente }
