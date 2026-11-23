import { areaLink } from '@/server/area-links'
import { PAINEL_COOKIE, readCookie, setSessionCookie } from '@/server/auth/guards'
import { requestInfo } from '@/server/auth/request-info'
import { checkSupportLimit, redeemSupport } from '@/server/auth/support-session'
import { AuthError } from '@/server/auth/actor'

// O token de passagem está na URL: nada de guardar a resposta em cache nem de mandar o endereço a outros sites.
const CABECALHOS = { 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' }

/** Todo erro (token inválido, usado, vencido, limite, admin ou conta fora do ar) responde igual: 404 sem corpo. */
const naoEncontrado = (): Response => new Response(null, { status: 404, headers: CABECALHOS })

/**
 * Troca o token de passagem do "entrar como" por uma sessão de suporte do painel: define o cookie e vai para a página
 * inicial. A sessão que o navegador já tinha no cookie é revogada na troca.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params
  const agora = new Date()
  const info = await requestInfo()
  try {
    await checkSupportLimit(info.ip, token, agora)
  } catch (erro) {
    if (erro instanceof AuthError) return naoEncontrado()
    throw erro
  }
  const anterior = await readCookie(PAINEL_COOKIE)
  const sessao = await redeemSupport(
    token,
    { ...info, ...(anterior ? { previousToken: anterior } : {}) },
    agora,
  )
  if (!sessao) return naoEncontrado()
  await setSessionCookie(PAINEL_COOKIE, sessao.sessionToken, sessao.expiresAt)
  return new Response(null, { status: 303, headers: { ...CABECALHOS, Location: areaLink('app', '/painel') } })
}
