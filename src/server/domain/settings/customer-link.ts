import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import { customerLinkQrSvg, customerLinkUrl } from '@/server/customer-link'
import { orNotFound } from '@/server/domain/errors'

export type CustomerLink = { url: string; qrSvg: string }

/** O link e o QR code da loja para os clientes. Só quem cuida dos clientes (dono e gerente) o recebe; os demais, `null`. */
export async function getCustomerLink(ctx: TenantContext): Promise<CustomerLink | null> {
  if (!can(ctx.actor, 'manage_clients')) return null
  const loja = orNotFound(await ctx.db.business.findUnique({ where: { id: ctx.businessId }, select: { slug: true } }), 'Conta')
  const url = customerLinkUrl(loja.slug)
  return { url, qrSvg: await customerLinkQrSvg(url) }
}
