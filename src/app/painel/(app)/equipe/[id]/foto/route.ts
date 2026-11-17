import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { setProfessionalAvatar } from '@/server/domain/team/avatar'

const CABECALHOS = { 'Cache-Control': 'no-store' }
/** Teto do arquivo, o mesmo do armazenamento de imagens (8 MiB), medido nos bytes reais. */
const MAX_ARQUIVO = 8 * 1024 * 1024
/** Folga para os campos e as divisórias do multipart em volta do arquivo. */
const MAX_CORPO = MAX_ARQUIVO + 64 * 1024

function para(destino: string): Response {
  return new Response(null, { status: 303, headers: { ...CABECALHOS, Location: destino } })
}

/** Lê o corpo até o teto: passou dele, para de ler (nada de guardar um corpo sem limite na memória). */
async function lerCorpo(request: Request): Promise<Uint8Array | null> {
  const declarado = Number(request.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > MAX_CORPO) return null
  if (!request.body) return new Uint8Array()
  const leitor = request.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_CORPO) {
      await leitor.cancel()
      return null
    }
    partes.push(value)
  }
  const corpo = new Uint8Array(total)
  let pos = 0
  for (const p of partes) {
    corpo.set(p, pos)
    pos += p.byteLength
  }
  return corpo
}

/**
 * Envia (ou, com `intent=remove`, remove) a foto de um profissional. Formulário POST multipart que funciona sem
 * JavaScript e sempre volta à ficha com `?foto=ok` ou `?foto=<código>`. Só POST, só com sessão do painel, e a origem do
 * formulário precisa ser este mesmo host. Quem pode trocar a foto de quem é decidido pelo domínio (a equipe, qualquer
 * uma; o profissional, a própria). O envio tem rota própria para o limite de corpo maior valer só aqui.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await requireTenant()
  const origem = request.headers.get('origin')
  const host = request.headers.get('host')
  let mesmoSite = false
  try {
    mesmoSite = origem !== null && host !== null && new URL(origem).host === host
  } catch {
    mesmoSite = false
  }
  if (!mesmoSite) return new Response(null, { status: 403, headers: CABECALHOS })

  const { id } = await params
  const volta = (codigo: string) => para(`/equipe/${encodeURIComponent(id)}?foto=${codigo}`)
  const corpo = await lerCorpo(request)
  if (corpo === null) return volta('too_large')
  let form: FormData
  try {
    form = await new Response(Buffer.from(corpo), { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData()
  } catch {
    return volta('no_file')
  }

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
