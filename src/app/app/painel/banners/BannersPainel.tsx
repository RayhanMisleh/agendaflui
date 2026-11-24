'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, DataList, EmptyState, LinkButton, StatusBadge } from '@/ui/components'
import type { BadgeTone, DataColumn } from '@/ui/components'
import { AcaoDeLinha } from '../_lib/AcaoDeLinha'
import type { EstadoPainel } from '../_lib/PainelForm'
import { alternarBanner, excluirBanner, moverBanner } from './actions'
import { periodoEmTexto } from './periodo'

export type BannerLinha = {
  id: string
  title: string
  imageUrl: string | null
  startsOn: string | null
  endsOn: string | null
  active: boolean
  status: 'live' | 'scheduled' | 'ended' | 'inactive'
  first: boolean
  last: boolean
}

const SELO: Record<BannerLinha['status'], { tone: BadgeTone; texto: string }> = {
  live: { tone: 'confirmed', texto: 'No ar hoje' },
  scheduled: { tone: 'pending', texto: 'Agendado' },
  ended: { tone: 'canceled', texto: 'Encerrado' },
  inactive: { tone: 'neutral', texto: 'Inativo' },
}

/** A lista de banners: miniatura, período, selo, ordem por botões, ativar e excluir com confirmação. */
export function BannersPainel({ banners }: { banners: BannerLinha[] }) {
  const [excluindo, setExcluindo] = useState<BannerLinha | null>(null)

  const colunas: DataColumn<BannerLinha>[] = [
    {
      key: 'banner',
      header: 'Banner',
      primary: true,
      cell: (b) => (
        <span className="af-service">
          <span className="af-thumb">
            {b.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta; sem otimização aqui
              <img src={b.imageUrl} alt="" className="af-thumb__img" />
            ) : (
              <span>Sem imagem</span>
            )}
          </span>
          <span className="af-service__text">
            <Link href={`/painel/banners/${b.id}`} className="af-service__name">
              {b.title}
            </Link>
          </span>
        </span>
      ),
    },
    { key: 'periodo', header: 'Período', nowrap: true, cell: (b) => periodoEmTexto(b.startsOn, b.endsOn) },
    { key: 'situacao', header: 'Situação', nowrap: true, cell: (b) => <StatusBadge tone={SELO[b.status].tone}>{SELO[b.status].texto}</StatusBadge> },
    {
      key: 'acoes',
      header: <span className="af-sr">Ações</span>,
      cell: (b) => (
        <span className="af-rowactions">
          <AcaoDeLinha action={moverBanner} campos={{ id: b.id, direction: 'up' }} icon={<ArrowUp size={16} />} disabled={b.first} ariaLabel={`Subir ${b.title}`} />
          <AcaoDeLinha action={moverBanner} campos={{ id: b.id, direction: 'down' }} icon={<ArrowDown size={16} />} disabled={b.last} ariaLabel={`Descer ${b.title}`} />
          <AcaoDeLinha
            action={alternarBanner}
            campos={{ id: b.id, active: b.active ? '0' : '1' }}
            icon={b.active ? <EyeOff size={16} /> : <Eye size={16} />}
            ariaLabel={`${b.active ? 'Desativar' : 'Ativar'} ${b.title}`}
          >
            {b.active ? 'Desativar' : 'Ativar'}
          </AcaoDeLinha>
          <LinkButton href={`/painel/banners/${b.id}`} variant="secondary" size="sm" icon={<Pencil size={16} />} aria-label={`Editar ${b.title}`}>
            Editar
          </LinkButton>
          <Button size="sm" variant="ghost" icon={<Trash2 size={16} />} onClick={() => setExcluindo(b)} aria-label={`Excluir ${b.title}`}>
            Excluir
          </Button>
        </span>
      ),
    },
  ]

  return (
    <>
      <div className="af-toolbar">
        <p className="af-section__help">A tela inicial dos clientes mostra, na ordem abaixo, os banners ativos que estão dentro do período.</p>
        <LinkButton href="/painel/banners/novo" variant="primary" icon={<Plus size={18} />}>
          Novo banner
        </LinkButton>
      </div>
      <DataList
        label="Banners"
        columns={colunas}
        rows={banners}
        rowKey={(b) => b.id}
        stack="lg"
        empty={
          <EmptyState
            title="Cadastre o primeiro banner"
            description="Banners aparecem na tela inicial dos clientes com uma imagem e um link opcional."
            action={
              <LinkButton href="/painel/banners/novo" variant="primary" icon={<Plus size={18} />}>
                Novo banner
              </LinkButton>
            }
          />
        }
      />
      <ConfirmDialog
        open={excluindo !== null}
        onClose={() => setExcluindo(null)}
        title={excluindo ? `Excluir ${excluindo.title}?` : ''}
        description="O banner e a imagem são apagados de vez e saem da vitrine dos clientes. Não dá para desfazer. Para tirar do ar só por um tempo, desative o banner."
        confirmLabel="Excluir banner"
        initialState={{ ok: false, message: null, fields: {} }}
        hidden={{ id: excluindo?.id ?? '' }}
        action={async (prev, fd) => {
          const r = await excluirBanner(prev as EstadoPainel, fd)
          if (r.ok) setExcluindo(null)
          return r
        }}
      />
    </>
  )
}
