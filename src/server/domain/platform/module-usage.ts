import { assertPlatformAdmin, type PlatformAdminActor } from '@/server/auth/platform-actor'
import { prisma } from '@/server/db/client'
import { DomainError, z } from '@/server/domain/errors'

export type ModuleUsage = {
  /** Pedidos pagos que ainda não foram entregues. */
  openOrders: number
  /** Resgates de prêmio pedidos e ainda não entregues. */
  pendingRedemptions: number
  /** Códigos de voucher vendidos e ainda sem baixa nem anulação. */
  activeVoucherCodes: number
  /** O Mercado Pago tem token e assinatura do webhook gravados. */
  mercadoPagoConfigured: boolean
}

const idSchema = z.uuid()

/**
 * O que está em andamento nos módulos de uma conta, para o admin conferir antes de desligar um módulo (aba Módulos do painel
 * dev). Só contagens; cada uma filtra pela conta. Conta que não existe é `not_found`.
 */
export async function getModuleUsage(actor: PlatformAdminActor, businessId: string): Promise<ModuleUsage> {
  assertPlatformAdmin(actor)
  if (!idSchema.safeParse(businessId).success) throw new DomainError('not_found', 'Conta não encontrada.')
  if (!(await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }))) {
    throw new DomainError('not_found', 'Conta não encontrada.')
  }
  const [openOrders, pendingRedemptions, activeVoucherCodes, integration] = await Promise.all([
    prisma.order.count({ where: { businessId, status: 'PAID', fulfillmentStatus: { not: 'DELIVERED' } } }),
    prisma.prizeRedemption.count({ where: { businessId, status: 'PENDING' } }),
    prisma.voucherCode.count({ where: { businessId, status: 'ACTIVE' } }),
    prisma.businessIntegration.findUnique({ where: { businessId }, select: { mpAccessTokenEnc: true, mpWebhookSecretEnc: true } }),
  ])
  return {
    openOrders,
    pendingRedemptions,
    activeVoucherCodes,
    mercadoPagoConfigured: integration !== null && integration.mpAccessTokenEnc !== null && integration.mpWebhookSecretEnc !== null,
  }
}
