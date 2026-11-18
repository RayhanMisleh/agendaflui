import type { TenantContext } from '@/server/auth/actor'
import { createSystemContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { createOrder } from '@/server/domain/store/orders'
import { applyPayment } from '@/server/domain/store/payments'
import { createPartner, type PartnerInput } from '@/server/domain/vouchers/partners'
import { createVoucher, type VoucherInput } from '@/server/domain/vouchers/vouchers'
import { setIntegrationsForTests } from '@/server/integrations'
import { fakeMercadoPago } from '@/server/integrations/fakes'
import { cenaLoja, configurarIntegracoes, type CenaLoja } from './store'
import { pagamentoMp } from './store-payments'

export const dadosDoParceiro = (o: Partial<PartnerInput> = {}): PartnerInput => ({
  name: 'Restaurante Sabor do Rio',
  description: 'Comida regional',
  address: 'Rua das Flores, 100 - Centro',
  phone: '(92) 99999-0000',
  website: 'https://sabordorio.example.com',
  active: true,
  ...o,
})

export const dadosDoVoucher = (partnerId: string, o: Partial<VoucherInput> = {}): VoucherInput => ({
  partnerId,
  name: 'Jantar para dois',
  description: 'Prato principal e sobremesa',
  terms: 'Válido de segunda a quinta. Não acumula.',
  priceCents: 12000,
  stock: 10,
  validDays: 30,
  active: true,
  ...o,
})

export type CenaVouchers = CenaLoja & {
  fake: ReturnType<typeof fakeMercadoPago>
  parceiro: { id: string }
  voucher: { id: string }
}

/** Loja e Vouchers ligados, Mercado Pago falso configurado, um parceiro e um voucher (R$ 120,00, estoque 10, 30 dias de validade). */
export async function cenaVouchers(o: { voucher?: Partial<VoucherInput>; semVouchers?: boolean } = {}): Promise<CenaVouchers> {
  const c = await cenaLoja()
  if (o.semVouchers !== true) await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { vouchers: true } })
  await configurarIntegracoes(c.b.id, { mercadoPago: true })
  const fake = fakeMercadoPago()
  setIntegrationsForTests({ mercadoPago: fake })
  const parceiro = await createPartnerDireto(c.b.id)
  const voucher = await createVoucherDireto(c.b.id, parceiro.id, o.voucher)
  return { ...c, fake, parceiro, voucher }
}

/** Parceiro direto no banco (não depende do módulo estar ligado). */
export async function createPartnerDireto(businessId: string, o: Partial<PartnerInput> = {}) {
  const d = dadosDoParceiro(o)
  return prisma.partner.create({ data: { businessId, name: d.name, description: d.description, address: d.address, phone: d.phone, website: d.website, active: d.active } })
}

export async function createVoucherDireto(businessId: string, partnerId: string, o: Partial<VoucherInput> = {}) {
  const d = dadosDoVoucher(partnerId, o)
  return prisma.voucher.create({
    data: { businessId, partnerId, name: d.name, description: d.description, terms: d.terms, priceCents: d.priceCents, stock: d.stock, validDays: d.validDays, active: d.active, displayOrder: 1 },
  })
}

export { createPartner, createVoucher }

/** Pedido só de vouchers (entrega `NONE`). */
export function pedidoDeVoucher(ctx: TenantContext, lines: { voucherId: string; quantity: number }[], o: { idempotencyKey?: string } = {}) {
  return createOrder(ctx, { lines, delivery: { method: 'NONE' }, note: null, ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}) })
}

/** Paga o pedido pelo mesmo caminho do webhook (`applyPayment`), com o relógio dado (o da cena por padrão). */
export async function pagar(c: { b: { id: string }; now: Date }, pedido: { id: string; totalCents: number }, o: { now?: Date; id?: string } = {}) {
  const sistema = await createSystemContext(c.b.id, () => o.now ?? c.now)
  return applyPayment(sistema, pedido.id, pagamentoMp(pedido, o.id ? { id: o.id } : {}))
}

/** Os códigos gravados de um pedido, por item e `seq`. */
export const codigosDe = (orderId: string) => prisma.voucherCode.findMany({ where: { orderId }, orderBy: [{ orderItemId: 'asc' }, { seq: 'asc' }] })

export const estoqueDoVoucher = async (id: string): Promise<number> => (await prisma.voucher.findUniqueOrThrow({ where: { id } })).stock
