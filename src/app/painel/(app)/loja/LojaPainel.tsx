'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Archive, ArrowDown, ArrowUp, Package, Pencil } from 'lucide-react'
import { Button, Checkbox, ConfirmDialog, DataList, EmptyState, Field, Input, LinkButton, MaskedInput, Sheet, StatusDot, Textarea } from '@/ui/components'
import type { DataColumn } from '@/ui/components'
import { formatInt, formatMoney } from '@/ui/format'
import { AcaoDeLinha } from '../_lib/AcaoDeLinha'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { ajustarEstoque, arquivarCategoria, arquivarProduto, criarCategoria, moverCategoria, renomearCategoria, salvarConfiguracoes } from './actions'

export type ProdutoLinha = {
  id: string
  name: string
  imageUrl: string | null
  priceCents: number
  promoPriceCents: number | null
  finalPriceCents: number
  stock: number
  active: boolean
  archived: boolean
  categoryName: string | null
}

export type CategoriaLinha = { id: string; name: string; productCount: number; first: boolean; last: boolean }

export type ConfiguracoesDados = {
  version: number
  pickupEnabled: boolean
  pickupInstructions: string
  shippingEnabled: boolean
  originPostalCode: string
  weightGrams: number
  lengthCm: number
  heightCm: number
  widthCm: number
  paymentWindowMin: number
}

const SEM_ESTADO = { ok: false, message: null, fields: {} }

// ---------------------------------------------------------------- estoque

/** "Ajustar estoque": folha com a quantidade com sinal (entrada positiva, saída negativa) e o motivo. */
export function AjustarEstoque({ produto, variant = 'secondary' }: { produto: { id: string; name: string; stock: number }; variant?: 'secondary' | 'ghost' }) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <Button size="sm" variant={variant} icon={<Package size={16} />} onClick={() => setAberto(true)} aria-label={`Ajustar o estoque de ${produto.name}`}>
        Ajustar estoque
      </Button>
      <Sheet open={aberto} onClose={() => setAberto(false)} title={`Ajustar estoque de ${produto.name}`}>
        {aberto ? (
          <PainelForm action={ajustarEstoque} submit="Registrar ajuste" onDone={() => setAberto(false)} labels={{ delta: 'Quantidade', reason: 'Motivo' }} anchors={{ delta: `estoque-qtd-${produto.id}`, reason: `estoque-motivo-${produto.id}` }}>
            {(state) => (
              <>
                <input type="hidden" name="id" value={produto.id} />
                <p>
                  Estoque agora: <strong className="af-tabular">{formatInt(produto.stock)}</strong>. Use um número positivo para entrada e negativo para saída.
                </p>
                <Field label="Quantidade" hint="Por exemplo 10 para entrada ou -3 para saída." error={state.fields.delta}>
                  <Input id={`estoque-qtd-${produto.id}`} name="delta" inputMode="numeric" autoComplete="off" defaultValue={state.values.delta ?? ''} required />
                </Field>
                <Field label="Motivo" hint="Fica no registro do produto." error={state.fields.reason}>
                  <Input id={`estoque-motivo-${produto.id}`} name="reason" maxLength={200} autoComplete="off" defaultValue={state.values.reason ?? ''} required />
                </Field>
              </>
            )}
          </PainelForm>
        ) : null}
      </Sheet>
    </>
  )
}

// ---------------------------------------------------------------- produtos

export function ProdutosLista({ produtos, vazio }: { produtos: ProdutoLinha[]; vazio: React.ReactNode }) {
  const [arquivando, setArquivando] = useState<ProdutoLinha | null>(null)
  const colunas: DataColumn<ProdutoLinha>[] = [
    {
      key: 'produto',
      header: 'Produto',
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
            <Link href={`/loja/produtos/${p.id}`} className="af-service__name">
              {p.name}
            </Link>
            {p.categoryName ? <span className="af-service__desc">{p.categoryName}</span> : null}
          </span>
        </span>
      ),
    },
    {
      key: 'preco',
      header: 'Preço',
      nowrap: true,
      align: 'end',
      cell: (p) => (
        <span className="af-service__text">
          <span className="af-tabular">{formatMoney(p.finalPriceCents)}</span>
          {p.promoPriceCents !== null ? <span className="af-service__desc">Em promoção, de {formatMoney(p.priceCents)}</span> : null}
        </span>
      ),
    },
    {
      key: 'estoque',
      header: 'Estoque',
      nowrap: true,
      align: 'end',
      cell: (p) => (p.stock === 0 ? <StatusDot tone="danger" label="Acabou" /> : <span className="af-tabular">{formatInt(p.stock)}</span>),
    },
    {
      key: 'situacao',
      header: 'Situação',
      nowrap: true,
      cell: (p) => (p.archived ? <StatusDot tone="neutral" label="Arquivado" /> : p.active ? <StatusDot tone="success" label="À venda" /> : <StatusDot tone="warning" label="Fora de uso" detail="Não aparece no app" />),
    },
    {
      key: 'acoes',
      header: <span className="af-sr">Ações</span>,
      cell: (p) =>
        p.archived ? null : (
          <span className="af-rowactions">
            <LinkButton href={`/loja/produtos/${p.id}`} variant="secondary" size="sm" icon={<Pencil size={16} />} aria-label={`Editar ${p.name}`}>
              Editar
            </LinkButton>
            <AjustarEstoque produto={p} variant="ghost" />
            <Button size="sm" variant="ghost" icon={<Archive size={16} />} onClick={() => setArquivando(p)} aria-label={`Arquivar ${p.name}`}>
              Arquivar
            </Button>
          </span>
        ),
    },
  ]
  return (
    <>
      <DataList label="Produtos" columns={colunas} rows={produtos} rowKey={(p) => p.id} stack="lg" empty={vazio} />
      <ConfirmDialog
        open={arquivando !== null}
        onClose={() => setArquivando(null)}
        title={arquivando ? `Arquivar ${arquivando.name}?` : ''}
        description="O produto sai da lista e do app. Os pedidos já feitos continuam com o nome e o preço da compra."
        confirmLabel="Arquivar produto"
        initialState={SEM_ESTADO}
        hidden={{ id: arquivando?.id ?? '' }}
        action={async (prev, fd) => {
          const r = await arquivarProduto(prev as EstadoPainel, fd)
          if (r.ok) setArquivando(null)
          return r
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------- categorias

export function CategoriasLista({ categorias }: { categorias: CategoriaLinha[] }) {
  const [renomeando, setRenomeando] = useState<CategoriaLinha | null>(null)
  const [arquivando, setArquivando] = useState<CategoriaLinha | null>(null)
  const colunas: DataColumn<CategoriaLinha>[] = [
    { key: 'nome', header: 'Categoria', primary: true, cell: (c) => <span className="af-service__name">{c.name}</span> },
    { key: 'produtos', header: 'Produtos', nowrap: true, align: 'end', cell: (c) => <span className="af-tabular">{formatInt(c.productCount)}</span> },
    {
      key: 'acoes',
      header: <span className="af-sr">Ações</span>,
      cell: (c) => (
        <span className="af-rowactions">
          <AcaoDeLinha action={moverCategoria} campos={{ id: c.id, direction: 'up' }} icon={<ArrowUp size={16} />} disabled={c.first} ariaLabel={`Subir ${c.name}`} />
          <AcaoDeLinha action={moverCategoria} campos={{ id: c.id, direction: 'down' }} icon={<ArrowDown size={16} />} disabled={c.last} ariaLabel={`Descer ${c.name}`} />
          <Button size="sm" variant="secondary" icon={<Pencil size={16} />} onClick={() => setRenomeando(c)} aria-label={`Renomear ${c.name}`}>
            Renomear
          </Button>
          <Button size="sm" variant="ghost" icon={<Archive size={16} />} onClick={() => setArquivando(c)} aria-label={`Arquivar ${c.name}`}>
            Arquivar
          </Button>
        </span>
      ),
    },
  ]
  return (
    <>
      <PainelForm action={criarCategoria} submit="Criar categoria" labels={{ name: 'Nome' }} anchors={{ name: 'categoria-nova' }}>
        {(state) => (
          <Field label="Nova categoria" hint="Agrupa os produtos na vitrine do app." error={state.fields.name}>
            <Input id="categoria-nova" name="name" maxLength={60} autoComplete="off" defaultValue={state.ok ? '' : (state.values.name ?? '')} required />
          </Field>
        )}
      </PainelForm>
      <DataList
        label="Categorias"
        columns={colunas}
        rows={categorias}
        rowKey={(c) => c.id}
        stack="md"
        empty={<EmptyState title="Nenhuma categoria ainda" description="Com categorias, quem compra encontra os produtos mais rápido. Elas são opcionais." />}
      />
      <Sheet open={renomeando !== null} onClose={() => setRenomeando(null)} title={renomeando ? `Renomear ${renomeando.name}` : ''}>
        {renomeando ? (
          <PainelForm action={renomearCategoria} submit="Salvar nome" onDone={() => setRenomeando(null)} labels={{ name: 'Nome' }} anchors={{ name: 'categoria-nome' }}>
            {(state) => (
              <>
                <input type="hidden" name="id" value={renomeando.id} />
                <Field label="Nome da categoria" error={state.fields.name}>
                  <Input id="categoria-nome" name="name" maxLength={60} autoComplete="off" defaultValue={state.values.name ?? renomeando.name} required />
                </Field>
              </>
            )}
          </PainelForm>
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={arquivando !== null}
        onClose={() => setArquivando(null)}
        title={arquivando ? `Arquivar ${arquivando.name}?` : ''}
        description="A categoria sai da lista e do app, e os produtos dela deixam de aparecer ao app até você mudar a categoria deles. Nada é apagado."
        confirmLabel="Arquivar categoria"
        initialState={SEM_ESTADO}
        hidden={{ id: arquivando?.id ?? '' }}
        action={async (prev, fd) => {
          const r = await arquivarCategoria(prev as EstadoPainel, fd)
          if (r.ok) setArquivando(null)
          return r
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------- configurações

const ROTULOS_CONFIG = {
  pickupEnabled: 'Retirada no local',
  pickupInstructions: 'Instruções de retirada',
  shippingEnabled: 'Entrega',
  originPostalCode: 'CEP de origem',
  weightGrams: 'Peso padrão',
  lengthCm: 'Comprimento padrão',
  heightCm: 'Altura padrão',
  widthCm: 'Largura padrão',
  paymentWindowMin: 'Prazo para pagar',
}
const ANCORAS_CONFIG = {
  pickupEnabled: 'loja-retirada',
  pickupInstructions: 'loja-instrucoes',
  shippingEnabled: 'loja-entrega',
  originPostalCode: 'loja-cep',
  weightGrams: 'loja-peso',
  lengthCm: 'loja-comprimento',
  heightCm: 'loja-altura',
  widthCm: 'loja-largura',
  paymentWindowMin: 'loja-prazo',
}

export function ConfiguracoesForm({ dados, mercadoPago, frenet }: { dados: ConfiguracoesDados; mercadoPago: boolean; frenet: boolean }) {
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: {
      version: String(dados.version),
      pickupEnabled: dados.pickupEnabled ? 'on' : '',
      pickupInstructions: dados.pickupInstructions,
      shippingEnabled: dados.shippingEnabled ? 'on' : '',
      originPostalCode: dados.originPostalCode,
      weightGrams: String(dados.weightGrams),
      lengthCm: String(dados.lengthCm),
      heightCm: String(dados.heightCm),
      widthCm: String(dados.widthCm),
      paymentWindowMin: String(dados.paymentWindowMin),
    },
  }
  return (
    <PainelForm action={salvarConfiguracoes} initial={inicial} submit="Salvar configurações" labels={ROTULOS_CONFIG} anchors={ANCORAS_CONFIG}>
      {(state) => {
        const v = state.values
        return (
          <>
            <input type="hidden" name="version" value={String(dados.version)} />
            <h2 className="af-section__title">Retirada no local</h2>
            <Checkbox id="loja-retirada" name="pickupEnabled" label="O cliente pode retirar o pedido no local" defaultChecked={v.pickupEnabled === 'on'} />
            <Field label="Instruções de retirada" hint="Opcional. Aparece para o cliente: onde, em que horário e o que levar." error={state.fields.pickupInstructions}>
              <Textarea id="loja-instrucoes" name="pickupInstructions" rows={3} maxLength={300} defaultValue={v.pickupInstructions ?? ''} />
            </Field>
            <h2 className="af-section__title">Entrega pelos Correios e transportadoras</h2>
            <Checkbox id="loja-entrega" name="shippingEnabled" label="Entregar os pedidos na casa do cliente" defaultChecked={v.shippingEnabled === 'on'} />
            <Field label="CEP de origem" hint="De onde saem os pedidos. Obrigatório para ligar a entrega." error={state.fields.originPostalCode}>
              <MaskedInput mask="cep" id="loja-cep" name="originPostalCode" autoComplete="off" defaultValue={v.originPostalCode ?? ''} />
            </Field>
            <p className="af-section__help">Pacote padrão: vale para os produtos que não têm medidas próprias.</p>
            <div className="af-formgrid">
              <Field label="Peso (g)" error={state.fields.weightGrams}>
                <Input id="loja-peso" name="weightGrams" inputMode="numeric" defaultValue={v.weightGrams ?? ''} required />
              </Field>
              <Field label="Comprimento (cm)" error={state.fields.lengthCm}>
                <Input id="loja-comprimento" name="lengthCm" inputMode="numeric" defaultValue={v.lengthCm ?? ''} required />
              </Field>
              <Field label="Altura (cm)" error={state.fields.heightCm}>
                <Input id="loja-altura" name="heightCm" inputMode="numeric" defaultValue={v.heightCm ?? ''} required />
              </Field>
              <Field label="Largura (cm)" error={state.fields.widthCm}>
                <Input id="loja-largura" name="widthCm" inputMode="numeric" defaultValue={v.widthCm ?? ''} required />
              </Field>
            </div>
            <h2 className="af-section__title">Pagamento</h2>
            <Field label="Prazo para pagar (minutos)" hint="Passado o prazo, o pedido vence e o estoque volta. De 30 a 1.440 minutos (o Pix exige pelo menos 30)." error={state.fields.paymentWindowMin}>
              <Input id="loja-prazo" name="paymentWindowMin" inputMode="numeric" defaultValue={v.paymentWindowMin ?? ''} required />
            </Field>
            <h2 className="af-section__title">Integrações</h2>
            <p className="af-section__help">Só o suporte do AgendaFlui liga as integrações.</p>
            <StatusDot tone={mercadoPago ? 'success' : 'warning'} label={`Pagamento pelo Mercado Pago: ${mercadoPago ? 'configurado' : 'não configurado'}`} {...(mercadoPago ? {} : { detail: 'Peça ao suporte do AgendaFlui.' })} />
            <StatusDot tone={frenet ? 'success' : 'warning'} label={`Cálculo de frete pela Frenet: ${frenet ? 'configurado' : 'não configurado'}`} {...(frenet ? {} : { detail: 'Peça ao suporte do AgendaFlui.' })} />
          </>
        )
      }}
    </PainelForm>
  )
}
