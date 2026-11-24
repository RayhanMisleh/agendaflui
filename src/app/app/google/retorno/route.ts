import { GOOGLE_FLOW_COOKIE } from '@/server/auth/google/flow'
import { handleGoogleCallback } from '@/server/auth/google/callback'
import { APP_COOKIE, readCookie, setSessionCookie } from '@/server/auth/guards'
import { requestInfo } from '@/server/auth/request-info'
import { env } from '@/server/env'

// O endereço traz `code` e `state`: nada de cache nem de mandar a URL a outros sites.
const CABECALHOS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

/** Volta do Google: confere o fluxo, aplica as regras, grava a sessão (quando abre) e apaga o cookie de fluxo. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const info = await requestInfo()
  const resultado = await handleGoogleCallback({
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    error: url.searchParams.get('error'),
    flowCookie: await readCookie(GOOGLE_FLOW_COOKIE),
    sessionToken: await readCookie(APP_COOKIE),
    ...(info.ip ? { ip: info.ip } : {}),
    ...(info.userAgent ? { userAgent: info.userAgent } : {}),
    now: new Date(),
  })
  if (resultado.ok && resultado.session) await setSessionCookie(APP_COOKIE, resultado.session.token, resultado.session.expiresAt)
  const apagar = [`${GOOGLE_FLOW_COOKIE}=`, 'Path=/google', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax', ...(env.NODE_ENV === 'production' ? ['Secure'] : [])].join('; ')
  return new Response(null, { status: 303, headers: { ...CABECALHOS, Location: resultado.redirectTo, 'Set-Cookie': apagar } })
}
