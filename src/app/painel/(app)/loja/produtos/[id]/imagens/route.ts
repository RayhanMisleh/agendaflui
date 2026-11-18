import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { addProductImage, moveProductImage, removeProductImage } from '@/server/domain/store/products'
import { CABECALHOS, MAX_ARQUIVO, lerCorpo, lerFormulario, mesmaOrigem, para } from '@/app/_lib/upload-multipart'

/**
 * Envia, sobe, desce ou remove uma imagem do produto (`intent` = `add` por padrão, `up`, `down` ou `remove`, com `imageId`
 * nos três últimos). Formulário POST multipart que funciona sem JavaScript e sempre volta à ficha com `?imagem=<código>`.
 * Só POST, só com sessão do painel, só do mesmo host; quem pode mexer nas imagens é decidido pelo domínio.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await requireTenant()
  const { id } = await params
  if (!mesmaOrigem(request)) return new Response(null, { status: 403, headers: CABECALHOS })
  const volta = (codigo: string) => para(`/loja/produtos/${encodeURIComponent(id)}?imagem=${codigo}`)
  const corpo = await lerCorpo(request)
  if (corpo === null) return volta('too_large')
  const form = await lerFormulario(request, corpo)
  if (form === null) return volta('no_file')
  const intent = form.get('intent')
  const imageId = form.get('imageId')
  try {
    if (intent === null || intent === 'add') {
      const arquivo = form.get('file')
      if (!(arquivo instanceof File) || arquivo.size === 0) return volta('no_file')
      if (arquivo.size > MAX_ARQUIVO) return volta('too_large')
      await addProductImage(ctx, id, { bytes: new Uint8Array(await arquivo.arrayBuffer()) })
    } else if (intent === 'remove' && typeof imageId === 'string') {
      await removeProductImage(ctx, id, imageId)
    } else if ((intent === 'up' || intent === 'down') && typeof imageId === 'string') {
      await moveProductImage(ctx, id, imageId, intent)
    } else {
      return volta('refused')
    }
    return volta('ok')
  } catch (err) {
    if (!(err instanceof DomainError)) throw err
    const codigo = err.code === 'not_found' ? 'not_found' : typeof err.details?.imageCode === 'string' ? err.details.imageCode : 'refused'
    return volta(codigo)
  }
}
