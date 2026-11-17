import { requirePlatformAdmin } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { CABECALHOS, MAX_ARQUIVO, lerCorpo, lerFormulario, mesmaOrigem, para } from '@/app/_lib/upload-multipart'
import { setBrandImage } from '@/server/domain/platform/customization'
import type { BrandImageSlot } from '@/server/domain/platform/customization'

const SLOTS: readonly BrandImageSlot[] = ['logo', 'symbol', 'favicon', 'loginImage']

/**
 * Envia (ou, com `intent=remove`, remove) uma imagem da marca. É um formulário POST multipart que funciona sem
 * JavaScript, e sempre volta à aba Marca com `?imagem=ok` ou `?imagem=<código>`. Só POST; a origem do formulário precisa ser
 * este mesmo host. O envio de imagem tem rota própria para o limite de corpo maior valer só aqui, atrás da sessão de admin.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; slot: string }> }): Promise<Response> {
  const admin = await requirePlatformAdmin()
  if (!mesmaOrigem(request)) return new Response(null, { status: 403, headers: CABECALHOS })

  const { id, slot } = await params
  const volta = (codigo: string) => para(`/contas/${encodeURIComponent(id)}/marca?imagem=${codigo}`)
  const alvo = SLOTS.find((s) => s === slot)
  if (!alvo) return volta('invalid_slot')

  const corpo = await lerCorpo(request)
  if (corpo === null) return volta('too_large')
  const form = await lerFormulario(request, corpo)
  if (form === null) return volta('no_file')

  try {
    if (form.get('intent') === 'remove') {
      await setBrandImage(admin, id, alvo, null)
      return volta('ok')
    }
    const arquivo = form.get('file')
    if (!(arquivo instanceof File) || arquivo.size === 0) return volta('no_file')
    const bytes = new Uint8Array(await arquivo.arrayBuffer())
    if (bytes.byteLength > MAX_ARQUIVO) return volta('too_large')
    await setBrandImage(admin, id, alvo, { bytes, mime: arquivo.type })
    return volta('ok')
  } catch (err) {
    if (!(err instanceof DomainError)) throw err
    const codigo = err.code === 'not_found' ? 'not_found' : typeof err.details?.imageCode === 'string' ? err.details.imageCode : 'refused'
    return volta(codigo)
  }
}
