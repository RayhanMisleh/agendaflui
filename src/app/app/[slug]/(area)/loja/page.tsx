import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCustomer } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { listCategories } from '@/server/domain/store/categories'
import { listPublicProducts } from '@/server/domain/store/products'
import { EmptyIllustration, LinkButton } from '@/ui/components'
import { um } from '@/app/_lib/params'
import { ClientePagina } from '@/ui/shells'
import { modulosDaLoja } from '../../_lib/modulos'
import { ModuloDesligado } from '../../_lib/ModuloDesligado'
import { metadataDaLoja } from '../../_lib/loja'
import { BotaoDoCarrinho } from './_lib/BotaoDoCarrinho'
import { ProdutoCartao } from './_lib/ProdutoCartao'
import { readCart, totalDeUnidades } from './_lib/carrinho'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Loja')
}

/** A vitrine da Loja: categorias em chips, produtos em grade e "Carregar mais" por cursor. */
export default async function LojaVitrinePage({ params, searchParams }: Props) {
  const { slug } = await params
  const visit = await requireCustomer(slug, `/${slug}/loja`)
  if (!(await modulosDaLoja(visit)).store) {
    return (
      <ClientePagina title="Loja">
        <ModuloDesligado slug={slug} what="Loja" />
      </ClientePagina>
    )
  }
  const q = await searchParams
  const categoria = um(q.categoria)
  const cursor = um(q.cursor)
  const [categorias, unidades] = await Promise.all([listCategories(visit.ctx), readCart().then(totalDeUnidades)])
  const filtro = categorias.some((c) => c.id === categoria) ? categoria : ''
  let pagina
  try {
    pagina = await listPublicProducts(visit.ctx, { ...(filtro ? { categoryId: filtro } : {}), ...(cursor ? { cursor } : {}) })
  } catch (err) {
    if (!(err instanceof DomainError) || err.fields?.['cursor'] === undefined) throw err
    pagina = await listPublicProducts(visit.ctx, filtro ? { categoryId: filtro } : {})
  }
  const base = `/${slug}/loja`
  return (
    <ClientePagina title="Loja" actions={<BotaoDoCarrinho slug={slug} unidades={unidades} />}>
      {categorias.length > 0 ? (
        <nav aria-label="Categorias" className="af-cl-chips">
          <Link href={base} className={filtro === '' ? 'af-cl-chip is-selected' : 'af-cl-chip'} aria-current={filtro === '' ? 'page' : undefined}>
            Tudo
          </Link>
          {categorias.map((c) => (
            <Link key={c.id} href={`${base}?categoria=${c.id}`} className={filtro === c.id ? 'af-cl-chip is-selected' : 'af-cl-chip'} aria-current={filtro === c.id ? 'page' : undefined}>
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {pagina.items.length === 0 ? (
        <div className="af-cl-state af-cl-state--inline">
          <span className="af-cl-state__art">
            <EmptyIllustration name="carrinho" size={96} />
          </span>
          <p className="af-cl-state__title">A loja ainda não tem produtos à venda.</p>
          <p className="af-cl-state__text">{filtro ? 'Nenhum produto nesta categoria.' : 'Volte mais tarde: a loja vai avisar quando houver novidade.'}</p>
          {filtro ? (
            <LinkButton href={base} variant="secondary">
              Ver tudo
            </LinkButton>
          ) : null}
        </div>
      ) : (
        <ul className="af-cl-products">
          {pagina.items.map((p) => (
            <ProdutoCartao key={p.id} slug={slug} produto={p} />
          ))}
        </ul>
      )}
      {pagina.nextCursor ? (
        <LinkButton href={`${base}?${filtro ? `categoria=${filtro}&` : ''}cursor=${encodeURIComponent(pagina.nextCursor)}`} variant="secondary">
          Carregar mais
        </LinkButton>
      ) : null}
    </ClientePagina>
  )
}
