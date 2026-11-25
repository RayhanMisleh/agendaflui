import { readStoreVisit } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { setPetPhoto } from '@/server/domain/pets/photo'
import { safeReturnPath } from '@/shared/return-path'
import { CABECALHOS, MAX_ARQUIVO, lerCorpo, lerFormulario, mesmaOrigem, para } from '@/app/_lib/upload-multipart'
import { atualizarLoja } from '../../../../_lib/revalidar'

/**
 * Envia (ou, com `intent=remove`, remove) a foto de um pet do cliente. Formulário POST multipart que funciona sem JavaScript
 * (volta à página de origem com `?foto=ok|<código>`) e, com `Accept: application/json`, responde `{ ok, code }` para o quiz.
 * Só POST, só de cliente ativo desta loja e só do mesmo host; o pet de outro cliente é "não encontrado".
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; petId: string }> }): Promise<Response> {
  if (!mesmaOrigem(request)) return new Response(null, { status: 403, headers: CABECALHOS })
  const { slug, petId } = await params
  const visit = await readStoreVisit(slug)
  if (visit.kind !== 'customer') return para(`/${slug}/entrar`)

  const json = (request.headers.get('accept') ?? '').includes('application/json')
  const corpo = await lerCorpo(request)
  const form = corpo === null ? null : await lerFormulario(request, corpo)
  const origem = form?.get('destino')
  const destino = safeReturnPath(slug, typeof origem === 'string' ? origem : null)?.split('?')[0] ?? `/${slug}/pets/${encodeURIComponent(petId)}`
  const responder = (code: string): Response =>
    json
      ? Response.json({ ok: code === 'ok', code }, { status: code === 'ok' ? 200 : 422, headers: CABECALHOS })
      : para(`${destino}?foto=${code}`)

  if (corpo === null) return responder('too_large')
  if (form === null) return responder('no_file')
  try {
    if (form.get('intent') === 'remove') {
      await setPetPhoto(visit.ctx, petId, null)
      atualizarLoja()
      return responder('ok')
    }
    const arquivo = form.get('foto') ?? form.get('file')
    if (!(arquivo instanceof File) || arquivo.size === 0) return responder('no_file')
    if (arquivo.size > MAX_ARQUIVO) return responder('too_large')
    await setPetPhoto(visit.ctx, petId, { bytes: new Uint8Array(await arquivo.arrayBuffer()) })
    atualizarLoja()
    return responder('ok')
  } catch (err) {
    if (!(err instanceof DomainError)) throw err
    return responder(err.code === 'not_found' ? 'not_found' : typeof err.details?.imageCode === 'string' ? err.details.imageCode : 'refused')
  }
}
