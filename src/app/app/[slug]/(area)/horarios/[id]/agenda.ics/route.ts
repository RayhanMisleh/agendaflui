import { readStoreVisit } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getStorefront } from '@/server/domain/storefront/storefront'
import { appointmentIcs } from '@/server/domain/scheduling/ics'
import { areaLink } from '@/server/area-links'
import { carregarLoja } from '../../../../_lib/loja'

const SEM_CACHE = { 'Cache-Control': 'private, no-store' }

/**
 * O arquivo `.ics` do horário do próprio cliente, para pôr na agenda do celular. Quem não é cliente ativo desta loja, ou
 * pede o horário de outro cliente (ou de outra loja), recebe 404: a rota nem diz que o horário existe.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const { slug, id } = await params
  const naoExiste = () => new Response(null, { status: 404, headers: SEM_CACHE })
  const visit = await readStoreVisit(slug)
  if (visit.kind !== 'customer') return naoExiste()
  const loja = await carregarLoja(slug)
  if (!loja) return naoExiste()
  try {
    const { filename, body } = await appointmentIcs(visit.ctx, id, {
      storeName: loja.brand.name,
      address: (await getStorefront(visit.ctx)).address,
      url: areaLink('app', `/${slug}/horarios/${id}`),
    })
    return new Response(body, {
      headers: { ...SEM_CACHE, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
    })
  } catch (err) {
    if (err instanceof DomainError && (err.code === 'not_found' || err.code === 'forbidden')) return naoExiste()
    throw err
  }
}
