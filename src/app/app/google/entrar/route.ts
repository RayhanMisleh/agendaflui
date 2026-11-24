import { mesmaOrigem } from '@/app/_lib/upload-multipart'
import { beginGoogle, failureTarget } from '@/server/auth/google/callback'
import type { GoogleFailure } from '@/server/auth/google/callback'
import { GOOGLE_FLOW_COOKIE, FLOW_TTL_SEC } from '@/server/auth/google/flow'
import type { GoogleIntent } from '@/server/auth/google/flow'
import { readInvite } from '@/server/auth/invites'
import { requestInfo } from '@/server/auth/request-info'
import { findOpenStore } from '@/server/auth/store-join'
import { env } from '@/server/env'
import { safeReturnPath } from '@/shared/return-path'

const CABECALHOS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

const voltar = (intent: GoogleIntent, failure: GoogleFailure): Response =>
  new Response(null, { status: 303, headers: { ...CABECALHOS, Location: failureTarget(intent, failure) } })

function texto(form: FormData, nome: string, max: number): string {
  const v = form.get(nome)
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/**
 * Começa o "Continuar com Google". Só aceita formulário do próprio endereço (`Origin`). A intenção sai dos campos e vai
 * para o cookie assinado de fluxo (caminho `/google`, 10 minutos); a resposta é 303 para o Google.
 */
export async function POST(request: Request): Promise<Response> {
  if (!mesmaOrigem(request)) return new Response(null, { status: 403, headers: CABECALHOS })
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return new Response(null, { status: 400, headers: CABECALHOS })
  }
  const agora = new Date()
  const fluxo = texto(form, 'fluxo', 20)
  let intent: GoogleIntent
  switch (fluxo) {
    case 'loja': {
      const slug = texto(form, 'slug', 40)
      const back = safeReturnPath(slug, texto(form, 'volta', 300))
      intent = { kind: 'store_signup', slug: slug === '' ? '-' : slug, ...(back ? { back } : {}) }
      if ((await findOpenStore(slug)) === null) return voltar(intent, 'store_unavailable')
      break
    }
    case 'convite': {
      const token = texto(form, 'convite', 200)
      intent = { kind: 'invite', token: token === '' ? '-' : token }
      if ((await readInvite(token, agora)) === null) return voltar(intent, 'invite_invalid')
      break
    }
    case 'vincular':
      intent = { kind: 'link' }
      break
    default:
      intent = { kind: 'sign_in' }
  }
  const info = await requestInfo()
  const inicio = await beginGoogle(intent, info.ip, agora)
  if ('failure' in inicio) return voltar(intent, inicio.failure)
  const cookie = [`${GOOGLE_FLOW_COOKIE}=${inicio.cookie}`, 'Path=/google', `Max-Age=${FLOW_TTL_SEC}`, 'HttpOnly', 'SameSite=Lax', ...(env.NODE_ENV === 'production' ? ['Secure'] : [])].join('; ')
  return new Response(null, { status: 303, headers: { ...CABECALHOS, Location: inicio.url, 'Set-Cookie': cookie } })
}
