import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { listCategories } from '@/server/domain/store/categories'
import { Card, LinkButton } from '@/ui/components'
import { PainelFrame } from '../../../PainelFrame'
import { requirePainelModule } from '../../../_lib/modulo'
import { ProdutoForm } from '../../ProdutoForm'

export const metadata: Metadata = { title: 'Novo produto | Agenda Flui' }

export default async function NovoProdutoPage() {
  const ctx = await requireTenant('manage_store')
  await requirePainelModule(ctx, 'store')
  const categorias = await listCategories(ctx)
  return (
    <PainelFrame
      ctx={ctx}
      title="Novo produto"
      actions={
        <LinkButton href="/loja?aba=produtos" variant="ghost">
          Voltar para a loja
        </LinkButton>
      }
    >
      <Card as="section" aria-labelledby="produto-novo" className="af-profile af-profile--narrow">
        <h2 id="produto-novo" className="af-section__title">
          Dados do produto
        </h2>
        <p className="af-section__help">Depois de criar, você envia as imagens do produto.</p>
        <ProdutoForm produto={null} categorias={categorias.map((c) => ({ id: c.id, name: c.name }))} />
      </Card>
    </PainelFrame>
  )
}
