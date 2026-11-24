import 'server-only'
import type { TenantContext } from '@/server/auth/actor'
import { DomainError } from '@/server/domain/errors'
import { setBusinessLogo } from '@/server/domain/settings/business-profile'
import { CABECALHOS, MAX_ARQUIVO, lerCorpo, lerFormulario, mesmaOrigem, para } from '@/app/_lib/upload-multipart'

/**
 * Envia (ou, com `intent=remove`, remove) a logo da conta. Formulário POST multipart que funciona sem JavaScript e sempre
 * volta à tela de origem (`volta(codigo)`) com `ok` ou o código do erro. Só POST, só com sessão, e a origem precisa ser este
 * host. Quem pode trocar a logo é decidido pelo domínio (dono e suporte).
 */
export async function receberLogo(ctx: TenantContext, request: Request, volta: (codigo: string) => string): Promise<Response> {
  if (!mesmaOrigem(request)) return new Response(null, { status: 403, headers: CABECALHOS })
  const voltar = (codigo: string) => para(volta(codigo))
  const corpo = await lerCorpo(request)
  if (corpo === null) return voltar('too_large')
  const form = await lerFormulario(request, corpo)
  if (form === null) return voltar('no_file')
  try {
    if (form.get('intent') === 'remove') {
      await setBusinessLogo(ctx, null)
      return voltar('ok')
    }
    const arquivo = form.get('file')
    if (!(arquivo instanceof File) || arquivo.size === 0) return voltar('no_file')
    if (arquivo.size > MAX_ARQUIVO) return voltar('too_large')
    await setBusinessLogo(ctx, { bytes: new Uint8Array(await arquivo.arrayBuffer()) })
    return voltar('ok')
  } catch (err) {
    if (!(err instanceof DomainError)) throw err
    const codigo = err.code === 'forbidden' ? 'forbidden' : typeof err.details?.imageCode === 'string' ? err.details.imageCode : 'refused'
    return voltar(codigo)
  }
}
