import { requireTenant } from '@/server/auth/guards'
import { setPrizeImage } from '@/server/domain/loyalty/prizes'
import { receberImagem } from '../../../../_lib/imagem'

/** Envia (ou, com `intent=remove`, remove) a imagem de um prêmio. Só POST, só com sessão do painel. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await requireTenant()
  const { id } = await params
  return receberImagem(ctx, request, {
    volta: (codigo) => `/painel/fidelidade/premios/${encodeURIComponent(id)}?imagem=${codigo}`,
    salvar: (file) => setPrizeImage(ctx, id, file),
  })
}
