import type { Metadata } from 'next'
import { Plus } from 'lucide-react'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { listPartners } from '@/server/domain/vouchers/partners'
import { listVoucherCodes } from '@/server/domain/vouchers/codes'
import { listVouchers } from '@/server/domain/vouchers/vouchers'
import { Card, EmptyState, LinkButton, NavTabs, Pagination, SearchBar } from '@/ui/components'
import { um } from '@/app/_lib/params'
import { PainelFrame } from '../PainelFrame'
import { requirePainelModule } from '../_lib/modulo'
import { DarBaixa } from './DarBaixa'
import { CodigosLista, ParceirosLista, VouchersLista } from './VouchersPainel'
import { SITUACAO_DO_CODIGO } from './situacao'

export const metadata: Metadata = { title: 'Vouchers | AgendaFlui' }

const ABAS = [
  { id: 'baixa', label: 'Dar baixa' },
  { id: 'vouchers', label: 'Vouchers' },
  { id: 'parceiros', label: 'Parceiros' },
  { id: 'codigos', label: 'Códigos' },
] as const
type Aba = (typeof ABAS)[number]['id']

const SITUACOES_DE_CODIGO = [
  { id: '', label: 'Todas as situações', status: undefined },
  { id: 'ACTIVE', label: 'Válidos', status: 'ACTIVE' },
  { id: 'REDEEMED', label: 'Usados', status: 'REDEEMED' },
  { id: 'EXPIRED', label: 'Vencidos', status: 'EXPIRED' },
  { id: 'VOID', label: 'Anulados', status: 'VOID' },
] as const

const SITUACOES_DE_VOUCHER = [
  { id: '', label: 'Todos os vouchers', situation: undefined },
  { id: 'ativos', label: 'À venda', situation: 'active' },
  { id: 'inativos', label: 'Fora de uso', situation: 'inactive' },
  { id: 'arquivados', label: 'Arquivados', situation: 'archived' },
] as const

/** Texto da busca sem caracteres de controle (o banco recusa o byte zero) e no tamanho que o domínio aceita. */
function limpar(texto: string): string {
  return texto.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100)
}

export default async function VouchersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant('manage_vouchers')
  await requirePainelModule(ctx, 'vouchers')
  const q = await searchParams
  const aba: Aba = ABAS.find((a) => a.id === um(q.aba))?.id ?? 'baixa'
  const abas = ABAS.map((a) => ({ id: a.id, label: a.label, href: a.id === 'baixa' ? '/vouchers' : `/vouchers?aba=${a.id}`, active: aba === a.id }))

  let corpo
  let acoes = null
  if (aba === 'baixa') {
    corpo = <DarBaixa />
  } else if (aba === 'vouchers') {
    const situacao = SITUACOES_DE_VOUCHER.find((s) => s.id === um(q.situacao)) ?? SITUACOES_DE_VOUCHER[0]
    const lista = await listVouchers(ctx, situacao.situation ? { situation: situacao.situation } : {})
    const novo = (
      <LinkButton href="/vouchers/novo" variant="primary" icon={<Plus size={18} />}>
        Novo voucher
      </LinkButton>
    )
    acoes = novo
    const vazio = situacao.id !== '' ? (
      <EmptyState title="Nenhum voucher encontrado" description="Nada combina com o filtro." action={<LinkButton href="/vouchers?aba=vouchers">Limpar filtro</LinkButton>} />
    ) : (
      <EmptyState title="Cadastre o primeiro voucher" description="Primeiro cadastre um parceiro; depois o voucher aparece na loja do app, com preço e validade." action={novo} />
    )
    corpo = (
      <>
        <SearchBar action="/vouchers" hidden={{ aba: 'vouchers' }} label="Filtrar vouchers" query="" filters={[{ name: 'situacao', label: 'Situação', value: situacao.id, options: SITUACOES_DE_VOUCHER.map((s) => ({ value: s.id, label: s.label })) }]} clearHref="/vouchers?aba=vouchers" />
        <VouchersLista
          vazio={vazio}
          vouchers={lista.map((v) => ({
            id: v.id,
            name: v.name,
            partnerName: v.partnerName,
            imageUrl: v.imageUrl,
            priceCents: v.priceCents,
            stock: v.stock,
            sold: v.sold,
            redeemed: v.redeemed,
            validity: v.validDays === null ? 'Sem validade' : `${v.validDays} ${v.validDays === 1 ? 'dia' : 'dias'}`,
            active: v.active,
            archived: v.archivedAt !== null,
          }))}
        />
      </>
    )
  } else if (aba === 'parceiros') {
    const lista = await listPartners(ctx)
    const novo = (
      <LinkButton href="/vouchers/parceiros/novo" variant="primary" icon={<Plus size={18} />}>
        Novo parceiro
      </LinkButton>
    )
    acoes = novo
    corpo = (
      <ParceirosLista
        vazio={<EmptyState title="Cadastre o primeiro parceiro" description="O parceiro é quem recebe o cliente e aceita o voucher: restaurante, cinema, spa..." action={novo} />}
        parceiros={lista.map((p) => ({ id: p.id, name: p.name, address: p.address, phone: p.phone, voucherCount: p.voucherCount, active: p.active, archived: p.archivedAt !== null, logoUrl: p.logoUrl }))}
      />
    )
  } else {
    const situacao = SITUACOES_DE_CODIGO.find((s) => s.id === um(q.situacao)) ?? SITUACOES_DE_CODIGO[0]
    const search = limpar(um(q.search))
    const cursor = um(q.cursor) || null
    let pagina: Awaited<ReturnType<typeof listVoucherCodes>> | null = null
    let aviso: string | null = null
    try {
      pagina = await listVoucherCodes(ctx, { ...(situacao.status ? { status: situacao.status } : {}), ...(search ? { search } : {}), ...(cursor ? { cursor } : {}), limit: 30 })
    } catch (err) {
      if (!(err instanceof DomainError) || err.code !== 'validation') throw err
      aviso = err.message
    }
    const filtrado = search !== '' || situacao.id !== ''
    const vazio = aviso ? (
      <EmptyState title="Esta página da lista não existe mais" description={aviso} action={<LinkButton href="/vouchers?aba=codigos">Voltar ao início da lista</LinkButton>} />
    ) : filtrado ? (
      <EmptyState title="Nenhum código encontrado" description="Nada combina com a busca ou com o filtro. Busque pelo código, pelo nome do cliente ou pelo número do pedido." action={<LinkButton href="/vouchers?aba=codigos">Limpar busca</LinkButton>} />
    ) : (
      <EmptyState title="Nenhum código ainda" description="Os códigos nascem quando o pagamento de um pedido de voucher é aprovado." />
    )
    corpo = (
      <>
        <SearchBar
          action="/vouchers"
          hidden={{ aba: 'codigos' }}
          label="Buscar códigos"
          placeholder="Buscar pelo código, pelo cliente ou pelo número do pedido"
          query={search}
          filters={[{ name: 'situacao', label: 'Situação', value: situacao.id, options: SITUACOES_DE_CODIGO.map((s) => ({ value: s.id, label: s.label })) }]}
          clearHref="/vouchers?aba=codigos"
        />
        <CodigosLista
          vazio={vazio}
          codigos={(pagina?.items ?? []).map((c) => ({
            id: c.id,
            code: c.code,
            voucher: c.voucher.name,
            partner: c.partnerName,
            customer: c.customer.name,
            orderNumber: `#${c.orderNumber}`,
            statusText: SITUACAO_DO_CODIGO[c.status].text,
            tone: SITUACAO_DO_CODIGO[c.status].tone,
            validity: c.expiresLabel ?? 'Sem validade',
          }))}
        />
        <Pagination basePath="/vouchers" params={{ aba: 'codigos', search: search || undefined, situacao: situacao.id || undefined }} cursor={cursor} nextCursor={pagina?.nextCursor ?? null} />
      </>
    )
  }

  return (
    <PainelFrame ctx={ctx} title="Vouchers" actions={acoes}>
      <Card className="af-listpanel" as="section" aria-label="Vouchers">
        <NavTabs label="Seções dos vouchers" items={abas} />
        {corpo}
      </Card>
    </PainelFrame>
  )
}
