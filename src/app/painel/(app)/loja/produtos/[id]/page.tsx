import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { listCategories } from '@/server/domain/store/categories'
import { getProduct } from '@/server/domain/store/products'
import type { ProductView } from '@/server/domain/store/products'
import { Card, LinkButton, StatusDot } from '@/ui/components'
import { formatInt } from '@/ui/format'
import { um, porCodigo } from '@/app/_lib/params'
import { PainelFrame } from '../../../PainelFrame'
import { MENSAGENS_DE_IMAGEM } from '../../../_lib/imagem'
import { requirePainelModule } from '../../../_lib/modulo'
import { AjustarEstoque } from '../../LojaPainel'
import { ProdutoForm } from '../../ProdutoForm'
import { ProdutoImagens } from '../../ProdutoImagens'

export const metadata: Metadata = { title: 'Produto | AgendaFlui' }

export default async function ProdutoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireTenant('manage_store')
  await requirePainelModule(ctx, 'store')
  const { id } = await params
  const q = await searchParams
  let produto: ProductView
  try {
    produto = await getProduct(ctx, id)
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
  const categorias = (await listCategories(ctx)).map((c) => ({ id: c.id, name: c.name }))
  // Produto de categoria arquivada: ela continua como opção, senão salvar o formulário tiraria o produto dela sem aviso.
  if (produto.categoryId !== null && !categorias.some((c) => c.id === produto.categoryId)) categorias.push({ id: produto.categoryId, name: 'Categoria arquivada' })
  const aviso = porCodigo(MENSAGENS_DE_IMAGEM, um(q.imagem))
  return (
    <PainelFrame
      ctx={ctx}
      title={produto.name}
      actions={
        <LinkButton href="/loja?aba=produtos" variant="ghost">
          Voltar para a loja
        </LinkButton>
      }
    >
      <div className="af-profile af-profile--narrow">
        <Card as="section" aria-labelledby="produto-estoque-titulo" className="af-profile">
          <h2 id="produto-estoque-titulo" className="af-section__title">
            Estoque
          </h2>
          <p>
            {produto.stock === 0 ? <StatusDot tone="danger" label="Acabou" /> : <strong className="af-tabular">{formatInt(produto.stock)} em estoque</strong>}
          </p>
          <p className="af-section__help">Entrada e saída ficam registradas com o motivo. Pedidos aguardando pagamento já reservam as unidades.</p>
          <div>
            <AjustarEstoque produto={{ id: produto.id, name: produto.name, stock: produto.stock }} />
          </div>
        </Card>
        <Card as="section" aria-labelledby="produto-imagens" className="af-profile">
          <h2 id="produto-imagens" className="af-section__title">
            Imagens
          </h2>
          {aviso ? (
            <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'af-acctform__ok' : 'af-rowerror'}>
              {aviso.texto}
            </p>
          ) : null}
          <ProdutoImagens productId={produto.id} nome={produto.name} imagens={produto.images} />
        </Card>
        <Card as="section" aria-labelledby="produto-dados" className="af-profile">
          <h2 id="produto-dados" className="af-section__title">
            Dados do produto
          </h2>
          <ProdutoForm
            produto={{
              id: produto.id,
              name: produto.name,
              description: produto.description ?? '',
              priceCents: produto.priceCents,
              promoPriceCents: produto.promoPriceCents,
              categoryId: produto.categoryId ?? '',
              weightGrams: produto.weightGrams,
              lengthCm: produto.lengthCm,
              heightCm: produto.heightCm,
              widthCm: produto.widthCm,
              active: produto.active,
            }}
            categorias={categorias}
          />
        </Card>
      </div>
    </PainelFrame>
  )
}
