import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { requestInfo } from './request-info'
import { env } from '@/server/env'
import type { Actor, TenantContext } from './actor'
import { can, type Capability } from './capabilities'
import { getMemberSession, getTenantContext, type MemberSession } from './member-auth'
import { getPlatformActor } from './platform-auth'

export const DEV_COOKIE = 'af_dev_session'
export const PAINEL_COOKIE = 'af_painel_session'
export const BRAND_COOKIE = 'af_brand'

const UM_ANO_S = 365 * 24 * 60 * 60

// Sem atributo Domain: cada cookie fica preso ao host que o gravou (dev. ou painel.).
function opcoes(extra: { expires?: Date; maxAge?: number }) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/',
    ...extra,
  }
}

export async function setSessionCookie(name: typeof DEV_COOKIE | typeof PAINEL_COOKIE, token: string, expiresAt: Date): Promise<void> {
  ;(await cookies()).set(name, token, opcoes({ expires: expiresAt }))
}

export async function clearSessionCookie(name: typeof DEV_COOKIE | typeof PAINEL_COOKIE): Promise<void> {
  ;(await cookies()).set(name, '', opcoes({ maxAge: 0 }))
}

export async function setBrandCookie(slug: string): Promise<void> {
  ;(await cookies()).set(BRAND_COOKIE, slug, opcoes({ maxAge: UM_ANO_S }))
}

export async function readCookie(name: string): Promise<string | undefined> {
  return (await cookies()).get(name)?.value
}

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

const lerAdmin = cache((token: string | undefined) => getPlatformActor(token))
const lerSessao = cache((token: string | undefined) => getMemberSession(token))
const lerContexto = cache((token: string | undefined) => getTenantContext(token))

/** Administrador da plataforma da sessão do painel dev. Sem sessão válida, vai para a entrada. */
export async function requirePlatformAdmin(): Promise<PlatformAdminActor> {
  const actor = await lerAdmin(await readCookie(DEV_COOKIE))
  if (!actor) redirect('/entrar')
  return actor
}

/** Sessão do painel do negócio, sem exigir conta ativa (usada pela escolha de conta). */
export async function requireMemberSession(): Promise<MemberSession> {
  const session = await lerSessao(await readCookie(PAINEL_COOKIE))
  if (!session) redirect('/entrar')
  return session
}

/**
 * Contexto da conta ativa da sessão. Sem sessão válida vai para a entrada; sem conta ativa, para a
 * escolha de conta; sem a capacidade pedida, é 404 (a rota não existe para quem não pode usá-la).
 */
export async function requireTenant(capability?: Capability): Promise<TenantContext> {
  const token = await readCookie(PAINEL_COOKIE)
  const session = await requireMemberSession()
  if (!session.activeBusinessId) redirect('/escolher-conta')
  const ctx = await lerContexto(token)
  if (!ctx) redirect('/escolher-conta')
  if (capability && !can(ctx.actor, capability)) notFound()
  const info = await requestInfo()
  return { ...ctx, request: { ip: info.ip ?? null, userAgent: info.userAgent ?? null } }
}
