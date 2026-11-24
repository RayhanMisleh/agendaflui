import 'server-only'
import { areaLink } from '@/server/area-links'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { lockKeyRaw } from '@/server/db/tenant'
import { DomainError, parse, z } from '@/server/domain/errors'
import { emailSchema } from '@/server/domain/platform/schemas'
import { deliverAccessMail } from '@/server/notifications/deliver-mail'
import { isSafeRecipient } from '@/server/notifications/channels/types'
import { renderPasswordReset } from '@/server/notifications/render-password-reset'
import { addMinutes, toIsoInstant } from '@/server/time'
import { AuthError } from './actor'
import { ipLimitKeyPart } from './client-ip'
import { consumeInvites } from './person'
import { hashPassword, passwordSchema } from './password'
import { hitRateLimit, LIMITS, limitKey } from './rate-limit-db'
import type { RequestMeta } from './support-session'
import { generateToken, hashToken } from './tokens'

/*
 * Redefinição de senha por link, para QUALQUER pessoa (equipe, cliente, conta pendente ou só Google). Token opaco de 32 bytes
 * (no banco só o hash), 60 minutos, uso único por UPDATE condicional, um token vivo por pessoa. "Esqueci a senha" não revela
 * se o e-mail existe: a parte síncrona é igual para todos e tudo que depende do e-mail roda na continuação, depois da
 * resposta. O link prova o e-mail: define a senha, verifica o e-mail e, para conta pendente, a ativa e consome os convites;
 * para quem só tem Google, cria a primeira senha.
 */

export const RESET_TTL_MINUTES = 60

/** Mesma frase para link inexistente, vencido, usado ou de quem perdeu o acesso: a tela não revela qual dos casos aconteceu. */
export const RESET_INVALID_MESSAGE = 'Este link não vale mais. Peça um novo em "Esqueci a senha" na tela de entrada.'

const invalido = (): DomainError => new DomainError('not_found', RESET_INVALID_MESSAGE)

export type ResetTx = Prisma.TransactionClient

/**
 * ORDEM ÚNICA DE TRAVAS em todo o código de acesso (convite, papel, desativação, redefinição, troca de senha, cadastro e entrada pela loja):
 * `business_owners` da conta -> vínculos em ordem crescente de id -> linha do usuário -> tokens e sessões. Quem pega
 * travas só nessa ordem nunca espera em círculo (deadlock do Postgres, 40P01, que viraria erro 500).
 *
 * Trava os vínculos do usuário (todos, ativos ou não, de qualquer conta) em ordem crescente de id e depois a linha dele
 * (`FOR NO KEY UPDATE`: não bloqueia quem só lê nem as chaves estrangeiras de outras tabelas). `extra` junta ao mesmo
 * passo vínculos de OUTRAS pessoas que a transação também precisa (o do autor da ação), para a ordem crescente valer para o
 * conjunto todo. Quem já segura `business_owners` o fez antes de chamar. Trava repetida na mesma transação não espera.
 */
export async function lockUserAccess(
  tx: ResetTx,
  userId: string,
  extra: { id: string; businessId: string }[] = [],
): Promise<void> {
  const proprios = await tx.membership.findMany({ where: { userId }, select: { id: true, businessId: true } })
  const todos = new Map<string, { id: string; businessId: string }>()
  for (const v of [...proprios, ...extra]) todos.set(v.id.toLowerCase(), v)
  for (const id of [...todos.keys()].sort()) {
    const v = todos.get(id)
    if (v) await lockKeyRaw(tx, v.businessId, 'membership', v.id)
  }
  await tx.$queryRaw`select id from users where id = ${userId}::uuid for no key update`
}

/** Emite o token de redefinição e apaga o anterior ainda não usado. O token em texto só existe neste retorno, para ir no e-mail. */
export async function issuePasswordReset(
  tx: ResetTx,
  userId: string,
  now: Date,
  extra: { id: string; businessId: string }[] = [],
): Promise<{ token: string; expiresAt: Date }> {
  await lockUserAccess(tx, userId, extra)
  await tx.userToken.deleteMany({ where: { userId, purpose: 'PASSWORD_RESET', usedAt: null } })
  const { token, hash } = generateToken()
  const expiresAt = addMinutes(now, RESET_TTL_MINUTES)
  await tx.userToken.create({ data: { userId, purpose: 'PASSWORD_RESET', tokenHash: hash, expiresAt } })
  return { token, expiresAt }
}

/**
 * Revoga as sessões do painel do usuário (todas, de qualquer conta, menos a do token indicado). Chame depois de `lockUserAccess` (as travas dos vínculos já estão na transação).
 */
export async function revokeUserAccess(tx: ResetTx, userId: string, now: Date, keepSessionToken?: string): Promise<void> {
  await tx.session.updateMany({
    where: { userId, revokedAt: null, ...(keepSessionToken ? { NOT: { tokenHash: hashToken(keepSessionToken) } } : {}) },
    data: { revokedAt: now },
  })
}

const pedidoSchema = z.object({
  email: emailSchema.refine(isSafeRecipient, 'Informe um e-mail válido, por exemplo nome@exemplo.com.'),
})

/**
 * Conta um e-mail de redefinição para o endereço (3 em 15 minutos, 6 por dia). Vale para o "esqueci a senha" e para o envio
 * pelo dono ou gerente: os dois dividem o mesmo teto. `false` quando passou do limite.
 */
export async function allowResetEmail(email: string, now: Date, db?: ResetTx): Promise<boolean> {
  const curto = await hitRateLimit(limitKey('redefinir-painel:email', email), LIMITS.codeEmail, now, db)
  if (!curto.allowed) return false
  return (await hitRateLimit(limitKey('redefinir-painel-dia:email', email), LIMITS.codeEmailDaily, now, db)).allowed
}

/** Conta o pedido: origem primeiro (um IP barrado não gasta o teto do e-mail), depois o e-mail. */
async function allowRequest(email: string, ip: string | null | undefined, now: Date): Promise<boolean> {
  if (ip) {
    const porIp = await hitRateLimit(limitKey('redefinir-painel:ip', ipLimitKeyPart(ip)), LIMITS.panelResetIp, now)
    if (!porIp.allowed) return false
  }
  return allowResetEmail(email, now)
}

/**
 * "Esqueci a senha". Duas partes, para a resposta (e o tempo dela) ser a mesma exista o e-mail ou não: esta função só valida o
 * formato do e-mail (422 igual para todos) e DEVOLVE a continuação, que a ação agenda para depois da resposta
 * (`runAfterResponse`): limites, consulta, token e envio. Qualquer pessoa com o e-mail recebe o link.
 */
export async function requestPasswordReset(email: string, meta: RequestMeta, now: Date): Promise<() => Promise<void>> {
  const i = parse(pedidoSchema, { email })
  return async () => {
    if (!(await allowRequest(i.email, meta.ip, now))) return
    const pessoa = await prisma.user.findUnique({ where: { email: i.email }, select: { id: true, name: true } })
    if (!pessoa) return
    const emitido = await prisma.$transaction((tx) => issuePasswordReset(tx, pessoa.id, now))
    await deliverAccessMail(
      'password_reset',
      i.email,
      renderPasswordReset({
        name: pessoa.name,
        link: areaLink('app', `/redefinir-senha/${emitido.token}`),
        ttlMin: RESET_TTL_MINUTES,
      }),
    )
  }
}

/** Token vivo de redefinição: a condição que `readPasswordReset` e a troca usam. */
const tokenVivo = (hash: string, now: Date): Prisma.UserTokenWhereInput => ({
  tokenHash: hash,
  purpose: 'PASSWORD_RESET',
  usedAt: null,
  expiresAt: { gt: now },
})

/** E-mail de quem recebeu o link, ou `null` se o token não existe, venceu ou já foi usado. */
export async function readPasswordReset(token: string, now: Date): Promise<{ email: string } | null> {
  if (token === '') return null
  const linha = await prisma.userToken.findFirst({ where: tokenVivo(hashToken(token), now), select: { user: { select: { email: true } } } })
  return linha ? { email: linha.user.email } : null
}

const novaSenhaSchema = z.object({ password: passwordSchema })

/**
 * Define a senha nova com o link. Descobre a pessoa pelo hash do token SEM travar a linha do token, trava o acesso dela na
 * ordem única (`lockUserAccess`) e só então consome o token por um UPDATE condicional: de duas redefinições simultâneas só
 * uma passa. Na mesma transação: grava a senha e verifica o e-mail (um UPDATE só, porque conta ativa exige e-mail
 * verificado), consome os convites abertos e revoga TODAS as sessões da pessoa. Link que não vale: `not_found` com a mesma
 * frase em todos os casos.
 */
export async function resetPassword(i: { token: string; password: string }, _meta: RequestMeta, now: Date): Promise<void> {
  const { password } = parse(novaSenhaSchema, { password: i.password })
  const tokenHash = hashToken(i.token)
  const previo = i.token === '' ? null : await prisma.userToken.findFirst({ where: tokenVivo(tokenHash, now), select: { userId: true } })
  if (!previo) throw invalido()
  const passwordHash = await hashPassword(password)
  await prisma.$transaction(async (tx) => {
    await lockUserAccess(tx, previo.userId)
    const usado = await tx.userToken.updateMany({ where: { ...tokenVivo(tokenHash, now), userId: previo.userId }, data: { usedAt: now } })
    // Outra redefinição venceu a corrida: o link não vale mais.
    if (usado.count !== 1) throw invalido()
    const agora = toIsoInstant(now)
    await tx.$executeRaw`
      UPDATE users SET password_hash = ${passwordHash}, email_verified_at = coalesce(email_verified_at, ${agora}::timestamptz), updated_at = ${agora}::timestamptz
      WHERE id = ${previo.userId}::uuid`
    await consumeInvites(tx, previo.userId, now)
    await tx.userToken.deleteMany({ where: { userId: previo.userId, purpose: 'PASSWORD_RESET', usedAt: null } })
    await revokeUserAccess(tx, previo.userId, now)
  })
}

/**
 * Conta uma tentativa de redefinir. Com IP confiável, por IP (IPv6 como /64); sem IP, por token (token lixo nunca atrapalha
 * a redefinição de outra pessoa).
 */
export async function checkResetLimit(ip: string | undefined, token: string, now: Date): Promise<void> {
  const chave = ip ? limitKey('redefinir:ip', ipLimitKeyPart(ip)) : limitKey('redefinir:token', hashToken(token))
  const r = await hitRateLimit(chave, LIMITS.authIp, now)
  if (!r.allowed) throw new AuthError('rate_limited', r.retryAfterSec)
}
