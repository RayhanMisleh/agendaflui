import 'server-only'
import { createHash, hkdfSync, randomBytes } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'
import { areaLink } from '@/server/area-links'
import { CALENDAR_SCOPE } from '@/server/calendar/event'
import { z } from '@/server/domain/errors'
import { env } from '@/server/env'
import { safeReturnPath } from '@/shared/return-path'
import { integrations } from '@/server/integrations'
import { googleClient } from './config'

/*
 * O fluxo do "Entrar com Google" (OpenID Connect, código + PKCE). O que precisa sobreviver à ida ao Google (state, nonce,
 * verifier do PKCE e a INTENÇÃO: entrar, cadastrar na loja X, aceitar o convite T, vincular) vai num cookie curto assinado
 * (JWT HS256, chave derivada do APP_SECRET), httpOnly e só do caminho /google. A URL que vai ao Google leva só o que o
 * Google precisa; a intenção nunca vai nela.
 */

export const GOOGLE_FLOW_COOKIE = 'af_google'
export const FLOW_TTL_SEC = 600

/** `calendar` liga o Google Agenda (escopo `calendar.events`, acesso offline) para a pessoa da sessão. Intenção desconhecida não passa. */
export type GoogleIntent =
  | { kind: 'sign_in' }
  /** `back`: caminho da própria loja para onde seguir depois de entrar (já validado por `safeReturnPath`; inválido = ausente). */
  | { kind: 'store_signup'; slug: string; back?: string }
  | { kind: 'invite'; token: string }
  | { kind: 'link' }
  | { kind: 'calendar' }

export type GoogleFlow = { v: 1; state: string; nonce: string; verifier: string; intent: GoogleIntent }

const intentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sign_in') }),
  z.object({ kind: z.literal('store_signup'), slug: z.string().min(1).max(40), back: z.string().max(300).optional() }),
  z.object({ kind: z.literal('invite'), token: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('link') }),
  z.object({ kind: z.literal('calendar') }),
])

const flowSchema = z.object({
  v: z.literal(1),
  state: z.string().min(16).max(100),
  nonce: z.string().min(16).max(100),
  verifier: z.string().min(43).max(128),
  intent: intentSchema,
})

/** `back` fora do formato (ou de outra loja) é descartado: a intenção segue sem ele. */
function cleanIntent(intent: GoogleIntent): GoogleIntent {
  if (intent.kind !== 'store_signup') return intent
  const back = safeReturnPath(intent.slug, intent.back)
  return back === null ? { kind: 'store_signup', slug: intent.slug } : { kind: 'store_signup', slug: intent.slug, back }
}

let chave: Uint8Array | undefined
function flowKey(): Uint8Array {
  chave ??= new Uint8Array(hkdfSync('sha256', env.APP_SECRET, '', 'agendaflui/google-flow/v1', 32))
  return chave
}

const aleatorio = (): string => randomBytes(32).toString('base64url')
const epoch = (d: Date): number => Math.floor(d.getTime() / 1000)

export function googleRedirectUri(): string {
  return areaLink('app', '/google/retorno')
}

/**
 * Começa o fluxo: devolve o endereço do Google e o valor do cookie de fluxo, ou `null` quando não há chaves (regra 11).
 */
export async function startGoogleFlow(
  intent: GoogleIntent,
  now: Date,
  o: { loginHint?: string } = {},
): Promise<{ url: string; cookie: string } | null> {
  const client = await googleClient()
  if (client === null) return null
  const flow: GoogleFlow = { v: 1, state: aleatorio(), nonce: aleatorio(), verifier: aleatorio(), intent: cleanIntent(intentSchema.parse(intent)) }
  const cookie = await new SignJWT({ ...flow })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(epoch(now))
    .setExpirationTime(epoch(now) + FLOW_TTL_SEC)
    .sign(flowKey())
  const url = new URL(integrations().google.authorizationEndpoint())
  const p = url.searchParams
  p.set('response_type', 'code')
  p.set('client_id', client.clientId)
  p.set('redirect_uri', googleRedirectUri())
  const agenda = flow.intent.kind === 'calendar'
  p.set('scope', agenda ? `openid email ${CALENDAR_SCOPE}` : 'openid email profile')
  p.set('state', flow.state)
  p.set('nonce', flow.nonce)
  p.set('code_challenge', createHash('sha256').update(flow.verifier).digest('base64url'))
  p.set('code_challenge_method', 'S256')
  if (agenda) {
    // Autorização incremental com acesso offline; `consent` faz o Google devolver sempre o token de renovação.
    p.set('access_type', 'offline')
    p.set('include_granted_scopes', 'true')
    p.set('prompt', 'consent')
    if (o.loginHint !== undefined && o.loginHint !== '') p.set('login_hint', o.loginHint)
  } else {
    p.set('prompt', 'select_account')
  }
  return { url: url.toString(), cookie }
}

/** Lê o cookie de fluxo: assinatura, validade (10 min), versão e intenção. Qualquer defeito: `null`. */
export async function readGoogleFlow(cookie: string | undefined, now: Date): Promise<GoogleFlow | null> {
  if (!cookie) return null
  try {
    const { payload } = await jwtVerify(cookie, flowKey(), { algorithms: ['HS256'], currentDate: now, requiredClaims: ['exp'] })
    const lido = flowSchema.safeParse(payload)
    return lido.success ? { ...lido.data, intent: cleanIntent(lido.data.intent) } : null
  } catch {
    return null
  }
}
