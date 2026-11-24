'use client'
import { useState } from 'react'
import { ArrowDown, ArrowUp, Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import { Button, Checkbox, ConfirmDialog, DataList, DurationField, EmptyState, Field, Input, MoneyField, NavTabs, Sheet, StatusDot, Textarea } from '@/ui/components'
import type { DataColumn } from '@/ui/components'
import { formatDuration, formatInt, formatMoney } from '@/ui/format'
import { formatMoneyInput } from '@/ui/money'
import { ServiceIcon } from '@/ui/service-icon'
import { SERVICE_ICON_LABELS, SERVICE_ICON_NAMES } from '@/shared/service-icons'
import { AcaoDeLinha } from '../_lib/AcaoDeLinha'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { arquivarServico, criarServico, editarServico, moverServico, restaurarServico } from './actions'

export type ServicoLinha = {
  id: string
  name: string
  description: string | null
  icon: string
  priceCents: number
  durationMin: number
  rewardPoints: number
  clubOnly: boolean
  active: boolean
  archived: boolean
  first: boolean
  last: boolean
}

type Contexto = { step: number; loyalty: boolean; pontos: string; clube: string }

const ROTULOS = { name: 'Nome', description: 'Descrição', icon: 'Ícone', price: 'Preço', durationMin: 'Duração', rewardPoints: 'Pontos', clubOnly: 'Só para o clube' }
const ANCORAS = { name: 'servico-nome', description: 'servico-descricao', price: 'servico-preco', durationMin: 'servico-duracao', rewardPoints: 'servico-pontos' }

/** O formulário do serviço, dentro da folha: cria (sem `servico`) ou edita. */
function ServicoForm({ servico, ctx, onDone }: { servico: ServicoLinha | null; ctx: Contexto; onDone: () => void }) {
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: servico
      ? {
          id: servico.id,
          name: servico.name,
          description: servico.description ?? '',
          icon: servico.icon,
          price: formatMoneyInput(servico.priceCents),
          durationMin: String(servico.durationMin),
          rewardPoints: String(servico.rewardPoints),
          clubOnly: servico.clubOnly ? 'on' : '',
          active: servico.active ? 'on' : '',
        }
      : { icon: 'sparkles', price: '', durationMin: String(ctx.step * Math.max(1, Math.round(30 / ctx.step))), rewardPoints: '0', active: 'on' },
  }
  return (
    <PainelForm
      action={servico ? editarServico : criarServico}
      initial={inicial}
      submit={servico ? 'Salvar serviço' : 'Criar serviço'}
      onDone={onDone}
      labels={ROTULOS}
      anchors={ANCORAS}
    >
      {(state) => {
        const v = state.values
        return (
          <>
            {servico ? <input type="hidden" name="id" value={servico.id} /> : null}
            {ctx.loyalty ? <input type="hidden" name="loyalty" value="1" /> : null}
            <Field label="Nome do serviço" error={state.fields.name}>
              <Input id="servico-nome" name="name" defaultValue={v.name ?? ''} maxLength={80} autoComplete="off" required />
            </Field>
            <Field label="Descrição" hint="Opcional. Aparece para quem marca horário." error={state.fields.description}>
              <Textarea id="servico-descricao" name="description" defaultValue={v.description ?? ''} maxLength={500} rows={3} />
            </Field>
            <fieldset className="af-iconpick">
              <legend className="af-field__label">Ícone</legend>
              <div className="af-iconpick__grid">
                {SERVICE_ICON_NAMES.map((nome) => (
                  <label key={nome} className="af-iconpick__item">
                    <input type="radio" name="icon" value={nome} defaultChecked={(v.icon ?? 'sparkles') === nome} className="af-iconpick__input" />
                    <span className="af-iconpick__face">
                      <ServiceIcon name={nome} size={20} />
                      <span className="af-iconpick__label">{SERVICE_ICON_LABELS[nome]}</span>
                    </span>
                  </label>
                ))}
              </div>
              {state.fields.icon ? <p className="af-field__error">{state.fields.icon}</p> : null}
            </fieldset>
            <div className="af-formgrid">
              <Field label="Preço (R$)" error={state.fields.price}>
                <MoneyField id="servico-preco" name="price" defaultValue={v.price ?? ''} />
              </Field>
              <Field label="Duração" hint={`Em múltiplos de ${ctx.step} minutos, a grade da agenda.`} error={state.fields.durationMin}>
                <DurationField id="servico-duracao" name="durationMin" stepMin={ctx.step} value={Number(v.durationMin) || undefined} />
              </Field>
            </div>
            {ctx.loyalty ? (
              <div className="af-formgrid">
                <Field label={`${ctx.pontos} ao concluir`} error={state.fields.rewardPoints}>
                  <Input id="servico-pontos" name="rewardPoints" type="number" inputMode="numeric" min={0} max={100000} defaultValue={v.rewardPoints ?? '0'} />
                </Field>
                <Checkbox name="clubOnly" label={`Só para ${ctx.clube}`} defaultChecked={v.clubOnly === 'on'} />
              </div>
            ) : null}
            <Checkbox name="active" label="Disponível para marcar horário" defaultChecked={v.active === 'on'} />
          </>
        )
      }}
    </PainelForm>
  )
}

/** A lista de serviços: ordem por botões, folha para criar e editar, confirmação para arquivar. */
export function ServicosPainel({ servicos, arquivados, ctx }: { servicos: ServicoLinha[]; arquivados: boolean; ctx: Contexto }) {
  const [folha, setFolha] = useState<ServicoLinha | 'novo' | null>(null)
  const [arquivando, setArquivando] = useState<ServicoLinha | null>(null)
  const fechar = () => setFolha(null)

  const colunas: DataColumn<ServicoLinha>[] = [
    {
      key: 'servico',
      header: 'Serviço',
      primary: true,
      cell: (s) => (
        <span className="af-service">
          <span className="af-service__icon">
            <ServiceIcon name={s.icon} />
          </span>
          <span className="af-service__text">
            <span className="af-service__name">{s.name}</span>
            {s.description ? <span className="af-service__desc">{s.description}</span> : null}
          </span>
        </span>
      ),
    },
    { key: 'preco', header: 'Preço', nowrap: true, align: 'end', cell: (s) => <span className="af-tabular">{formatMoney(s.priceCents)}</span> },
    { key: 'duracao', header: 'Duração', nowrap: true, cell: (s) => <span className="af-tabular">{formatDuration(s.durationMin)}</span> },
    ...(ctx.loyalty
      ? ([
          { key: 'pontos', header: ctx.pontos, nowrap: true, align: 'end', cell: (s) => <span className="af-tabular">{formatInt(s.rewardPoints)}</span> },
          { key: 'clube', header: ctx.clube, nowrap: true, cell: (s) => (s.clubOnly ? 'Só para o clube' : 'Todos') },
        ] satisfies DataColumn<ServicoLinha>[])
      : []),
    {
      key: 'situacao',
      header: 'Situação',
      nowrap: true,
      cell: (s) => (s.archived ? <StatusDot tone="neutral" label="Arquivado" /> : s.active ? <StatusDot tone="success" label="Disponível" /> : <StatusDot tone="warning" label="Fora de uso" detail="Não aparece para marcar" />),
    },
    {
      key: 'acoes',
      header: <span className="af-sr">Ações</span>,
      cell: (s) =>
        s.archived ? (
          <span className="af-rowactions">
            <AcaoDeLinha action={restaurarServico} campos={{ id: s.id }} icon={<ArchiveRestore size={16} />} ariaLabel={`Restaurar ${s.name}`}>
              Restaurar
            </AcaoDeLinha>
          </span>
        ) : (
          <span className="af-rowactions">
            <AcaoDeLinha action={moverServico} campos={{ id: s.id, direction: 'up' }} icon={<ArrowUp size={16} />} disabled={s.first} ariaLabel={`Subir ${s.name}`} />
            <AcaoDeLinha action={moverServico} campos={{ id: s.id, direction: 'down' }} icon={<ArrowDown size={16} />} disabled={s.last} ariaLabel={`Descer ${s.name}`} />
            <Button size="sm" variant="secondary" icon={<Pencil size={16} />} onClick={() => setFolha(s)} aria-label={`Editar ${s.name}`}>
              Editar
            </Button>
            <Button size="sm" variant="ghost" icon={<Archive size={16} />} onClick={() => setArquivando(s)} aria-label={`Arquivar ${s.name}`}>
              Arquivar
            </Button>
          </span>
        ),
    },
  ]

  const vazio = arquivados ? (
    <EmptyState title="Nenhum serviço arquivado" description="Quando você arquivar um serviço, ele fica aqui e pode voltar para a lista." />
  ) : (
    <EmptyState
      title="Cadastre o primeiro serviço"
      description="Com ao menos um serviço, seus clientes já podem marcar horário."
      action={
        <Button variant="primary" icon={<Plus size={18} />} onClick={() => setFolha('novo')}>
          Criar serviço
        </Button>
      }
    />
  )

  return (
    <>
      <div className="af-toolbar">
        <NavTabs
          label="Situação dos serviços"
          items={[
            { id: 'em-uso', label: 'Em uso', href: '/painel/servicos', active: !arquivados },
            { id: 'arquivados', label: 'Arquivados', href: '/painel/servicos?situacao=arquivados', active: arquivados },
          ]}
        />
        {arquivados ? null : (
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setFolha('novo')}>
            Novo serviço
          </Button>
        )}
      </div>
      <DataList label="Serviços" columns={colunas} rows={servicos} rowKey={(s) => s.id} empty={vazio} stack="lg" />
      <Sheet open={folha !== null} onClose={fechar} title={folha === 'novo' ? 'Novo serviço' : folha ? `Editar ${folha.name}` : ''}>
        {folha !== null ? <ServicoForm servico={folha === 'novo' ? null : folha} ctx={ctx} onDone={fechar} /> : null}
      </Sheet>
      <ConfirmDialog
        open={arquivando !== null}
        onClose={() => setArquivando(null)}
        title={arquivando ? `Arquivar ${arquivando.name}?` : ''}
        description="O serviço sai da lista e deixa de aparecer para marcar horário. Os atendimentos já feitos continuam no histórico, e você pode restaurá-lo depois."
        confirmLabel="Arquivar serviço"
        initialState={{ ok: false, message: null, fields: {} }}
        hidden={{ id: arquivando?.id ?? '' }}
        action={async (prev, fd) => {
          const r = await arquivarServico(prev as EstadoPainel, fd)
          if (r.ok) setArquivando(null)
          return r
        }}
      />
    </>
  )
}
