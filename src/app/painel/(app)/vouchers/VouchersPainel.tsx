'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Archive, Pencil } from 'lucide-react'
import { Button, ConfirmDialog, DataList, LinkButton, StatusDot } from '@/ui/components'
import type { BadgeTone, DataColumn } from '@/ui/components'
import { StatusBadge } from '@/ui/components'
import { formatInt, formatMoney } from '@/ui/format'
import type { EstadoPainel } from '../_lib/PainelForm'
import { arquivarParceiro, arquivarVoucher } from './actions'

const SEM_ESTADO = { ok: false, message: null, fields: {}, values: {} }

export type VoucherLinha = {
  id: string
  name: string
  partnerName: string
  imageUrl: string | null
  priceCents: number
  stock: number
  sold: number
  redeemed: number
  validity: string
  active: boolean
  archived: boolean
}

export type ParceiroLinha = { id: string; name: string; address: string | null; phone: string | null; voucherCount: number; active: boolean; archived: boolean; logoUrl: string | null }

export type CodigoLinha = { id: string; code: string; voucher: string; partner: string; customer: string; orderNumber: string; statusText: string; tone: BadgeTone; validity: string }

function Miniatura({ src }: { src: string | null }) {
  return (
    <span className="af-thumb">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta; sem otimização aqui
        <img src={src} alt="" className="af-thumb__img" />
      ) : (
        <span>Sem imagem</span>
      )}
    </span>
  )
}

export function VouchersLista({ vouchers, vazio }: { vouchers: VoucherLinha[]; vazio: React.ReactNode }) {
  const [arquivando, setArquivando] = useState<VoucherLinha | null>(null)
  const colunas: DataColumn<VoucherLinha>[] = [
    {
      key: 'voucher',
      header: 'Voucher',
      primary: true,
      cell: (v) => (
        <span className="af-service">
          <Miniatura src={v.imageUrl} />
          <span className="af-service__text">
            <Link href={`/vouchers/${v.id}`} className="af-service__name">
              {v.name}
            </Link>
            <span className="af-service__desc">{v.partnerName}</span>
          </span>
        </span>
      ),
    },
    { key: 'preco', header: 'Preço', nowrap: true, align: 'end', cell: (v) => <span className="af-tabular">{formatMoney(v.priceCents)}</span> },
    { key: 'validade', header: 'Validade', nowrap: true, cell: (v) => v.validity },
    { key: 'estoque', header: 'Estoque', nowrap: true, align: 'end', cell: (v) => (v.stock === 0 ? <StatusDot tone="danger" label="Acabou" /> : <span className="af-tabular">{formatInt(v.stock)}</span>) },
    { key: 'vendidos', header: 'Vendidos', nowrap: true, align: 'end', cell: (v) => <span className="af-tabular">{formatInt(v.sold)}</span> },
    { key: 'usados', header: 'Usados', nowrap: true, align: 'end', cell: (v) => <span className="af-tabular">{formatInt(v.redeemed)}</span> },
    {
      key: 'situacao',
      header: 'Situação',
      nowrap: true,
      cell: (v) => (v.archived ? <StatusDot tone="neutral" label="Arquivado" /> : v.active ? <StatusDot tone="success" label="À venda" /> : <StatusDot tone="warning" label="Fora de uso" detail="Não aparece no app" />),
    },
    {
      key: 'acoes',
      header: <span className="af-sr">Ações</span>,
      cell: (v) =>
        v.archived ? null : (
          <span className="af-rowactions">
            <LinkButton href={`/vouchers/${v.id}`} variant="secondary" size="sm" icon={<Pencil size={16} />} aria-label={`Editar ${v.name}`}>
              Editar
            </LinkButton>
            <Button size="sm" variant="ghost" icon={<Archive size={16} />} onClick={() => setArquivando(v)} aria-label={`Arquivar ${v.name}`}>
              Arquivar
            </Button>
          </span>
        ),
    },
  ]
  return (
    <>
      <DataList label="Vouchers" columns={colunas} rows={vouchers} rowKey={(v) => v.id} stack="lg" empty={vazio} />
      <ConfirmDialog
        open={arquivando !== null}
        onClose={() => setArquivando(null)}
        title={arquivando ? `Arquivar ${arquivando.name}?` : ''}
        description="O voucher sai da lista e do app. Quem já comprou continua com o código e pode usá-lo no balcão."
        confirmLabel="Arquivar voucher"
        initialState={SEM_ESTADO}
        hidden={{ id: arquivando?.id ?? '' }}
        action={async (prev, fd) => {
          const r = await arquivarVoucher(prev as EstadoPainel, fd)
          if (r.ok) setArquivando(null)
          return r
        }}
      />
    </>
  )
}

export function ParceirosLista({ parceiros, vazio }: { parceiros: ParceiroLinha[]; vazio: React.ReactNode }) {
  const [arquivando, setArquivando] = useState<ParceiroLinha | null>(null)
  const colunas: DataColumn<ParceiroLinha>[] = [
    {
      key: 'parceiro',
      header: 'Parceiro',
      primary: true,
      cell: (p) => (
        <span className="af-service">
          <Miniatura src={p.logoUrl} />
          <span className="af-service__text">
            <Link href={`/vouchers/parceiros/${p.id}`} className="af-service__name">
              {p.name}
            </Link>
            {p.address ? <span className="af-service__desc">{p.address}</span> : null}
          </span>
        </span>
      ),
    },
    { key: 'telefone', header: 'Telefone', nowrap: true, cell: (p) => p.phone ?? '' },
    { key: 'vouchers', header: 'Vouchers', nowrap: true, align: 'end', cell: (p) => <span className="af-tabular">{formatInt(p.voucherCount)}</span> },
    { key: 'situacao', header: 'Situação', nowrap: true, cell: (p) => (p.archived ? <StatusDot tone="neutral" label="Arquivado" /> : p.active ? <StatusDot tone="success" label="Ativo" /> : <StatusDot tone="warning" label="Parado" detail="Seus vouchers não aparecem no app" />) },
    {
      key: 'acoes',
      header: <span className="af-sr">Ações</span>,
      cell: (p) =>
        p.archived ? null : (
          <span className="af-rowactions">
            <LinkButton href={`/vouchers/parceiros/${p.id}`} variant="secondary" size="sm" icon={<Pencil size={16} />} aria-label={`Editar ${p.name}`}>
              Editar
            </LinkButton>
            <Button size="sm" variant="ghost" icon={<Archive size={16} />} onClick={() => setArquivando(p)} aria-label={`Arquivar ${p.name}`}>
              Arquivar
            </Button>
          </span>
        ),
    },
  ]
  return (
    <>
      <DataList label="Parceiros" columns={colunas} rows={parceiros} rowKey={(p) => p.id} stack="md" empty={vazio} />
      <ConfirmDialog
        open={arquivando !== null}
        onClose={() => setArquivando(null)}
        title={arquivando ? `Arquivar ${arquivando.name}?` : ''}
        description="O parceiro e os vouchers dele saem da lista e do app. Os códigos já vendidos continuam valendo no balcão."
        confirmLabel="Arquivar parceiro"
        initialState={SEM_ESTADO}
        hidden={{ id: arquivando?.id ?? '' }}
        action={async (prev, fd) => {
          const r = await arquivarParceiro(prev as EstadoPainel, fd)
          if (r.ok) setArquivando(null)
          return r
        }}
      />
    </>
  )
}

/** Códigos: somem do app se o pedido for devolvido; aqui a equipe vê todos, com a situação sempre em texto. */
export function CodigosLista({ codigos, vazio }: { codigos: CodigoLinha[]; vazio: React.ReactNode }) {
  const colunas: DataColumn<CodigoLinha>[] = [
    { key: 'codigo', header: 'Código', primary: true, nowrap: true, cell: (c) => <span className="af-codetext">{c.code}</span> },
    {
      key: 'voucher',
      header: 'Voucher',
      cell: (c) => (
        <span className="af-service__text">
          <span className="af-service__name">{c.voucher}</span>
          <span className="af-service__desc">{c.partner}</span>
        </span>
      ),
    },
    { key: 'cliente', header: 'Cliente', cell: (c) => c.customer },
    { key: 'pedido', header: 'Pedido', nowrap: true, cell: (c) => c.orderNumber },
    { key: 'validade', header: 'Validade', nowrap: true, cell: (c) => c.validity },
    { key: 'situacao', header: 'Situação', nowrap: true, cell: (c) => <StatusBadge tone={c.tone}>{c.statusText}</StatusBadge> },
  ]
  return <DataList label="Códigos" columns={colunas} rows={codigos} rowKey={(c) => c.id} stack="lg" empty={vazio} />
}
