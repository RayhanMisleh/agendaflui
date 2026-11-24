import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { searchKey } from '@/server/domain/customers/contact'
import { isUniqueViolation } from '@/server/domain/errors'
import { integrations, IntegrationError } from '@/server/integrations'
import { ipLimitKeyPart } from '@/server/auth/client-ip'
import { customerLandingPath, resolveStoreVisit } from '@/server/auth/customer-access'
import { destinationForUser, destinationPath } from '@/server/auth/destination'
import { readInvite } from '@/server/auth/invites'
import { lockUserAccess, revokeUserAccess } from '@/server/auth/password-reset'
import { activatePerson, personState } from '@/server/auth/person'
import { hitRateLimit, LIMITS, limitKey } from '@/server/auth/rate-limit-db'
import { getPersonSession, openSession } from '@/server/auth/session'
import { findOpenStore, joinStoreIn } from '@/server/auth/store-join'
import type { StoreRef } from '@/server/auth/store-join'
import { googleClient } from './config'
import { decideGoogle } from './decide'
import type { GoogleDecision, GoogleFacts, GoogleRefusal, PersonFact } from './decide'
import { googleRedirectUri, readGoogleFlow, startGoogleFlow } from './flow'
import type { GoogleIntent } from './flow'
import { GoogleTokenError, verifyGoogleIdToken } from './id-token'
import type { GoogleIdentity } from './id-token'

/*
 * Retorno do Google e aplicação das regras. A rota entrega o que veio na URL e nos cookies; aqui se confere o fluxo (cookie
 * assinado, `state`), troca-se o código (PKCE), confere-se o `id_token` e se decide por `decideGoogle` SOB a trava da pessoa:
 * os fatos são relidos dentro da transação e a decisão é refeita, então nada decidido de antes é gravado. Cada transação
 * trava no máximo uma pessoa; se a decisão mudou de alvo, a transação toda recomeça (sem espera em círculo). Violação de
 * unicidade (dois retornos do mesmo Google novo, ou o mesmo e-mail em dois cadastros) também recomeça: na releitura o
 * perdedor entra na pessoa criada ou recebe a recusa certa, nunca uma segunda pessoa. Nada daqui vai para log.
 */

export type GoogleFailure = GoogleRefusal | 'not_configured' | 'flow_invalid' | 'canceled' | 'provider_error' | 'rate_limited'

export type GoogleOutcome =
  | { ok: true; session: { token: string; expiresAt: Date } | null; redirectTo: string }
  | { ok: false; failure: GoogleFailure; redirectTo: string }

/** Para onde voltar quando o fluxo falha: a tela de onde a pessoa saiu, com o motivo em `?google=`. */
export function failureTarget(intent: GoogleIntent | null, failure: GoogleFailure | 'vinculado'): string {
  const q = `google=${failure}`
  switch (intent?.kind) {
    case 'store_signup':
      return `/${encodeURIComponent(intent.slug)}/entrar?${q}`
    case 'invite':
      return `/convite/${encodeURIComponent(intent.token)}?${q}`
    case 'link':
      return `/conta?${q}`
    case 'sign_in':
    case undefined:
      return `/entrar?${q}`
  }
}

const recusa = (failure: GoogleFailure, intent: GoogleIntent | null): GoogleOutcome => ({ ok: false, failure, redirectTo: failureTarget(intent, failure) })

/** Começa o fluxo: limite por IP e o início (`null` do início = sem chaves). */
export async function beginGoogle(
  intent: GoogleIntent,
  ip: string | undefined,
  now: Date,
): Promise<{ url: string; cookie: string } | { failure: 'not_configured' | 'rate_limited' }> {
  // Sem IP confiável não há como separar quem chama (um balde só deixaria um atacante travar todo mundo): não conta.
  if (ip && !(await hitRateLimit(limitKey('google-inicio:ip', ipLimitKeyPart(ip)), LIMITS.authIp, now)).allowed) return { failure: 'rate_limited' }
  const inicio = await startGoogleFlow(intent, now)
  return inicio ?? { failure: 'not_configured' }
}

function fato(u: { id: string; email: string; passwordHash: string | null; googleSub: string | null }): PersonFact {
  return { id: u.id, email: u.email, state: personState(u), googleSub: u.googleSub }
}

const COLUNAS = { id: true, email: true, passwordHash: true, googleSub: true } as const

async function lerFatos(tx: Prisma.TransactionClient, i: { intent: GoogleIntent; identity: GoogleIdentity; store: StoreRef | null; currentId: string | null; now: Date }): Promise<GoogleFacts> {
  // Em série: uma transação interativa usa uma conexão só.
  const bySub = await tx.user.findUnique({ where: { googleSub: i.identity.sub }, select: COLUNAS })
  const byEmail = await tx.user.findUnique({ where: { email: i.identity.email }, select: COLUNAS })
  const invite = i.intent.kind === 'invite' ? await readInvite(i.intent.token, i.now, tx) : null
  const current = i.currentId !== null ? await tx.user.findUnique({ where: { id: i.currentId }, select: COLUNAS }) : null
  return {
    identity: i.identity,
    bySub: bySub && fato(bySub),
    byEmail: byEmail && fato(byEmail),
    invite: invite && { userId: invite.userId, email: invite.email },
    store: i.store,
    current: current && fato(current),
  }
}

/** A transação precisa recomeçar: a decisão mudou de alvo ou uma condição de gravação não vale mais. */
class Recomecar extends Error {}

const alvoDaTrava = (d: GoogleDecision): string | null => (d.kind === 'sign_in' || d.kind === 'activate' || d.kind === 'link' ? d.userId : null)

type Aplicado = { refuse: GoogleRefusal } | { userId: string; session: { token: string; expiresAt: Date } | null }

async function aplicar(
  i: { intent: GoogleIntent; identity: GoogleIdentity; store: StoreRef | null; currentId: string | null; sessionToken: string | undefined; ip: string | undefined; userAgent: string | undefined; now: Date },
): Promise<Aplicado> {
  return prisma.$transaction(async (tx) => {
    // 1) Decide com o que se vê agora só para saber QUEM travar; 2) trava; 3) relê e decide de novo, valendo esta.
    const previa = decideGoogle(i.intent, await lerFatos(tx, i))
    const alvo = alvoDaTrava(previa)
    if (alvo !== null) await lockUserAccess(tx, alvo)
    const d = decideGoogle(i.intent, await lerFatos(tx, i))
    if (d.kind === 'refuse') return { refuse: d.reason }
    if (alvoDaTrava(d) !== alvo) throw new Recomecar()

    const abrir = (userId: string) =>
      openSession(tx, {
        userId,
        now: i.now,
        ...(i.ip !== undefined ? { ip: i.ip } : {}),
        ...(i.userAgent !== undefined ? { userAgent: i.userAgent } : {}),
        ...(i.sessionToken !== undefined ? { previousToken: i.sessionToken } : {}),
        ...(i.intent.kind === 'store_signup' && i.store ? { customerBusinessId: i.store.businessId } : {}),
      })
    // Cadastro pela loja: a pessoa vira cliente dela (cria o cliente ou adota o de balcão com o mesmo e-mail).
    const ligarALoja = async (userId: string): Promise<void> => {
      if (i.intent.kind === 'store_signup' && i.store) await joinStoreIn(tx, userId, i.store.businessId, i.now)
    }

    switch (d.kind) {
      case 'sign_in': {
        // Regra 1: o e-mail do Google pode ter mudado do lado do Google; só o registro dele é atualizado.
        await tx.user.update({ where: { id: d.userId }, data: { googleEmail: i.identity.email } })
        await ligarALoja(d.userId)
        return { userId: d.userId, session: await abrir(d.userId) }
      }
      case 'activate': {
        // Conta pendente: o Google prova o e-mail, vincula, ativa e consome os convites. Quem já ficou ativa: recomeça e re-decide.
        if (!(await activatePerson(tx, d.userId, { google: { sub: i.identity.sub, email: i.identity.email } }, i.now))) throw new Recomecar()
        await revokeUserAccess(tx, d.userId, i.now)
        await ligarALoja(d.userId)
        return { userId: d.userId, session: await abrir(d.userId) }
      }
      case 'create': {
        const nome = (i.identity.name ?? i.identity.email.split('@')[0] ?? '').trim().slice(0, 120) || 'Cliente'
        const nova = await tx.user.create({
          data: {
            name: nome,
            searchName: searchKey(nome),
            email: i.identity.email,
            emailVerifiedAt: i.now,
            googleSub: i.identity.sub,
            googleEmail: i.identity.email,
            googleLinkedAt: i.now,
          },
          select: { id: true },
        })
        await ligarALoja(nova.id)
        return { userId: nova.id, session: await abrir(nova.id) }
      }
      case 'link': {
        const feito = await tx.user.updateMany({
          where: { id: d.userId, googleSub: null },
          data: { googleSub: i.identity.sub, googleEmail: i.identity.email, googleLinkedAt: i.now },
        })
        if (feito.count !== 1) throw new Recomecar()
        return { userId: d.userId, session: null }
      }
    }
  })
}

async function aplicarComRetentativa(i: Parameters<typeof aplicar>[0]): Promise<Aplicado> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await aplicar(i)
    } catch (err) {
      if (!(err instanceof Recomecar || isUniqueViolation(err)) || tentativa >= 2) throw err
    }
  }
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function handleGoogleCallback(i: {
  code: string | null
  state: string | null
  error: string | null
  flowCookie: string | undefined
  sessionToken: string | undefined
  ip?: string
  userAgent?: string
  now: Date
}): Promise<GoogleOutcome> {
  const flow = await readGoogleFlow(i.flowCookie, i.now)
  const intent = flow?.intent ?? null
  // Limite por IP antes de gastar o código no Google (mesmo teto do login).
  if (i.ip && !(await hitRateLimit(limitKey('google:ip', ipLimitKeyPart(i.ip)), LIMITS.loginIp, i.now)).allowed) return recusa('rate_limited', intent)
  if (flow === null || i.state === null || !iguais(i.state, flow.state)) return recusa('flow_invalid', intent)
  if (i.error !== null) return recusa(i.error === 'access_denied' ? 'canceled' : 'provider_error', intent)
  if (i.code === null || i.code === '') return recusa('flow_invalid', intent)
  const client = await googleClient()
  if (client === null) return recusa('not_configured', intent)

  const google = integrations().google
  let identity: GoogleIdentity
  try {
    const { idToken } = await google.exchangeCode({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      code: i.code,
      codeVerifier: flow.verifier,
      redirectUri: googleRedirectUri(),
    })
    identity = await verifyGoogleIdToken(idToken, { clientId: client.clientId, nonce: flow.nonce, now: i.now, keys: google.keys() })
  } catch (err) {
    if (err instanceof GoogleTokenError) return recusa('flow_invalid', intent)
    // Código recusado (vencido, já usado): refazer o fluxo resolve; o resto é falha do Google.
    if (err instanceof IntegrationError) return recusa(err.code === 'rejected' ? 'flow_invalid' : 'provider_error', intent)
    throw err
  }

  // Segundo limite, por identidade do Google: quem insiste com a mesma conta.
  if (!(await hitRateLimit(limitKey('google:sub', identity.sub), LIMITS.loginEmailWide, i.now)).allowed) return recusa('rate_limited', intent)

  const store = intent?.kind === 'store_signup' ? await findOpenStore(intent.slug) : null
  let currentId: string | null = null
  if (intent?.kind === 'link') {
    const sessao = await getPersonSession(i.sessionToken, i.now)
    currentId = sessao?.kind === 'person' ? sessao.user.id : null
  }
  const aplicado = await aplicarComRetentativa({
    intent: flow.intent,
    identity,
    store,
    currentId,
    sessionToken: i.sessionToken,
    ip: i.ip,
    userAgent: i.userAgent,
    now: i.now,
  })
  if ('refuse' in aplicado) return recusa(aplicado.refuse, intent)
  if (flow.intent.kind === 'link') return { ok: true, session: null, redirectTo: '/conta?google=vinculado' }
  if (flow.intent.kind === 'store_signup' && store) {
    // Cliente novo (ou antigo) da loja vai para o quiz ou para o `volta`; conta desativada na loja só vê a página da loja.
    const visita = aplicado.session
      ? await resolveStoreVisit({ token: aplicado.session.token, slug: store.slug, request: { ip: i.ip ?? null, userAgent: i.userAgent ?? null }, now: i.now })
      : null
    const destino = visita?.kind === 'customer' ? await customerLandingPath(visita, flow.intent.back ?? null) : `/${store.slug}`
    return { ok: true, session: aplicado.session, redirectTo: destino }
  }
  const destino = await destinationForUser(aplicado.userId, null)
  return { ok: true, session: aplicado.session, redirectTo: destinationPath(destino) }
}
