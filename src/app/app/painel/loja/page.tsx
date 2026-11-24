import type { Metadata } from 'next'
import { Plus } from 'lucide-react'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { listCategories } from '@/server/domain/store/categories'
import { listOrders } from '@/server/domain/store/orders'
import { listProducts } from '@/server/domain/store/products'
import { getStoreIntegrations, getStoreSettings } from '@/server/domain/store/settings'
import { ATTENTION_LABELS, Card, EmptyState, LinkButton, NavTabs, orderStatusText, orderStatusTone, Pagination, SearchBar } from '@/ui/components'
import { formatMoney } from '@/ui/format'
import { um } from '@/app/_lib/params'
import { PainelFrame } from '../PainelFrame'
import { requirePainelModule } from '../_lib/modulo'
import { CategoriasLista, ConfiguracoesForm, ProdutosLista } from './LojaPainel'
import { PedidosLista } from './PedidosLista'

export const metadata: Metadata = { title: 'Loja | Agenda Flui' }

const ABAS = [
  { id: 'pedidos', label: 'Pedidos' },
  { id: 'produtos', label: 'Produtos' },
  { id: 'categorias', label: 'Categorias' },
  { id: 'configuracoes', label: 'Configurações' },
] as const
type Aba = (typeof ABAS)[number]['id']

const SITUACOES_DE_PEDIDO = [
  { id: '', label: 'Todos os pedidos', status: undefined },
  { id: 'aguardando', label: 'Aguardando pagamento', status: 'AWAITING_PAYMENT' },
  { id: 'a-entregar', label: 'Pagos, a entregar', status: 'to_fulfill' },
  { id: 'entregues', label: 'Entregues', status: 'delivered' },
  { id: 'cancelados', label: 'Cancelados e vencidos', status: 'closed' },
] as const

const ENTREGA_EM_TEXTO = { PICKUP: 'Retirada', SHIPPING: 'Entrega' } as const

const SITUACOES = [
  { id: '', label: 'Todos os produtos', situation: undefined },
  { id: 'ativos', label: 'À venda', situation: 'active' },
  { id: 'inativos', label: 'Fora de uso', situation: 'inactive' },
  { id: 'arquivados', label: 'Arquivados', situation: 'archived' },
] as const

/** Texto da busca sem caracteres de controle (o banco recusa o byte zero) e no tamanho que o domínio aceita. */
function limpar(texto: string): string {
  return texto.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100)
}

export default async function LojaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant('manage_store')
  await requirePainelModule(ctx, 'store')
  const q = await searchParams
  const aba: Aba = ABAS.find((a) => a.id === um(q.aba))?.id ?? 'pedidos'
  const abas = ABAS.map((a) => ({ id: a.id, label: a.label, href: a.id === 'pedidos' ? '/painel/loja' : `/painel/loja?aba=${a.id}`, active: aba === a.id }))

  let corpo
  let acoes = null
  if (aba === 'pedidos') {
    const situacao = SITUACOES_DE_PEDIDO.find((s) => s.id === um(q.situacao)) ?? SITUACOES_DE_PEDIDO[0]
    const search = limpar(um(q.search))
    const cursor = um(q.cursor) || null
    let pagina: Awaited<ReturnType<typeof listOrders>> | null = null
    let aviso: string | null = null
    try {
      pagina = await listOrders(ctx, { ...(situacao.status ? { status: situacao.status } : {}), ...(search ? { search } : {}), ...(cursor ? { cursor } : {}), limit: 30 })
    } catch (err) {
      if (!(err instanceof DomainError) || err.code !== 'validation') throw err
      aviso = err.message
    }
    const pedidos = (pagina?.items ?? []).map((o) => ({
      id: o.id,
      numero: `#${o.number}`,
      cliente: o.customer.name,
      total: formatMoney(o.totalCents),
      criado: o.createdLabel,
      entrega: ENTREGA_EM_TEXTO[o.deliveryMethod],
      situacao: orderStatusText(o.status, o.fulfillmentStatus, o.deliveryMethod),
      tom: orderStatusTone(o.status, o.fulfillmentStatus),
      atencao: o.attention === null ? null : ATTENTION_LABELS[o.attention],
    }))
    const filtrado = search !== '' || situacao.id !== ''
    const vazio = aviso ? (
      <EmptyState title="Esta página da lista não existe mais" description={aviso} action={<LinkButton href="/painel/loja">Voltar ao início da lista</LinkButton>} />
    ) : filtrado ? (
      <EmptyState title="Nenhum pedido encontrado" description="Nada combina com a busca ou com o filtro. Busque pelo número do pedido ou pelo nome do cliente." action={<LinkButton href="/painel/loja">Limpar busca</LinkButton>} />
    ) : (
      <EmptyState title="Nenhum pedido ainda" description="Os pedidos feitos pelo link da loja aparecem aqui, com o pagamento e a entrega." action={<LinkButton href="/painel/loja?aba=produtos">Ver produtos</LinkButton>} />
    )
    corpo = (
      <>
        <SearchBar
          action="/painel/loja"
          label="Buscar pedidos"
          placeholder="Buscar pelo número ou pelo nome do cliente"
          query={search}
          filters={[{ name: 'situacao', label: 'Situação', value: situacao.id, options: SITUACOES_DE_PEDIDO.map((s) => ({ value: s.id, label: s.label })) }]}
          clearHref="/painel/loja"
        />
        <PedidosLista pedidos={pedidos} vazio={vazio} />
        <Pagination basePath="/painel/loja" params={{ search: search || undefined, situacao: situacao.id || undefined }} cursor={cursor} nextCursor={pagina?.nextCursor ?? null} />
      </>
    )
  } else if (aba === 'produtos') {
    const categorias = await listCategories(ctx)
    const situacao = SITUACOES.find((s) => s.id === um(q.situacao)) ?? SITUACOES[0]
    const categoria = categorias.find((c) => c.id === um(q.categoria))?.id ?? ''
    const search = limpar(um(q.search))
    const cursor = um(q.cursor) || null
    let pagina: Awaited<ReturnType<typeof listProducts>> | null = null
    let aviso: string | null = null
    try {
      pagina = await listProducts(ctx, {
        ...(situacao.situation ? { situation: situacao.situation } : {}),
        ...(categoria ? { categoryId: categoria } : {}),
        ...(search ? { search } : {}),
        ...(cursor ? { cursor } : {}),
        limit: 30,
      })
    } catch (err) {
      if (!(err instanceof DomainError) || err.code !== 'validation') throw err
      aviso = err.message
    }
    const nomeDaCategoria = new Map(categorias.map((c) => [c.id, c.name]))
    const produtos = (pagina?.items ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      imageUrl: p.images[0]?.url ?? null,
      priceCents: p.priceCents,
      promoPriceCents: p.promoPriceCents,
      finalPriceCents: p.finalPriceCents,
      stock: p.stock,
      active: p.active,
      archived: p.archivedAt !== null,
      categoryName: p.categoryId === null ? null : (nomeDaCategoria.get(p.categoryId) ?? null),
    }))
    const filtrado = search !== '' || categoria !== '' || situacao.id !== ''
    const novo = (
      <LinkButton href="/painel/loja/produtos/novo" variant="primary" icon={<Plus size={18} />}>
        Novo produto
      </LinkButton>
    )
    acoes = novo
    const vazio = aviso ? (
      <EmptyState title="Esta página da lista não existe mais" description={aviso} action={<LinkButton href="/painel/loja?aba=produtos">Voltar ao início da lista</LinkButton>} />
    ) : filtrado ? (
      <EmptyState title="Nenhum produto encontrado" description="Nada combina com a busca ou com os filtros. Confira a grafia ou limpe a busca." action={<LinkButton href="/painel/loja?aba=produtos">Limpar busca</LinkButton>} />
    ) : (
      <EmptyState title="Cadastre o primeiro produto" description="Os produtos aparecem na vitrine dos clientes, com foto, preço e estoque." action={novo} />
    )
    const params = { aba: 'produtos', search: search || undefined, categoria: categoria || undefined, situacao: situacao.id || undefined }
    corpo = (
      <>
        <SearchBar
          action="/painel/loja"
          hidden={{ aba: 'produtos' }}
          label="Buscar produtos"
          placeholder="Buscar pelo nome do produto"
          query={search}
          filters={[
            { name: 'categoria', label: 'Categoria', value: categoria, options: [{ value: '', label: 'Todas as categorias' }, ...categorias.map((c) => ({ value: c.id, label: c.name }))] },
            { name: 'situacao', label: 'Situação', value: situacao.id, options: SITUACOES.map((s) => ({ value: s.id, label: s.label })) },
          ]}
          clearHref="/painel/loja?aba=produtos"
        />
        <ProdutosLista produtos={produtos} vazio={vazio} />
        <Pagination basePath="/painel/loja" params={params} cursor={cursor} nextCursor={pagina?.nextCursor ?? null} />
      </>
    )
  } else if (aba === 'categorias') {
    const lista = await listCategories(ctx)
    corpo = <CategoriasLista categorias={lista.map((c, i) => ({ id: c.id, name: c.name, productCount: c.productCount, first: i === 0, last: i === lista.length - 1 }))} />
  } else {
    const s = await getStoreSettings(ctx)
    const status = await getStoreIntegrations(ctx)
    corpo = (
      <ConfiguracoesForm
        dados={{
          version: s.version,
          pickupEnabled: s.pickupEnabled,
          pickupInstructions: s.pickupInstructions ?? '',
          shippingEnabled: s.shippingEnabled,
          originPostalCode: s.originPostalCode ?? '',
          weightGrams: s.defaultPackage.weightGrams,
          lengthCm: s.defaultPackage.lengthCm,
          heightCm: s.defaultPackage.heightCm,
          widthCm: s.defaultPackage.widthCm,
          paymentWindowMin: s.paymentWindowMin,
        }}
        mercadoPago={status.mercadoPago}
        frenet={status.frenet}
      />
    )
  }

  return (
    <PainelFrame ctx={ctx} title="Loja" actions={acoes}>
      <Card className="af-listpanel" as="section" aria-label="Loja">
        <NavTabs label="Seções da loja" items={abas} />
        {corpo}
      </Card>
    </PainelFrame>
  )
}
