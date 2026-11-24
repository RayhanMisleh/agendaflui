'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Archive, ArrowDown, ArrowUp, Check, Pencil, Plus, X } from 'lucide-react'
import { Button, Checkbox, ConfirmDialog, DataList, EmptyState, Field, Input, LinkButton, Sheet, StatusBadge, StatusDot } from '@/ui/components'
import type { BadgeTone, DataColumn } from '@/ui/components'
import { formatInt } from '@/ui/format'
import { AcaoDeLinha } from '../_lib/AcaoDeLinha'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { arquivarPremio, cancelarResgate, criarPremio, entregarResgate, moverPremio, salvarPremio, salvarRanking } from './actions'

export type PremioLinha = {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  costPoints: number
  stock: number | null
  active: boolean
  first: boolean
  last: boolean
}

export type ResgateLinha = {
  id: string
  status: 'PENDING' | 'DELIVERED' | 'CANCELED'
  prizeName: string
  costPoints: number
  customerId: string
  customerName: string
  createdLabel: string
  deliveredLabel: string | null
  canceledLabel: string | null
  cancelReason: string | null
}

export type ClubeLinha = { id: string; name: string; phoneLabel: string | null }

/** Os termos da conta usados nos rótulos (pontos no plural, nome do clube). */
export type TermosFidelidade = { ponto: string; pontos: string; clube: string; cliente: string }

const pontosDe = (n: number, termos: TermosFidelidade) => `${formatInt(n)} ${(n === 1 ? termos.ponto : termos.pontos).toLowerCase()}`

// ---------------------------------------------------------------- prêmios

const ROTULOS_PREMIO = { name: 'Nome', description: 'Descrição', costPoints: 'Custo', stock: 'Estoque' }
const ANCORAS_PREMIO = { name: 'premio-nome', description: 'premio-descricao', costPoints: 'premio-custo', stock: 'premio-estoque' }

export type PremioDados = { id: string; name: string; description: string; costPoints: number; stock: number | null; active: boolean }

/** O formulário do prêmio: cria (sem `premio`) ou edita. Quem cria vai para a ficha, onde envia a imagem. */
export function PremioForm({ premio, termos }: { premio: PremioDados | null; termos: TermosFidelidade }) {
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: premio
      ? { id: premio.id, name: premio.name, description: premio.description, costPoints: String(premio.costPoints), stock: premio.stock === null ? '' : String(premio.stock), active: premio.active ? 'on' : '' }
      : { active: 'on' },
  }
  return (
    <PainelForm action={premio ? salvarPremio : criarPremio} initial={inicial} submit={premio ? 'Salvar prêmio' : 'Criar prêmio'} labels={ROTULOS_PREMIO} anchors={ANCORAS_PREMIO}>
      {(state) => {
        const v = state.values
        return (
          <>
            {premio ? <input type="hidden" name="id" value={premio.id} /> : null}
            {premio ? <input type="hidden" name="expectedStock" value={premio.stock === null ? 'sem' : String(premio.stock)} /> : null}
            <Field label="Nome do prêmio" error={state.fields.name}>
              <Input id="premio-nome" name="name" defaultValue={v.name ?? ''} maxLength={80} autoComplete="off" required />
            </Field>
            <Field label="Descrição" hint="Opcional. Aparece para quem resgata." error={state.fields.description}>
              <Input id="premio-descricao" name="description" defaultValue={v.description ?? ''} maxLength={500} autoComplete="off" />
            </Field>
            <div className="af-formgrid">
              <Field label={`Custo em ${termos.pontos.toLowerCase()}`} error={state.fields.costPoints}>
                <Input id="premio-custo" name="costPoints" type="number" inputMode="numeric" min={1} max={1000000} defaultValue={v.costPoints ?? ''} required />
              </Field>
              <Field label="Estoque" hint="Deixe em branco para não ter limite." error={state.fields.stock}>
                <Input id="premio-estoque" name="stock" type="number" inputMode="numeric" min={0} max={1000000} defaultValue={v.stock ?? ''} />
              </Field>
            </div>
            <Checkbox name="active" label="Disponível para resgatar" defaultChecked={v.active === 'on'} />
          </>
        )
      }}
    </PainelForm>
  )
}

export function PremiosLista({ premios, termos }: { premios: PremioLinha[]; termos: TermosFidelidade }) {
  const [arquivando, setArquivando] = useState<PremioLinha | null>(null)
  const colunas: DataColumn<PremioLinha>[] = [
    {
      key: 'premio',
      header: 'Prêmio',
      primary: true,
      cell: (p) => (
        <span className="af-service">
          <span className="af-thumb">
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta; sem otimização aqui
              <img src={p.imageUrl} alt="" className="af-thumb__img" />
            ) : (
              <span>Sem imagem</span>
            )}
          </span>
          <span className="af-service__text">
            <Link href={`/painel/fidelidade/premios/${p.id}`} className="af-service__name">
              {p.name}
            </Link>
            {p.description ? <span className="af-service__desc">{p.description}</span> : null}
          </span>
        </span>
      ),
    },
    { key: 'custo', header: 'Custo', nowrap: true, align: 'end', cell: (p) => <span className="af-tabular">{pontosDe(p.costPoints, termos)}</span> },
    { key: 'estoque', header: 'Estoque', nowrap: true, align: 'end', cell: (p) => <span className="af-tabular">{p.stock === null ? 'Sem limite' : p.stock === 0 ? 'Esgotado' : formatInt(p.stock)}</span> },
    { key: 'situacao', header: 'Situação', nowrap: true, cell: (p) => (p.active ? <StatusDot tone="success" label="Disponível" /> : <StatusDot tone="warning" label="Fora de uso" detail="Não aparece no app" />) },
    {
      key: 'acoes',
      header: <span className="af-sr">Ações</span>,
      cell: (p) => (
        <span className="af-rowactions">
          <AcaoDeLinha action={moverPremio} campos={{ id: p.id, direction: 'up' }} icon={<ArrowUp size={16} />} disabled={p.first} ariaLabel={`Subir ${p.name}`} />
          <AcaoDeLinha action={moverPremio} campos={{ id: p.id, direction: 'down' }} icon={<ArrowDown size={16} />} disabled={p.last} ariaLabel={`Descer ${p.name}`} />
          <LinkButton href={`/painel/fidelidade/premios/${p.id}`} variant="secondary" size="sm" icon={<Pencil size={16} />} aria-label={`Editar ${p.name}`}>
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
      <div className="af-toolbar">
        <p className="af-section__help">Os {termos.cliente.toLowerCase()} resgatam estes prêmios pelo link da loja, na ordem abaixo.</p>
        <LinkButton href="/painel/fidelidade/premios/novo" variant="primary" icon={<Plus size={18} />}>
          Novo prêmio
        </LinkButton>
      </div>
      <DataList
        label="Prêmios"
        columns={colunas}
        rows={premios}
        rowKey={(p) => p.id}
        stack="lg"
        empty={
          <EmptyState
            title="Cadastre o primeiro prêmio"
            description={`Com um prêmio, quem junta ${termos.pontos.toLowerCase()} já pode trocá-los.`}
            action={
              <LinkButton href="/painel/fidelidade/premios/novo" variant="primary" icon={<Plus size={18} />}>
                Novo prêmio
              </LinkButton>
            }
          />
        }
      />
      <ConfirmDialog
        open={arquivando !== null}
        onClose={() => setArquivando(null)}
        title={arquivando ? `Arquivar ${arquivando.name}?` : ''}
        description="O prêmio sai da lista e da vitrine dos clientes. Os resgates já feitos continuam no histórico."
        confirmLabel="Arquivar prêmio"
        initialState={{ ok: false, message: null, fields: {} }}
        hidden={{ id: arquivando?.id ?? '' }}
        action={async (prev, fd) => {
          const r = await arquivarPremio(prev as EstadoPainel, fd)
          if (r.ok) setArquivando(null)
          return r
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------- resgates

const SELO: Record<ResgateLinha['status'], { tone: BadgeTone; texto: string }> = {
  PENDING: { tone: 'pending', texto: 'Pendente' },
  DELIVERED: { tone: 'done', texto: 'Entregue' },
  CANCELED: { tone: 'canceled', texto: 'Cancelado' },
}

export function ResgatesLista({ resgates, termos }: { resgates: ResgateLinha[]; termos: TermosFidelidade }) {
  const [cancelando, setCancelando] = useState<ResgateLinha | null>(null)
  const colunas: DataColumn<ResgateLinha>[] = [
    {
      key: 'resgate',
      header: 'Prêmio',
      primary: true,
      cell: (r) => (
        <span className="af-service__text">
          <span className="af-service__name">{r.prizeName}</span>
          <span className="af-service__desc">
            <Link href={`/painel/clientes/${r.customerId}`}>{r.customerName}</Link>
          </span>
        </span>
      ),
    },
    { key: 'custo', header: 'Custo', nowrap: true, align: 'end', cell: (r) => <span className="af-tabular">{pontosDe(r.costPoints, termos)}</span> },
    {
      key: 'quando',
      header: 'Quando',
      cell: (r) => (
        <span className="af-service__text">
          <span>Pedido em {r.createdLabel}</span>
          {r.deliveredLabel ? <span className="af-service__desc">Entregue em {r.deliveredLabel}</span> : null}
          {r.canceledLabel ? <span className="af-service__desc">Cancelado em {r.canceledLabel}{r.cancelReason ? `: ${r.cancelReason}` : ''}</span> : null}
        </span>
      ),
    },
    { key: 'situacao', header: 'Situação', nowrap: true, cell: (r) => <StatusBadge tone={SELO[r.status].tone}>{SELO[r.status].texto}</StatusBadge> },
    {
      key: 'acoes',
      header: <span className="af-sr">Ações</span>,
      cell: (r) =>
        r.status === 'PENDING' ? (
          <span className="af-rowactions">
            <AcaoDeLinha action={entregarResgate} campos={{ id: r.id }} icon={<Check size={16} />} variant="primary" ariaLabel={`Entregar ${r.prizeName} a ${r.customerName}`}>
              Entregar
            </AcaoDeLinha>
            <Button size="sm" variant="ghost" icon={<X size={16} />} onClick={() => setCancelando(r)} aria-label={`Cancelar ${r.prizeName} de ${r.customerName}`}>
              Cancelar
            </Button>
          </span>
        ) : null,
    },
  ]
  return (
    <>
      <DataList label="Resgates" columns={colunas} rows={resgates} rowKey={(r) => r.id} stack="lg" empty={<EmptyState title="Nenhum resgate por aqui" description="Quando alguém trocar pontos por um prêmio, o resgate aparece nesta lista." action={<LinkButton href="/painel/fidelidade">Ver prêmios</LinkButton>} />} />
      <Sheet open={cancelando !== null} onClose={() => setCancelando(null)} title={cancelando ? `Cancelar ${cancelando.prizeName}` : ''}>
        {cancelando ? (
          <PainelForm action={cancelarResgate} submit="Cancelar resgate" onDone={() => setCancelando(null)} labels={{ reason: 'Motivo' }} anchors={{ reason: 'resgate-motivo' }}>
            {(state) => (
              <>
                <input type="hidden" name="id" value={cancelando.id} />
                <p>
                  Os {termos.pontos.toLowerCase()} voltam para {cancelando.customerName} e o estoque do prêmio, quando tem limite, ganha a unidade de volta.
                </p>
                <Field label="Motivo" hint="Opcional. Fica no registro do resgate." error={state.fields.reason}>
                  <Input id="resgate-motivo" name="reason" defaultValue={state.values.reason ?? ''} maxLength={300} autoComplete="off" />
                </Field>
              </>
            )}
          </PainelForm>
        ) : null}
      </Sheet>
    </>
  )
}

// ---------------------------------------------------------------- clube

export function ClubeLista({ membros, termos }: { membros: ClubeLinha[]; termos: TermosFidelidade }) {
  const colunas: DataColumn<ClubeLinha>[] = [
    { key: 'nome', header: termos.cliente, primary: true, cell: (m) => <Link href={`/painel/clientes/${m.id}`}>{m.name}</Link> },
    { key: 'telefone', header: 'Telefone', nowrap: true, cell: (m) => m.phoneLabel ?? 'Sem telefone' },
    {
      key: 'acoes',
      header: <span className="af-sr">Ações</span>,
      cell: (m) => (
        <LinkButton href={`/painel/clientes/${m.id}`} variant="secondary" size="sm" aria-label={`Abrir a ficha de ${m.name}`}>
          Abrir ficha
        </LinkButton>
      ),
    },
  ]
  return (
    <>
      <p className="af-section__help">Quem faz parte do {termos.clube}. Para incluir ou tirar alguém, abra a ficha e mude a marcação em Dados.</p>
      <DataList label={`Membros do ${termos.clube}`} columns={colunas} rows={membros} rowKey={(m) => m.id} stack="md" empty={<EmptyState title={`Ninguém no ${termos.clube} ainda`} description="Marque o cliente como membro na ficha dele." action={<LinkButton href="/painel/clientes">Abrir clientes</LinkButton>} />} />
    </>
  )
}

// ---------------------------------------------------------------- ajustes da conta

export function RankingForm({ version, ligado, termos }: { version: number; ligado: boolean; termos: TermosFidelidade }) {
  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: { version: String(version), rankingEnabled: ligado ? 'on' : '' } }
  return (
    <PainelForm action={salvarRanking} initial={inicial} submit="Salvar ajustes">
      {(state) => (
        <>
          <input type="hidden" name="version" value={String(version)} />
          <Checkbox name="rankingEnabled" label="Mostrar o ranking aos clientes" defaultChecked={state.values.rankingEnabled === 'on'} />
          <p className="af-field__hint">Mostra aos clientes o primeiro nome e a foto dos 10 que mais ganharam {termos.pontos.toLowerCase()} no mês.</p>
        </>
      )}
    </PainelForm>
  )
}
