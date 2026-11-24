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
import type { PricingMode } from '@/server/db/generated/client'
import { NICHES } from '@/server/niches'
import { ServicoPrecos } from './ServicoPrecos'
import type { LinhaPreco } from './ServicoPrecos'
import { arquivarServico, criarServico, editarServico, moverServico, restaurarServico } from './actions'

export type ServicoLinha = {
  id: string
  name: string
  description: string | null
  icon: string
  priceCents: number
  durationMin: number
  pricingMode: PricingMode
  /** Linhas por porte (a equipe vê todas, inclusive a de gato escondida). */
  prices: LinhaPreco[]
  /** "Por porte · a partir de R$ 50,00" e "4 portes": só em preço por porte. */
  fromLabel: string | null
  linesLabel: string | null
  fromDurationMin: number | null
  rewardPoints: number
  clubOnly: boolean
  active: boolean
  archived: boolean
  first: boolean
  last: boolean
}

type Contexto = { step: number; loyalty: boolean; pontos: string; clube: string; niche: { servesCats: boolean } | null }

const ROTULOS: Record<string, string> = {
  name: 'Nome',
  description: 'Descrição',
  icon: 'Ícone',
  price: 'Preço',
  durationMin: 'Duração',
  rewardPoints: 'Pontos',
  clubOnly: 'Só para o clube',
  pricingMode: 'Tipo de preço',
  variantPrices: 'Preços por porte',
}
const ANCORAS: Record<string, string> = { name: 'servico-nome', description: 'servico-descricao', price: 'servico-preco', durationMin: 'servico-duracao', rewardPoints: 'servico-pontos', variantPrices: 'servico-precos' }

const ROTULOS_DE_PORTE: Record<string, string> = Object.fromEntries(
  NICHES.PET.variants.flatMap((d) => [
    [`v_${d.key}_price`, `Preço (${d.shortLabel})`],
    [`v_${d.key}_duration`, `Duração (${d.shortLabel})`],
  ]),
)

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
          pricingMode: servico.pricingMode,
          rewardPoints: String(servico.rewardPoints),
          clubOnly: servico.clubOnly ? 'on' : '',
          active: servico.active ? 'on' : '',
        }
      : { icon: 'sparkles', price: '', durationMin: String(ctx.step * Math.max(1, Math.round(30 / ctx.step))), pricingMode: 'SINGLE', rewardPoints: '0', active: 'on' },
  }
  return (
    <PainelForm
      action={servico ? editarServico : criarServico}
      initial={inicial}
      submit={servico ? 'Salvar serviço' : 'Criar serviço'}
      onDone={onDone}
      labels={{ ...ROTULOS, ...ROTULOS_DE_PORTE }}
      anchors={ANCORAS}
    >
      {(state) => <ServicoCampos servico={servico} ctx={ctx} state={state} />}
    </PainelForm>
  )
}

function ServicoCampos({ servico, ctx, state }: { servico: ServicoLinha | null; ctx: Contexto; state: EstadoPainel }) {
  const v = state.values
  const [modo, setModo] = useState<PricingMode>(ctx.niche === null ? 'SINGLE' : v.pricingMode === 'BY_VARIANT' ? 'BY_VARIANT' : 'SINGLE')
  const porPorte = modo === 'BY_VARIANT'
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

      {ctx.niche ? (
        <fieldset className="af-chips__set">
          <legend className="af-field__label">Tipo de preço</legend>
          <div className="af-chips">
            <label className="af-chip">
              <input type="radio" name="pricingMode" value="SINGLE" checked={!porPorte} onChange={() => setModo('SINGLE')} className="af-chip__input" />
              Preço único
            </label>
            <label className="af-chip">
              <input type="radio" name="pricingMode" value="BY_VARIANT" checked={porPorte} onChange={() => setModo('BY_VARIANT')} className="af-chip__input" />
              Por animal e porte
            </label>
          </div>
          {state.fields.pricingMode ? <p className="af-field__error">{state.fields.pricingMode}</p> : null}
          {!porPorte && servico?.pricingMode === 'BY_VARIANT' ? (
            <p role="status" className="af-wizard__note">
              Ao salvar, os preços por porte serão apagados.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {porPorte && ctx.niche ? (
        <>
          <ServicoPrecos servesCats={ctx.niche.servesCats} step={ctx.step} prices={servico?.prices ?? []} valores={v} erros={state.fields} novo={servico === null || servico.pricingMode === 'SINGLE'} />
          {state.fields.variantPrices ? (
            <p role="alert" className="af-field__error">
              {state.fields.variantPrices}
            </p>
          ) : null}
        </>
      ) : (
        <div className="af-formgrid">
          <Field label="Preço (R$)" error={state.fields.price}>
            <MoneyField id="servico-preco" name="price" defaultValue={v.price ?? ''} />
          </Field>
          <Field label="Duração" hint={`Em múltiplos de ${ctx.step} minutos, a grade da agenda.`} error={state.fields.durationMin}>
            <DurationField id="servico-duracao" name="durationMin" stepMin={ctx.step} value={Number(v.durationMin) || undefined} />
          </Field>
        </div>
      )}
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
    {
      key: 'preco',
      header: 'Preço',
      nowrap: true,
      align: 'end',
      cell: (s) =>
        s.fromLabel ? (
          <span className="af-service__text">
            <span className="af-tabular">{s.fromLabel}</span>
            {s.linesLabel ? <span className="af-service__desc">{s.linesLabel}</span> : null}
          </span>
        ) : (
          <span className="af-tabular">{formatMoney(s.priceCents)}</span>
        ),
    },
    {
      key: 'duracao',
      header: 'Duração',
      nowrap: true,
      cell: (s) => <span className="af-tabular">{s.fromDurationMin !== null ? `A partir de ${formatDuration(s.fromDurationMin)}` : formatDuration(s.durationMin)}</span>,
    },
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
