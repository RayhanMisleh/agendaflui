import { requireTenant } from '@/server/auth/guards'
import { setVoucherImage } from '@/server/domain/vouchers/vouchers'
import { receberImagem } from '../../../_lib/imagem'

/** Envia (ou, com `intent=remove`, remove) a imagem de um voucher. Só POST, só com sessão do painel. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await requireTenant()
  const { id } = await params
  return receberImagem(ctx, request, {
    volta: (codigo) => `/vouchers/${encodeURIComponent(id)}?imagem=${codigo}`,
    salvar: (file) => setVoucherImage(ctx, id, file),
  })
}
