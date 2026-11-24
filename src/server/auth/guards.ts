import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { requestInfo } from './request-info'
import { env } from '@/server/env'
import type { Actor, TenantContext } from './actor'
import { can, type Capability } from './capabilities'
import { getPersonSession, getStaffContext, type PersonSession } from './session'
import { getPlatformActor } from './platform-auth'
import { resolveStoreVisit, type CustomerVisit, type StoreVisit } from './customer-access'

export const DEV_COOKIE = 'af_dev_session'
export const APP_COOKIE = 'af_session'

// Sem atributo Domain: cada cookie fica preso ao host que o gravou (dev. ou app.).
function opcoes(extra: { expires?: Date; maxAge?: number }) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/',
    ...extra,
  }
}

export async function setSessionCookie(name: typeof DEV_COOKIE | typeof APP_COOKIE, token: string, expiresAt: Date): Promise<void> {
  ;(await cookies()).set(name, token, opcoes({ expires: expiresAt }))
}

export async function clearSessionCookie(name: typeof DEV_COOKIE | typeof APP_COOKIE): Promise<void> {
  ;(await cookies()).set(name, '', opcoes({ maxAge: 0 }))
}

export async function readCookie(name: string): Promise<string | undefined> {
  return (await cookies()).get(name)?.value
}

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

const lerAdmin = cache((token: string | undefined) => getPlatformActor(token))
const lerSessao = cache((token: string | undefined) => getPersonSession(token))
const lerContexto = cache((token: string | undefined) => getStaffContext(token))

/** Administrador da plataforma da sessão do painel dev. Sem sessão válida, vai para a entrada. */
export async function requirePlatformAdmin(): Promise<PlatformAdminActor> {
  const actor = await lerAdmin(await readCookie(DEV_COOKIE))
  if (!actor) redirect('/entrar')
  return actor
}

/** Sessão da pessoa (ou do suporte), ou `null`. Não redireciona: para telas que decidem o que mostrar sem sessão. */
export async function readPersonSession(): Promise<PersonSession | null> {
  return lerSessao(await readCookie(APP_COOKIE))
}

/** Sessão de uma pessoa. Sem sessão vai para a entrada; o modo suporte (admin) não é pessoa e volta ao painel. */
export async function requirePerson(): Promise<Extract<PersonSession, { kind: 'person' }>> {
  const session = await readPersonSession()
  if (!session) redirect('/entrar')
  if (session.kind === 'support') redirect('/painel')
  return session
}

/**
 * Contexto da loja da equipe. Sem sessão vai para a entrada; pessoa que não é da equipe de nenhuma conta ativa vai para `/`
 * (que decide o destino dela); sem a capacidade pedida, é 404 (a rota não existe para quem não pode usá-la). O vínculo é
 * relido a cada chamada.
 */
export async function requireTenant(capability?: Capability): Promise<TenantContext> {
  const token = await readCookie(APP_COOKIE)
  const session = await lerSessao(token)
  if (!session) redirect('/entrar')
  const ctx = await lerContexto(token)
  if (!ctx) redirect('/')
  if (capability && !can(ctx.actor, capability)) notFound()
  const info = await requestInfo()
  return { ...ctx, request: { ip: info.ip ?? null, userAgent: info.userAgent ?? null } }
}

const lerVisita = cache((slug: string, token: string | undefined, ip: string | null, userAgent: string | null) =>
  resolveStoreVisit({ token, slug, request: { ip, userAgent } }),
)

/**
 * A visita à loja desta requisição: loja aberta, pessoa entrada e vínculo de cliente (`StoreVisit`). Lida uma vez por requisição
 * (uma ação é outra requisição, então relê o vínculo): nunca confia no slug nem na loja lembrada pela sessão.
 */
export async function readStoreVisit(slug: string): Promise<StoreVisit> {
  const info = await requestInfo()
  return lerVisita(slug, await readCookie(APP_COOKIE), info.ip ?? null, info.userAgent ?? null)
}

/**
 * Cliente ativo da loja `slug`, ou redireciona: loja indisponível → página da loja; sem sessão → entrar da loja; pessoa que
 * não é cliente (ou foi desativada) → página da loja, que explica e oferece "Usar minha conta". `here` é o caminho de volta.
 */
export async function requireCustomer(slug: string, here: string): Promise<CustomerVisit> {
  const visita = await readStoreVisit(slug)
  const volta = encodeURIComponent(here)
  switch (visita.kind) {
    case 'unavailable':
      return redirect(`/${slug}`)
    case 'anonymous':
      return redirect(`/${slug}/entrar?volta=${volta}`)
    case 'visitor':
      return redirect(`/${slug}?volta=${volta}`)
    case 'customer':
      return visita
  }
}
