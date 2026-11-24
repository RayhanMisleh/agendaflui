import 'server-only'
import type { TenantContext } from '@/server/auth/actor'
import { DomainError } from '@/server/domain/errors'
import { CABECALHOS, MAX_ARQUIVO, lerCorpo, lerFormulario, mesmaOrigem, para } from '@/app/_lib/upload-multipart'

/** Texto de cada código que a rota de envio põe em `?imagem=` ao voltar para a tela. */
export const MENSAGENS_DE_IMAGEM: Record<string, { texto: string; ok: boolean }> = {
  ok: { texto: 'Imagem atualizada.', ok: true },
  no_file: { texto: 'Escolha uma imagem antes de enviar.', ok: false },
  too_large: { texto: 'A imagem passa de 8 MB. Escolha um arquivo menor.', ok: false },
  not_an_image: { texto: 'Este arquivo não é uma imagem. Envie JPEG, PNG ou WebP.', ok: false },
  unsupported_format: { texto: 'Este formato não é aceito. Envie JPEG, PNG ou WebP.', ok: false },
  too_many_pixels: { texto: 'A imagem é grande demais. Reduza e envie de novo.', ok: false },
  too_small: { texto: 'A imagem é pequena demais. Escolha uma com pelo menos 400 pixels no lado menor.', ok: false },
  too_many_images: { texto: 'O produto já tem 6 imagens. Remova uma antes de enviar outra.', ok: false },
  refused: { texto: 'Você não pode trocar esta imagem agora.', ok: false },
  not_found: { texto: 'Este registro não existe mais.', ok: false },
}

/**
 * Corpo comum das rotas de envio de imagem do painel do negócio. Formulário POST multipart que funciona sem JavaScript e
 * sempre volta à tela de origem com `?imagem=ok` ou `?imagem=<código>` (`volta` monta o endereço com o código). A rota
 * chama `requireTenant` ANTES e entrega o contexto; aqui a origem do formulário precisa ser este mesmo host (senão 403),
 * o corpo tem teto e `intent=remove` tira a imagem. Quem pode trocar a imagem é decidido pelo domínio em `salvar`.
 */
export async function receberImagem(
  ctx: TenantContext,
  request: Request,
  o: { volta: (codigo: string) => string; salvar: (file: { bytes: Uint8Array } | null) => Promise<unknown> },
): Promise<Response> {
  void ctx
  if (!mesmaOrigem(request)) return new Response(null, { status: 403, headers: CABECALHOS })
  const volta = (codigo: string) => para(o.volta(codigo))
  const corpo = await lerCorpo(request)
  if (corpo === null) return volta('too_large')
  const form = await lerFormulario(request, corpo)
  if (form === null) return volta('no_file')
  try {
    if (form.get('intent') === 'remove') {
      await o.salvar(null)
      return volta('ok')
    }
    const arquivo = form.get('file')
    if (!(arquivo instanceof File) || arquivo.size === 0) return volta('no_file')
    if (arquivo.size > MAX_ARQUIVO) return volta('too_large')
    await o.salvar({ bytes: new Uint8Array(await arquivo.arrayBuffer()) })
    return volta('ok')
  } catch (err) {
    if (!(err instanceof DomainError)) throw err
    const codigo = err.code === 'not_found' ? 'not_found' : typeof err.details?.imageCode === 'string' ? err.details.imageCode : 'refused'
    return volta(codigo)
  }
}
