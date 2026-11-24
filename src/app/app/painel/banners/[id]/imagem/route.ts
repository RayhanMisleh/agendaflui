import { requireTenant } from '@/server/auth/guards'
import { setBannerImage } from '@/server/domain/banners/banners'
import { receberImagem } from '../../../_lib/imagem'

/** Envia (ou, com `intent=remove`, remove) a imagem de um banner. Só POST, só com sessão do painel. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await requireTenant()
  const { id } = await params
  return receberImagem(ctx, request, {
    volta: (codigo) => `/painel/banners/${encodeURIComponent(id)}?imagem=${codigo}`,
    salvar: (file) => setBannerImage(ctx, id, file),
  })
}
