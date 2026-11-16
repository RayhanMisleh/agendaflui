import { requirePlatformAdmin } from '@/server/auth/guards'
import { startSupport } from '@/server/auth/support-session'
import { DomainError } from '@/server/domain/errors'

// O endereço de saída leva o token de passagem: nada de cache e nada de mandar o endereço a outros sites.
const CABECALHOS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

function para(destino: string): Response {
  return new Response(null, { status: 303, headers: { ...CABECALHOS, Location: destino } })
}

/**
 * "Entrar como": formulário POST da página da conta, aberto em nova aba. Emite o link de passagem (60 s, uso único) e
 * redireciona para o painel da conta em modo suporte. Só POST (nunca um link GET com efeito colateral); a origem do
 * formulário precisa ser este mesmo host, para outro site não poder disparar a ação com a sessão do admin.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const admin = await requirePlatformAdmin()
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
  try {
    const { url } = await startSupport(admin, id)
    return para(url)
  } catch (err) {
    if (!(err instanceof DomainError)) throw err
    return para(`/contas/${encodeURIComponent(id)}?suporte=${err.code === 'business_unavailable' ? 'arquivada' : 'falhou'}`)
  }
}
