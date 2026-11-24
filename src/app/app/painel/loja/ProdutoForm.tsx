'use client'
import { Checkbox, Field, Input, MoneyField, Select, Textarea } from '@/ui/components'
import { formatMoneyInput } from '@/ui/money'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { criarProduto, salvarProduto } from './actions'

const ROTULOS = {
  name: 'Nome',
  description: 'Descrição',
  price: 'Preço',
  promoPrice: 'Preço promocional',
  stock: 'Estoque',
  categoryId: 'Categoria',
  weightGrams: 'Peso',
  lengthCm: 'Comprimento',
  heightCm: 'Altura',
  widthCm: 'Largura',
}
const ANCORAS = {
  name: 'produto-nome',
  description: 'produto-descricao',
  price: 'produto-preco',
  promoPrice: 'produto-promo',
  stock: 'produto-estoque',
  categoryId: 'produto-categoria',
  weightGrams: 'produto-peso',
  lengthCm: 'produto-comprimento',
  heightCm: 'produto-altura',
  widthCm: 'produto-largura',
}

export type ProdutoDados = {
  id: string
  name: string
  description: string
  priceCents: number
  promoPriceCents: number | null
  categoryId: string
  weightGrams: number | null
  lengthCm: number | null
  heightCm: number | null
  widthCm: number | null
  active: boolean
}

const texto = (n: number | null) => (n === null ? '' : String(n))

/**
 * O formulário do produto: cria (sem `produto`, com o estoque inicial) ou edita. Na edição o estoque não está aqui: muda por
 * "Ajustar estoque", que não desfaz uma venda feita enquanto o formulário estava aberto. Quem cria vai para a ficha, onde envia as imagens.
 */
export function ProdutoForm({ produto, categorias }: { produto: ProdutoDados | null; categorias: { id: string; name: string }[] }) {
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: produto
      ? {
          id: produto.id,
          name: produto.name,
          description: produto.description,
          price: formatMoneyInput(produto.priceCents),
          promoPrice: produto.promoPriceCents === null ? '' : formatMoneyInput(produto.promoPriceCents),
          categoryId: produto.categoryId,
          weightGrams: texto(produto.weightGrams),
          lengthCm: texto(produto.lengthCm),
          heightCm: texto(produto.heightCm),
          widthCm: texto(produto.widthCm),
          active: produto.active ? 'on' : '',
        }
      : { active: 'on', stock: '0' },
  }
  return (
    <PainelForm action={produto ? salvarProduto : criarProduto} initial={inicial} submit={produto ? 'Salvar produto' : 'Criar produto'} labels={ROTULOS} anchors={ANCORAS}>
      {(state) => {
        const v = state.values
        return (
          <>
            {produto ? <input type="hidden" name="id" value={produto.id} /> : null}
            <Field label="Nome do produto" error={state.fields.name}>
              <Input id="produto-nome" name="name" defaultValue={v.name ?? ''} maxLength={120} autoComplete="off" required />
            </Field>
            <Field label="Descrição" hint="Opcional. Aparece para quem vai comprar." error={state.fields.description}>
              <Textarea id="produto-descricao" name="description" rows={3} maxLength={1000} defaultValue={v.description ?? ''} />
            </Field>
            <div className="af-formgrid">
              <Field label="Preço (R$)" error={state.fields.price}>
                <MoneyField id="produto-preco" name="price" defaultValue={v.price ?? ''} required />
              </Field>
              <Field label="Preço promocional (R$)" hint="Opcional. Precisa ser menor que o preço." error={state.fields.promoPrice}>
                <MoneyField id="produto-promo" name="promoPrice" defaultValue={v.promoPrice ?? ''} />
              </Field>
            </div>
            <div className="af-formgrid">
              {produto ? null : (
                <Field label="Estoque inicial" hint="Unidades que você tem agora." error={state.fields.stock}>
                  <Input id="produto-estoque" name="stock" inputMode="numeric" defaultValue={v.stock ?? '0'} required />
                </Field>
              )}
              <Field label="Categoria" hint="Opcional." error={state.fields.categoryId}>
                <Select id="produto-categoria" name="categoryId" defaultValue={v.categoryId ?? ''}>
                  <option value="">Sem categoria</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <details className="af-fold" open={Object.keys(state.fields).some((k) => ['weightGrams', 'lengthCm', 'heightCm', 'widthCm'].includes(k)) || undefined}>
              <summary>Entrega</summary>
              <div className="af-fold__body">
                <p className="af-field__hint">Medidas do produto embalado, para calcular o frete. Em branco, vale o pacote padrão da loja.</p>
                <div className="af-formgrid">
                  <Field label="Peso (g)" error={state.fields.weightGrams}>
                    <Input id="produto-peso" name="weightGrams" inputMode="numeric" defaultValue={v.weightGrams ?? ''} />
                  </Field>
                  <Field label="Comprimento (cm)" error={state.fields.lengthCm}>
                    <Input id="produto-comprimento" name="lengthCm" inputMode="numeric" defaultValue={v.lengthCm ?? ''} />
                  </Field>
                  <Field label="Altura (cm)" error={state.fields.heightCm}>
                    <Input id="produto-altura" name="heightCm" inputMode="numeric" defaultValue={v.heightCm ?? ''} />
                  </Field>
                  <Field label="Largura (cm)" error={state.fields.widthCm}>
                    <Input id="produto-largura" name="widthCm" inputMode="numeric" defaultValue={v.widthCm ?? ''} />
                  </Field>
                </div>
              </div>
            </details>
            <Checkbox name="active" label="À venda no app" defaultChecked={v.active === 'on'} />
          </>
        )
      }}
    </PainelForm>
  )
}
