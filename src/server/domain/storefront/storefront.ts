import type { TenantContext } from '@/server/auth/actor'
import { formatPhone } from '@/server/domain/customers/contact'
import { getModules } from '@/server/domain/modules'
import { listServices, type ServiceView } from '@/server/domain/catalog/services'
import { DomainError, orNotFound } from '@/server/domain/errors'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { formatDuration } from '@/shared/duration'
import { SERVICE_ICON_NAMES, type ServiceIconName } from '@/shared/service-icons'
import type { Modules } from '@/shared/modules'
import { fromPrice } from '@/server/domain/catalog/pricing'
import { isVariantVisible } from '@/server/niches'
import { getStoreNiche } from '@/server/domain/settings/niche-settings'

/** Vitrine pública da loja: só o que o visitante e o cliente podem ver. Nunca documento, e-mail de contato nem dado interno. */
export type StorefrontService = {
  id: string
  name: string
  description: string | null
  icon: ServiceIconName
  from: { cents: number; varies: boolean } | null
  durationLabel: string
  clubOnly: boolean
}

export type Storefront = {
  name: string
  address: string | null
  phone: { label: string; href: string; whatsappHref: string | null } | null
  services: StorefrontService[]
  modules: Modules
  petNiche: boolean
  servesCats: boolean
  rules: { changeWindowMin: number; changeWindowLabel: string }
}

const isIcon = (v: string): v is ServiceIconName => (SERVICE_ICON_NAMES as readonly string[]).includes(v)

/** "até 2 h antes", "até 1 dia antes", "a qualquer momento". */
export function changeWindowLabel(min: number): string {
  if (min <= 0) return 'a qualquer momento'
  if (min % 1440 === 0) {
    const dias = min / 1440
    return `até ${dias} ${dias === 1 ? 'dia' : 'dias'} antes`
  }
  return `até ${formatDuration(min)} antes`
}

function phoneOf(digits: string | null): Storefront['phone'] {
  if (digits === null || digits === '') return null
  // Celular brasileiro: 55 + DDD + 9 + 8 dígitos (13 no total).
  const celular = digits.startsWith('55') && digits.length === 13 && digits[4] === '9'
  return { label: formatPhone(digits), href: `tel:+${digits}`, whatsappHref: celular ? `https://wa.me/${digits}` : null }
}

/** A duração única, ou "1 h a 1 h 30" entre a menor e a maior das variantes visíveis (iguais → uma só). */
function durationLabelOf(s: ServiceView, servesCats: boolean): string {
  if (s.pricingMode === 'SINGLE') return formatDuration(s.durationMin)
  const tempos = s.prices.filter((p) => isVariantVisible(p.variant, { servesCats })).map((p) => p.durationMin)
  if (tempos.length === 0) return formatDuration(s.durationMin)
  const [menor, maior] = [Math.min(...tempos), Math.max(...tempos)]
  return menor === maior ? formatDuration(menor) : `${formatDuration(menor)} a ${formatDuration(maior)}`
}

export async function getStorefront(ctx: TenantContext): Promise<Storefront> {
  if (ctx.actor.kind !== 'guest' && ctx.actor.kind !== 'customer') throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
  const [business, branding, services, modules, rules, niche] = await Promise.all([
    ctx.db.business.findUnique({ where: { id: ctx.businessId }, select: { phone: true, addressLine: true, city: true, state: true } }),
    ctx.db.businessBranding.findUnique({ where: { businessId: ctx.businessId }, select: { displayName: true } }),
    listServices(ctx),
    getModules(ctx.db, ctx.businessId),
    getSchedulingRules(ctx),
    getStoreNiche(ctx),
  ])
  const b = orNotFound(business, 'Loja')
  const lugar = [b.city, b.state].filter((p): p is string => p !== null && p !== '').join(' - ')
  const address = [b.addressLine, lugar].filter((p): p is string => p !== null && p !== '').join(', ')
  const visiveis: StorefrontService[] = []
  for (const s of services) {
    const from = fromPrice(s, { servesCats: niche.servesCats })
    if (from === null) continue
    visiveis.push({
      id: s.id,
      name: s.name,
      description: s.description,
      icon: isIcon(s.icon) ? s.icon : 'sparkles',
      from,
      durationLabel: durationLabelOf(s, niche.servesCats),
      clubOnly: s.clubOnly,
    })
  }
  return {
    name: branding?.displayName ?? '',
    address: address === '' ? null : address,
    phone: phoneOf(b.phone),
    services: visiveis,
    modules,
    petNiche: niche.petNiche,
    servesCats: niche.servesCats,
    rules: { changeWindowMin: rules.customerChangeWindowMin, changeWindowLabel: changeWindowLabel(rules.customerChangeWindowMin) },
  }
}
