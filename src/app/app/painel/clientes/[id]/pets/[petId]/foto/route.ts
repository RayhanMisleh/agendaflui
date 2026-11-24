import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { setPetPhoto } from '@/server/domain/pets/photo'
import { CABECALHOS, MAX_ARQUIVO, lerCorpo, lerFormulario, mesmaOrigem, para } from '@/app/_lib/upload-multipart'

/**
 * Envia (ou, com `intent=remove`, remove) a foto de um pet. Formulário POST multipart que funciona sem JavaScript e
 * sempre volta à página do pet com `?foto=ok` ou `?foto=<código>`. Só POST, só com sessão do painel, e a origem do
 * formulário precisa ser este mesmo host. Quem pode trocar a foto é decidido pelo domínio (`manage_clients`).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; petId: string }> }): Promise<Response> {
  const ctx = await requireTenant()
  if (!mesmaOrigem(request)) return new Response(null, { status: 403, headers: CABECALHOS })

  const { id, petId } = await params
  const volta = (codigo: string) => para(`/painel/clientes/${encodeURIComponent(id)}/pets/${encodeURIComponent(petId)}?foto=${codigo}`)
  const corpo = await lerCorpo(request)
  if (corpo === null) return volta('too_large')
  const form = await lerFormulario(request, corpo)
  if (form === null) return volta('no_file')

  try {
    if (form.get('intent') === 'remove') {
      await setPetPhoto(ctx, petId, null)
      return volta('ok')
    }
    const arquivo = form.get('file')
    if (!(arquivo instanceof File) || arquivo.size === 0) return volta('no_file')
    if (arquivo.size > MAX_ARQUIVO) return volta('too_large')
    await setPetPhoto(ctx, petId, { bytes: new Uint8Array(await arquivo.arrayBuffer()) })
    return volta('ok')
  } catch (err) {
    if (!(err instanceof DomainError)) throw err
    const codigo = err.code === 'not_found' ? 'not_found' : typeof err.details?.imageCode === 'string' ? err.details.imageCode : 'refused'
    return volta(codigo)
  }
}
