import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { CABECALHOS, MAX_ARQUIVO, lerCorpo, lerFormulario, mesmaOrigem, para } from '@/app/_lib/upload-multipart'
import { setProfessionalAvatar } from '@/server/domain/team/avatar'

/**
 * Envia (ou, com `intent=remove`, remove) a foto de um profissional. Formulário POST multipart que funciona sem
 * JavaScript e sempre volta à ficha com `?foto=ok` ou `?foto=<código>`. Só POST, só com sessão do painel, e a origem do
 * formulário precisa ser este mesmo host. Quem pode trocar a foto de quem é decidido pelo domínio (a equipe, qualquer
 * uma; o profissional, a própria). O envio tem rota própria para o limite de corpo maior valer só aqui.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await requireTenant()
  if (!mesmaOrigem(request)) return new Response(null, { status: 403, headers: CABECALHOS })

  const { id } = await params
  const volta = (codigo: string) => para(`/painel/equipe/${encodeURIComponent(id)}?foto=${codigo}`)
  const corpo = await lerCorpo(request)
  if (corpo === null) return volta('too_large')
  const form = await lerFormulario(request, corpo)
  if (form === null) return volta('no_file')

  try {
    if (form.get('intent') === 'remove') {
      await setProfessionalAvatar(ctx, id, null)
      return volta('ok')
    }
    const arquivo = form.get('file')
    if (!(arquivo instanceof File) || arquivo.size === 0) return volta('no_file')
    if (arquivo.size > MAX_ARQUIVO) return volta('too_large')
    await setProfessionalAvatar(ctx, id, { bytes: new Uint8Array(await arquivo.arrayBuffer()) })
    return volta('ok')
  } catch (err) {
    if (!(err instanceof DomainError)) throw err
    const codigo = err.code === 'not_found' ? 'not_found' : typeof err.details?.imageCode === 'string' ? err.details.imageCode : 'refused'
    return volta(codigo)
  }
}
