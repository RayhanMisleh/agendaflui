import 'server-only'
import { areaLink } from '@/server/area-links'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { lockKeyRaw } from '@/server/db/tenant'
import { DomainError, parse, z } from '@/server/domain/errors'
import { emailSchema } from '@/server/domain/platform/schemas'
import { deliverAccessMail } from '@/server/notifications/deliver-mail'
import { isSafeRecipient } from '@/server/notifications/channels/types'
import { renderMemberInvite } from '@/server/notifications/render-invite'
import { renderPanelPasswordReset } from '@/server/notifications/render-password-reset'
import { roleLabel } from './role-labels'
import { addMinutes } from '@/server/time'
import { AuthError } from './actor'
import { ipLimitKeyPart } from './client-ip'
import { INVITE_TTL_DAYS, issueInvite } from './invites'
import { hashPassword, passwordSchema } from './password'
import { hitRateLimit, LIMITS, limitKey } from './rate-limit-db'
import type { RequestMeta } from './support-session'
import { generateToken, hashToken } from './tokens'

/*
 * Redefinição de senha do painel (donos e equipe). Token opaco de 32 bytes (no banco só o hash), 60 minutos, uso único
 * por UPDATE condicional, um token vivo por usuário. "Esqueci a senha" não revela se o e-mail existe: a parte síncrona é
 * igual para todos e tudo que depende do e-mail roda na continuação, depois da resposta. Quem ainda não definiu a senha
 * (convite pendente) recebe o convite de novo: convite e redefinição têm o mesmo efeito (definir a senha de quem prova
 * o e-mail), então não existe um segundo caminho para quem nunca aceitou o convite.
 */

export const PANEL_RESET_TTL_MINUTES = 60

/** Mesma frase para link inexistente, vencido, usado ou de quem perdeu o acesso: a tela não revela qual dos casos aconteceu. */
export const RESET_INVALID_MESSAGE = 'Este link não vale mais. Peça um novo em "Esqueci a senha" na tela de entrada.'

const invalido = (): DomainError => new DomainError('not_found', RESET_INVALID_MESSAGE)

export type ResetTx = Prisma.TransactionClient

/**
 * ORDEM ÚNICA DE TRAVAS em todo o código de acesso (convite, papel, desativação, redefinição, troca de senha, login do app):
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
export async function issuePanelPasswordReset(
  tx: ResetTx,
  userId: string,
  now: Date,
  extra: { id: string; businessId: string }[] = [],
): Promise<{ token: string; expiresAt: Date }> {
  await lockUserAccess(tx, userId, extra)
  await tx.userToken.deleteMany({ where: { userId, purpose: 'PASSWORD_RESET', usedAt: null } })
  const { token, hash } = generateToken()
  const expiresAt = addMinutes(now, PANEL_RESET_TTL_MINUTES)
  await tx.userToken.create({ data: { userId, purpose: 'PASSWORD_RESET', tokenHash: hash, expiresAt } })
  return { token, expiresAt }
}

/**
 * Revoga as sessões do painel do usuário (todas, de qualquer conta, menos a do token indicado) e os tokens do app de todos
 * os vínculos dele, ativos ou não. Chame depois de `lockUserAccess` (as travas dos vínculos já estão na transação).
 */
export async function revokeUserAccess(tx: ResetTx, userId: string, now: Date, keepSessionToken?: string): Promise<void> {
  const vinculos = await tx.membership.findMany({ where: { userId }, select: { id: true } })
  await tx.session.updateMany({
    where: { userId, revokedAt: null, ...(keepSessionToken ? { NOT: { tokenHash: hashToken(keepSessionToken) } } : {}) },
    data: { revokedAt: now },
  })
  if (vinculos.length > 0) {
    await tx.refreshToken.updateMany({
      where: { membershipId: { in: vinculos.map((v) => v.id) }, revokedAt: null },
      data: { revokedAt: now },
    })
  }
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
 * formato do e-mail (422 igual para todos) e DEVOLVE a continuação, que a rota agenda para depois da resposta
 * (`runAfterResponse`): limites, consulta, token e envio. Sem vínculo ativo numa conta ativa: nada é enviado.
 */
export async function requestPanelPasswordReset(email: string, meta: RequestMeta, now: Date): Promise<() => Promise<void>> {
  const i = parse(pedidoSchema, { email })
  return async () => {
    if (!(await allowRequest(i.email, meta.ip, now))) return
    const usuario = await prisma.user.findUnique({
      where: { email: i.email },
      select: {
        id: true,
        name: true,
        passwordHash: true,
        memberships: {
          where: { active: true, business: { status: 'ACTIVE' } },
          select: { role: true, business: { select: { name: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
        },
      },
    })
    const vinculo = usuario?.memberships[0]
    if (!usuario || !vinculo) return
    if (usuario.passwordHash === null) {
      const convite = await prisma.$transaction(async (tx) => {
        await lockUserAccess(tx, usuario.id)
        const atual = await tx.user.findUnique({ where: { id: usuario.id }, select: { passwordHash: true } })
        // Definiu a senha entre a consulta e a trava: o convite não vale mais, e o pedido acaba aqui.
        return atual?.passwordHash === null ? issueInvite(tx, usuario.id, now) : null
      })
      if (!convite) return
      await deliverAccessMail(
        'invite',
        i.email,
        renderMemberInvite({
          name: usuario.name,
          businessName: vinculo.business.name,
          roleLabel: roleLabel(vinculo.role, 'Profissional'),
          link: areaLink('painel', `/definir-senha/${convite.token}`),
          ttlDays: INVITE_TTL_DAYS,
        }),
      )
      return
    }
    const emitido = await prisma.$transaction((tx) => issuePanelPasswordReset(tx, usuario.id, now))
    await deliverAccessMail(
      'password_reset',
      i.email,
      renderPanelPasswordReset({
        name: usuario.name,
        link: areaLink('painel', `/redefinir-senha/${emitido.token}`),
        ttlMin: PANEL_RESET_TTL_MINUTES,
      }),
    )
  }
}

/** Quem ainda entra: ao menos um vínculo ativo numa conta ativa (a mesma condição do pedido de redefinição). */
const aindaEntra: Prisma.UserWhereInput = { memberships: { some: { active: true, business: { status: 'ACTIVE' } } } }

/** Token vivo de redefinição de quem ainda entra: a condição que `readPanelPasswordReset` e a troca usam. */
const tokenVivo = (hash: string, now: Date): Prisma.UserTokenWhereInput => ({
  tokenHash: hash,
  purpose: 'PASSWORD_RESET',
  usedAt: null,
  expiresAt: { gt: now },
  user: aindaEntra,
})

/** E-mail de quem recebeu o link, ou `null` se o token não existe, venceu, já foi usado ou a pessoa perdeu o acesso. */
export async function readPanelPasswordReset(token: string, now: Date): Promise<{ email: string } | null> {
  if (token === '') return null
  const linha = await prisma.userToken.findFirst({ where: tokenVivo(hashToken(token), now), select: { user: { select: { email: true } } } })
  return linha ? { email: linha.user.email } : null
}

const novaSenhaSchema = z.object({ password: passwordSchema })

/**
 * Define a senha nova com o link. Descobre a pessoa pelo hash do token SEM travar a linha do token, trava o acesso dela na
 * ordem única (`lockUserAccess`) e só então consome o token por um UPDATE condicional: de duas redefinições simultâneas só
 * uma passa. Na mesma transação, revoga todas as sessões do painel da pessoa e os tokens do app de todos os vínculos dela.
 * Link que não vale: `not_found` com a mesma frase em todos os casos.
 */
export async function resetPanelPassword(i: { token: string; password: string }, _meta: RequestMeta, now: Date): Promise<void> {
  const { password } = parse(novaSenhaSchema, { password: i.password })
  const tokenHash = hashToken(i.token)
  const previo = i.token === '' ? null : await prisma.userToken.findFirst({ where: tokenVivo(tokenHash, now), select: { userId: true } })
  if (!previo) throw invalido()
  const passwordHash = await hashPassword(password)
  await prisma.$transaction(async (tx) => {
    await lockUserAccess(tx, previo.userId)
    const usado = await tx.userToken.updateMany({ where: { ...tokenVivo(tokenHash, now), userId: previo.userId }, data: { usedAt: now } })
    // Outra redefinição ou a perda do último acesso ativo venceu a corrida: o link não vale mais.
    if (usado.count !== 1) throw invalido()
    await tx.user.update({ where: { id: previo.userId }, data: { passwordHash } })
    await tx.userToken.deleteMany({ where: { userId: previo.userId, purpose: { in: ['PASSWORD_RESET', 'INVITE'] }, usedAt: null } })
    await revokeUserAccess(tx, previo.userId, now)
  })
}

/**
 * Conta uma tentativa de redefinir. Com IP confiável, por IP (IPv6 como /64); sem IP, por token (token lixo nunca atrapalha
 * a redefinição de outra pessoa).
 */
export async function checkPanelResetLimit(ip: string | undefined, token: string, now: Date): Promise<void> {
  const chave = ip ? limitKey('redefinir:ip', ipLimitKeyPart(ip)) : limitKey('redefinir:token', hashToken(token))
  const r = await hitRateLimit(chave, LIMITS.authIp, now)
  if (!r.allowed) throw new AuthError('rate_limited', r.retryAfterSec)
}
