import { requireTenant } from '@/server/auth/guards'
import { setPartnerLogo } from '@/server/domain/vouchers/partners'
import { receberImagem } from '../../../../_lib/imagem'

/** Envia (ou, com `intent=remove`, remove) o logo de um parceiro. Só POST, só com sessão do painel. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await requireTenant()
  const { id } = await params
  return receberImagem(ctx, request, {
    volta: (codigo) => `/vouchers/parceiros/${encodeURIComponent(id)}?imagem=${codigo}`,
    salvar: (file) => setPartnerLogo(ctx, id, file),
  })
}
